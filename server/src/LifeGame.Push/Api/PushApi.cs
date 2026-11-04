using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using LifeGame.Push.Push;
using LifeGame.Push.Scheduling;
using LifeGame.Push.Storage;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Api;

public static class PushApi
{
    public const string SecretHeader = "X-Subscription-Secret";
    public const string AccessKeyHeader = "X-Access-Key";

    public static IEndpointRouteBuilder MapPushApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api").RequireRateLimiting("api");

        api.MapGet("/push/public-key", (VapidKeys keys) => Results.Ok(new PublicKeyResponse(keys.PublicKey)));

        api.MapPost("/subscriptions", CreateAsync);
        api.MapPut("/subscriptions/{id}", UpdateAsync);
        api.MapPut("/subscriptions/{id}/progress", ProgressAsync);
        api.MapPut("/subscriptions/{id}/events", EventsAsync);
        api.MapPost("/subscriptions/{id}/test", TestAsync);
        api.MapDelete("/subscriptions/{id}", DeleteAsync);

        // приїзди з геозон iOS Shortcuts
        api.MapPost("/subscriptions/{id}/arrival-key", ArrivalKeyAsync);
        api.MapPost("/subscriptions/{id}/arrivals/claim", ClaimArrivalsAsync);
        api.MapPost("/arrive/{key}/{place}", ArriveAsync);
        return app;
    }

    private static async Task<IResult> CreateAsync(
        CreateSubscriptionRequest request,
        HttpContext http,
        SubscriptionStore store,
        IOptions<PushOptions> options,
        TimeProvider time,
        CancellationToken ct)
    {
        var opts = options.Value;
        if (!string.IsNullOrEmpty(opts.AccessKey) &&
            !FixedEquals(http.Request.Headers[AccessKeyHeader].ToString(), opts.AccessKey))
            return Results.Problem("Access key is missing or wrong", statusCode: StatusCodes.Status401Unauthorized);

        var error = RequestValidator.Subscription(request.Subscription, opts, out var sub)
            ?? RequestValidator.TimeZone(request.TimeZone)
            ?? RequestValidator.Reminders(request.Reminders);
        if (error is not null) return BadRequest(error);

        var secret = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var now = time.GetUtcNow();
        // той самий браузер підписався знову — замінюємо старий запис
        var existing = store.FindByEndpoint(sub!.Endpoint);
        if (existing is not null) await store.RemoveAsync(existing.Id, ct);

        var record = new SubscriptionRecord
        {
            Id = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
            SecretHash = Hash(secret),
            Endpoint = sub.Endpoint,
            P256dh = sub.P256dh,
            Auth = sub.Auth,
            TimeZone = request.TimeZone!,
            Reminders = request.Reminders ?? [],
            // ключ приїздів, черги й пара переживають перепідписку того самого браузера
            ArrivalKeyHash = existing?.ArrivalKeyHash,
            Arrivals = existing?.Arrivals ?? [],
            LastArrival = existing?.LastArrival,
            Actions = existing?.Actions ?? [],
            Summary = existing?.Summary,
            PartnerId = existing?.PartnerId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await store.UpsertAsync(record, ct);
        if (existing?.PartnerId is { } partnerOf)
            await store.UpdateAsync(partnerOf, p => p.PartnerId == existing.Id ? p with { PartnerId = record.Id } : p, ct);
        return Results.Created($"/api/subscriptions/{record.Id}", new CreatedSubscriptionResponse(record.Id, secret));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        UpdateSubscriptionRequest request,
        HttpContext http,
        SubscriptionStore store,
        IOptions<PushOptions> options,
        TimeProvider time,
        CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;

        ValidSubscription? sub = null;
        var error = (request.Subscription is null ? null : RequestValidator.Subscription(request.Subscription, options.Value, out sub))
            ?? (request.TimeZone is null ? null : RequestValidator.TimeZone(request.TimeZone))
            ?? RequestValidator.Reminders(request.Reminders);
        if (error is not null) return BadRequest(error);

        var updated = await store.UpdateAsync(id, s => s with
        {
            Endpoint = sub?.Endpoint ?? s.Endpoint,
            P256dh = sub?.P256dh ?? s.P256dh,
            Auth = sub?.Auth ?? s.Auth,
            TimeZone = request.TimeZone ?? s.TimeZone,
            Reminders = request.Reminders ?? s.Reminders,
            UpdatedAt = time.GetUtcNow(),
        }, ct);
        return updated is null ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult> ProgressAsync(
        string id,
        ProgressRequest request,
        HttpContext http,
        SubscriptionStore store,
        IPushSender sender,
        TimeProvider time,
        CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        if (RequestValidator.Progress(request) is { } error) return BadRequest(error);
        if (request.Summary is not null && RequestValidator.Summary(request.Summary) is { } summaryError)
            return BadRequest(summaryError);

        string[] newlyDone = [];
        var updated = await store.UpdateAsync(id, s =>
        {
            var summary = request.Summary is null ? s.Summary : request.Summary with { Date = request.Date!, UpdatedAt = time.GetUtcNow() };
            if (request.Summary is not null)
                newlyDone = GameRules.NewlyDone(s.Summary, summary!);
            return s with
            {
                Progress = new DayProgress { Date = request.Date!, DoneQuests = request.DoneQuests ?? [] },
                Summary = summary,
            };
        }, ct);
        if (updated is null) return Results.NotFound();

        // партнер дізнається про виконаний квест
        if (newlyDone.Length > 0 && updated.PartnerId is { } partnerId && store.Get(partnerId) is { } partner)
        {
            var payload = ReminderPlanner.BuildPayload(
                updated.Summary!.Name,
                GameRules.PartnerNotice(newlyDone),
                "partner",
                "./?screen=progress");
            try
            {
                await sender.SendAsync(partner, payload, "partner", ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // сповіщення партнерові — не критично
            }
        }
        return Results.NoContent();
    }

    /// <summary>Замінює всі разові нагадування пристрою (клієнт надсилає повний актуальний список).</summary>
    private static async Task<IResult> EventsAsync(
        string id, EventsRequest request, HttpContext http, SubscriptionStore store, TimeProvider time, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        if (RequestValidator.Events(request, time.GetUtcNow()) is { } error) return BadRequest(error);

        var events = request.Events!;
        var keep = events.Select(ReminderPlanner.EventKey).ToHashSet();
        var updated = await store.UpdateAsync(id, s => s with
        {
            Events = events,
            // забуваємо позначки «надіслано» для справ, яких уже немає
            LastSent = s.LastSent
                .Where(kv => !kv.Key.StartsWith("event:", StringComparison.Ordinal) || keep.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value),
            UpdatedAt = time.GetUtcNow(),
        }, ct);
        return updated is null ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult> TestAsync(
        string id, HttpContext http, SubscriptionStore store, IPushSender sender, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        var subscription = store.Get(id)!;
        var payload = ReminderPlanner.BuildPayload(
            "Гра про життя", "Тестове нагадування: сповіщення працюють!", "reminder-test", "./");
        var result = await sender.SendAsync(subscription, payload, "test", ct);

        switch (result.Outcome)
        {
            case PushOutcome.Delivered:
                return Results.Ok(new { delivered = true });
            case PushOutcome.Gone:
                await store.RemoveAsync(id, ct);
                return Results.Problem("The browser subscription has expired. Subscribe again.", statusCode: StatusCodes.Status410Gone);
            default:
                return Results.Problem(
                    $"Push service answered {(int?)result.Status}: {result.Detail}",
                    statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static async Task<IResult> DeleteAsync(string id, HttpContext http, SubscriptionStore store, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        if (store.Get(id)?.PartnerId is { } partnerId)
            await store.UpdateAsync(partnerId, p => p.PartnerId == id ? p with { PartnerId = null } : p, ct);
        await store.RemoveAsync(id, ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Видає новий ключ приїздів (старий перестає працювати). Ключ іде в URL автоматизації
    /// Shortcuts і вміє лише відмічати приїзди, тому секрет підписки з телефону не виходить.
    /// </summary>
    private static async Task<IResult> ArrivalKeyAsync(
        string id, HttpContext http, SubscriptionStore store, TimeProvider time, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        var key = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(24));
        var updated = await store.UpdateAsync(id, s => s with
        {
            ArrivalKeyHash = Hash(key),
            UpdatedAt = time.GetUtcNow(),
        }, ct);
        return updated is null ? Results.NotFound() : Results.Ok(new ArrivalKeyResponse(key));
    }

    /// <summary>Віддає незабрані приїзди й очищає чергу.</summary>
    private static async Task<IResult> ClaimArrivalsAsync(
        string id, HttpContext http, SubscriptionStore store, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        Arrival[] claimed = [];
        QueuedAction[] actions = [];
        var updated = await store.UpdateAsync(id, s =>
        {
            claimed = s.Arrivals;
            actions = s.Actions;
            return claimed.Length == 0 && actions.Length == 0 ? s : s with { Arrivals = [], Actions = [] };
        }, ct);
        return updated is null ? Results.NotFound() : Results.Ok(new ArrivalsResponse(claimed, actions));
    }

    /// <summary>
    /// Викликає автоматизація iOS «Коли я прибуваю…» → «Отримати вміст URL» (POST).
    /// Приїзд стає в чергу, а на телефон приходить сповіщення.
    /// </summary>
    private static async Task<IResult> ArriveAsync(
        string key,
        string place,
        SubscriptionStore store,
        IPushSender sender,
        TimeProvider time,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        var record = string.IsNullOrEmpty(key) ? null : store.FindByArrivalKey(Hash(key));
        if (record is null) return Results.NotFound();
        var normalized = ArrivalPlanner.NormalizePlace(place);
        if (normalized is null) return BadRequest("Place must be home, office or gym");

        var accepted = false;
        var updated = await store.UpdateAsync(record.Id, s =>
        {
            var next = ArrivalPlanner.Record(s, normalized, time.GetUtcNow());
            accepted = next is not null;
            return next ?? s;
        }, ct);
        if (updated is null) return Results.NotFound();
        if (!accepted) return Results.Ok(new ArriveResponse(false));

        var (title, body) = ArrivalPlanner.Notice(normalized);
        var payload = ReminderPlanner.BuildPayload(title, body, "arrive", "./?screen=today");
        try
        {
            var result = await sender.SendAsync(updated, payload, "arrive", ct);
            if (result.Outcome != PushOutcome.Delivered)
                loggers.CreateLogger("Arrivals").LogWarning(
                    "Arrival notice for {Id} not delivered: {Outcome} {Status}", record.Id, result.Outcome, result.Status);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // приїзд уже збережено — сповіщення лише бонус
            loggers.CreateLogger("Arrivals").LogWarning(ex, "Arrival notice for {Id} failed", record.Id);
        }
        return Results.Accepted(value: new ArriveResponse(true));
    }

    /// <summary>Перевіряє секрет підписки. Невідомий id і хибний секрет дають однакову відповідь.</summary>
    internal static IResult? Authorize(string id, HttpContext http, SubscriptionStore store)
    {
        var secret = http.Request.Headers[SecretHeader].ToString();
        var record = store.Get(id);
        if (record is null || string.IsNullOrEmpty(secret) || !FixedEquals(Hash(secret), record.SecretHash))
            return Results.NotFound();
        return null;
    }

    internal static string Hash(string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    internal static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    internal static IResult BadRequest(string error) =>
        Results.Problem(error, statusCode: StatusCodes.Status400BadRequest, title: "Invalid request");
}

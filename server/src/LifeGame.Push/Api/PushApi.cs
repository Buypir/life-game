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
        api.MapPost("/subscriptions/{id}/test", TestAsync);
        api.MapDelete("/subscriptions/{id}", DeleteAsync);
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
            CreatedAt = now,
            UpdatedAt = now,
        };
        await store.UpsertAsync(record, ct);
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
        string id, ProgressRequest request, HttpContext http, SubscriptionStore store, CancellationToken ct)
    {
        if (Authorize(id, http, store) is { } denied) return denied;
        if (RequestValidator.Progress(request) is { } error) return BadRequest(error);

        var updated = await store.UpdateAsync(id, s => s with
        {
            Progress = new DayProgress { Date = request.Date!, DoneQuests = request.DoneQuests ?? [] },
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
        await store.RemoveAsync(id, ct);
        return Results.NoContent();
    }

    /// <summary>Перевіряє секрет підписки. Невідомий id і хибний секрет дають однакову відповідь.</summary>
    private static IResult? Authorize(string id, HttpContext http, SubscriptionStore store)
    {
        var secret = http.Request.Headers[SecretHeader].ToString();
        var record = store.Get(id);
        if (record is null || string.IsNullOrEmpty(secret) || !FixedEquals(Hash(secret), record.SecretHash))
            return Results.NotFound();
        return null;
    }

    private static string Hash(string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    private static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    private static IResult BadRequest(string error) =>
        Results.Problem(error, statusCode: StatusCodes.Status400BadRequest, title: "Invalid request");
}

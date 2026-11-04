using LifeGame.Push.Scheduling;
using LifeGame.Push.Storage;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Api;

/// <summary>Siri й «Команди», режим пари, резервна копія на сервері й стан для пристрою на ESP32.</summary>
public static class GameApi
{
    public const int MaxBackupBytes = 512 * 1024;

    public static IEndpointRouteBuilder MapGameApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api").RequireRateLimiting("api");
        api.MapPost("/act/{key}/{action}", ActAsync);
        api.MapGet("/device/{key}", DeviceAsync);
        api.MapPost("/subscriptions/{id}/pair-code", PairCodeAsync);
        api.MapPost("/subscriptions/{id}/pair", PairAsync);
        api.MapGet("/subscriptions/{id}/partner", PartnerAsync);
        api.MapDelete("/subscriptions/{id}/pair", UnpairAsync);
        api.MapPut("/subscriptions/{id}/backup", PutBackupAsync);
        api.MapGet("/subscriptions/{id}/backup", GetBackupAsync);
        return app;
    }

    /// <summary>
    /// «Гей Siri, почистив зуби» → «Отримати вміст URL» (POST /api/act/{key}/brush).
    /// Для Apple Health: POST /api/act/{key}/health з JSON { steps, sleep, workout }.
    /// </summary>
    private static async Task<IResult> ActAsync(
        string key, string action, HttpContext http, SubscriptionStore store, TimeProvider time, CancellationToken ct)
    {
        var record = string.IsNullOrEmpty(key) ? null : store.FindByArrivalKey(PushApi.Hash(key));
        if (record is null) return Results.NotFound();
        action = action.Trim().ToLowerInvariant();
        if (!RequestValidator.IsActionId(action)) return PushApi.BadRequest("Unknown action id");

        var queued = new QueuedAction { Action = action, At = time.GetUtcNow() };
        if (action == "health")
        {
            HealthBody? body = null;
            try
            {
                if (http.Request.ContentLength is > 0 or null && http.Request.HasJsonContentType())
                    body = await http.Request.ReadFromJsonAsync<HealthBody>(ct);
            }
            catch (System.Text.Json.JsonException)
            {
                return PushApi.BadRequest("Body must be JSON { steps, sleep, workout }");
            }
            if (RequestValidator.Health(body) is { } error) return PushApi.BadRequest(error);
            queued = queued with { Steps = body!.Steps, Sleep = body.Sleep, Workout = body.Workout };
        }

        var accepted = false;
        var updated = await store.UpdateAsync(record.Id, s =>
        {
            var next = GameRules.QueueAction(s, queued);
            accepted = next is not null;
            return next ?? s;
        }, ct);
        if (updated is null) return Results.NotFound();
        return accepted ? Results.Accepted(value: new ArriveResponse(true)) : Results.Ok(new ArriveResponse(false));
    }

    /// <summary>Стан для пристрою: ім'я, рівень, серія, наступна справа й час нагадувань.</summary>
    private static IResult DeviceAsync(string key, SubscriptionStore store, TimeProvider time)
    {
        var record = string.IsNullOrEmpty(key) ? null : store.FindByArrivalKey(PushApi.Hash(key));
        if (record is null) return Results.NotFound();
        var reminders = record.Reminders
            .Select(r => new DeviceReminder(r.Id, r.Time, r.Enabled, r.Title))
            .ToArray();
        return Results.Ok(new DeviceStateResponse(record.Summary, reminders, record.TimeZone, time.GetUtcNow()));
    }

    private static async Task<IResult> PairCodeAsync(
        string id, HttpContext http, SubscriptionStore store, TimeProvider time, CancellationToken ct)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        string code;
        do code = GameRules.NewPairCode();
        while (store.All().Any(s => s.PairCode == code && s.Id != id));
        var expires = time.GetUtcNow() + GameRules.PairCodeLifetime;
        await store.UpdateAsync(id, s => s with { PairCode = code, PairCodeExpires = expires }, ct);
        return Results.Ok(new PairCodeResponse(code, expires));
    }

    private static async Task<IResult> PairAsync(
        string id, PairRequest request, HttpContext http, SubscriptionStore store, TimeProvider time, CancellationToken ct)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        var code = request.Code?.Trim();
        var now = time.GetUtcNow();
        var partner = string.IsNullOrEmpty(code)
            ? null
            : store.All().FirstOrDefault(s =>
                s.Id != id && s.PairCode == code && s.PairCodeExpires is { } exp && exp > now);
        if (partner is null) return PushApi.BadRequest("Код не підходить або вже прострочений");

        // старі пари розриваємо
        foreach (var other in new[] { store.Get(id)?.PartnerId, partner.PartnerId })
        {
            if (other is not null && other != id && other != partner.Id)
                await store.UpdateAsync(other, s => s with { PartnerId = null }, ct);
        }
        await store.UpdateAsync(partner.Id, s => s with { PartnerId = id, PairCode = null, PairCodeExpires = null }, ct);
        await store.UpdateAsync(id, s => s with { PartnerId = partner.Id, PairCode = null, PairCodeExpires = null }, ct);
        return Results.Ok(new PartnerResponse(store.Get(partner.Id)?.Summary));
    }

    private static IResult PartnerAsync(string id, HttpContext http, SubscriptionStore store)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        var partnerId = store.Get(id)?.PartnerId;
        var partner = partnerId is null ? null : store.Get(partnerId);
        return partner is null ? Results.NotFound() : Results.Ok(new PartnerResponse(partner.Summary));
    }

    private static async Task<IResult> UnpairAsync(string id, HttpContext http, SubscriptionStore store, CancellationToken ct)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        if (store.Get(id)?.PartnerId is { } partnerId)
            await store.UpdateAsync(partnerId, s => s.PartnerId == id ? s with { PartnerId = null } : s, ct);
        await store.UpdateAsync(id, s => s with { PartnerId = null }, ct);
        return Results.NoContent();
    }

    /// <summary>Резервна копія прогресу (JSON до 512 КБ) — окремим файлом, щоб не роздувати subscriptions.json.</summary>
    private static async Task<IResult> PutBackupAsync(
        string id, HttpContext http, SubscriptionStore store, IOptions<PushOptions> options, CancellationToken ct)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        if (http.Request.ContentLength > MaxBackupBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await http.Request.Body.ReadAsync(chunk, ct)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxBackupBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }
        try
        {
            using var _ = System.Text.Json.JsonDocument.Parse(buffer.ToArray());
        }
        catch (System.Text.Json.JsonException)
        {
            return PushApi.BadRequest("Backup must be JSON");
        }
        var path = BackupPath(options.Value, id);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        await File.WriteAllBytesAsync(temp, buffer.ToArray(), ct);
        File.Move(temp, path, overwrite: true);
        return Results.NoContent();
    }

    private static IResult GetBackupAsync(string id, HttpContext http, SubscriptionStore store, IOptions<PushOptions> options)
    {
        if (PushApi.Authorize(id, http, store) is { } denied) return denied;
        var path = BackupPath(options.Value, id);
        return File.Exists(path) ? Results.File(path, "application/json") : Results.NotFound();
    }

    /// <summary>Id генерує сервер (base64url), тож у шлях не потрапить нічого зайвого.</summary>
    internal static string BackupPath(PushOptions options, string id) =>
        Path.Combine(Path.GetFullPath(options.DataDirectory), "backups", $"{id}.json");
}

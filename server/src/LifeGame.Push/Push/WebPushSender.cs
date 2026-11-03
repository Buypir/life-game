using System.Buffers.Text;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Push;

public enum PushOutcome
{
    Delivered,
    /// <summary>Підписка більше не існує (404/410) — її треба видалити.</summary>
    Gone,
    /// <summary>Тимчасова помилка (мережа, 429, 5xx) — можна спробувати пізніше.</summary>
    Retry,
    /// <summary>Запит відхилено (400, 401, 403, 413) — повтор не допоможе.</summary>
    Rejected,
}

public sealed record PushResult(PushOutcome Outcome, HttpStatusCode? Status = null, string? Detail = null);

public interface IPushSender
{
    Task<PushResult> SendAsync(SubscriptionRecord subscription, byte[] payload, string? topic, CancellationToken ct);
}

/// <summary>Надсилає зашифроване повідомлення на endpoint підписки з VAPID-авторизацією.</summary>
public sealed class WebPushSender(
    HttpClient http,
    VapidKeys keys,
    IOptions<PushOptions> options,
    TimeProvider time,
    ILogger<WebPushSender> logger) : IPushSender
{
    private readonly ConcurrentDictionary<string, (string Jwt, DateTimeOffset RenewAfter)> _jwtCache = new();

    public async Task<PushResult> SendAsync(
        SubscriptionRecord subscription, byte[] payload, string? topic, CancellationToken ct)
    {
        var endpoint = new Uri(subscription.Endpoint);
        var body = WebPushEncryption.Encrypt(
            payload,
            Base64Url.DecodeFromChars(subscription.P256dh),
            Base64Url.DecodeFromChars(subscription.Auth));

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new ByteArrayContent(body),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", options.Value.TimeToLiveSeconds.ToString());
        request.Headers.TryAddWithoutValidation("Urgency", "high");
        if (!string.IsNullOrEmpty(topic)) request.Headers.TryAddWithoutValidation("Topic", topic);
        request.Headers.TryAddWithoutValidation(
            "Authorization", $"vapid t={GetJwt(endpoint)}, k={keys.PublicKey}");

        try
        {
            using var response = await http.SendAsync(request, ct);
            var status = response.StatusCode;
            if (response.IsSuccessStatusCode) return new PushResult(PushOutcome.Delivered, status);

            var detail = await ReadDetail(response, ct);
            var outcome = status switch
            {
                HttpStatusCode.NotFound or HttpStatusCode.Gone => PushOutcome.Gone,
                HttpStatusCode.TooManyRequests => PushOutcome.Retry,
                >= HttpStatusCode.InternalServerError => PushOutcome.Retry,
                _ => PushOutcome.Rejected,
            };
            logger.LogWarning(
                "Push to {Host} failed: {Status} {Detail}", endpoint.Host, (int)status, detail);
            return new PushResult(outcome, status, detail);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Push to {Host} failed with a network error", endpoint.Host);
            return new PushResult(PushOutcome.Retry, null, ex.Message);
        }
    }

    /// <summary>JWT живе 12 годин; оновлюємо його, коли лишилося менше 6.</summary>
    private string GetJwt(Uri endpoint)
    {
        var audience = endpoint.GetLeftPart(UriPartial.Authority);
        var now = time.GetUtcNow();
        if (_jwtCache.TryGetValue(audience, out var cached) && cached.RenewAfter > now) return cached.Jwt;
        var jwt = keys.CreateJwt(audience, options.Value.VapidSubject, now.AddHours(12));
        _jwtCache[audience] = (jwt, now.AddHours(6));
        return jwt;
    }

    private static async Task<string> ReadDetail(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            return text.Length > 300 ? text[..300] : text;
        }
        catch
        {
            return string.Empty;
        }
    }
}

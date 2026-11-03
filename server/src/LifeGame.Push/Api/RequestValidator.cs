using System.Buffers.Text;
using System.Globalization;
using LifeGame.Push.Scheduling;

namespace LifeGame.Push.Api;

public sealed record ValidSubscription(string Endpoint, string P256dh, string Auth);

/// <summary>Перевірка всього, що приходить від клієнта. Повертає текст помилки або null.</summary>
public static class RequestValidator
{
    public const int MaxReminders = 12;

    public static string? Subscription(PushSubscriptionDto? dto, PushOptions options, out ValidSubscription? result)
    {
        result = null;
        if (dto?.Endpoint is not { Length: > 0 and <= 2048 } endpoint)
            return "subscription.endpoint is required";
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri))
            return "subscription.endpoint must be an absolute URL";
        var schemeOk = uri.Scheme == Uri.UriSchemeHttps || (options.AllowInsecureEndpoints && uri.Scheme == Uri.UriSchemeHttp);
        if (!schemeOk)
            return "subscription.endpoint must use https";
        if (!IsAllowedHost(uri.Host, options.AllowedEndpointHosts))
            return $"push service {uri.Host} is not allowed";

        if (!TryDecode(dto.Keys?.P256dh, out var p256dh) || p256dh.Length != 65 || p256dh[0] != 0x04)
            return "subscription.keys.p256dh must be an uncompressed P-256 key";
        if (!TryDecode(dto.Keys?.Auth, out var auth) || auth.Length != 16)
            return "subscription.keys.auth must be 16 bytes";

        result = new ValidSubscription(endpoint, dto.Keys!.P256dh!, dto.Keys.Auth!);
        return null;
    }

    public static string? TimeZone(string? id) =>
        ReminderPlanner.FindTimeZone(id) is null ? "timeZone must be an IANA time zone, e.g. Europe/Kyiv" : null;

    public static string? Reminders(Reminder[]? reminders)
    {
        if (reminders is null) return null;
        if (reminders.Length > MaxReminders) return $"at most {MaxReminders} reminders";
        var ids = new HashSet<string>();
        foreach (var r in reminders)
        {
            if (r is null) return "reminder must not be null";
            if (string.IsNullOrWhiteSpace(r.Id) || r.Id.Length > 40) return "reminder.id is required (max 40 chars)";
            if (!ids.Add(r.Id)) return $"duplicate reminder id {r.Id}";
            if (!TimeOnly.TryParseExact(r.Time, ReminderPlanner.TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                return $"reminder {r.Id}: time must be HH:mm";
            if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Length > 80) return $"reminder {r.Id}: title is required (max 80 chars)";
            if (string.IsNullOrWhiteSpace(r.Body) || r.Body.Length > 200) return $"reminder {r.Id}: body is required (max 200 chars)";
            if (r.Days is null || r.Days.Any(d => d is < 0 or > 6) || r.Days.Distinct().Count() != r.Days.Length)
                return $"reminder {r.Id}: days must be distinct values 0..6";
            if (r.Url is null || r.Url.Length > 200 || r.Url.StartsWith("//") || Uri.IsWellFormedUriString(r.Url, UriKind.Absolute))
                return $"reminder {r.Id}: url must be a relative path";
        }
        return null;
    }

    public static string? Progress(ProgressRequest? request)
    {
        if (request is null) return "body is required";
        if (!DateOnly.TryParseExact(request.Date, ReminderPlanner.DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            return "date must be yyyy-MM-dd";
        if (request.DoneQuests is { } done && (done.Length > 20 || done.Any(q => string.IsNullOrEmpty(q) || q.Length > 40)))
            return "doneQuests: up to 20 ids, max 40 chars each";
        return null;
    }

    public static bool IsAllowedHost(string host, IEnumerable<string> allowed) =>
        allowed.Any(suffix =>
            host.Equals(suffix, StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase));

    private static bool TryDecode(string? value, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrEmpty(value) || value.Length > 200) return false;
        try
        {
            bytes = Base64Url.DecodeFromChars(value.TrimEnd('='));
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

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

    public const int MaxEvents = 100;

    public static string? Events(EventsRequest? request, DateTimeOffset now)
    {
        if (request?.Events is not { } events) return "events is required";
        if (events.Length > MaxEvents) return $"at most {MaxEvents} events";
        var ids = new HashSet<string>();
        foreach (var e in events)
        {
            if (e is null) return "event must not be null";
            if (string.IsNullOrWhiteSpace(e.Id) || e.Id.Length > 40) return "event.id is required (max 40 chars)";
            if (!ids.Add(e.Id)) return $"duplicate event id {e.Id}";
            if (e.NotifyAt < now.AddDays(-2) || e.NotifyAt > now.AddDays(400)) return $"event {e.Id}: notifyAt is out of range";
            if (string.IsNullOrWhiteSpace(e.Title) || e.Title.Length > 80) return $"event {e.Id}: title is required (max 80 chars)";
            if (string.IsNullOrWhiteSpace(e.Body) || e.Body.Length > 200) return $"event {e.Id}: body is required (max 200 chars)";
            if (e.Url is null || e.Url.Length > 200 || e.Url.StartsWith("//") || Uri.IsWellFormedUriString(e.Url, UriKind.Absolute))
                return $"event {e.Id}: url must be a relative path";
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

    private static readonly System.Text.RegularExpressions.Regex ActionId = new("^[a-z][a-z0-9-]{0,31}$");
    private static readonly System.Text.RegularExpressions.Regex Color = new("^#[0-9a-fA-F]{6}$");
    private static readonly string[] Locations = ["home", "office", "gym", "road", "park", "cafe"];

    public static bool IsActionId(string? action) => action is not null && ActionId.IsMatch(action);

    public static string? Health(HealthBody? body)
    {
        if (body is null || (body.Steps is null && body.Sleep is null && body.Workout is null))
            return "health needs steps, sleep or workout";
        if (body.Steps is < 0 or > 200_000) return "steps must be 0..200000";
        if (body.Sleep is < 0 or > 24) return "sleep must be 0..24 hours";
        if (body.Workout is < 0 or > 1440) return "workout must be 0..1440 minutes";
        return null;
    }

    public static string? Summary(PlayerSummary s)
    {
        if (string.IsNullOrWhiteSpace(s.Name) || s.Name.Length > 24) return "summary.name: 1..24 chars";
        if (s.Level is < 1 or > 10_000 || s.Streak is < 0 or > 100_000 || s.Coins is < -1_000_000 or > 10_000_000)
            return "summary: level, streak or coins out of range";
        if (!Locations.Contains(s.Location)) return "summary.location is unknown";
        if (s.DoneTitles.Length > 10 || s.DoneTitles.Any(t => string.IsNullOrWhiteSpace(t) || t.Length > 40))
            return "summary.doneTitles: up to 10, max 40 chars";
        if (!Color.IsMatch(s.Shirt)) return "summary.shirt must be #RRGGBB";
        if (s.Hat is not null && !IsActionId(s.Hat) || s.Face is not null && !IsActionId(s.Face))
            return "summary.hat/face must be item ids";
        if (s.NextTaskId is not null && !IsActionId(s.NextTaskId)) return "summary.nextTaskId is invalid";
        if (s.NextTaskTitle is { Length: > 60 }) return "summary.nextTaskTitle: max 60 chars";
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

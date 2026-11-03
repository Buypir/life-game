using System.Globalization;
using System.Text.Json;

namespace LifeGame.Push.Scheduling;

/// <summary>Чисті функції: чи настав час нагадування і який вигляд має push-повідомлення.</summary>
public static class ReminderPlanner
{
    public const string DateFormat = "yyyy-MM-dd";
    public const string TimeFormat = "HH:mm";

    /// <summary>
    /// Перейменовані зони. Браузери часто віддають старі назви з CLDR (Chrome і Safari кажуть
    /// «Europe/Kiev»), а в нових образах Linux старі назви винесено в окремий пакет tzdata-legacy.
    /// </summary>
    private static readonly Dictionary<string, string> Renamed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Europe/Kiev"] = "Europe/Kyiv",
        ["Europe/Uzhgorod"] = "Europe/Kyiv",
        ["Europe/Zaporozhye"] = "Europe/Kyiv",
        ["Asia/Calcutta"] = "Asia/Kolkata",
        ["Asia/Saigon"] = "Asia/Ho_Chi_Minh",
        ["Asia/Katmandu"] = "Asia/Kathmandu",
        ["Asia/Rangoon"] = "Asia/Yangon",
        ["America/Godthab"] = "America/Nuuk",
        ["Atlantic/Faeroe"] = "Atlantic/Faroe",
    };

    public static TimeZoneInfo? FindTimeZone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64) return null;
        if (TryFind(id) is { } zone) return zone;
        if (Renamed.TryGetValue(id, out var modern) && TryFind(modern) is { } renamed) return renamed;
        var legacy = Renamed.FirstOrDefault(p => p.Value.Equals(id, StringComparison.OrdinalIgnoreCase)).Key;
        return legacy is null ? null : TryFind(legacy);
    }

    private static TimeZoneInfo? TryFind(string id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return null;
        }
    }

    public static string LocalDate(DateTimeOffset utcNow, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(utcNow, zone).ToString(DateFormat, CultureInfo.InvariantCulture);

    /// <summary>
    /// Нагадування, які треба надіслати зараз: настав їхній час (але не пізніше ніж на <paramref name="grace"/>),
    /// сьогодні їх ще не надсилали, і відповідний квест ще не виконано.
    /// </summary>
    public static IReadOnlyList<Reminder> DueReminders(SubscriptionRecord subscription, DateTimeOffset utcNow, TimeSpan grace)
    {
        var zone = FindTimeZone(subscription.TimeZone) ?? TimeZoneInfo.Utc;
        var local = TimeZoneInfo.ConvertTime(utcNow, zone);
        var today = local.ToString(DateFormat, CultureInfo.InvariantCulture);
        var done = subscription.Progress?.Date == today
            ? subscription.Progress.DoneQuests.ToHashSet()
            : [];

        var due = new List<Reminder>();
        foreach (var reminder in subscription.Reminders)
        {
            if (!reminder.Enabled) continue;
            if (!TimeOnly.TryParseExact(reminder.Time, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
                continue;
            if (reminder.Days.Length > 0 && !reminder.Days.Contains((int)local.DayOfWeek)) continue;
            if (subscription.LastSent.TryGetValue(reminder.Id, out var sentOn) && sentOn == today) continue;
            if (done.Contains(reminder.Id)) continue;

            var late = local.TimeOfDay - at.ToTimeSpan();
            if (late >= TimeSpan.Zero && late <= grace) due.Add(reminder);
        }
        return due;
    }

    /// <summary>
    /// Вміст у форматі, який розуміє Angular Service Worker: він сам покаже сповіщення,
    /// а натискання відкриє застосунок за адресою <c>url</c>.
    /// </summary>
    public static byte[] BuildPayload(string title, string body, string tag, string url) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            notification = new
            {
                title,
                body,
                tag,
                icon = "icons/icon-192x192.png",
                badge = "icons/icon-96x96.png",
                data = new
                {
                    onActionClick = new
                    {
                        @default = new { operation = "navigateLastFocusedOrOpen", url },
                    },
                },
            },
        });
}

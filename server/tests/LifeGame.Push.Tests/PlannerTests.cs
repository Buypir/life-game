using System.Text.Json;
using LifeGame.Push.Scheduling;

namespace LifeGame.Push.Tests;

public static class PlannerTests
{
    private static readonly TimeSpan Grace = TimeSpan.FromMinutes(90);

    // 2026-11-04 — середа; Київ узимку = UTC+2
    private static DateTimeOffset KyivTime(int hour, int minute, int day = 4) =>
        new(2026, 11, day, hour, minute, 0, TimeSpan.FromHours(2));

    private static SubscriptionRecord Subscription(params Reminder[] reminders) => new()
    {
        Id = "s1",
        SecretHash = "x",
        Endpoint = "https://fcm.googleapis.com/fcm/send/abc",
        P256dh = "p",
        Auth = "a",
        TimeZone = "Europe/Kyiv",
        Reminders = reminders,
    };

    private static Reminder Morning(string time = "07:30") =>
        new() { Id = "morning", Time = time, Title = "Ранок", Body = "Час прокидатись" };

    [Test]
    public static void NotDueBeforeTime()
    {
        Check.Equal(0, ReminderPlanner.DueReminders(Subscription(Morning()), KyivTime(7, 29), Grace).Count);
    }

    [Test]
    public static void DueAtTimeAndWithinGrace()
    {
        var sub = Subscription(Morning());
        Check.Equal(1, ReminderPlanner.DueReminders(sub, KyivTime(7, 30), Grace).Count);
        Check.Equal(1, ReminderPlanner.DueReminders(sub, KyivTime(9, 0), Grace).Count);
    }

    [Test]
    public static void NotDueAfterGrace()
    {
        Check.Equal(0, ReminderPlanner.DueReminders(Subscription(Morning()), KyivTime(9, 1), Grace).Count);
    }

    [Test]
    public static void UsesSubscriberTimeZone()
    {
        var utc = Subscription(Morning()) with { TimeZone = "UTC" };
        // 07:45 у Києві = 05:45 UTC — для UTC-підписки ще рано
        Check.Equal(0, ReminderPlanner.DueReminders(utc, KyivTime(7, 45), Grace).Count);
        Check.Equal(1, ReminderPlanner.DueReminders(utc, KyivTime(9, 45), Grace).Count);
    }

    [Test]
    public static void NotSentTwiceOnTheSameDayButAgainTomorrow()
    {
        var sub = Subscription(Morning()) with { LastSent = new() { ["morning"] = "2026-11-04" } };
        Check.Equal(0, ReminderPlanner.DueReminders(sub, KyivTime(7, 40), Grace).Count);
        Check.Equal(1, ReminderPlanner.DueReminders(sub, KyivTime(7, 40, day: 5), Grace).Count);
    }

    [Test]
    public static void SkipsQuestsAlreadyDoneToday()
    {
        var sub = Subscription(Morning()) with
        {
            Progress = new DayProgress { Date = "2026-11-04", DoneQuests = ["morning"] },
        };
        Check.Equal(0, ReminderPlanner.DueReminders(sub, KyivTime(7, 40), Grace).Count);
        // вчорашній прогрес не рахується
        Check.Equal(1, ReminderPlanner.DueReminders(sub, KyivTime(7, 40, day: 5), Grace).Count);
    }

    [Test]
    public static void RespectsDisabledAndDaysOfWeek()
    {
        var disabled = Morning() with { Enabled = false };
        var weekendOnly = Morning() with { Id = "weekend", Days = [0, 6] };
        var wednesday = Morning() with { Id = "wed", Days = [3] };
        var due = ReminderPlanner.DueReminders(Subscription(disabled, weekendOnly, wednesday), KyivTime(7, 35), Grace);
        Check.Equal(1, due.Count);
        Check.Equal("wed", due[0].Id);
    }

    [Test]
    public static void UnknownTimeZoneFallsBackToUtc()
    {
        var sub = Subscription(Morning()) with { TimeZone = "Mars/Olympus" };
        Check.Equal(1, ReminderPlanner.DueReminders(sub, KyivTime(9, 35), Grace).Count);
    }

    [Test]
    public static void PayloadMatchesAngularServiceWorkerFormat()
    {
        var json = JsonDocument.Parse(ReminderPlanner.BuildPayload("Ранок", "Час прокидатись", "reminder-morning", "./?quest=morning"));
        var notification = json.RootElement.GetProperty("notification");
        Check.Equal("Ранок", notification.GetProperty("title").GetString());
        Check.Equal("Час прокидатись", notification.GetProperty("body").GetString());
        Check.Equal("reminder-morning", notification.GetProperty("tag").GetString());
        var click = notification.GetProperty("data").GetProperty("onActionClick").GetProperty("default");
        Check.Equal("navigateLastFocusedOrOpen", click.GetProperty("operation").GetString());
        Check.Equal("./?quest=morning", click.GetProperty("url").GetString());
    }
}

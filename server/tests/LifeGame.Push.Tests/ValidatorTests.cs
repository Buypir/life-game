using LifeGame.Push.Api;

namespace LifeGame.Push.Tests;

public static class ValidatorTests
{
    private static readonly PushOptions Options = new();

    private static PushSubscriptionDto Dto(string endpoint, FakeBrowser browser) =>
        new(endpoint, new PushKeysDto(browser.P256dh, browser.Auth));

    [Test]
    public static void AcceptsKnownPushServices()
    {
        using var browser = new FakeBrowser();
        foreach (var endpoint in new[]
                 {
                     "https://web.push.apple.com/QGuQyavXutnMH8",
                     "https://fcm.googleapis.com/fcm/send/abc:def",
                     "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
                 })
        {
            Check.Null(RequestValidator.Subscription(Dto(endpoint, browser), Options, out var valid));
            Check.NotNull(valid);
        }
    }

    [Test]
    public static void RejectsUnknownHostsAndPlainHttp()
    {
        using var browser = new FakeBrowser();
        Check.Contains("not allowed", RequestValidator.Subscription(Dto("https://evil.example.com/x", browser), Options, out _));
        Check.Contains("not allowed", RequestValidator.Subscription(Dto("https://notpush.apple.com.evil.io/x", browser), Options, out _));
        Check.Contains("https", RequestValidator.Subscription(Dto("http://fcm.googleapis.com/x", browser), Options, out _));
    }

    [Test]
    public static void RejectsBadKeys()
    {
        var dto = new PushSubscriptionDto("https://fcm.googleapis.com/x", new PushKeysDto("AAAA", "BBBB"));
        Check.Contains("p256dh", RequestValidator.Subscription(dto, Options, out _));
    }

    [Test]
    public static void ValidatesTimeZones()
    {
        Check.Null(RequestValidator.TimeZone("Europe/Kyiv"));
        Check.Null(RequestValidator.TimeZone("Europe/Kiev"));
        Check.NotNull(RequestValidator.TimeZone("Nowhere/City"));
        Check.NotNull(RequestValidator.TimeZone(null));
    }

    [Test]
    public static void ValidatesReminders()
    {
        Reminder Make(string time = "07:30", string url = "./", int[]? days = null) =>
            new() { Id = "morning", Time = time, Title = "Ранок", Body = "Час", Url = url, Days = days ?? [] };

        Check.Null(RequestValidator.Reminders([Make()]));
        Check.Null(RequestValidator.Reminders(null));
        Check.Contains("HH:mm", RequestValidator.Reminders([Make(time: "7:30am")]));
        Check.Contains("relative", RequestValidator.Reminders([Make(url: "https://evil.example.com")]));
        Check.Contains("relative", RequestValidator.Reminders([Make(url: "//evil.example.com")]));
        Check.Contains("days", RequestValidator.Reminders([Make(days: [7])]));
        Check.Contains("duplicate", RequestValidator.Reminders([Make(), Make()]));
    }

    [Test]
    public static void ValidatesEvents()
    {
        var now = new DateTimeOffset(2026, 11, 4, 10, 0, 0, TimeSpan.Zero);
        EventReminder Make(string id = "t1", int addMinutes = 60, string url = "./") =>
            new() { Id = id, NotifyAt = now.AddMinutes(addMinutes), Title = "Стрижка", Body = "О 14:00", Url = url };

        Check.Null(RequestValidator.Events(new EventsRequest([Make(), Make("t2")]), now));
        Check.Null(RequestValidator.Events(new EventsRequest([]), now));
        Check.Contains("required", RequestValidator.Events(new EventsRequest(null), now));
        Check.Contains("duplicate", RequestValidator.Events(new EventsRequest([Make(), Make()]), now));
        Check.Contains("out of range", RequestValidator.Events(new EventsRequest([Make(addMinutes: -5 * 24 * 60)]), now));
        Check.Contains("relative", RequestValidator.Events(new EventsRequest([Make(url: "https://evil.example.com")]), now));
    }

    [Test]
    public static void ValidatesProgress()
    {
        Check.Null(RequestValidator.Progress(new ProgressRequest("2026-11-04", ["morning"])));
        Check.Contains("yyyy-MM-dd", RequestValidator.Progress(new ProgressRequest("04.11.2026", [])));
    }
}

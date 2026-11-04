using LifeGame.Push.Api;
using LifeGame.Push.Scheduling;

namespace LifeGame.Push.Tests;

public static class GameRulesTests
{
    private static readonly DateTimeOffset Nine = new(2026, 11, 4, 9, 0, 0, TimeSpan.FromHours(2));

    private static SubscriptionRecord Subscription() => new()
    {
        Id = "s1",
        SecretHash = "x",
        Endpoint = "https://web.push.apple.com/abc",
        P256dh = "p",
        Auth = "a",
        TimeZone = "Europe/Kyiv",
    };

    [Test]
    public static void SiriDoubleRunIsOneAction()
    {
        var sub = GameRules.QueueAction(Subscription(), new QueuedAction { Action = "brush", At = Nine })!;
        Check.Null(GameRules.QueueAction(sub, new QueuedAction { Action = "brush", At = Nine.AddSeconds(20) }));
        Check.NotNull(GameRules.QueueAction(sub, new QueuedAction { Action = "wash", At = Nine.AddSeconds(20) }));
        Check.NotNull(GameRules.QueueAction(sub, new QueuedAction { Action = "brush", At = Nine.AddMinutes(2) }));
    }

    [Test]
    public static void HealthUpdatesAreNeverDeduplicated()
    {
        var sub = GameRules.QueueAction(Subscription(), new QueuedAction { Action = "health", At = Nine, Steps = 3000 })!;
        sub = GameRules.QueueAction(sub, new QueuedAction { Action = "health", At = Nine.AddSeconds(5), Steps = 9000 })!;
        Check.Equal(2, sub.Actions.Length);
    }

    [Test]
    public static void ActionQueueIsBounded()
    {
        var sub = Subscription();
        for (var i = 0; i < GameRules.MaxActions + 10; i++)
            sub = GameRules.QueueAction(sub, new QueuedAction { Action = "health", At = Nine.AddMinutes(i), Steps = i })!;
        Check.Equal(GameRules.MaxActions, sub.Actions.Length);
    }

    [Test]
    public static void PartnerHearsOnlyAboutNewQuests()
    {
        var morning = new PlayerSummary { Date = "2026-11-04", DoneTitles = ["Ранок"] };
        var both = morning with { DoneTitles = ["Ранок", "Робота"] };
        Check.Equal("Робота", string.Join(",", GameRules.NewlyDone(morning, both)));
        Check.Equal(0, GameRules.NewlyDone(both, both).Length);
        // новий день — усе знову нове
        Check.Equal(1, GameRules.NewlyDone(both, morning with { Date = "2026-11-05" }).Length);
        Check.True(GameRules.PartnerNotice(["Ранок"]).Contains("«Ранок»"));
    }

    [Test]
    public static void PairCodesAreSixDigits()
    {
        for (var i = 0; i < 20; i++)
            Check.True(System.Text.RegularExpressions.Regex.IsMatch(GameRules.NewPairCode(), "^[0-9]{6}$"));
    }

    [Test]
    public static void ValidatesGameRequests()
    {
        Check.True(RequestValidator.IsActionId("brush-evening"));
        Check.False(RequestValidator.IsActionId("../etc"));
        Check.False(RequestValidator.IsActionId("Brush"));
        Check.NotNull(RequestValidator.Health(new HealthBody(null, null, null)));
        Check.NotNull(RequestValidator.Health(new HealthBody(-1, null, null)));
        Check.Null(RequestValidator.Health(new HealthBody(8000, 7.5, null)));
        Check.Null(RequestValidator.Summary(new PlayerSummary { Name = "Бодя", Level = 5, Shirt = "#16A34A", Hat = "hat-cap" }));
        Check.NotNull(RequestValidator.Summary(new PlayerSummary { Name = "", Level = 5 }));
        Check.NotNull(RequestValidator.Summary(new PlayerSummary { Name = "x", Shirt = "red" }));
        Check.NotNull(RequestValidator.Summary(new PlayerSummary { Name = "x", Location = "moon" }));
    }
}

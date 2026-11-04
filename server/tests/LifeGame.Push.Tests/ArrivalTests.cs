using LifeGame.Push.Scheduling;

namespace LifeGame.Push.Tests;

public static class ArrivalTests
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
    public static void AcceptsOnlyKnownPlaces()
    {
        Check.Equal("office", ArrivalPlanner.NormalizePlace(" Office "));
        Check.Equal("gym", ArrivalPlanner.NormalizePlace("gym"));
        Check.Equal(null, ArrivalPlanner.NormalizePlace("park"));
        Check.Equal(null, ArrivalPlanner.NormalizePlace(null));
    }

    [Test]
    public static void QueuesArrivals()
    {
        var sub = ArrivalPlanner.Record(Subscription(), "office", Nine)!;
        sub = ArrivalPlanner.Record(sub, "home", Nine.AddHours(9))!;
        Check.Equal(2, sub.Arrivals.Length);
        Check.Equal("office", sub.Arrivals[0].Place);
        Check.Equal("home", sub.LastArrival!.Place);
    }

    [Test]
    public static void IgnoresRepeatedGeofence()
    {
        var sub = ArrivalPlanner.Record(Subscription(), "office", Nine)!;
        Check.Equal(null, ArrivalPlanner.Record(sub, "office", Nine.AddMinutes(4)));
        // інше місце або після вікна — нормальний приїзд
        Check.True(ArrivalPlanner.Record(sub, "gym", Nine.AddMinutes(4)) is not null);
        Check.True(ArrivalPlanner.Record(sub, "office", Nine.AddMinutes(11)) is not null);
    }

    [Test]
    public static void DuplicateCheckSurvivesClaim()
    {
        var sub = ArrivalPlanner.Record(Subscription(), "office", Nine)! with { Arrivals = [] };
        Check.Equal(null, ArrivalPlanner.Record(sub, "office", Nine.AddMinutes(2)));
    }

    [Test]
    public static void KeepsQueueBounded()
    {
        var sub = Subscription();
        for (var i = 0; i < ArrivalPlanner.MaxPending + 5; i++)
            sub = ArrivalPlanner.Record(sub, i % 2 == 0 ? "home" : "office", Nine.AddHours(i))!;
        Check.Equal(ArrivalPlanner.MaxPending, sub.Arrivals.Length);
        Check.Equal(Nine.AddHours(ArrivalPlanner.MaxPending + 4), sub.Arrivals[^1].At);
    }

    [Test]
    public static void NoticeNamesThePlace()
    {
        Check.True(ArrivalPlanner.Notice("office").Body.Contains("офіс"));
        Check.True(ArrivalPlanner.Notice("home").Title.Contains("удома"));
    }
}

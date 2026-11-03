using System.Text.Json;
using LifeGame.Push.Push;
using LifeGame.Push.Scheduling;
using Microsoft.Extensions.Logging.Abstractions;

namespace LifeGame.Push.Tests;

public sealed class WorkerTests : IDisposable
{
    private readonly TempData _data = new();
    private readonly ManualTime _time = new(new DateTimeOffset(2026, 11, 4, 5, 25, 0, TimeSpan.Zero)); // 07:25 у Києві
    private readonly FakeSender _sender = new();

    private (ReminderWorker Worker, Storage.SubscriptionStore Store) Create()
    {
        var options = _data.Options();
        var store = _data.Store(options);
        var worker = new ReminderWorker(store, _sender, options, _time, NullLogger<ReminderWorker>.Instance);
        return (worker, store);
    }

    private static SubscriptionRecord Subscription(string id, params Reminder[] reminders) => new()
    {
        Id = id,
        SecretHash = "x",
        Endpoint = $"https://fcm.googleapis.com/fcm/send/{id}",
        P256dh = "p",
        Auth = "a",
        TimeZone = "Europe/Kyiv",
        Reminders = reminders,
    };

    private static Reminder Reminder(string id, string time) =>
        new() { Id = id, Time = time, Title = $"Квест {id}", Body = "Час!", Url = $"./?quest={id}" };

    [Test]
    public async Task SendsOnceWhenTheTimeComes()
    {
        var (worker, store) = Create();
        await store.UpsertAsync(Subscription("s1", Reminder("morning", "07:30")));

        Check.Equal(0, await worker.TickAsync(default));
        _time.Advance(TimeSpan.FromMinutes(5));
        Check.Equal(1, await worker.TickAsync(default));
        _time.Advance(TimeSpan.FromMinutes(1));
        Check.Equal(0, await worker.TickAsync(default));

        var (subId, payload, topic) = _sender.Sent.Single();
        Check.Equal("s1", subId);
        Check.Equal("morning", topic);
        var title = JsonDocument.Parse(payload).RootElement.GetProperty("notification").GetProperty("title").GetString();
        Check.Equal("Квест morning", title);
        Check.Equal("2026-11-04", store.Get("s1")!.LastSent["morning"]);
    }

    [Test]
    public async Task SkipsQuestMarkedDone()
    {
        var (worker, store) = Create();
        await store.UpsertAsync(Subscription("s1", Reminder("morning", "07:00"), Reminder("work", "07:00")) with
        {
            Progress = new DayProgress { Date = "2026-11-04", DoneQuests = ["morning"] },
        });
        Check.Equal(1, await worker.TickAsync(default));
        Check.Equal("work", _sender.Sent.Single().Topic);
    }

    [Test]
    public async Task RemovesGoneSubscriptions()
    {
        var (worker, store) = Create();
        await store.UpsertAsync(Subscription("s1", Reminder("morning", "07:00")));
        _sender.Outcomes.Enqueue(PushOutcome.Gone);
        await worker.TickAsync(default);
        Check.Null(store.Get("s1"));
    }

    [Test]
    public async Task RetriesTransientFailuresWithBackoff()
    {
        var (worker, store) = Create();
        await store.UpsertAsync(Subscription("s1", Reminder("morning", "07:00")));
        _sender.Outcomes.Enqueue(PushOutcome.Retry);

        Check.Equal(0, await worker.TickAsync(default));
        _time.Advance(TimeSpan.FromSeconds(30));
        Check.Equal(0, await worker.TickAsync(default)); // ще чекаємо (бекоф 1 хв)
        _time.Advance(TimeSpan.FromMinutes(1));
        Check.Equal(1, await worker.TickAsync(default));
        Check.Equal("2026-11-04", store.Get("s1")!.LastSent["morning"]);
    }

    [Test]
    public async Task StoreSurvivesRestart()
    {
        var (_, store) = Create();
        await store.UpsertAsync(Subscription("s1", Reminder("morning", "07:30")));
        await store.UpdateAsync("s1", s => s with { TimeZone = "UTC" });

        var reopened = _data.Store();
        Check.Equal("UTC", reopened.Get("s1")!.TimeZone);
        Check.Equal("morning", reopened.Get("s1")!.Reminders.Single().Id);
        Check.True(await reopened.RemoveAsync("s1"));
        Check.Equal(0, _data.Store().All().Count);
    }

    [Test]
    public static void TopicIsSanitized()
    {
        Check.Equal("morning", ReminderWorker.SafeTopic("morning"));
        Check.Equal("brush-evening", ReminderWorker.SafeTopic("brush-evening"));
        Check.Equal("abc", ReminderWorker.SafeTopic("a b/c"));
        Check.Null(ReminderWorker.SafeTopic("!!!"));
    }

    public void Dispose() => _data.Dispose();
}

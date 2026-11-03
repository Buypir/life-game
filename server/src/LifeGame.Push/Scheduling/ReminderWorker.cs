using LifeGame.Push.Push;
using LifeGame.Push.Storage;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Scheduling;

/// <summary>Кожні WorkerIntervalSeconds перевіряє всі підписки й надсилає нагадування, час яких настав.</summary>
public sealed class ReminderWorker(
    SubscriptionStore store,
    IPushSender sender,
    IOptions<PushOptions> options,
    TimeProvider time,
    ILogger<ReminderWorker> logger) : BackgroundService
{
    private static readonly TimeSpan[] Backoff =
        [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(10)];

    private readonly Dictionary<string, (int Attempts, DateTimeOffset NextTry)> _retries = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var period = TimeSpan.FromSeconds(Math.Max(1, options.Value.WorkerIntervalSeconds));
        using var timer = new PeriodicTimer(period, time);
        do
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Reminder tick failed");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>Один прохід планувальника. Публічний, щоб його можна було викликати з тестів.</summary>
    public async Task<int> TickAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var grace = TimeSpan.FromMinutes(options.Value.GraceMinutes);
        var sent = 0;

        foreach (var subscription in store.All())
        {
            var zone = ReminderPlanner.FindTimeZone(subscription.TimeZone) ?? TimeZoneInfo.Utc;
            var today = ReminderPlanner.LocalDate(now, zone);

            foreach (var reminder in ReminderPlanner.DueReminders(subscription, now, grace))
            {
                var key = $"{subscription.Id}/{reminder.Id}/{today}";
                if (_retries.TryGetValue(key, out var retry) && retry.NextTry > now) continue;

                var payload = ReminderPlanner.BuildPayload(
                    reminder.Title, reminder.Body, $"reminder-{reminder.Id}", reminder.Url);
                var result = await sender.SendAsync(subscription, payload, SafeTopic(reminder.Id), ct);

                switch (result.Outcome)
                {
                    case PushOutcome.Delivered:
                        sent++;
                        _retries.Remove(key);
                        await MarkSent(subscription.Id, reminder.Id, today, ct);
                        logger.LogInformation("Sent reminder {Reminder} to {Subscription}", reminder.Id, subscription.Id);
                        break;

                    case PushOutcome.Gone:
                        await store.RemoveAsync(subscription.Id, ct);
                        logger.LogInformation("Subscription {Subscription} is gone, removed", subscription.Id);
                        goto nextSubscription;

                    case PushOutcome.Rejected:
                        _retries.Remove(key);
                        await MarkSent(subscription.Id, reminder.Id, today, ct);
                        break;

                    case PushOutcome.Retry:
                        var attempts = (retry.Attempts) + 1;
                        if (attempts > Backoff.Length)
                        {
                            _retries.Remove(key);
                            await MarkSent(subscription.Id, reminder.Id, today, ct);
                        }
                        else
                        {
                            _retries[key] = (attempts, now + Backoff[attempts - 1]);
                        }
                        break;
                }
            }

            nextSubscription:;
        }

        PruneRetries(now);
        return sent;
    }

    private Task MarkSent(string subscriptionId, string reminderId, string date, CancellationToken ct) =>
        store.UpdateAsync(subscriptionId, s => s with
        {
            LastSent = new Dictionary<string, string>(s.LastSent) { [reminderId] = date },
        }, ct);

    private void PruneRetries(DateTimeOffset now)
    {
        foreach (var (key, value) in _retries.ToList())
        {
            if (value.NextTry < now - TimeSpan.FromDays(1)) _retries.Remove(key);
        }
    }

    /// <summary>Заголовок Topic: до 32 символів base64url-алфавіту.</summary>
    internal static string? SafeTopic(string id)
    {
        var clean = new string(id.Where(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_').ToArray());
        return clean.Length == 0 ? null : clean[..Math.Min(32, clean.Length)];
    }
}

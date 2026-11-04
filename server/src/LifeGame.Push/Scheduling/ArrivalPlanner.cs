namespace LifeGame.Push.Scheduling;

/// <summary>
/// Приїзди з геозон iOS Shortcuts: перевірка місця, відсіювання повторів і текст сповіщення.
/// Чиста логіка без I/O, щоб її легко тестувати.
/// </summary>
public static class ArrivalPlanner
{
    public static readonly string[] Places = ["home", "office", "gym"];

    /// <summary>Геозона iOS іноді спрацьовує кілька разів поспіль — повтор того самого місця в цьому вікні ігноруємо.</summary>
    public static readonly TimeSpan DuplicateWindow = TimeSpan.FromMinutes(10);

    /// <summary>Скільки незабраних приїздів тримати (старші відкидаються).</summary>
    public const int MaxPending = 50;

    public static string? NormalizePlace(string? place)
    {
        var value = place?.Trim().ToLowerInvariant();
        return value is not null && Places.Contains(value) ? value : null;
    }

    /// <summary>Додає приїзд у чергу. Повертає null, якщо це повтор.</summary>
    public static SubscriptionRecord? Record(SubscriptionRecord subscription, string place, DateTimeOffset now)
    {
        if (subscription.LastArrival is { } last &&
            last.Place == place &&
            now - last.At >= TimeSpan.Zero &&
            now - last.At < DuplicateWindow)
            return null;

        var arrival = new Arrival { Place = place, At = now };
        var pending = subscription.Arrivals.Append(arrival).TakeLast(MaxPending).ToArray();
        return subscription with { Arrivals = pending, LastArrival = arrival };
    }

    public static (string Title, string Body) Notice(string place) => place switch
    {
        "home" => ("Герой удома", "Поїздку додому зараховано. Відкрий гру, щоб забрати XP."),
        "office" => ("Герой в офісі", "Поїздку в офіс зараховано. Відкрий гру, щоб забрати XP."),
        _ => ("Герой у спортзалі", "Поїздку в зал зараховано. Відкрий гру, щоб забрати XP."),
    };
}

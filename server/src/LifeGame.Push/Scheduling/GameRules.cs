using System.Security.Cryptography;

namespace LifeGame.Push.Scheduling;

/// <summary>Чиста логіка для Siri-дій, пари й пристрою.</summary>
public static class GameRules
{
    /// <summary>Подвійний запуск команди Siri за хвилину — це одна дія.</summary>
    public static readonly TimeSpan ActionRepeatWindow = TimeSpan.FromSeconds(60);

    public static readonly TimeSpan PairCodeLifetime = TimeSpan.FromMinutes(15);

    public const int MaxActions = 100;

    /// <summary>Додає дію в чергу. Повертає null, якщо це повтор тієї самої дії.</summary>
    public static SubscriptionRecord? QueueAction(SubscriptionRecord s, QueuedAction action)
    {
        if (action.Action != "health" &&
            s.Actions.LastOrDefault(a => a.Action == action.Action) is { } last &&
            action.At - last.At < ActionRepeatWindow)
            return null;
        return s with { Actions = s.Actions.Append(action).TakeLast(MaxActions).ToArray() };
    }

    /// <summary>Квести, які з'явились у виконаних з минулого оновлення того самого дня.</summary>
    public static string[] NewlyDone(PlayerSummary? previous, PlayerSummary next)
    {
        var before = previous is not null && previous.Date == next.Date ? previous.DoneTitles : [];
        return next.DoneTitles.Except(before).ToArray();
    }

    public static string PartnerNotice(string[] titles) =>
        titles.Length == 1
            ? $"Виконано квест «{titles[0]}». Твоя черга!"
            : $"Виконано квести: {string.Join(", ", titles.Select(t => $"«{t}»"))}. Твоя черга!";

    public static string NewPairCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
}

namespace LifeGame.Push;

/// <summary>Нагадування для одного квесту: о котрій і з яким текстом.</summary>
public sealed record Reminder
{
    /// <summary>Ідентифікатор (зазвичай id квесту: morning, work, evening).</summary>
    public required string Id { get; init; }

    /// <summary>Локальний час у форматі HH:mm.</summary>
    public required string Time { get; init; }

    public bool Enabled { get; init; } = true;

    /// <summary>Дні тижня, 0 = неділя … 6 = субота. Порожньо — щодня.</summary>
    public int[] Days { get; init; } = [];

    public required string Title { get; init; }

    public required string Body { get; init; }

    /// <summary>Куди відкривати застосунок після натискання (відносно scope PWA).</summary>
    public string Url { get; init; } = "./";
}

/// <summary>Разове нагадування про справу зі списку (напр. «Стрижка о 14:00, нагадати за 30 хв»).</summary>
public sealed record EventReminder
{
    public required string Id { get; init; }

    /// <summary>Коли надіслати сповіщення (UTC або з зсувом).</summary>
    public required DateTimeOffset NotifyAt { get; init; }

    public required string Title { get; init; }

    public required string Body { get; init; }

    public string Url { get; init; } = "./";
}

/// <summary>Що вже виконано сьогодні — щоб не нагадувати про закриті квести.</summary>
public sealed record DayProgress
{
    public required string Date { get; init; }

    public string[] DoneQuests { get; init; } = [];
}

/// <summary>Збережена підписка одного пристрою.</summary>
public sealed record SubscriptionRecord
{
    public required string Id { get; init; }

    /// <summary>SHA-256 від секрету, який знає лише клієнт.</summary>
    public required string SecretHash { get; init; }

    public required string Endpoint { get; init; }

    public required string P256dh { get; init; }

    public required string Auth { get; init; }

    public required string TimeZone { get; init; }

    public Reminder[] Reminders { get; init; } = [];

    /// <summary>Разові нагадування про справи.</summary>
    public EventReminder[] Events { get; init; } = [];

    public DayProgress? Progress { get; init; }

    /// <summary>
    /// Id нагадування → локальна дата (yyyy-MM-dd), коли його востаннє надіслано.
    /// Для разових: «event:id» → час NotifyAt, для якого вже надіслано.
    /// </summary>
    public Dictionary<string, string> LastSent { get; init; } = [];

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }
}

// ---------- DTO для API ----------

public sealed record PushKeysDto(string? P256dh, string? Auth);

public sealed record PushSubscriptionDto(string? Endpoint, PushKeysDto? Keys);

public sealed record CreateSubscriptionRequest(
    PushSubscriptionDto? Subscription,
    string? TimeZone,
    Reminder[]? Reminders);

public sealed record UpdateSubscriptionRequest(
    PushSubscriptionDto? Subscription,
    string? TimeZone,
    Reminder[]? Reminders);

public sealed record ProgressRequest(string? Date, string[]? DoneQuests);

public sealed record EventsRequest(EventReminder[]? Events);

public sealed record CreatedSubscriptionResponse(string Id, string Secret);

public sealed record PublicKeyResponse(string PublicKey);

namespace LifeGame.Push;

/// <summary>Налаштування сервера нагадувань (секція "Push" в appsettings або змінні Push__*).</summary>
public sealed class PushOptions
{
    public const string Section = "Push";

    /// <summary>Публічний VAPID-ключ (base64url). Якщо порожньо — ключі генеруються й зберігаються в DataDirectory.</summary>
    public string? VapidPublicKey { get; set; }

    /// <summary>Приватний VAPID-ключ (base64url).</summary>
    public string? VapidPrivateKey { get; set; }

    /// <summary>Контакт для push-сервісів: mailto:… або https://… . Apple відхиляє запити без нього.</summary>
    public string VapidSubject { get; set; } = "mailto:life-game@example.com";

    /// <summary>Тека для subscriptions.json і згенерованих ключів.</summary>
    public string DataDirectory { get; set; } = "data";

    /// <summary>Звідки дозволено звертатися до API (адреса PWA).</summary>
    public string[] AllowedOrigins { get; set; } = ["http://localhost:4200"];

    /// <summary>Хости push-сервісів, на які сервер погоджується надсилати запити (захист від SSRF).</summary>
    public string[] AllowedEndpointHosts { get; set; } =
    [
        "push.apple.com",
        "fcm.googleapis.com",
        "push.services.mozilla.com",
        "notify.windows.com",
    ];

    /// <summary>Дозволити http-ендпоінти (лише для локальних тестів).</summary>
    public bool AllowInsecureEndpoints { get; set; }

    /// <summary>Якщо задано, створити підписку можна лише з заголовком X-Access-Key.</summary>
    public string? AccessKey { get; set; }

    /// <summary>Як часто планувальник перевіряє, чи настав час нагадування.</summary>
    public int WorkerIntervalSeconds { get; set; } = 30;

    /// <summary>Наскільки пізно ще можна надіслати пропущене нагадування (наприклад, після перезапуску).</summary>
    public int GraceMinutes { get; set; } = 90;

    /// <summary>Скільки часу push-сервіс тримає повідомлення, якщо телефон офлайн.</summary>
    public int TimeToLiveSeconds { get; set; } = 4 * 60 * 60;
}

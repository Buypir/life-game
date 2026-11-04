# Сервер нагадувань

ASP.NET Core 10, Minimal API. Зберігає розклад кожного пристрою й у потрібний час надсилає
Web Push на iPhone (і в будь-який інший браузер із підтримкою push).

Без сторонніх NuGet-пакетів: VAPID-підпис (RFC 8292) і шифрування повідомлень aes128gcm
(RFC 8291) написані на `System.Security.Cryptography`. Сумісність перевіряє e2e-тест,
який розшифровує повідомлення еталонною бібліотекою `http_ece` (тією ж, що в npm `web-push`).

## Як це працює

1. PWA бере публічний VAPID-ключ, підписується на push через Service Worker і надсилає
   підписку, часовий пояс і розклад на `POST /api/subscriptions`. У відповідь отримує `id` і `secret`.
2. Після кожної виконаної справи PWA повідомляє, які квести вже закриті сьогодні.
3. `ReminderWorker` кожні 30 секунд перевіряє розклади. Якщо час настав, квест не виконано
   й сьогодні ще не нагадували — шифрує повідомлення й надсилає його push-сервісу (Apple, Google, Mozilla).
4. Разові нагадування про справи («Стрижка о 14:00, нагадати за 30 хв») клієнт надсилає готовим
   часом `notifyAt`; сервер шле їх один раз. Якщо справу перенесли — надішле ще раз у новий час.
5. Якщо push-сервіс каже, що підписки вже немає (404/410), сервер її видаляє.
   Тимчасові помилки повторюються через 1, 2, 5 і 10 хвилин.

## API

| Метод | Шлях | Що робить |
| --- | --- | --- |
| GET | `/health` | стан сервера й кількість підписок |
| GET | `/api/push/public-key` | публічний VAPID-ключ |
| POST | `/api/subscriptions` | нова підписка → `{ id, secret }` |
| PUT | `/api/subscriptions/{id}` | змінити розклад, часовий пояс або браузерну підписку |
| PUT | `/api/subscriptions/{id}/progress` | `{ date, doneQuests }` — що виконано сьогодні |
| PUT | `/api/subscriptions/{id}/events` | `{ events: [{ id, notifyAt, title, body, url }] }` — разові нагадування про справи (повний список) |
| POST | `/api/subscriptions/{id}/test` | надіслати тестове сповіщення зараз |
| DELETE | `/api/subscriptions/{id}` | відписатися |

Усе, крім створення, вимагає заголовок `X-Subscription-Secret`.

## Налаштування

Секція `Push` в `appsettings.json` або змінні середовища `Push__…`:

| Параметр | За замовчуванням | Опис |
| --- | --- | --- |
| `AllowedOrigins` | `http://localhost:4200` | адреса PWA, напр. `https://buypir.github.io` |
| `VapidSubject` | `mailto:life-game@example.com` | твій контакт; Apple відхиляє push без нього |
| `VapidPublicKey` / `VapidPrivateKey` | порожньо | якщо порожньо — згенеруються в `DataDirectory/vapid.json` |
| `DataDirectory` | `data` | `subscriptions.json` і ключі |
| `AccessKey` | порожньо | якщо задано, нову підписку створить лише той, хто знає ключ (`X-Access-Key`) |
| `WorkerIntervalSeconds` | `30` | як часто перевіряти розклад |
| `GraceMinutes` | `90` | наскільки пізно ще надсилати пропущене нагадування |

Масиви в змінних середовища: `Push__AllowedOrigins__0=https://buypir.github.io`.

Важливо: якщо загубити VAPID-ключі, усі пристрої мусять підписатися знову. Або тримай
`DataDirectory` на постійному диску, або задай ключі явно через змінні середовища.

## Запуск локально

```bash
cd server
dotnet run --project src/LifeGame.Push          # http://localhost:5000
dotnet run --project tests/LifeGame.Push.Tests  # юніт-тести
npm ci --prefix e2e && npm test --prefix e2e    # e2e: справжній сервер + фейковий push-сервіс
```

Тест-ранер власний, на кількох десятках рядків, щоб проєкт збирався навіть без NuGet.
Якщо захочеш xUnit — тести легко перенести: `[Test]` → `[Fact]`, `Check.Equal` → `Assert.Equal`.

## Деплой

Серверу потрібно працювати постійно: якщо хостинг «присипляє» застосунок без трафіку,
нагадування не прийдуть вчасно. Варіанти:

**VPS з Docker** (найнадійніше, від ~4–5 $/міс):

```bash
docker build -t life-game-push server
docker run -d --restart unless-stopped -p 8080:8080 \
  -v life-game-data:/data \
  -e Push__AllowedOrigins__0=https://buypir.github.io \
  -e Push__VapidSubject=mailto:твоя@пошта \
  life-game-push
```

Попереду потрібен HTTPS (Caddy або nginx + Let's Encrypt): PWA на GitHub Pages працює по https
і не може звертатися до http-сервера.

**Render / Railway / Fly.io** — підійде Docker-сервіс із постійним диском, змонтованим у `/data`.
Безкоштовні тарифи зазвичай присипляють сервіс, тож для нагадувань потрібен платний або
зовнішній «будильник», який раз на кілька хвилин відкриває `/health`.

**Azure App Service** — тариф з увімкненим Always On.

Після деплою:

1. Перевір `https://твій-сервер/health`.
2. Впиши адресу в `public/config.json` гри (`"apiUrl": "https://твій-сервер"`) і запуш —
   або просто введи її на екрані «Нагадування» → «Сервер».
3. На iPhone: гра з головного екрана → «Нагадування» → «Увімкнути» → «Тестове».

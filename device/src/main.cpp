// Пристрій-компаньйон «Гри про життя».
// Показує героя, рівень, серію й наступну справу; кнопка «Готово» відмічає справу в грі,
// а в час нагадування пищалка будить, якщо квест ще не виконано.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <U8g2lib.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "config.h"
#include "logic.h"

U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);

lg::State state;
lg::SentToday sent;
char hat[24] = "";
unsigned firedMask = 0;
char firedDay[11] = "";
int page = 0;          // 0 — герой, 1 — нагадування
int alarmIndex = -1;   // що зараз дзвонить
unsigned long alarmStarted = 0;
unsigned long lastFetch = 0;
unsigned long toastUntil = 0;
char toast[64] = "";
bool online = false;

// ---------------------------------------------------------------- час

bool localNow(tm& out) { return getLocalTime(&out, 50); }

void todayKey(const tm& t, char* out) {
  std::snprintf(out, 11, "%04d-%02d-%02d", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
}

// ---------------------------------------------------------------- мережа

bool httpRequest(const char* url, const char* method, String* body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure secure;
  WiFiClient plain;
  // Для домашнього проєкту не перевіряємо сертифікат; для продакшну додай setCACert().
  secure.setInsecure();
  HTTPClient http;
  bool https = std::strncmp(url, "https://", 8) == 0;
  if (!(https ? http.begin(secure, url) : http.begin(plain, url))) return false;
  http.setTimeout(8000);
  int code = std::strcmp(method, "POST") == 0 ? http.POST("") : http.GET();
  if (body && code == 200) *body = http.getString();
  http.end();
  return code >= 200 && code < 300;
}

void fetchState() {
  String body;
  online = httpRequest(DEVICE_URL, "GET", &body);
  if (!online) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  JsonObject summary = doc["summary"];
  if (!summary.isNull()) {
    std::snprintf(state.name, sizeof state.name, "%s", summary["name"] | "Герой");
    state.level = summary["level"] | 1;
    state.streak = summary["streak"] | 0;
    state.coins = summary["coins"] | 0;
    std::snprintf(hat, sizeof hat, "%s", summary["hat"] | "");
    state.upcomingCount = 0;
    for (JsonObject t : summary["upcoming"].as<JsonArray>()) {
      if (state.upcomingCount >= lg::kMaxTasks) break;
      lg::TaskRef& ref = state.upcoming[state.upcomingCount++];
      std::snprintf(ref.id, sizeof ref.id, "%s", t["id"] | "");
      std::snprintf(ref.title, sizeof ref.title, "%s", t["title"] | "");
    }
  }
  JsonObject progress = doc["progress"];
  std::snprintf(state.progressDate, sizeof state.progressDate, "%s", progress["date"] | "");
  state.doneCount = 0;
  for (const char* q : progress["doneQuests"].as<JsonArray>()) {
    if (state.doneCount >= lg::kMaxDone) break;
    std::snprintf(state.doneQuests[state.doneCount++], 16, "%s", q ? q : "");
  }
  state.reminderCount = 0;
  for (JsonObject r : doc["reminders"].as<JsonArray>()) {
    if (state.reminderCount >= lg::kMaxReminders) break;
    lg::Reminder& rem = state.reminders[state.reminderCount++];
    std::snprintf(rem.id, sizeof rem.id, "%s", r["id"] | "");
    std::snprintf(rem.title, sizeof rem.title, "%s", r["title"] | "");
    rem.minutes = lg::parseTime(r["time"] | "");
    rem.enabled = r["enabled"] | false;
  }
}

void showToast(const char* text) {
  std::snprintf(toast, sizeof toast, "%s", text);
  toastUntil = millis() + 2500;
}

void sendDone() {
  const lg::TaskRef* task = lg::nextTask(state, sent);
  if (!task) {
    showToast("Усе зроблено!");
    return;
  }
  char url[220];
  if (!lg::actionUrl(DEVICE_URL, task->id, url, sizeof url)) return;
  if (httpRequest(url, "POST", nullptr)) {
    sent.add(task->id);
    char text[64];
    std::snprintf(text, sizeof text, "+ %.*s", static_cast<int>(lg::utf8Prefix(task->title, 13)), task->title);
    showToast(text);
    tone(PIN_BUZZER, 1760, 80);
  } else {
    showToast("Немає зв'язку");
  }
}

// ---------------------------------------------------------------- малювання

/** Герой 30×52 у лівій частині екрана; руки вгору, коли дзвонить будильник. */
void drawHero(int x, int y, bool cheer) {
  display.drawCircle(x + 15, y + 9, 8);
  display.drawBox(x + 7, y + 1, 17, 4);  // волосся
  display.drawPixel(x + 12, y + 10);
  display.drawPixel(x + 18, y + 10);
  display.drawLine(x + 13, y + 13, x + 17, y + 13);
  if (std::strcmp(hat, "hat-crown") == 0) {
    display.drawTriangle(x + 8, y + 1, x + 11, y - 5, x + 14, y + 1);
    display.drawTriangle(x + 13, y + 1, x + 15, y - 6, x + 17, y + 1);
    display.drawTriangle(x + 16, y + 1, x + 19, y - 5, x + 22, y + 1);
  } else if (hat[0]) {
    display.drawBox(x + 6, y - 1, 19, 4);  // кепка/шапка
  }
  display.drawRBox(x + 6, y + 19, 19, 18, 4);
  if (cheer) {
    display.drawLine(x + 6, y + 21, x + 1, y + 10);
    display.drawLine(x + 24, y + 21, x + 29, y + 10);
  } else {
    display.drawLine(x + 6, y + 21, x + 3, y + 34);
    display.drawLine(x + 24, y + 21, x + 27, y + 34);
  }
  display.drawBox(x + 9, y + 37, 5, 13);
  display.drawBox(x + 17, y + 37, 5, 13);
}

void drawHeroPage() {
  drawHero(2, 8, false);
  display.setFont(u8g2_font_6x13_t_cyrillic);
  display.setCursor(38, 12);
  display.print(state.name);
  display.setCursor(38, 25);
  display.printf("Рівень %d", state.level);
  display.setCursor(38, 37);
  display.printf("Серія %d", state.streak);
  display.setCursor(38, 49);
  display.printf("Монет %d", state.coins);
  const lg::TaskRef* task = lg::nextTask(state, sent);
  display.setCursor(38, 62);
  if (task) {
    display.printf("> %.*s", static_cast<int>(lg::utf8Prefix(task->title, 13)), task->title);
  } else {
    display.print(online ? "Усе зроблено!" : "Офлайн");
  }
}

void drawRemindersPage(const char* today) {
  display.setFont(u8g2_font_6x13_t_cyrillic);
  display.setCursor(0, 11);
  display.print("Нагадування");
  for (int i = 0; i < state.reminderCount && i < 4; i++) {
    const lg::Reminder& r = state.reminders[i];
    display.setCursor(0, 25 + i * 12);
    char time[6] = "--:--";
    if (r.minutes >= 0) std::snprintf(time, sizeof time, "%02d:%02d", r.minutes / 60, r.minutes % 60);
    // шрифт має лише латиницю й кирилицю, тож позначки ASCII
    const char* mark = lg::questDone(state, today, r.id) ? "+" : r.enabled ? " " : "-";
    display.printf("%s %s %.*s", time, mark, static_cast<int>(lg::utf8Prefix(r.title, 11)), r.title);
  }
}

void drawAlarm() {
  bool blink = (millis() / 400) % 2;
  drawHero(2, 8, blink);
  display.setFont(u8g2_font_8x13B_t_cyrillic);
  display.setCursor(38, 22);
  display.print("Підйом!");
  display.setFont(u8g2_font_6x13_t_cyrillic);
  const lg::Reminder& r = state.reminders[alarmIndex];
  display.setCursor(38, 40);
  display.printf("%.*s", static_cast<int>(lg::utf8Prefix(r.title, 14)), r.title);
  display.setCursor(38, 58);
  display.print("Будь-яка кнопка");
}

// ---------------------------------------------------------------- кнопки й будильник

bool pressed(int pin) {
  static unsigned long last[40] = {};
  if (digitalRead(pin) == LOW && millis() - last[pin] > 300) {
    last[pin] = millis();
    return true;
  }
  return false;
}

void ringAlarm() {
  static const int melody[] = {1319, 1568, 2093, 0};
  int step = (millis() / 180) % 4;
  if (melody[step]) tone(PIN_BUZZER, melody[step], 150);
}

void stopAlarm() {
  noTone(PIN_BUZZER);
  alarmIndex = -1;
}

// ---------------------------------------------------------------- setup/loop

void setup() {
  pinMode(PIN_DONE, INPUT_PULLUP);
  pinMode(PIN_NEXT, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  display.begin();
  display.enableUTF8Print();
  display.clearBuffer();
  display.setFont(u8g2_font_6x13_t_cyrillic);
  display.setCursor(0, 30);
  display.print("Wi-Fi...");
  display.sendBuffer();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  configTzTime(TZ_POSIX, "pool.ntp.org", "time.google.com");
  fetchState();
  lastFetch = millis();
}

void loop() {
  if (millis() - lastFetch > 60000) {
    if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
    fetchState();
    lastFetch = millis();
  }

  tm now{};
  char today[11] = "";
  if (localNow(now)) todayKey(now, today);
  if (today[0] && std::strcmp(today, firedDay) != 0) {
    std::snprintf(firedDay, sizeof firedDay, "%s", today);
    firedMask = 0;
    sent.reset(today);
  }

  if (alarmIndex < 0 && today[0]) {
    int due = lg::dueAlarm(state, today, now.tm_hour * 60 + now.tm_min, firedMask);
    if (due >= 0) {
      alarmIndex = due;
      alarmStarted = millis();
      firedMask |= 1u << due;
    }
  }

  if (alarmIndex >= 0) {
    ringAlarm();
    if (pressed(PIN_DONE) || pressed(PIN_NEXT) || millis() - alarmStarted > 120000) stopAlarm();
  } else {
    if (pressed(PIN_DONE)) sendDone();
    if (pressed(PIN_NEXT)) page = (page + 1) % 2;
  }

  display.clearBuffer();
  if (alarmIndex >= 0) {
    drawAlarm();
  } else if (millis() < toastUntil) {
    drawHero(2, 8, true);
    display.setFont(u8g2_font_6x13_t_cyrillic);
    display.setCursor(38, 36);
    display.print(toast);
  } else if (page == 0) {
    drawHeroPage();
  } else {
    drawRemindersPage(today);
  }
  display.sendBuffer();
  delay(30);
}

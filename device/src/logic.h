// Чиста логіка пристрою без Arduino — тестується на комп'ютері (test/test_logic.cpp).
#pragma once
#include <cstdio>
#include <cstring>
#include <initializer_list>

namespace lg {

constexpr int kMaxReminders = 6;
constexpr int kMaxTasks = 8;
constexpr int kMaxDone = 6;

struct Reminder {
  char id[16] = "";
  int minutes = -1;  // хвилини від півночі
  bool enabled = false;
  char title[48] = "";
};

struct TaskRef {
  char id[33] = "";
  char title[61] = "";
};

struct State {
  char name[25] = "Герой";
  int level = 1;
  int streak = 0;
  int coins = 0;
  char progressDate[11] = "";  // день, за який сервер знає виконані квести
  char doneQuests[kMaxDone][16] = {};
  int doneCount = 0;
  TaskRef upcoming[kMaxTasks];
  int upcomingCount = 0;
  Reminder reminders[kMaxReminders];
  int reminderCount = 0;
};

/** "07:30" → 450; -1, якщо формат хибний. */
inline int parseTime(const char* hhmm) {
  if (!hhmm || std::strlen(hhmm) != 5 || hhmm[2] != ':') return -1;
  for (int i : {0, 1, 3, 4})
    if (hhmm[i] < '0' || hhmm[i] > '9') return -1;
  int h = (hhmm[0] - '0') * 10 + (hhmm[1] - '0');
  int m = (hhmm[3] - '0') * 10 + (hhmm[4] - '0');
  return h < 24 && m < 60 ? h * 60 + m : -1;
}

inline bool questDone(const State& s, const char* today, const char* questId) {
  if (std::strcmp(s.progressDate, today) != 0) return false;
  for (int i = 0; i < s.doneCount; i++)
    if (std::strcmp(s.doneQuests[i], questId) == 0) return true;
  return false;
}

/**
 * Індекс нагадування, яке треба продзвонити зараз (або -1).
 * firedMask — біти вже продзвонених сьогодні нагадувань (скидається опівночі).
 * Дзвонимо в межах 10 хв після часу, якщо квест ще не виконано.
 */
inline int dueAlarm(const State& s, const char* today, int nowMinutes, unsigned firedMask) {
  for (int i = 0; i < s.reminderCount; i++) {
    const Reminder& r = s.reminders[i];
    if (!r.enabled || r.minutes < 0 || (firedMask & (1u << i))) continue;
    int late = nowMinutes - r.minutes;
    if (late >= 0 && late < 10 && !questDone(s, today, r.id)) return i;
  }
  return -1;
}

/** Множина справ, які пристрій уже надіслав сьогодні (до синхронізації з грою). */
struct SentToday {
  char day[11] = "";
  char ids[kMaxTasks * 2][33] = {};
  int count = 0;

  void reset(const char* today) {
    std::snprintf(day, sizeof day, "%s", today);
    count = 0;
  }
  bool has(const char* id) const {
    for (int i = 0; i < count; i++)
      if (std::strcmp(ids[i], id) == 0) return true;
    return false;
  }
  void add(const char* id) {
    if (has(id) || count >= kMaxTasks * 2) return;
    std::snprintf(ids[count++], sizeof ids[0], "%s", id);
  }
};

/** Перша справа зі списку, яку ще не надсилали; nullptr — усе зроблено. */
inline const TaskRef* nextTask(const State& s, const SentToday& sent) {
  for (int i = 0; i < s.upcomingCount; i++)
    if (!sent.has(s.upcoming[i].id)) return &s.upcoming[i];
  return nullptr;
}

/** URL дії з адреси пристрою: .../api/device/KEY → .../api/act/KEY/{id}. */
inline bool actionUrl(const char* deviceUrl, const char* id, char* out, size_t size) {
  const char* marker = std::strstr(deviceUrl, "/api/device/");
  if (!marker) return false;
  int prefix = static_cast<int>(marker - deviceUrl);
  int n = std::snprintf(out, size, "%.*s/api/act/%s/%s", prefix, deviceUrl, marker + 12, id);
  return n > 0 && static_cast<size_t>(n) < size;
}

/** Скільки байтів UTF-8 займають перші maxChars символів (щоб не різати кирилицю посередині). */
inline size_t utf8Prefix(const char* text, size_t maxChars) {
  size_t bytes = 0, chars = 0;
  while (text[bytes] && chars < maxChars) {
    unsigned char c = static_cast<unsigned char>(text[bytes]);
    bytes += c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : 4;
    chars++;
  }
  return bytes;
}

}  // namespace lg

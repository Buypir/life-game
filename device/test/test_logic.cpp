// g++ -std=c++17 -I../src test_logic.cpp -o /tmp/test_logic && /tmp/test_logic
#include <cassert>
#include <cstdio>
#include "logic.h"

using namespace lg;

int main() {
  assert(parseTime("07:30") == 450);
  assert(parseTime("23:59") == 1439);
  assert(parseTime("24:00") == -1);
  assert(parseTime("7:30") == -1);

  State s;
  s.reminderCount = 2;
  std::snprintf(s.reminders[0].id, 16, "morning");
  s.reminders[0].minutes = 450;
  s.reminders[0].enabled = true;
  std::snprintf(s.reminders[1].id, 16, "evening");
  s.reminders[1].minutes = 1350;
  s.reminders[1].enabled = true;

  assert(dueAlarm(s, "2026-11-04", 449, 0) == -1);
  assert(dueAlarm(s, "2026-11-04", 450, 0) == 0);
  assert(dueAlarm(s, "2026-11-04", 459, 0) == 0);
  assert(dueAlarm(s, "2026-11-04", 460, 0) == -1);  // запізно
  assert(dueAlarm(s, "2026-11-04", 452, 1u) == -1);  // уже продзвонив

  // ранок уже виконано сьогодні — не дзвонимо; учорашній прогрес не рахується
  std::snprintf(s.progressDate, 11, "2026-11-04");
  std::snprintf(s.doneQuests[0], 16, "morning");
  s.doneCount = 1;
  assert(dueAlarm(s, "2026-11-04", 450, 0) == -1);
  assert(dueAlarm(s, "2026-11-05", 450, 0) == 0);

  s.upcomingCount = 2;
  std::snprintf(s.upcoming[0].id, 33, "work");
  std::snprintf(s.upcoming[1].id, 33, "study");
  SentToday sent;
  sent.reset("2026-11-04");
  assert(std::strcmp(nextTask(s, sent)->id, "work") == 0);
  sent.add("work");
  sent.add("work");
  assert(sent.count == 1);
  assert(std::strcmp(nextTask(s, sent)->id, "study") == 0);
  sent.add("study");
  assert(nextTask(s, sent) == nullptr);

  char url[160];
  assert(actionUrl("https://x.dev/api/device/AbC", "brush", url, sizeof url));
  assert(std::strcmp(url, "https://x.dev/api/act/AbC/brush") == 0);
  assert(!actionUrl("https://x.dev/other", "brush", url, sizeof url));

  assert(utf8Prefix("Привіт", 3) == 6);
  assert(utf8Prefix("abc", 10) == 3);

  std::puts("logic tests passed");
  return 0;
}

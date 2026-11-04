import { isQuestDone, dateKey, addDays } from '../game/progress';
import { FocusSession } from '../game/progression';
import { Quest, QUESTS } from '../game/quests';
import { notifyAt, reminderBody, Todo } from '../game/todos';

export interface LocalReminderSetting {
  questId: string;
  time: string;
  enabled: boolean;
}

export interface PlannedNotification {
  id: number;
  title: string;
  body: string;
  at: Date;
  screen: string;
}

/** Скільки днів наперед плануємо квести (далі — при наступному відкритті гри). */
export const DAYS_AHEAD = 7;

/** Стабільний числовий id для справи зі списку. */
export function todoNotificationId(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return 100_000 + (Math.abs(hash) % 800_000);
}

/**
 * Сповіщення, які телефон має показати сам, без сервера: квести на тиждень уперед
 * (крім уже виконаних сьогодні), справи зі списку й кінець фокус-таймера.
 */
export function planNotifications(input: {
  settings: LocalReminderSetting[];
  doneToday: ReadonlySet<string>;
  todos: Todo[];
  focus: FocusSession | null;
  now: Date;
  quests?: Quest[];
}): PlannedNotification[] {
  const { settings, doneToday, todos, focus, now } = input;
  const quests = input.quests ?? QUESTS;
  const today = dateKey(now);
  const out: PlannedNotification[] = [];

  settings.forEach((setting) => {
    const qi = quests.findIndex((q) => q.id === setting.questId);
    const quest = quests[qi];
    if (!quest || !setting.enabled || !/^\d{2}:\d{2}$/.test(setting.time)) return;
    const [h, m] = setting.time.split(':').map(Number);
    for (let d = 0; d < DAYS_AHEAD; d++) {
      const day = addDays(today, d);
      if (d === 0 && isQuestDone(quest, doneToday)) continue;
      const [y, mo, da] = day.split('-').map(Number);
      const at = new Date(y, mo - 1, da, h, m);
      if (at.getTime() <= now.getTime()) continue;
      out.push({
        id: 1000 + d * 10 + qi,
        title: `Квест «${quest.title}»`,
        body: `${quest.tasks.map((t) => t.title).join(' · ')}. Герой чекає!`,
        at,
        screen: 'today',
      });
    }
  });

  for (const todo of todos) {
    const at = notifyAt(todo);
    if (todo.done || !at || at.getTime() <= now.getTime()) continue;
    out.push({
      id: todoNotificationId(todo.id),
      title: todo.title,
      body: reminderBody(todo, dateKey(at)),
      at,
      screen: 'todos',
    });
  }

  if (focus) {
    const at = new Date(new Date(focus.start).getTime() + focus.minutes * 60_000);
    if (at.getTime() > now.getTime()) {
      out.push({
        id: 99,
        title: 'Фокус завершено',
        body: `${focus.minutes} хв — є! Відкрий гру, щоб забрати XP.`,
        at,
        screen: 'today',
      });
    }
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import { planNotifications, todoNotificationId } from './local-schedule';

const SETTINGS = [
  { questId: 'morning', time: '07:30', enabled: true },
  { questId: 'work', time: '10:00', enabled: false },
  { questId: 'evening', time: '22:30', enabled: true },
];

describe('local notifications plan', () => {
  it('plans a week of quests and skips past times and finished quests', () => {
    const now = new Date(2026, 10, 4, 9, 0);
    const plan = planNotifications({
      settings: SETTINGS,
      doneToday: new Set(),
      todos: [],
      focus: null,
      now,
    });
    // ранок сьогодні вже минув, робота вимкнена: 6 ранків + 7 вечорів
    expect(plan.filter((p) => p.title.includes('Ранок'))).toHaveLength(6);
    expect(plan.filter((p) => p.title.includes('Вечір'))).toHaveLength(7);
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length);

    const done = new Set(['dinner', 'brush-evening', 'plan', 'sleep']);
    const after = planNotifications({
      settings: SETTINGS,
      doneToday: done,
      todos: [],
      focus: null,
      now,
    });
    expect(after.filter((p) => p.title.includes('Вечір'))).toHaveLength(6);
    expect(after.every((p) => p.at.getTime() > now.getTime())).toBe(true);
  });

  it('adds todo reminders and the end of focus', () => {
    const now = new Date(2026, 10, 4, 9, 0);
    const todo = {
      id: 't1',
      title: 'Стрижка',
      date: '2026-11-04',
      time: '14:00',
      remindBefore: 30,
      done: false,
      doneAt: null,
      createdAt: now.toISOString(),
    };
    const plan = planNotifications({
      settings: [],
      doneToday: new Set(),
      todos: [todo, { ...todo, id: 't2', done: true }],
      focus: { kind: 'embedded', minutes: 25, start: now.toISOString() },
      now,
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      id: todoNotificationId('t1'),
      title: 'Стрижка',
      screen: 'todos',
    });
    expect(plan[0].at).toEqual(new Date(2026, 10, 4, 13, 30));
    expect(plan[1]).toMatchObject({ id: 99, title: 'Фокус завершено' });
  });
});

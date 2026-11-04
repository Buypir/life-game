import { describe, expect, it } from 'vitest';
import { todoEvents } from '../reminders/reminders.service';
import { parseSave } from './progress';
import {
  cleanInput,
  dayLabel,
  durationLabel,
  groupTodos,
  notifyAt,
  parseTodos,
  reminderBody,
  remindLabel,
  Todo,
} from './todos';

const TODAY = '2026-11-04'; // середа

function todo(partial: Partial<Todo>): Todo {
  return {
    id: partial.id ?? 't1',
    title: partial.title ?? 'Стрижка',
    date: partial.date === undefined ? TODAY : partial.date,
    time: partial.time ?? null,
    remindBefore: partial.remindBefore ?? null,
    done: partial.done ?? false,
    doneAt: partial.doneAt ?? null,
    createdAt: partial.createdAt ?? '2026-11-04T08:00:00.000Z',
  };
}

describe('todo input', () => {
  it('trims the title and drops a reminder without time', () => {
    expect(cleanInput({ title: '  Стрижка  ', date: TODAY, time: null, remindBefore: 30 })).toEqual(
      {
        title: 'Стрижка',
        date: TODAY,
        time: null,
        remindBefore: null,
      },
    );
    expect(cleanInput({ title: '   ', date: TODAY, time: '14:00', remindBefore: 30 })).toBeNull();
  });

  it('drops time when there is no date', () => {
    expect(cleanInput({ title: 'Колись', date: null, time: '14:00', remindBefore: 30 })).toEqual({
      title: 'Колись',
      date: null,
      time: null,
      remindBefore: null,
    });
  });
});

describe('reminder time', () => {
  it('subtracts the chosen offset from the event time', () => {
    const at = notifyAt(todo({ time: '14:00', remindBefore: 30 }));
    expect(at).toEqual(new Date(2026, 10, 4, 13, 30));
    expect(notifyAt(todo({ time: '14:00', remindBefore: 0 }))).toEqual(
      new Date(2026, 10, 4, 14, 0),
    );
    expect(notifyAt(todo({ time: '09:00', remindBefore: 1440 }))).toEqual(
      new Date(2026, 10, 3, 9, 0),
    );
    expect(notifyAt(todo({ time: null, remindBefore: 30 }))).toBeNull();
    expect(notifyAt(todo({ time: '14:00', remindBefore: null }))).toBeNull();
  });

  it('formats offsets', () => {
    expect(durationLabel(30)).toBe('30 хв');
    expect(durationLabel(120)).toBe('2 год');
    expect(durationLabel(1440)).toBe('1 день');
    expect(remindLabel(0)).toBe('у момент події');
    expect(remindLabel(15)).toBe('за 15 хв');
  });

  it('labels days relative to today', () => {
    expect(dayLabel(TODAY, TODAY)).toBe('сьогодні');
    expect(dayLabel('2026-11-05', TODAY)).toBe('завтра');
    expect(dayLabel('2026-11-03', TODAY)).toBe('вчора');
    expect(dayLabel('2026-11-07', TODAY)).toBe('сб, 7 листопада');
    expect(dayLabel('2027-01-02', TODAY)).toBe('сб, 2 січня 2027');
  });

  it('writes the notification text relative to the day it arrives', () => {
    expect(reminderBody(todo({ time: '14:00', remindBefore: 30 }), TODAY)).toBe(
      'Сьогодні о 14:00 · через 30 хв',
    );
    expect(reminderBody(todo({ time: '14:00', remindBefore: 0 }), TODAY)).toBe(
      'Сьогодні о 14:00 · зараз',
    );
  });
});

describe('server events', () => {
  it('sends only future reminders of open todos', () => {
    const now = new Date(2026, 10, 4, 12, 0);
    const events = todoEvents(
      [
        todo({ id: 'a', time: '14:00', remindBefore: 30 }),
        todo({ id: 'b', time: '11:00', remindBefore: 0 }), // уже минуло
        todo({ id: 'c', time: '15:00', remindBefore: 30, done: true }),
        todo({ id: 'd', time: '16:00' }), // без нагадування
        todo({ id: 'e', date: '2026-11-05', time: '13:00', remindBefore: 1440 }),
      ],
      now,
    );
    expect(events.map((e) => e.id)).toEqual(['a', 'e']);
    expect(events[0].notifyAt).toBe(new Date(2026, 10, 4, 13, 30).toISOString());
    expect(events[0].body).toBe('Сьогодні о 14:00 · через 30 хв');
    // нагадування за день приходить сьогодні, тому подія — «завтра»
    expect(events[1].body).toBe('Завтра о 13:00 · через 1 день');
    expect(events[0].url).toBe('./?screen=todos');
  });
});

describe('groups', () => {
  it('splits open todos by day and keeps done ones last', () => {
    const groups = groupTodos(
      [
        todo({ id: 'late', date: '2026-11-02' }),
        todo({ id: 'b', time: '18:00' }),
        todo({ id: 'a', time: '09:00' }),
        todo({ id: 'notime' }),
        todo({ id: 'tmr', date: '2026-11-05' }),
        todo({ id: 'later', date: '2026-11-20' }),
        todo({ id: 'some', date: null }),
        todo({ id: 'done', done: true, doneAt: '2026-11-04T09:00:00Z' }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'later',
      'someday',
      'done',
    ]);
    expect(groups[1].items.map((t) => t.id)).toEqual(['a', 'b', 'notime']);
  });
});

describe('saved todos', () => {
  it('survive a save round-trip and broken items are dropped', () => {
    const save = parseSave(
      JSON.stringify({
        xp: 5,
        days: {},
        todos: [todo({ time: '14:00', remindBefore: 30 }), { id: 'x' }, { title: 'no id' }, 7],
      }),
    );
    expect(save.todos).toHaveLength(1);
    expect(save.todos[0].remindBefore).toBe(30);
    expect(parseTodos('nope')).toEqual([]);
  });
});

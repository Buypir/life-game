/**
 * Усе, що тримає мотивацію: досягнення, бос тижня, дерево навичок embedded, фокус-таймер,
 * показники Apple Health і статистика. Лише чисті функції над SaveData.
 */
import { ACTIVITIES } from './activities';
import type { SaveData } from './progress';
import { addDays, dayQualifies, isDateKey, isQuestDone, levelInfo } from './progress';
import { findTask, QUEST_BONUS_XP, QUESTS, StatKey } from './quests';
import { TODO_XP } from './todos';

// ---------------------------------------------------------------- фокус

export type FocusKind = 'embedded' | 'study' | 'work';

export interface FocusSession {
  kind: FocusKind;
  minutes: number;
  /** ISO-час старту. */
  start: string;
}

export interface FocusEntry {
  kind: FocusKind;
  minutes: number;
}

export const FOCUS_KINDS: { id: FocusKind; title: string; stat: StatKey }[] = [
  { id: 'embedded', title: 'Embedded', stat: 'intellect' },
  { id: 'study', title: 'Навчання', stat: 'intellect' },
  { id: 'work', title: 'Робота', stat: 'work' },
];

export const FOCUS_PRESETS = [25, 50];
/** Менше 5 хвилин — не фокус, а розминка пальців. */
export const MIN_FOCUS_MINUTES = 5;

/** 1 XP за хвилину; +1 до характеристики за кожні 25 хв (мінімум 1). */
export function focusReward(entry: FocusEntry): { xp: number; stat: StatKey; points: number } {
  const stat = FOCUS_KINDS.find((k) => k.id === entry.kind)?.stat ?? 'intellect';
  return { xp: entry.minutes, stat, points: Math.max(1, Math.floor(entry.minutes / 25)) };
}

export function focusElapsed(session: FocusSession, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(session.start).getTime()) / 60_000);
}

// ---------------------------------------------------------------- Apple Health

export interface HealthDay {
  steps: number;
  sleep: number;
  workout: number;
  /** Скільки XP за цей день уже нараховано. */
  xp: number;
}

export interface HealthInput {
  steps?: number;
  sleep?: number;
  workout?: number;
}

export const HEALTH_GOALS: {
  id: string;
  title: string;
  xp: number;
  stat: StatKey;
  reached: (h: HealthDay) => boolean;
}[] = [
  { id: 'steps6', title: '6 000 кроків', xp: 15, stat: 'energy', reached: (h) => h.steps >= 6000 },
  {
    id: 'steps10',
    title: '10 000 кроків',
    xp: 20,
    stat: 'energy',
    reached: (h) => h.steps >= 10000,
  },
  { id: 'sleep', title: 'Сон 7+ год', xp: 20, stat: 'energy', reached: (h) => h.sleep >= 7 },
  {
    id: 'workout',
    title: 'Тренування 20+ хв',
    xp: 25,
    stat: 'strength',
    reached: (h) => h.workout >= 20,
  },
];

export function healthXp(h: HealthDay): number {
  return HEALTH_GOALS.filter((g) => g.reached(h)).reduce((sum, g) => sum + g.xp, 0);
}

/** Об'єднує нові показники з уже відомими (беремо максимум — «Команди» можуть надіслати кілька разів). */
export function mergeHealth(previous: HealthDay | undefined, input: HealthInput): HealthDay {
  const base = previous ?? { steps: 0, sleep: 0, workout: 0, xp: 0 };
  const num = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
  return {
    steps: Math.max(base.steps, Math.round(num(input.steps, 200_000))),
    sleep: Math.max(base.sleep, Math.round(num(input.sleep, 24) * 10) / 10),
    workout: Math.max(base.workout, Math.round(num(input.workout, 1440))),
    xp: base.xp,
  };
}

// ---------------------------------------------------------------- підсумки

export interface Totals {
  tasks: Map<string, number>;
  quests: Map<string, number>;
  activities: Map<string, number>;
  todosDone: number;
  focusMinutes: number;
  embeddedFocusMinutes: number;
  maxSteps: number;
  purchases: number;
  activeDays: number;
}

export function totals(save: SaveData): Totals {
  const tasks = new Map<string, number>();
  const quests = new Map<string, number>();
  const activities = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string, by = 1) =>
    map.set(id, (map.get(id) ?? 0) + by);
  const active = new Set<string>();

  for (const [day, ids] of Object.entries(save.days)) {
    if (ids.length) active.add(day);
    for (const id of ids) bump(tasks, id);
    const done = new Set(ids);
    for (const q of QUESTS) if (isQuestDone(q, done)) bump(quests, q.id);
  }
  for (const [day, ids] of Object.entries(save.log)) {
    if (ids.length) active.add(day);
    for (const id of ids) bump(activities, id);
  }
  let focusMinutes = 0;
  let embeddedFocusMinutes = 0;
  for (const [day, entries] of Object.entries(save.focusLog)) {
    if (entries.length) active.add(day);
    for (const e of entries) {
      focusMinutes += e.minutes;
      if (e.kind === 'embedded') embeddedFocusMinutes += e.minutes;
    }
  }
  return {
    tasks,
    quests,
    activities,
    todosDone: save.todos.filter((t) => t.done).length + save.todosArchived,
    focusMinutes,
    embeddedFocusMinutes,
    maxSteps: Math.max(0, ...Object.values(save.health).map((h) => h.steps)),
    purchases: save.owned.length + save.redeemed.length,
    activeDays: active.size,
  };
}

// ---------------------------------------------------------------- дерево навичок

export interface SkillNode {
  id: string;
  title: string;
  cost: number;
  requires: string[];
  tier: number;
}

export const SKILLS: SkillNode[] = [
  { id: 'c', title: 'Основи C', cost: 1, requires: [], tier: 1 },
  { id: 'gpio', title: 'GPIO', cost: 1, requires: ['c'], tier: 1 },
  { id: 'uart', title: 'UART', cost: 1, requires: ['gpio'], tier: 2 },
  { id: 'timers', title: 'Таймери й PWM', cost: 1, requires: ['gpio'], tier: 2 },
  { id: 'irq', title: 'Переривання', cost: 1, requires: ['gpio'], tier: 2 },
  { id: 'adc', title: 'ADC', cost: 1, requires: ['timers'], tier: 3 },
  { id: 'i2c-spi', title: 'I2C і SPI', cost: 2, requires: ['uart'], tier: 3 },
  { id: 'dma', title: 'DMA', cost: 2, requires: ['irq'], tier: 3 },
  { id: 'debug', title: 'SWD і логічний аналізатор', cost: 2, requires: ['uart'], tier: 3 },
  { id: 'can', title: 'CAN', cost: 2, requires: ['uart', 'irq'], tier: 4 },
  { id: 'freertos', title: 'FreeRTOS: задачі', cost: 2, requires: ['irq'], tier: 4 },
  { id: 'rtos-sync', title: 'Черги й семафори', cost: 2, requires: ['freertos'], tier: 5 },
  { id: 'lowpower', title: 'Енергозбереження', cost: 2, requires: ['timers', 'irq'], tier: 5 },
  { id: 'bootloader', title: 'Бутлоадер і OTA', cost: 3, requires: ['dma', 'can'], tier: 6 },
  {
    id: 'device',
    title: 'Власний пристрій',
    cost: 3,
    requires: ['rtos-sync', 'i2c-spi', 'lowpower'],
    tier: 6,
  },
];

export const SKILL_XP_PER_POINT = 40;
/** Скільки хвилин фокусу на embedded дають 1 очко навичок. */
export const MINUTES_PER_SKILL_POINT = 25;

export function skillPoints(
  save: SaveData,
  t: Totals = totals(save),
): { earned: number; spent: number; free: number } {
  const earned =
    (t.activities.get('embedded') ?? 0) +
    Math.floor(t.embeddedFocusMinutes / MINUTES_PER_SKILL_POINT);
  const spent = SKILLS.filter((s) => save.skills.includes(s.id)).reduce((a, s) => a + s.cost, 0);
  return { earned, spent, free: earned - spent };
}

export type SkillState = 'learned' | 'available' | 'locked';

export function skillState(node: SkillNode, learned: readonly string[]): SkillState {
  if (learned.includes(node.id)) return 'learned';
  return node.requires.every((r) => learned.includes(r)) ? 'available' : 'locked';
}

// ---------------------------------------------------------------- досягнення

export interface Achievement {
  id: string;
  title: string;
  description: string;
  coins: number;
  /** [поточне значення, ціль]. */
  progress: (save: SaveData, t: Totals, best: number) => [number, number];
}

const taskCount = (t: Totals, ids: string[]) =>
  ids.reduce((a, id) => a + (t.tasks.get(id) ?? 0), 0);
const activityCount = (t: Totals, ids: string[]) =>
  ids.reduce((a, id) => a + (t.activities.get(id) ?? 0), 0);
const TRIPS = ACTIVITIES.filter((a) => a.action === 'drive').map((a) => a.id);

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first',
    title: 'Перший крок',
    description: 'Виконай першу справу',
    coins: 50,
    progress: (_, t) => [[...t.tasks.values()].reduce((a, b) => a + b, 0), 1],
  },
  {
    id: 'morning-5',
    title: 'Ранкова пташка',
    description: 'Ранковий квест 5 разів',
    coins: 100,
    progress: (_, t) => [t.quests.get('morning') ?? 0, 5],
  },
  {
    id: 'streak-3',
    title: 'Розгін',
    description: 'Серія 3 дні',
    coins: 100,
    progress: (_, __, best) => [best, 3],
  },
  {
    id: 'streak-7',
    title: 'Тиждень без пропусків',
    description: 'Серія 7 днів',
    coins: 250,
    progress: (_, __, best) => [best, 7],
  },
  {
    id: 'streak-30',
    title: 'Залізна воля',
    description: 'Серія 30 днів',
    coins: 1000,
    progress: (_, __, best) => [best, 30],
  },
  {
    id: 'level-5',
    title: 'Рівень 5',
    description: 'Досягни 5 рівня',
    coins: 150,
    progress: (s) => [levelInfo(s.xp).level, 5],
  },
  {
    id: 'level-10',
    title: 'Рівень 10',
    description: 'Досягни 10 рівня',
    coins: 400,
    progress: (s) => [levelInfo(s.xp).level, 10],
  },
  {
    id: 'gym-10',
    title: 'Залізо',
    description: '10 тренувань',
    coins: 200,
    progress: (_, t) => [activityCount(t, ['gym-workout']) + taskCount(t, ['workout']), 10],
  },
  {
    id: 'embedded-10',
    title: 'Прошивальник',
    description: '10 сесій embedded',
    coins: 200,
    progress: (_, t) => [
      activityCount(t, ['embedded']) + Math.floor(t.embeddedFocusMinutes / 25),
      10,
    ],
  },
  {
    id: 'focus-10h',
    title: 'Глибока робота',
    description: '10 годин фокусу',
    coins: 300,
    progress: (_, t) => [Math.floor(t.focusMinutes / 60), 10],
  },
  {
    id: 'trips-20',
    title: 'Водій',
    description: '20 поїздок',
    coins: 150,
    progress: (_, t) => [activityCount(t, TRIPS), 20],
  },
  {
    id: 'date-5',
    title: 'Романтик',
    description: '5 побачень',
    coins: 200,
    progress: (_, t) => [activityCount(t, ['date-walk', 'date-dinner']), 5],
  },
  {
    id: 'todos-25',
    title: 'Без хвостів',
    description: '25 справ зі списку',
    coins: 150,
    progress: (_, t) => [t.todosDone, 25],
  },
  {
    id: 'skills-5',
    title: 'Інженер',
    description: '5 навичок embedded',
    coins: 250,
    progress: (s) => [s.skills.length, 5],
  },
  {
    id: 'skills-all',
    title: 'Сеньйор embedded',
    description: 'Усе дерево навичок',
    coins: 1000,
    progress: (s) => [s.skills.length, SKILLS.length],
  },
  {
    id: 'steps-10k',
    title: '10 000 кроків',
    description: 'День з 10 000 кроків',
    coins: 100,
    progress: (_, t) => [Math.min(t.maxSteps, 10000), 10000],
  },
  {
    id: 'shopper',
    title: 'Шопінг',
    description: 'Купи 3 речі або нагороди',
    coins: 100,
    progress: (_, t) => [t.purchases, 3],
  },
];

/** Досягнення, які вже виконано, але ще не записано. */
export function newAchievements(save: SaveData, best: number): Achievement[] {
  const t = totals(save);
  return ACHIEVEMENTS.filter((a) => {
    if (save.achievements[a.id]) return false;
    const [value, target] = a.progress(save, t, best);
    return value >= target;
  });
}

// ---------------------------------------------------------------- бос тижня

export interface Boss {
  id: string;
  title: string;
  goal: string;
  target: number;
  count: (save: SaveData, days: string[]) => number;
}

export const BOSS_XP = 100;
export const BOSS_COINS = 200;

const inDays = (map: Record<string, string[]>, days: string[], ids: string[]) =>
  days.reduce((a, d) => a + (map[d] ?? []).filter((id) => ids.includes(id)).length, 0);

export const BOSSES: Boss[] = [
  {
    id: 'iron',
    title: 'Залізний тиждень',
    goal: 'тренування',
    target: 4,
    count: (s, d) => inDays(s.log, d, ['gym-workout']) + inDays(s.days, d, ['workout']),
  },
  {
    id: 'firmware',
    title: 'Тиждень прошивок',
    goal: 'сесій embedded',
    target: 5,
    count: (s, d) =>
      inDays(s.log, d, ['embedded']) +
      d.reduce(
        (a, day) =>
          a +
          (s.focusLog[day] ?? []).filter((e) => e.kind === 'embedded' && e.minutes >= 25).length,
        0,
      ),
  },
  {
    id: 'mornings',
    title: 'Ранковий дракон',
    goal: 'ранкових квестів',
    target: 5,
    count: (s, d) => d.filter((day) => isQuestDone(QUESTS[0], new Set(s.days[day] ?? []))).length,
  },
  {
    id: 'todos',
    title: 'Гідра справ',
    goal: 'справ зі списку',
    target: 10,
    count: (s, d) =>
      s.todos.filter((t) => t.done && t.doneAt && d.includes(t.doneAt.slice(0, 10))).length,
  },
  {
    id: 'focus',
    title: 'Тиждень фокусу',
    goal: 'хв фокусу',
    target: 300,
    count: (s, d) =>
      d.reduce((a, day) => a + (s.focusLog[day] ?? []).reduce((x, e) => x + e.minutes, 0), 0),
  },
  {
    id: 'romance',
    title: 'Романтичний тиждень',
    goal: 'побачення',
    target: 2,
    count: (s, d) => inDays(s.log, d, ['date-walk', 'date-dinner']),
  },
];

/** Понеділок тижня, до якого належить день. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function bossFor(day: string): { boss: Boss; week: string; days: string[] } {
  const week = weekStart(day);
  const [y, m, d] = week.split('-').map(Number);
  const index = Math.round(Date.UTC(y, m - 1, d) / (7 * 86_400_000));
  const boss = BOSSES[((index % BOSSES.length) + BOSSES.length) % BOSSES.length];
  return { boss, week, days: Array.from({ length: 7 }, (_, i) => addDays(week, i)) };
}

// ---------------------------------------------------------------- заморозка серії

/**
 * Пропущені дні перед сьогодні, які можна прикрити заморозками: лише якщо перед ними
 * була серія і заморозок вистачає на всі.
 */
export function daysToFreeze(save: SaveData, today: string): string[] {
  if (save.freezes <= 0) return [];
  const covered = (day: string) =>
    dayQualifies(save.days[day], QUESTS) || save.frozen.includes(day);
  const missed: string[] = [];
  let cursor = addDays(today, -1);
  while (!covered(cursor) && missed.length <= save.freezes) {
    missed.push(cursor);
    cursor = addDays(cursor, -1);
  }
  if (missed.length === 0 || missed.length > save.freezes) return [];
  return dayQualifies(save.days[cursor], QUESTS) ? missed : [];
}

// ---------------------------------------------------------------- статистика

/** XP за кожен день (квести, активності, справи, фокус, Health). */
export function dailyXp(save: SaveData): Map<string, number> {
  const xp = new Map<string, number>();
  const add = (day: string, value: number) => xp.set(day, (xp.get(day) ?? 0) + value);
  for (const [day, ids] of Object.entries(save.days)) {
    const done = new Set(ids);
    for (const id of ids) add(day, findTask(id)?.task.xp ?? 0);
    for (const q of QUESTS) if (isQuestDone(q, done)) add(day, QUEST_BONUS_XP);
  }
  const activityXp = new Map(ACTIVITIES.map((a) => [a.id, a.xp]));
  for (const [day, ids] of Object.entries(save.log)) {
    for (const id of ids) add(day, activityXp.get(id) ?? 0);
  }
  for (const todo of save.todos) {
    if (todo.done && todo.doneAt) add(todo.doneAt.slice(0, 10), TODO_XP);
  }
  for (const [day, entries] of Object.entries(save.focusLog)) {
    for (const e of entries) add(day, focusReward(e).xp);
  }
  for (const [day, h] of Object.entries(save.health)) add(day, h.xp);
  return xp;
}

// ---------------------------------------------------------------- розбір збереження

export function parseFocus(raw: unknown): FocusSession | null {
  const f = raw as Partial<FocusSession> | null;
  if (
    !f ||
    !FOCUS_KINDS.some((k) => k.id === f.kind) ||
    typeof f.minutes !== 'number' ||
    f.minutes < 1 ||
    f.minutes > 180 ||
    typeof f.start !== 'string' ||
    Number.isNaN(Date.parse(f.start))
  )
    return null;
  return { kind: f.kind!, minutes: Math.round(f.minutes), start: f.start };
}

export function parseFocusLog(raw: unknown): Record<string, FocusEntry[]> {
  const out: Record<string, FocusEntry[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [day, list] of Object.entries(raw)) {
    if (!isDateKey(day) || !Array.isArray(list)) continue;
    out[day] = list
      .filter(
        (e): e is FocusEntry =>
          !!e &&
          FOCUS_KINDS.some((k) => k.id === e.kind) &&
          typeof e.minutes === 'number' &&
          e.minutes > 0 &&
          e.minutes <= 180,
      )
      .map((e) => ({ kind: e.kind, minutes: Math.round(e.minutes) }));
  }
  return out;
}

export function parseHealth(raw: unknown): Record<string, HealthDay> {
  const out: Record<string, HealthDay> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [day, h] of Object.entries(raw as Record<string, Partial<HealthDay>>)) {
    if (!isDateKey(day) || !h || typeof h !== 'object') continue;
    const merged = mergeHealth(undefined, h);
    out[day] = { ...merged, xp: typeof h.xp === 'number' && h.xp >= 0 ? Math.round(h.xp) : 0 };
  }
  return out;
}

export function parseAchievements(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const [id, day] of Object.entries(raw)) {
    if (known.has(id) && typeof day === 'string') out[id] = day;
  }
  return out;
}

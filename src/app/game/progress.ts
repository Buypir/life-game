import { Quest, StatKey } from './quests';
import { LocationId, parsePlaces, Place } from './activities';
import { parseTodos, Todo } from './todos';

export type Stats = Record<StatKey, number>;

/** Те, що зберігається на телефоні. */
export interface SaveData {
  version: 1;
  /** Загальний досвід за весь час. */
  xp: number;
  stats: Stats;
  /** Виконані справи за днями: 'YYYY-MM-DD' → id справ. */
  days: Record<string, string[]>;
  /** Список справ (окремо від щоденних квестів). */
  todos: Todo[];
  /** Активності за днями: 'YYYY-MM-DD' → id (можуть повторюватися). */
  log: Record<string, string[]>;
  /** Де зараз герой. */
  location: LocationId;
  /** Збережені за GPS місця. */
  places: Place[];
  /** Чи визначати місце за GPS, коли відкриваєш гру. */
  tracking: boolean;
  sound: boolean;
}

export function emptySave(): SaveData {
  return {
    version: 1,
    xp: 0,
    stats: { strength: 0, intellect: 0, energy: 0, discipline: 0, work: 0, love: 0 },
    days: {},
    todos: [],
    log: {},
    location: 'home',
    places: [],
    tracking: false,
    sound: true,
  };
}

/** Локальна дата у форматі YYYY-MM-DD (не UTC, щоб день мінявся опівночі за твоїм часом). */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return dateKey(date);
}

/** Скільки XP треба, щоб перейти з рівня `level` на наступний. */
export function xpToNext(level: number): number {
  return 100 + 50 * (level - 1);
}

export interface LevelInfo {
  level: number;
  /** XP, набраний усередині поточного рівня. */
  into: number;
  /** XP, потрібний для наступного рівня. */
  need: number;
}

export function levelInfo(totalXp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}

export function isQuestDone(quest: Quest, done: ReadonlySet<string>): boolean {
  return quest.tasks.every((t) => done.has(t.id));
}

/** День зараховується в серію, якщо хоча б один квест виконано повністю. */
export function dayQualifies(doneIds: readonly string[] | undefined, quests: Quest[]): boolean {
  if (!doneIds || doneIds.length === 0) return false;
  const done = new Set(doneIds);
  return quests.some((q) => isQuestDone(q, done));
}

/**
 * Поточна серія днів. Якщо сьогодні ще не зараховано, серія не обривається,
 * а рахується від учора — у тебе є весь день, щоб її продовжити.
 */
export function currentStreak(days: SaveData['days'], today: string, quests: Quest[]): number {
  let cursor = dayQualifies(days[today], quests) ? today : addDays(today, -1);
  let streak = 0;
  while (dayQualifies(days[cursor], quests)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function bestStreak(days: SaveData['days'], quests: Quest[]): number {
  const keys = Object.keys(days)
    .filter((k) => dayQualifies(days[k], quests))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of keys) {
    run = prev !== null && addDays(prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

/** Останні `count` днів, від найстарішого до сьогодні. */
export function recentDays(
  days: SaveData['days'],
  today: string,
  quests: Quest[],
  count = 7,
): { key: string; qualified: boolean; isToday: boolean }[] {
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    result.push({ key, qualified: dayQualifies(days[key], quests), isToday: i === 0 });
  }
  return result;
}

const LOCATIONS: LocationId[] = ['home', 'office', 'gym', 'road', 'park', 'cafe'];

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDays(raw: unknown): Record<string, string[]> {
  const days: Record<string, string[]> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, ids] of Object.entries(raw)) {
      if (isDateKey(key) && Array.isArray(ids)) {
        days[key] = ids.filter((id): id is string => typeof id === 'string');
      }
    }
  }
  return days;
}

/** Акуратно відновлює збереження: пошкоджені поля замінюються значеннями за замовчуванням. */
export function parseSave(raw: string | null): SaveData {
  const base = emptySave();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<SaveData>;
    const stats = { ...base.stats };
    for (const key of Object.keys(stats) as StatKey[]) {
      const value = data.stats?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) stats[key] = Math.max(0, value);
    }
    const days: SaveData['days'] = {};
    if (data.days && typeof data.days === 'object') {
      for (const [key, ids] of Object.entries(data.days)) {
        if (isDateKey(key) && Array.isArray(ids)) {
          days[key] = ids.filter((id): id is string => typeof id === 'string');
        }
      }
    }
    return {
      version: 1,
      xp: typeof data.xp === 'number' && Number.isFinite(data.xp) ? Math.max(0, data.xp) : 0,
      stats,
      days,
      todos: parseTodos(data.todos),
      log: parseDays(data.log),
      location: LOCATIONS.includes(data.location as LocationId)
        ? (data.location as LocationId)
        : 'home',
      places: parsePlaces(data.places),
      tracking: data.tracking === true,
      sound: typeof data.sound === 'boolean' ? data.sound : true,
    };
  } catch {
    return base;
  }
}

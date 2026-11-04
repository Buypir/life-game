import { Quest, StatKey } from './quests';
import { LocationId, parsePlaces, Place } from './activities';
import { parseTodos, Todo } from './todos';
import {
  defaultEquipped,
  Equipped,
  parseCount,
  parseEquipped,
  parseOwned,
  parseRedeemed,
  parseRewards,
  parseStrings,
  Redemption,
  Reward,
  DEFAULT_REWARDS,
  MAX_FREEZES,
} from './shop';
import {
  FocusEntry,
  FocusSession,
  HealthDay,
  parseAchievements,
  parseFocus,
  parseFocusLog,
  parseHealth,
  SKILLS,
} from './progression';

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
  /** Ім'я героя (видно партнерові в режимі пари). */
  name: string;
  /** Монети за досягнення й боса (решта монет рахується з XP). */
  coinBonus: number;
  /** Скільки монет витрачено в магазині. */
  spent: number;
  owned: string[];
  equipped: Equipped;
  rewards: Reward[];
  redeemed: Redemption[];
  freezes: number;
  /** Дні, які врятувала заморозка серії. */
  frozen: string[];
  /** id досягнення → день, коли отримано. */
  achievements: Record<string, string>;
  /** Тижні (понеділки), за які вже забрано нагороду боса. */
  bosses: string[];
  skills: string[];
  focus: FocusSession | null;
  focusLog: Record<string, FocusEntry[]>;
  health: Record<string, HealthDay>;
  /** Скільки виконаних справ прибрано зі списку (для досягнень). */
  todosArchived: number;
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
    name: 'Герой',
    coinBonus: 0,
    spent: 0,
    owned: [],
    equipped: defaultEquipped(),
    rewards: DEFAULT_REWARDS.map((r) => ({ ...r })),
    redeemed: [],
    freezes: 0,
    frozen: [],
    achievements: {},
    bosses: [],
    skills: [],
    focus: null,
    focusLog: {},
    health: {},
    todosArchived: 0,
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
export function currentStreak(
  days: SaveData['days'],
  today: string,
  quests: Quest[],
  frozen: readonly string[] = [],
): number {
  let cursor = dayQualifies(days[today], quests) ? today : addDays(today, -1);
  let streak = 0;
  // заморожений день не додає до серії, але й не обриває її
  while (dayQualifies(days[cursor], quests) || frozen.includes(cursor)) {
    if (dayQualifies(days[cursor], quests)) streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function bestStreak(
  days: SaveData['days'],
  quests: Quest[],
  frozen: readonly string[] = [],
): number {
  const keys = [...Object.keys(days).filter((k) => dayQualifies(days[k], quests)), ...frozen]
    .filter((k, i, all) => all.indexOf(k) === i)
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of keys) {
    const counts = dayQualifies(days[key], quests) ? 1 : 0;
    run = prev !== null && addDays(prev, 1) === key ? run + counts : counts;
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
  frozen: readonly string[] = [],
): { key: string; qualified: boolean; isToday: boolean; frozen?: boolean }[] {
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    const day: { key: string; qualified: boolean; isToday: boolean; frozen?: boolean } = {
      key,
      qualified: dayQualifies(days[key], quests),
      isToday: i === 0,
    };
    if (frozen.includes(key)) day.frozen = true;
    result.push(day);
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

function parseEconomy(
  data: Partial<SaveData>,
): Omit<
  SaveData,
  | 'version'
  | 'xp'
  | 'stats'
  | 'days'
  | 'todos'
  | 'log'
  | 'location'
  | 'places'
  | 'tracking'
  | 'sound'
> {
  const owned = parseOwned(data.owned);
  const skillIds = new Set(SKILLS.map((s) => s.id));
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 24) : '';
  return {
    name: name || 'Герой',
    coinBonus: parseCount(data.coinBonus),
    spent: parseCount(data.spent),
    owned,
    equipped: parseEquipped(data.equipped, owned),
    rewards: parseRewards(data.rewards),
    redeemed: parseRedeemed(data.redeemed),
    freezes: Math.min(MAX_FREEZES, parseCount(data.freezes)),
    frozen: parseStrings(data.frozen, 400).filter(isDateKey),
    achievements: parseAchievements(data.achievements),
    bosses: parseStrings(data.bosses, 400).filter(isDateKey),
    skills: [...new Set(parseStrings(data.skills).filter((id) => skillIds.has(id)))],
    focus: parseFocus(data.focus),
    focusLog: parseFocusLog(data.focusLog),
    health: parseHealth(data.health),
    todosArchived: parseCount(data.todosArchived),
  };
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
      ...parseEconomy(data),
    };
  } catch {
    return base;
  }
}

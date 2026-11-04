/** Магазин: монети, одяг героя, речі для кімнати, бонуси й власні нагороди з реального життя. */

export type ShopCategory = 'shirt' | 'hat' | 'face' | 'room' | 'bonus';
export type Slot = 'shirt' | 'hat' | 'face';

export interface ShopItem {
  id: string;
  title: string;
  category: ShopCategory;
  price: number;
  /** Колір футболки для категорії shirt. */
  color?: string;
  note?: string;
}

export interface Equipped {
  shirt: string;
  hat: string | null;
  face: string | null;
}

export interface Reward {
  id: string;
  title: string;
  price: number;
}

export interface Redemption {
  rewardId: string;
  title: string;
  price: number;
  at: string;
}

/** 1 монета за кожні 2 XP: скасування справи автоматично забирає й монети. */
export const XP_PER_COIN = 2;
export const MAX_FREEZES = 3;
export const DEFAULT_SHIRT = 'shirt-blue';

export const SHOP: ShopItem[] = [
  { id: 'shirt-blue', title: 'Синя футболка', category: 'shirt', price: 0, color: '#3B5BFD' },
  { id: 'shirt-green', title: 'Зелена футболка', category: 'shirt', price: 150, color: '#16A34A' },
  { id: 'shirt-red', title: 'Червона футболка', category: 'shirt', price: 150, color: '#E5484D' },
  { id: 'shirt-orange', title: 'Помаранчева', category: 'shirt', price: 200, color: '#F97316' },
  { id: 'shirt-purple', title: 'Фіолетове худі', category: 'shirt', price: 250, color: '#7C3AED' },
  { id: 'shirt-black', title: 'Чорне худі', category: 'shirt', price: 300, color: '#22252F' },
  { id: 'hat-cap', title: 'Кепка', category: 'hat', price: 250 },
  { id: 'hat-beanie', title: 'Шапка', category: 'hat', price: 250 },
  { id: 'hat-headphones', title: 'Навушники', category: 'hat', price: 400 },
  {
    id: 'hat-crown',
    title: 'Корона',
    category: 'hat',
    price: 2000,
    note: 'Для справжніх королів рутини',
  },
  { id: 'face-glasses', title: 'Окуляри', category: 'face', price: 250 },
  { id: 'face-sun', title: 'Сонцезахисні окуляри', category: 'face', price: 350 },
  { id: 'room-plant', title: 'Вазон на підвіконні', category: 'room', price: 200 },
  { id: 'room-poster', title: 'Постер', category: 'room', price: 250 },
  { id: 'room-rug', title: 'Килим', category: 'room', price: 300 },
  { id: 'room-lamp', title: 'Настільна лампа', category: 'room', price: 300 },
  { id: 'room-lights', title: 'Гірлянда', category: 'room', price: 400 },
  { id: 'room-guitar', title: 'Гітара', category: 'room', price: 600 },
  { id: 'room-console', title: 'Приставка', category: 'room', price: 800 },
  {
    id: 'room-cat',
    title: 'Кіт',
    category: 'room',
    price: 1000,
    note: 'Живе в кімнаті й махає хвостом',
  },
  {
    id: 'freeze',
    title: 'Заморозка серії',
    category: 'bonus',
    price: 300,
    note: 'Рятує серію, якщо пропустиш день. Спрацьовує сама.',
  },
];

const BY_ID = new Map(SHOP.map((i) => [i.id, i]));

export function findItem(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_REWARDS: Reward[] = [
  { id: 'r-coffee', title: 'Кава в кав’ярні', price: 400 },
  { id: 'r-games', title: 'Вечір ігор без докорів сумління', price: 800 },
  { id: 'r-new-game', title: 'Нова гра', price: 5000 },
];

export function defaultEquipped(): Equipped {
  return { shirt: DEFAULT_SHIRT, hat: null, face: null };
}

export function coinBalance(xp: number, bonus: number, spent: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_COIN) + bonus - spent;
}

export function slotOf(item: ShopItem): Slot | null {
  return item.category === 'shirt' || item.category === 'hat' || item.category === 'face'
    ? item.category
    : null;
}

export function shirtColor(equipped: Equipped): string {
  return findItem(equipped.shirt)?.color ?? '#3B5BFD';
}

// ---------- розбір збереження ----------

const strings = (raw: unknown, max = 100): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, max) : [];

const count = (raw: unknown): number =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

export function parseOwned(raw: unknown): string[] {
  return [...new Set(strings(raw).filter((id) => BY_ID.has(id) && id !== 'freeze'))];
}

export function parseEquipped(raw: unknown, owned: string[]): Equipped {
  const value = (raw ?? {}) as Partial<Equipped>;
  const has = (id: unknown, slot: Slot): id is string =>
    typeof id === 'string' &&
    findItem(id)?.category === slot &&
    (owned.includes(id) || id === DEFAULT_SHIRT);
  return {
    shirt: has(value.shirt, 'shirt') ? value.shirt : DEFAULT_SHIRT,
    hat: has(value.hat, 'hat') ? value.hat : null,
    face: has(value.face, 'face') ? value.face : null,
  };
}

export function parseRewards(raw: unknown): Reward[] {
  if (!Array.isArray(raw)) return DEFAULT_REWARDS.map((r) => ({ ...r }));
  return raw
    .filter(
      (r): r is Reward =>
        !!r &&
        typeof r.id === 'string' &&
        typeof r.title === 'string' &&
        r.title.trim().length > 0 &&
        typeof r.price === 'number' &&
        r.price > 0,
    )
    .slice(0, 30)
    .map((r) => ({ id: r.id, title: r.title.slice(0, 60), price: Math.floor(r.price) }));
}

export function parseRedeemed(raw: unknown): Redemption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is Redemption =>
        !!r &&
        typeof r.rewardId === 'string' &&
        typeof r.title === 'string' &&
        typeof r.price === 'number' &&
        typeof r.at === 'string',
    )
    .slice(-50);
}

export { count as parseCount, strings as parseStrings };

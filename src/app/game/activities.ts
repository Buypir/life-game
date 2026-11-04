import { StatKey } from './quests';

/** Де відбувається сцена. */
export type LocationId = 'home' | 'office' | 'gym' | 'road' | 'park' | 'cafe';

/** Місця, які можна зберегти за GPS. */
export type PlaceId = 'home' | 'office' | 'gym';

export type ActivityAction = 'embedded' | 'drive' | 'type' | 'lift' | 'date-walk' | 'date-dinner';

/** Разова активність: можна виконувати кілька разів на день, кожна має свою сцену. */
export interface Activity {
  id: string;
  title: string;
  doing: string;
  done: string;
  xp: number;
  stat: StatKey;
  /** Де герой виконує дію. Для поїздки — «road», а `to` — куди він приїде. */
  location: LocationId;
  action: ActivityAction;
  to?: PlaceId;
  /** Іконка для плитки (контурна, 24 × 24). */
  icon: 'chip' | 'car' | 'laptop' | 'dumbbell' | 'heart' | 'dinner' | 'home';
}

export const ACTIVITIES: Activity[] = [
  {
    id: 'embedded',
    title: 'Вчу embedded',
    doing: 'Герой прошиває STM32',
    done: 'Світлодіод блимає — прошивка працює',
    xp: 25,
    stat: 'intellect',
    location: 'home',
    action: 'embedded',
    icon: 'chip',
  },
  {
    id: 'to-office',
    title: 'Їду в офіс',
    doing: 'Герой їде в офіс',
    done: 'Герой в офісі',
    xp: 10,
    stat: 'discipline',
    location: 'road',
    action: 'drive',
    to: 'office',
    icon: 'car',
  },
  {
    id: 'office-work',
    title: 'Працюю в офісі',
    doing: 'Герой працює в офісі',
    done: 'Робочий блок в офісі закрито',
    xp: 30,
    stat: 'work',
    location: 'office',
    action: 'type',
    icon: 'laptop',
  },
  {
    id: 'to-gym',
    title: 'Їду в зал',
    doing: 'Герой їде в спортзал',
    done: 'Герой у спортзалі',
    xp: 10,
    stat: 'discipline',
    location: 'road',
    action: 'drive',
    to: 'gym',
    icon: 'car',
  },
  {
    id: 'gym-workout',
    title: 'Тренуюсь у залі',
    doing: 'Герой тягає гантелі',
    done: 'Тренування завершено',
    xp: 30,
    stat: 'strength',
    location: 'gym',
    action: 'lift',
    icon: 'dumbbell',
  },
  {
    id: 'date-walk',
    title: 'Гуляю з дівчиною',
    doing: 'Герой гуляє з дівчиною в парку',
    done: 'Чудова прогулянка',
    xp: 20,
    stat: 'love',
    location: 'park',
    action: 'date-walk',
    icon: 'heart',
  },
  {
    id: 'date-dinner',
    title: 'Вечеря з дівчиною',
    doing: 'Герой вечеряє з дівчиною',
    done: 'Романтична вечеря',
    xp: 25,
    stat: 'love',
    location: 'cafe',
    action: 'date-dinner',
    icon: 'dinner',
  },
  {
    id: 'to-home',
    title: 'Їду додому',
    doing: 'Герой їде додому',
    done: 'Герой удома',
    xp: 10,
    stat: 'discipline',
    location: 'road',
    action: 'drive',
    to: 'home',
    icon: 'home',
  },
];

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

export function findActivity(id: string): Activity | undefined {
  return BY_ID.get(id);
}

/** Поїздка, яка закінчується в цьому місці. */
export function commuteTo(place: PlaceId): Activity | undefined {
  return ACTIVITIES.find((a) => a.action === 'drive' && a.to === place);
}

/** Де опиниться герой після активності. */
export function locationAfter(activity: Activity): LocationId {
  return activity.to ?? activity.location;
}

export const PLACE_LABELS: Record<PlaceId, string> = {
  home: 'Дім',
  office: 'Офіс',
  gym: 'Спортзал',
};

export interface Place {
  id: PlaceId;
  lat: number;
  lon: number;
  /** Радіус у метрах, у межах якого вважаємо, що ти на місці. */
  radius: number;
}

/** Відстань між двома точками в метрах (формула гаверсинуса). */
export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** У якому зі збережених місць ти зараз (найближче, якщо в радіусі кількох). */
export function placeAt(
  places: Place[],
  position: { lat: number; lon: number; accuracy?: number },
): PlaceId | null {
  let best: { id: PlaceId; d: number } | null = null;
  for (const place of places) {
    const d = distanceMeters(place, position);
    const slack = Math.min(position.accuracy ?? 0, 100);
    if (d <= place.radius + slack && (!best || d < best.d)) best = { id: place.id, d };
  }
  return best?.id ?? null;
}

export function parsePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const { id, lat, lon, radius } = p as Partial<Place>;
    if ((id !== 'home' && id !== 'office' && id !== 'gym') || ids.has(id)) return [];
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return [];
    ids.add(id);
    const r = typeof radius === 'number' && radius >= 50 && radius <= 2000 ? radius : 150;
    return [{ id, lat, lon, radius: r }];
  });
}

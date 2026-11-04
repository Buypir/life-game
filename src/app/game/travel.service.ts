import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { RemindersService, ServerArrival } from '../reminders/reminders.service';
import { commuteTo, PLACE_LABELS, PlaceId, placeAt } from './activities';
import { ActivityResult, GAME_CLOCK, GameStateService } from './game-state.service';
import { dateKey } from './progress';

/** Геолокація браузера (у тестах — підробка). null — пристрій її не має. */
export const GEOLOCATION = new InjectionToken<Pick<Geolocation, 'getCurrentPosition'> | null>(
  'GEOLOCATION',
  {
    providedIn: 'root',
    factory: () =>
      typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null,
  },
);

export type TravelSource = 'gps' | 'shortcut';

export interface ArrivalEvent {
  seq: number;
  place: PlaceId;
  source: TravelSource;
  result: ActivityResult;
}

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'at'; place: PlaceId; time: Date }
  | { kind: 'away'; time: Date }
  | { kind: 'error'; message: string };

const PLACE_IDS: PlaceId[] = ['home', 'office', 'gym'];
const LINK_KEY = 'life-game:arrive-link';

/** Наскільки далеко від місця ще вважається «на місці», коли GPS неточний. */
export function radiusFor(accuracy: number): number {
  return Math.round(Math.min(500, Math.max(150, accuracy * 1.5)));
}

export function geoErrorText(err: unknown): string {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1)
    return 'Немає дозволу на геолокацію. Дозволь її в налаштуваннях Safari для цього сайту.';
  if (code === 3) return 'GPS не відповів вчасно. Спробуй ще раз на вулиці або біля вікна.';
  return 'Не вдалося визначити місце.';
}

/** Приїзди з сервера по порядку, лише відомі місця з коректною датою. */
export function orderArrivals(arrivals: ServerArrival[]): { place: PlaceId; at: Date }[] {
  return arrivals
    .flatMap((a) => {
      const place = a?.place as PlaceId;
      const at = new Date(a?.at);
      return PLACE_IDS.includes(place) && !Number.isNaN(at.getTime()) ? [{ place, at }] : [];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Поїздки за GPS. Два джерела:
 * 1) геолокація браузера — лише поки застосунок відкритий (обмеження PWA);
 * 2) автоматизації iOS Shortcuts «Коли я прибуваю…» → сервер → черга, яку застосунок забирає при відкритті.
 * Поїздка зараховується, коли герой опиняється в іншому збереженому місці, ніж був.
 */
@Injectable({ providedIn: 'root' })
export class TravelService {
  private readonly game = inject(GameStateService);
  private readonly reminders = inject(RemindersService);
  private readonly geo = inject(GEOLOCATION);
  private readonly clock = inject(GAME_CLOCK);

  readonly supported = this.geo !== null;
  readonly lastArrival = signal<ArrivalEvent | null>(null);
  readonly check = signal<CheckState>({ kind: 'idle' });
  /** Початок URL для автоматизацій «Команд» (далі /home, /office, /gym). */
  readonly arrivalLink = signal<string | null>(loadLink());
  private seq = 0;
  private refreshing = false;

  /** Герой приїхав у місце. null — він уже там (повтор GPS або геозони). */
  arrive(place: PlaceId, source: TravelSource, at?: Date): ActivityResult | null {
    const commute = commuteTo(place);
    if (!commute || this.game.location() === place) return null;
    const result = this.game.doActivity(commute.id, at ? dateKey(at) : undefined);
    if (!result) return null;
    this.lastArrival.set({ seq: ++this.seq, place, source, result });
    return result;
  }

  /** Відкриття застосунку або повернення до нього: спершу черга з сервера, потім GPS. */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.claimFromServer();
      if (this.game.tracking() && this.game.places().length > 0) await this.checkNow();
    } finally {
      this.refreshing = false;
    }
  }

  async claimFromServer(): Promise<number> {
    let applied = 0;
    try {
      for (const { place, at } of orderArrivals(await this.reminders.claimArrivals())) {
        if (this.arrive(place, 'shortcut', at)) applied++;
      }
    } catch {
      // сервер недоступний — заберемо наступного разу, черга там зберігається
    }
    return applied;
  }

  /** Визначає, де телефон, і зараховує поїздку, якщо це інше збережене місце. */
  async checkNow(): Promise<void> {
    if (this.check().kind === 'checking') return;
    if (!this.geo) {
      this.check.set({ kind: 'error', message: 'Цей браузер не вміє визначати місце.' });
      return;
    }
    const places = this.game.places();
    if (places.length === 0) {
      this.check.set({ kind: 'error', message: 'Спершу збережи хоча б одне місце.' });
      return;
    }
    this.check.set({ kind: 'checking' });
    try {
      const { coords } = await this.locate();
      const here = placeAt(places, {
        lat: coords.latitude,
        lon: coords.longitude,
        accuracy: coords.accuracy,
      });
      if (here) {
        this.arrive(here, 'gps');
        this.check.set({ kind: 'at', place: here, time: this.clock() });
      } else {
        this.check.set({ kind: 'away', time: this.clock() });
      }
    } catch (err) {
      this.check.set({ kind: 'error', message: geoErrorText(err) });
    }
  }

  /** Запам'ятовує поточну точку як «Дім/Офіс/Спортзал». Повертає текст помилки або null. */
  async saveHere(id: PlaceId): Promise<string | null> {
    if (!this.geo) return 'Цей браузер не вміє визначати місце.';
    try {
      const { coords } = await this.locate();
      this.game.savePlace(id, coords.latitude, coords.longitude, radiusFor(coords.accuracy));
      // ти вже тут — без зарахування поїздки
      this.game.setLocation(id);
      this.check.set({ kind: 'at', place: id, time: this.clock() });
      return null;
    } catch (err) {
      return geoErrorText(err);
    }
  }

  /** Новий ключ для автоматизацій; старі посилання перестають працювати. */
  async createArrivalLink(): Promise<string | null> {
    const result = await this.reminders.createArrivalLink();
    if ('error' in result) return result.error;
    this.arrivalLink.set(result.baseUrl);
    try {
      localStorage.setItem(LINK_KEY, result.baseUrl);
    } catch {
      // без сховища посилання проживе до перезапуску
    }
    return null;
  }

  private locate(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) =>
      this.geo!.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000,
      }),
    );
  }
}

function loadLink(): string | null {
  try {
    return localStorage.getItem(LINK_KEY);
  } catch {
    return null;
  }
}

export function arrivalText(event: ArrivalEvent): string {
  const label = PLACE_LABELS[event.place];
  const via = event.source === 'gps' ? 'GPS' : 'автоматизація';
  return `+${event.result.xpGained} XP · приїзд: ${label} (${via})`;
}

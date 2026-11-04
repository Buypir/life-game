import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { GameStateService } from '../game/game-state.service';
import { orderArrivals, TravelService } from '../game/travel.service';
import { RemindersService } from '../reminders/reminders.service';
import { isNative, LifeGameNative } from './native';
import { planNotifications } from './local-schedule';

const ALARM_KEY = 'life-game:alarm';

export interface AlarmSetting {
  enabled: boolean;
  time: string;
}

/**
 * Усе нативне в iOS-застосунку: сповіщення без сервера, геозони, черги приїздів і дій із Siri,
 * справжній будильник AlarmKit. У браузері сервіс нічого не робить.
 */
@Injectable({ providedIn: 'root' })
export class NativeBridgeService {
  private readonly game = inject(GameStateService);
  private readonly travel = inject(TravelService);
  private readonly reminders = inject(RemindersService);

  readonly native = isNative();
  readonly alarmSupported = signal(false);
  readonly alarm = signal<AlarmSetting>(loadAlarm());
  /** Екран, який треба відкрити після натискання на сповіщення. */
  readonly openScreen = signal<string | null>(null);
  private scheduleTimer?: ReturnType<typeof setTimeout>;

  start(): void {
    if (!this.native) return;

    // сповіщення: перепланувати, коли змінюється розклад, прогрес, справи чи фокус
    effect(() => {
      this.reminders.settings();
      this.reminders.status();
      this.game.doneToday();
      this.game.todos();
      this.game.focus();
      untracked(() => this.queueSchedule());
    });

    // геозони стежать за збереженими місцями, поки ввімкнено «Стежити за поїздками»
    effect(() => {
      const places = this.game.places();
      const enabled = this.game.tracking();
      void LifeGameNative.setPlaces({ enabled, places }).catch(() => undefined);
    });

    void LifeGameNative.alarmSupported()
      .then((r) => this.alarmSupported.set(r.supported))
      .catch(() => undefined);

    void LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const screen = event.notification.extra?.screen;
      if (typeof screen === 'string') this.openScreen.set(screen);
    });
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void this.collect();
    });
    void this.collect();
  }

  /** Приїзди з геозон і дії з Siri, що накопичились, поки гра була закрита. */
  async collect(): Promise<void> {
    try {
      const { arrivals } = await LifeGameNative.takeArrivals();
      for (const { place, at } of orderArrivals(arrivals)) this.travel.arrive(place, 'gps', at);
      const { actions } = await LifeGameNative.takeActions();
      this.travel.applyActions(actions);
    } catch {
      // плагін недоступний (напр. стара збірка) — нічого страшного
    }
  }

  async setAlarm(setting: AlarmSetting): Promise<string | null> {
    const [hour, minute] = setting.time.split(':').map(Number);
    try {
      await LifeGameNative.setAlarm({
        enabled: setting.enabled,
        hour,
        minute,
        title: 'Час прокидатись! Герой чекає',
      });
      this.alarm.set(setting);
      try {
        localStorage.setItem(ALARM_KEY, JSON.stringify(setting));
      } catch {
        // без сховища налаштування проживе до перезапуску
      }
      return null;
    } catch (err) {
      return (err as { message?: string })?.message ?? 'Не вдалося поставити будильник';
    }
  }

  private queueSchedule(): void {
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = setTimeout(() => void this.reschedule(), 500);
  }

  /** Повністю перебудовує заплановані сповіщення гри. */
  async reschedule(): Promise<void> {
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) {
        await LocalNotifications.cancel({
          notifications: pending.notifications.map((n) => ({ id: n.id })),
        });
      }
      if (this.reminders.status() !== 'on') return;
      const planned = planNotifications({
        settings: this.reminders.settings(),
        doneToday: this.game.doneToday(),
        todos: this.game.todos(),
        focus: this.game.focus(),
        now: new Date(),
      }).slice(0, 60); // iOS тримає до 64 запланованих сповіщень
      if (!planned.length) return;
      await LocalNotifications.schedule({
        notifications: planned.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          schedule: { at: p.at, allowWhileIdle: true },
          extra: { screen: p.screen },
        })),
      });
    } catch {
      // немає дозволу — перепланується, щойно його дадуть
    }
  }
}

function loadAlarm(): AlarmSetting {
  try {
    const raw = JSON.parse(localStorage.getItem(ALARM_KEY) ?? 'null') as AlarmSetting | null;
    if (raw && typeof raw.enabled === 'boolean' && /^\d{2}:\d{2}$/.test(raw.time)) return raw;
  } catch {
    // пошкоджене значення
  }
  return { enabled: false, time: '07:00' };
}

import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { GameStateService } from '../game/game-state.service';
import { isQuestDone } from '../game/progress';
import { Quest, QUESTS } from '../game/quests';
import { AppConfigService } from './app-config.service';

export type ReminderStatus =
  'unsupported' | 'needs-install' | 'no-server' | 'denied' | 'off' | 'on';

export interface ReminderSetting {
  questId: string;
  time: string;
  enabled: boolean;
}

interface PushState {
  id: string;
  secret: string;
  apiUrl: string;
  endpoint: string;
}

const SETTINGS_KEY = 'life-game:reminders';
const PUSH_KEY = 'life-game:push';

export const DEFAULT_TIMES: Record<string, string> = {
  morning: '07:30',
  work: '10:00',
  evening: '22:30',
};

export function defaultSettings(quests: Quest[] = QUESTS): ReminderSetting[] {
  return quests.map((q) => ({
    questId: q.id,
    time: DEFAULT_TIMES[q.id] ?? '09:00',
    enabled: true,
  }));
}

/** Текст сповіщення: назва квесту й список справ. */
export function reminderText(quest: Quest): { title: string; body: string } {
  return {
    title: `Квест «${quest.title}»`,
    body: `${quest.tasks.map((t) => t.title).join(' · ')}. Герой чекає!`,
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Пуш-нагадування: підписка через Angular Service Worker, розклад на сервері,
 * синхронізація прогресу (щоб не нагадувати про виконані квести).
 */
@Injectable({ providedIn: 'root' })
export class RemindersService {
  private readonly swPush = inject(SwPush);
  private readonly config = inject(AppConfigService);
  private readonly game = inject(GameStateService);

  readonly settings = signal<ReminderSetting[]>(loadSettings());
  readonly busy = signal(false);
  private readonly push = signal<PushState | null>(loadJson<PushState>(PUSH_KEY));
  private readonly permission = signal<NotificationPermission>(currentPermission());

  readonly supported =
    this.swPush.isEnabled && typeof Notification !== 'undefined' && 'PushManager' in window;
  readonly needsInstall = isIos() && !isStandalone();

  readonly status = computed<ReminderStatus>(() => {
    if (this.needsInstall) return 'needs-install';
    if (!this.supported) return 'unsupported';
    if (!this.config.apiUrl()) return 'no-server';
    if (this.permission() === 'denied') return 'denied';
    const push = this.push();
    return push && push.apiUrl === this.config.apiUrl() ? 'on' : 'off';
  });

  private scheduleTimer?: ReturnType<typeof setTimeout>;
  private progressTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // прогрес дня → сервер, щоб він не нагадував про виконані квести
    effect(() => {
      this.game.doneToday();
      if (untracked(() => this.status()) === 'on') untracked(() => this.queueProgress());
    });
    void this.verifySubscription();
  }

  setTime(questId: string, time: string): void {
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    this.updateSetting(questId, { time });
  }

  toggle(questId: string): void {
    const current = this.settings().find((s) => s.questId === questId);
    this.updateSetting(questId, { enabled: !current?.enabled });
  }

  /** Вмикає нагадування. Повертає текст помилки або null. Викликати лише з обробника натискання (вимога iOS). */
  async enable(): Promise<string | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    try {
      const permission = await Notification.requestPermission();
      this.permission.set(permission);
      if (permission !== 'granted') return 'Дозвіл на сповіщення не надано.';

      const { publicKey } = await this.request<{ publicKey: string }>(
        'GET',
        '/api/push/public-key',
      );
      const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
      const created = await this.request<{ id: string; secret: string }>(
        'POST',
        '/api/subscriptions',
        {
          subscription: subscription.toJSON(),
          timeZone: timeZone(),
          reminders: this.serverReminders(),
        },
      );
      this.savePush({
        id: created.id,
        secret: created.secret,
        apiUrl: this.config.apiUrl(),
        endpoint: subscription.endpoint,
      });
      await this.sendProgress();
      return null;
    } catch (err) {
      return errorText(err);
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<string | null> {
    const push = this.push();
    this.busy.set(true);
    try {
      if (push) {
        await this.request('DELETE', `/api/subscriptions/${push.id}`, undefined, push).catch(
          () => undefined,
        );
      }
      await this.swPush.unsubscribe().catch(() => undefined);
      this.savePush(null);
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async sendTest(): Promise<string | null> {
    const push = this.push();
    if (!push) return 'Нагадування вимкнені.';
    this.busy.set(true);
    try {
      await this.request('POST', `/api/subscriptions/${push.id}/test`, undefined, push);
      return null;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410))
        this.savePush(null);
      return errorText(err);
    } finally {
      this.busy.set(false);
    }
  }

  private updateSetting(questId: string, change: Partial<ReminderSetting>): void {
    const next = this.settings().map((s) => (s.questId === questId ? { ...s, ...change } : s));
    this.settings.set(next);
    saveJson(SETTINGS_KEY, next);
    if (this.status() === 'on') {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = setTimeout(() => void this.sendSchedule(), 600);
    }
  }

  private async sendSchedule(): Promise<void> {
    const push = this.push();
    if (!push) return;
    try {
      await this.request(
        'PUT',
        `/api/subscriptions/${push.id}`,
        {
          timeZone: timeZone(),
          reminders: this.serverReminders(),
        },
        push,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) this.savePush(null);
    }
  }

  private queueProgress(): void {
    clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => void this.sendProgress(), 800);
  }

  private async sendProgress(): Promise<void> {
    const push = this.push();
    if (!push) return;
    const done = this.game.doneToday();
    const doneQuests = QUESTS.filter((q) => isQuestDone(q, done)).map((q) => q.id);
    await this.request(
      'PUT',
      `/api/subscriptions/${push.id}/progress`,
      { date: this.game.today(), doneQuests },
      push,
    ).catch(() => undefined);
  }

  /** Після перезапуску перевіряє, чи браузерна підписка ще жива і чи не змінилася. */
  private async verifySubscription(): Promise<void> {
    const push = this.push();
    if (!push || !this.swPush.isEnabled) return;
    try {
      const current = await firstValueFrom(this.swPush.subscription);
      if (!current) {
        this.savePush(null);
        return;
      }
      if (current.endpoint !== push.endpoint) {
        await this.request(
          'PUT',
          `/api/subscriptions/${push.id}`,
          { subscription: current.toJSON() },
          push,
        );
        this.savePush({ ...push, endpoint: current.endpoint });
      }
      await this.sendSchedule();
    } catch {
      // сервер недоступний — спробуємо наступного разу
    }
  }

  private serverReminders() {
    return this.settings().flatMap((setting) => {
      const quest = QUESTS.find((q) => q.id === setting.questId);
      if (!quest) return [];
      return [
        {
          id: quest.id,
          time: setting.time,
          enabled: setting.enabled,
          days: [],
          ...reminderText(quest),
          url: `./?quest=${quest.id}`,
        },
      ];
    });
  }

  private async request<T = void>(
    method: string,
    path: string,
    body?: unknown,
    push?: PushState | null,
  ): Promise<T> {
    const base = push?.apiUrl ?? this.config.apiUrl();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (push) headers['X-Subscription-Secret'] = push.secret;
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Сервер нагадувань недоступний. Перевір адресу й інтернет.');
    }
    if (!response.ok) {
      let detail = '';
      try {
        const problem = (await response.json()) as { detail?: string; title?: string };
        detail = problem.detail ?? problem.title ?? '';
      } catch {
        // відповідь без тіла
      }
      throw new ApiError(response.status, detail || `Сервер відповів ${response.status}.`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private savePush(state: PushState | null): void {
    this.push.set(state);
    saveJson(PUSH_KEY, state);
  }
}

function loadSettings(): ReminderSetting[] {
  const defaults = defaultSettings();
  const stored = loadJson<ReminderSetting[]>(SETTINGS_KEY);
  if (!Array.isArray(stored)) return defaults;
  return defaults.map((d) => {
    const s = stored.find((x) => x?.questId === d.questId);
    return s && /^\d{2}:\d{2}$/.test(s.time) ? { ...d, time: s.time, enabled: !!s.enabled } : d;
  });
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // сховище недоступне
  }
}

function currentPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof DOMException && err.name === 'NotAllowedError')
    return 'Дозвіл на сповіщення не надано.';
  return 'Не вдалося увімкнути нагадування. Спробуй ще раз.';
}

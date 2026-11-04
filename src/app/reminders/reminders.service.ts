import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { GameStateService } from '../game/game-state.service';
import { dateKey, isQuestDone } from '../game/progress';
import { Quest, QUESTS } from '../game/quests';
import { notifyAt, reminderBody, Todo } from '../game/todos';
import { FocusSession } from '../game/progression';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from '../native/native';
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

/** Приїзд, який автоматизація iOS Shortcuts відмітила на сервері. */
export interface ServerArrival {
  place: string;
  at: string;
}

/** Дія з Siri, «Команд» (Apple Health) чи пристрою. */
export interface ServerAction {
  action: string;
  at: string;
  steps?: number | null;
  sleep?: number | null;
  workout?: number | null;
}

/** Стан партнера в режимі пари. */
export interface PartnerSummary {
  name: string;
  level: number;
  streak: number;
  coins: number;
  location: string;
  date: string;
  doneTitles: string[];
  shirt: string;
  hat?: string | null;
  face?: string | null;
  updatedAt: string;
}

const BACKUP_KEY = 'life-game:server-backup';
const NATIVE_KEY = 'life-game:native-reminders';

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

  /** iOS-застосунок: сповіщення плануються на телефоні, сервер не потрібен. */
  readonly native = isNative();
  private readonly nativePermission = signal<string | null>(null);
  private readonly nativeEnabled = signal(loadJson<boolean>(NATIVE_KEY) !== false);

  readonly status = computed<ReminderStatus>(() => {
    if (this.native) {
      const permission = this.nativePermission();
      if (permission === 'denied') return 'denied';
      return permission === 'granted' && this.nativeEnabled() ? 'on' : 'off';
    }
    if (this.needsInstall) return 'needs-install';
    if (!this.supported) return 'unsupported';
    if (!this.config.apiUrl()) return 'no-server';
    if (this.permission() === 'denied') return 'denied';
    const push = this.push();
    return push && push.apiUrl === this.config.apiUrl() ? 'on' : 'off';
  });

  private scheduleTimer?: ReturnType<typeof setTimeout>;
  private progressTimer?: ReturnType<typeof setTimeout>;
  private eventsTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // прогрес дня → сервер, щоб він не нагадував про виконані квести
    // (разом із коротким станом для партнера й пристрою)
    effect(() => {
      this.game.doneToday();
      this.game.level();
      this.game.streak();
      this.game.look();
      this.game.name();
      this.game.location();
      if (untracked(() => this.status()) === 'on') untracked(() => this.queueProgress());
    });
    // список справ і фокус-таймер → разові нагадування на сервері
    effect(() => {
      this.game.todos();
      this.game.focus();
      if (untracked(() => this.status()) === 'on') untracked(() => this.queueEvents());
    });
    void this.verifySubscription();
    if (this.native) {
      void LocalNotifications.checkPermissions()
        .then((p) => this.nativePermission.set(p.display))
        .catch(() => undefined);
    }
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
    if (this.native) {
      const p = await LocalNotifications.requestPermissions();
      this.nativePermission.set(p.display);
      this.nativeEnabled.set(true);
      saveJson(NATIVE_KEY, true);
      return p.display === 'granted' ? null : 'Дозвіл на сповіщення не надано.';
    }
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
      await this.sendEvents();
      return null;
    } catch (err) {
      return errorText(err);
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<string | null> {
    if (this.native) {
      this.nativeEnabled.set(false);
      saveJson(NATIVE_KEY, false);
      return null;
    }
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
    if (this.native) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 7,
            title: 'Гра про життя',
            body: 'Тестове нагадування: сповіщення працюють!',
            schedule: { at: new Date(Date.now() + 3000) },
          },
        ],
      });
      return null;
    }
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

  /**
   * Видає новий ключ приїздів (старий перестає діяти) і повертає початок URL для автоматизацій:
   * далі дописується /home, /office або /gym.
   */
  async createArrivalLink(): Promise<{ baseUrl: string } | { error: string }> {
    const push = this.push();
    if (!push)
      return { error: 'Спершу ввімкни нагадування: приїзди йдуть через той самий сервер.' };
    try {
      const { key } = await this.request<{ key: string }>(
        'POST',
        `/api/subscriptions/${push.id}/arrival-key`,
        undefined,
        push,
      );
      return { baseUrl: `${push.apiUrl}/api/arrive/${key}` };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) this.savePush(null);
      return { error: errorText(err) };
    }
  }

  /** Забирає з сервера приїзди й дії (Siri, Health), відмічені, поки застосунок був закритий. */
  async claim(): Promise<{ arrivals: ServerArrival[]; actions: ServerAction[] }> {
    const push = this.push();
    if (!push) return { arrivals: [], actions: [] };
    const response = await this.request<{ arrivals?: ServerArrival[]; actions?: ServerAction[] }>(
      'POST',
      `/api/subscriptions/${push.id}/arrivals/claim`,
      undefined,
      push,
    );
    return {
      arrivals: Array.isArray(response?.arrivals) ? response.arrivals : [],
      actions: Array.isArray(response?.actions) ? response.actions : [],
    };
  }

  async claimArrivals(): Promise<ServerArrival[]> {
    return (await this.claim()).arrivals;
  }

  // ---------- режим пари ----------

  /** Під'єднано до сервера (пара, копії, автоматизації) — у браузері через push-підписку. */
  readonly connected = computed(() => {
    const push = this.push();
    return !!push && push.apiUrl === this.config.apiUrl();
  });

  async createPairCode(): Promise<{ code: string; expiresAt: string } | { error: string }> {
    const push = this.push();
    if (!push) return { error: 'Спершу ввімкни нагадування: пара працює через сервер.' };
    try {
      return await this.request('POST', `/api/subscriptions/${push.id}/pair-code`, undefined, push);
    } catch (err) {
      return { error: errorText(err) };
    }
  }

  async pair(code: string): Promise<{ partner: PartnerSummary | null } | { error: string }> {
    const push = this.push();
    if (!push) return { error: 'Спершу ввімкни нагадування.' };
    try {
      const res = await this.request<{ summary: PartnerSummary | null }>(
        'POST',
        `/api/subscriptions/${push.id}/pair`,
        { code: code.replace(/\D/g, '') },
        push,
      );
      return { partner: res?.summary ?? null };
    } catch (err) {
      return { error: errorText(err) };
    }
  }

  /** null — пари немає; undefined — сервер недоступний. */
  async partner(): Promise<PartnerSummary | null | undefined> {
    const push = this.push();
    if (!push) return null;
    try {
      const res = await this.request<{ summary: PartnerSummary | null }>(
        'GET',
        `/api/subscriptions/${push.id}/partner`,
        undefined,
        push,
      );
      return (
        res?.summary ??
        ({
          name: '…',
          level: 1,
          streak: 0,
          coins: 0,
          location: 'home',
          date: '',
          doneTitles: [],
          shirt: '#3B5BFD',
          updatedAt: '',
        } as PartnerSummary)
      );
    } catch (err) {
      return err instanceof ApiError && err.status === 404 ? null : undefined;
    }
  }

  async unpair(): Promise<void> {
    const push = this.push();
    if (!push) return;
    await this.request('DELETE', `/api/subscriptions/${push.id}/pair`, undefined, push).catch(
      () => undefined,
    );
  }

  // ---------- резервна копія на сервері ----------

  readonly lastBackup = signal<string | null>(loadJson<string>(BACKUP_KEY));

  async uploadBackup(): Promise<string | null> {
    const push = this.push();
    if (!push) return 'Спершу ввімкни нагадування.';
    try {
      await this.request(
        'PUT',
        `/api/subscriptions/${push.id}/backup`,
        JSON.parse(this.game.exportData()),
        push,
      );
      const stamp = new Date().toISOString();
      this.lastBackup.set(stamp);
      saveJson(BACKUP_KEY, stamp);
      return null;
    } catch (err) {
      return errorText(err);
    }
  }

  async downloadBackup(): Promise<string | { error: string }> {
    const push = this.push();
    if (!push) return { error: 'Спершу ввімкни нагадування.' };
    try {
      const data = await this.request<unknown>(
        'GET',
        `/api/subscriptions/${push.id}/backup`,
        undefined,
        push,
      );
      return JSON.stringify(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        return { error: 'На сервері ще немає копії.' };
      return { error: errorText(err) };
    }
  }

  /** Раз на день копія прогресу сама летить на сервер. */
  private async autoBackup(): Promise<void> {
    const last = this.lastBackup();
    if (last && last.slice(0, 10) === new Date().toISOString().slice(0, 10)) return;
    await this.uploadBackup();
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
      { date: this.game.today(), doneQuests, summary: playerSummary(this.game) },
      push,
    ).catch(() => undefined);
  }

  private queueEvents(): void {
    clearTimeout(this.eventsTimer);
    this.eventsTimer = setTimeout(() => void this.sendEvents(), 800);
  }

  /** Надсилає повний список майбутніх нагадувань про справи. */
  async sendEvents(): Promise<void> {
    const push = this.push();
    if (!push) return;
    await this.request(
      'PUT',
      `/api/subscriptions/${push.id}/events`,
      { events: [...todoEvents(this.game.todos(), new Date()), ...focusEvents(this.game.focus())] },
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
      await this.sendEvents();
      await this.sendProgress();
      await this.autoBackup();
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

/** Сповіщення, коли закінчиться фокус-таймер (навіть якщо гру закрито). */
export function focusEvents(focus: FocusSession | null) {
  if (!focus) return [];
  const end = new Date(new Date(focus.start).getTime() + focus.minutes * 60_000);
  return [
    {
      id: 'focus',
      notifyAt: end.toISOString(),
      title: 'Фокус завершено',
      body: `${focus.minutes} хв — є! Відкрий гру, щоб забрати XP.`,
      url: './',
    },
  ];
}

/** Короткий стан для партнера й пристрою на ESP32. */
export function playerSummary(game: GameStateService) {
  const done = game.doneToday();
  const quest = QUESTS.find((q) => !isQuestDone(q, done));
  const next = quest?.tasks.find((t) => !done.has(t.id));
  const look = game.look();
  return {
    name: game.name(),
    level: game.level().level,
    streak: game.streak(),
    coins: game.coins(),
    location: game.location(),
    doneTitles: QUESTS.filter((q) => isQuestDone(q, done)).map((q) => q.title),
    shirt: look.shirt,
    hat: look.hat,
    face: look.face,
    nextTaskId: next?.id ?? null,
    nextTaskTitle: next?.title ?? null,
    upcoming: QUESTS.flatMap((q) => q.tasks)
      .filter((t) => !done.has(t.id))
      .slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title })),
  };
}

/**
 * Нагадування про справи, які ще попереду. «Сьогодні/завтра» в тексті рахуються від дня,
 * коли сповіщення прийде, а не від дня, коли його запланували.
 */
export function todoEvents(todos: Todo[], now: Date) {
  return todos.flatMap((todo) => {
    const at = notifyAt(todo);
    if (todo.done || !at || at.getTime() < now.getTime() - 60_000) return [];
    return [
      {
        id: todo.id,
        notifyAt: at.toISOString(),
        title: todo.title,
        body: reminderBody(todo, dateKey(at)),
        url: './?screen=todos',
      },
    ];
  });
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

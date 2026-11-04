import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  addDays,
  bestStreak,
  currentStreak,
  dateKey,
  dayQualifies,
  emptySave,
  isDateKey,
  isQuestDone,
  levelInfo,
  parseSave,
  recentDays,
  SaveData,
} from './progress';
import { findTask, Quest, QUEST_BONUS_XP, QUESTS } from './quests';
import { cleanInput, newTodoId, Todo, TODO_XP, TodoInput } from './todos';
import { coinBalance, findItem, MAX_FREEZES, Reward, shirtColor, slotOf } from './shop';
import {
  Achievement,
  ACHIEVEMENTS,
  BOSS_COINS,
  BOSS_XP,
  bossFor,
  daysToFreeze,
  FocusKind,
  focusElapsed,
  focusReward,
  HEALTH_GOALS,
  healthXp,
  HealthInput,
  mergeHealth,
  MIN_FOCUS_MINUTES,
  newAchievements,
  SKILL_XP_PER_POINT,
  SKILLS,
  skillPoints,
  skillState,
  totals as computeTotals,
  dailyXp,
} from './progression';
import { Activity, findActivity, LocationId, locationAfter, Place, PlaceId } from './activities';

export const STORAGE_KEY = 'life-game:v1';

export interface ActivityResult {
  activity: Activity;
  xpGained: number;
  leveledUp: boolean;
  level: number;
  /** День, у журнал якого записано активність. */
  day: string;
}

/** Сховище й годинник винесені в токени, щоб логіку можна було тестувати. */
export const GAME_STORAGE = new InjectionToken<Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>>(
  'GAME_STORAGE',
  {
    providedIn: 'root',
    factory: () => {
      try {
        return window.localStorage;
      } catch {
        const memory = new Map<string, string>();
        return {
          getItem: (k: string) => memory.get(k) ?? null,
          setItem: (k: string, v: string) => void memory.set(k, v),
          removeItem: (k: string) => void memory.delete(k),
        };
      }
    },
  },
);

export const GAME_CLOCK = new InjectionToken<() => Date>('GAME_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

export interface CompleteResult {
  xpGained: number;
  questCompleted: Quest | null;
  leveledUp: boolean;
  level: number;
}

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly storage = inject(GAME_STORAGE);
  private readonly clock = inject(GAME_CLOCK);

  private readonly save = signal<SaveData>(this.load());
  /** Поточний день; оновлюється, коли застосунок повертається на екран або минає північ. */
  readonly today = signal(dateKey(this.clock()));

  readonly quests = QUESTS;
  readonly xp = computed(() => this.save().xp);
  readonly stats = computed(() => this.save().stats);
  readonly sound = computed(() => this.save().sound);
  readonly level = computed(() => levelInfo(this.save().xp));
  readonly doneToday = computed(() => new Set(this.save().days[this.today()] ?? []));
  readonly streak = computed(() =>
    currentStreak(this.save().days, this.today(), QUESTS, this.save().frozen),
  );
  readonly bestStreak = computed(() => bestStreak(this.save().days, QUESTS, this.save().frozen));
  readonly week = computed(() =>
    recentDays(this.save().days, this.today(), QUESTS, 7, this.save().frozen),
  );
  /** Герой спить, поки за день нічого не зроблено, і після «Лягти спати». */
  readonly asleep = computed(() => {
    const done = this.doneToday();
    return (
      done.has('sleep') || (done.size === 0 && (this.save().log[this.today()] ?? []).length === 0)
    );
  });
  readonly awake = computed(() => !this.asleep());
  readonly wentToBed = computed(() => this.doneToday().has('sleep'));
  readonly breakfastDone = computed(() => this.doneToday().has('breakfast'));

  constructor() {
    // досягнення, які вже виконано до оновлення гри, зараховуємо одразу
    if (newAchievements(this.save(), this.bestStreak()).length) this.commit(this.save());
  }

  /** Перевіряє, чи не настав новий день; заодно рятує серію заморозкою. */
  refreshDay(): void {
    const key = dateKey(this.clock());
    if (key !== this.today()) this.today.set(key);
    this.applyFreezes();
  }

  /** Пропущені дні прикриваються заморозками (якщо вони є і перед пропуском була серія). */
  applyFreezes(): string[] {
    const current = this.save();
    const days = daysToFreeze(current, this.today());
    if (days.length === 0) return [];
    this.commit({
      ...current,
      freezes: current.freezes - days.length,
      frozen: [...current.frozen, ...days].slice(-400),
    });
    this.notices.update((list) => [
      ...list,
      days.length === 1
        ? 'Заморозка врятувала серію за вчора'
        : `Заморозки врятували серію (${days.length} дні)`,
    ]);
    return days;
  }

  questProgress(quest: Quest): { done: number; total: number; complete: boolean } {
    const done = this.doneToday();
    const count = quest.tasks.filter((t) => done.has(t.id)).length;
    return { done: count, total: quest.tasks.length, complete: count === quest.tasks.length };
  }

  /** day — для дій із Siri, які застосунок забрав пізніше (за замовчуванням сьогодні). */
  complete(taskId: string, day?: string): CompleteResult | null {
    const found = findTask(taskId);
    if (!found) return null;
    const { task, quest } = found;
    const today = day && isDateKey(day) ? day : this.today();
    const current = this.save();
    const doneIds = current.days[today] ?? [];
    if (doneIds.includes(taskId)) return null;

    const nextDone = [...doneIds, taskId];
    // щоденні квести герой виконує вдома
    const questCompleted = isQuestDone(quest, new Set(nextDone));
    const xpGained = task.xp + (questCompleted ? QUEST_BONUS_XP : 0);
    const levelBefore = levelInfo(current.xp).level;

    const stats = { ...current.stats, [task.stat]: current.stats[task.stat] + 1 };
    if (questCompleted) stats.discipline += 1;

    const next: SaveData = {
      ...current,
      xp: current.xp + xpGained,
      stats,
      days: { ...current.days, [today]: nextDone },
      location: 'home',
    };
    this.commit(next);

    const levelAfter = levelInfo(next.xp).level;
    return {
      xpGained,
      questCompleted: questCompleted ? quest : null,
      leveledUp: levelAfter > levelBefore,
      level: levelAfter,
    };
  }

  /** Скасовує випадково відмічену справу (разом із бонусом квесту, якщо він був). */
  undo(taskId: string): number {
    const found = findTask(taskId);
    if (!found) return 0;
    const { task, quest } = found;
    const today = this.today();
    const current = this.save();
    const doneIds = current.days[today] ?? [];
    if (!doneIds.includes(taskId)) return 0;

    const wasComplete = isQuestDone(quest, new Set(doneIds));
    const xpLost = task.xp + (wasComplete ? QUEST_BONUS_XP : 0);
    const stats = { ...current.stats, [task.stat]: Math.max(0, current.stats[task.stat] - 1) };
    if (wasComplete) stats.discipline = Math.max(0, stats.discipline - 1);

    this.commit({
      ...current,
      xp: Math.max(0, current.xp - xpLost),
      stats,
      days: { ...current.days, [today]: doneIds.filter((id) => id !== taskId) },
    });
    return xpLost;
  }

  setSound(on: boolean): void {
    this.commit({ ...this.save(), sound: on });
  }

  /** Скидає досвід і квести; звуки й список справ лишаються. */
  reset(): void {
    const { sound, todos, places, tracking, name, rewards } = this.save();
    this.commit({ ...emptySave(), sound, todos, places, tracking, name, rewards });
  }

  // ---------- активності й місця ----------

  readonly location = computed(() => this.save().location);
  readonly places = computed(() => this.save().places);
  readonly tracking = computed(() => this.save().tracking);
  /** Скільки разів кожну активність виконано сьогодні. */
  readonly activityCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const id of this.save().log[this.today()] ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  });

  /**
   * Зараховує активність. day — дата запису (за замовчуванням сьогодні): приїзд,
   * який сервер зафіксував учора ввечері, піде в учорашній журнал.
   */
  doActivity(id: string, day?: string): ActivityResult | null {
    const activity = findActivity(id);
    if (!activity) return null;
    const current = this.save();
    const today = day && isDateKey(day) ? day : this.today();
    const before = levelInfo(current.xp).level;
    const next: SaveData = {
      ...current,
      xp: current.xp + activity.xp,
      stats: { ...current.stats, [activity.stat]: current.stats[activity.stat] + 1 },
      log: { ...current.log, [today]: [...(current.log[today] ?? []), id] },
      location: locationAfter(activity),
    };
    this.commit(next);
    const level = levelInfo(next.xp).level;
    return { activity, xpGained: activity.xp, leveledUp: level > before, level, day: today };
  }

  /** Скасовує останній запис активності за день (за замовчуванням сьогодні). */
  undoActivity(id: string, day?: string): number {
    const activity = findActivity(id);
    const current = this.save();
    const today = day && isDateKey(day) ? day : this.today();
    const entries = current.log[today] ?? [];
    const index = entries.lastIndexOf(id);
    if (!activity || index < 0) return 0;
    this.commit({
      ...current,
      xp: Math.max(0, current.xp - activity.xp),
      stats: { ...current.stats, [activity.stat]: Math.max(0, current.stats[activity.stat] - 1) },
      log: { ...current.log, [today]: entries.filter((_, i) => i !== index) },
    });
    return activity.xp;
  }

  setLocation(location: LocationId): void {
    if (this.save().location !== location) this.commit({ ...this.save(), location });
  }

  savePlace(id: PlaceId, lat: number, lon: number, radius = 150): void {
    const current = this.save();
    const place: Place = { id, lat, lon, radius };
    this.commit({ ...current, places: [...current.places.filter((p) => p.id !== id), place] });
  }

  removePlace(id: PlaceId): void {
    const current = this.save();
    this.commit({ ...current, places: current.places.filter((p) => p.id !== id) });
  }

  setTracking(on: boolean): void {
    this.commit({ ...this.save(), tracking: on });
  }

  // ---------- монети й магазин ----------

  readonly name = computed(() => this.save().name);
  readonly coins = computed(() => {
    const s = this.save();
    return coinBalance(s.xp, s.coinBonus, s.spent);
  });
  readonly owned = computed(() => new Set(this.save().owned));
  readonly equipped = computed(() => this.save().equipped);
  readonly rewards = computed(() => this.save().rewards);
  readonly redeemed = computed(() => this.save().redeemed);
  readonly freezes = computed(() => this.save().freezes);
  /** Зовнішність героя для сцени й аватара. */
  readonly look = computed(() => {
    const e = this.save().equipped;
    return { shirt: shirtColor(e), hat: e.hat, face: e.face };
  });
  /** Куплені речі для кімнати. */
  readonly roomItems = computed(() =>
    this.save().owned.filter((id) => findItem(id)?.category === 'room'),
  );
  /** Повідомлення для тосту (досягнення, заморозки). Екран забирає їх через takeNotices(). */
  readonly notices = signal<string[]>([]);

  takeNotices(): string[] {
    const list = this.notices();
    if (list.length) this.notices.set([]);
    return list;
  }

  setName(name: string): void {
    const clean = name.trim().slice(0, 24);
    if (clean) this.commit({ ...this.save(), name: clean });
  }

  /** Купівля. Повертає текст помилки або null. */
  buy(itemId: string): string | null {
    const item = findItem(itemId);
    if (!item) return 'Такої речі немає.';
    const current = this.save();
    if (item.category === 'bonus') {
      if (current.freezes >= MAX_FREEZES)
        return `Можна тримати не більше ${MAX_FREEZES} заморозок.`;
    } else if (current.owned.includes(itemId) || item.price === 0) {
      return 'Уже куплено.';
    }
    if (this.coins() < item.price) return 'Не вистачає монет.';
    const next: SaveData = { ...current, spent: current.spent + item.price };
    if (item.category === 'bonus') next.freezes = current.freezes + 1;
    else next.owned = [...current.owned, itemId];
    const slot = slotOf(item);
    if (slot) next.equipped = { ...current.equipped, [slot]: itemId };
    this.commit(next);
    return null;
  }

  /** Вдягнути або зняти річ. Футболку не знімаємо — повертаємо базову. */
  toggleEquip(itemId: string): void {
    const item = findItem(itemId);
    const slot = item && slotOf(item);
    const current = this.save();
    if (!item || !slot || (!current.owned.includes(itemId) && item.price > 0)) return;
    const on = current.equipped[slot] === itemId;
    const value = on ? (slot === 'shirt' ? 'shirt-blue' : null) : itemId;
    this.commit({ ...current, equipped: { ...current.equipped, [slot]: value } });
  }

  addReward(title: string, price: number): boolean {
    const clean = title.trim().slice(0, 60);
    const cost = Math.floor(price);
    if (!clean || !Number.isFinite(cost) || cost < 1 || cost > 100_000) return false;
    const current = this.save();
    const reward: Reward = { id: `r-${newTodoId()}`, title: clean, price: cost };
    this.commit({ ...current, rewards: [...current.rewards, reward].slice(0, 30) });
    return true;
  }

  removeReward(id: string): void {
    const current = this.save();
    this.commit({ ...current, rewards: current.rewards.filter((r) => r.id !== id) });
  }

  /** Обміняти монети на нагороду з реального життя. */
  redeem(id: string): string | null {
    const current = this.save();
    const reward = current.rewards.find((r) => r.id === id);
    if (!reward) return 'Нагороду не знайдено.';
    if (this.coins() < reward.price) return 'Не вистачає монет.';
    this.commit({
      ...current,
      spent: current.spent + reward.price,
      redeemed: [
        ...current.redeemed,
        { rewardId: id, title: reward.title, price: reward.price, at: this.clock().toISOString() },
      ].slice(-50),
    });
    return null;
  }

  // ---------- досягнення, бос, навички ----------

  readonly totals = computed(() => computeTotals(this.save()));
  readonly xpByDay = computed(() => dailyXp(this.save()));

  readonly achievements = computed(() => {
    const s = this.save();
    const t = this.totals();
    const best = this.bestStreak();
    return ACHIEVEMENTS.map((a) => {
      const [value, target] = a.progress(s, t, best);
      return {
        ...a,
        value: Math.min(value, target),
        target,
        unlockedAt: s.achievements[a.id] ?? null,
      };
    });
  });

  readonly boss = computed(() => {
    const { boss, week, days } = bossFor(this.today());
    const value = boss.count(this.save(), days);
    return {
      ...boss,
      week,
      value: Math.min(value, boss.target),
      done: value >= boss.target,
      claimed: this.save().bosses.includes(week),
    };
  });

  claimBoss(): boolean {
    const boss = this.boss();
    if (!boss.done || boss.claimed) return false;
    const current = this.save();
    this.commit({
      ...current,
      xp: current.xp + BOSS_XP,
      coinBonus: current.coinBonus + BOSS_COINS,
      stats: { ...current.stats, discipline: current.stats.discipline + 1 },
      bosses: [...current.bosses, boss.week].slice(-200),
    });
    return true;
  }

  readonly skills = computed(() => {
    const learned = this.save().skills;
    return SKILLS.map((node) => ({ ...node, state: skillState(node, learned) }));
  });
  readonly skillPoints = computed(() => skillPoints(this.save()));

  learnSkill(id: string): string | null {
    const node = SKILLS.find((s) => s.id === id);
    const current = this.save();
    if (!node) return 'Невідома навичка.';
    const state = skillState(node, current.skills);
    if (state === 'learned') return 'Уже вивчено.';
    if (state === 'locked') return 'Спершу вивчи попередні навички.';
    if (this.skillPoints().free < node.cost) return 'Не вистачає очок: займайся embedded.';
    this.commit({
      ...current,
      skills: [...current.skills, id],
      xp: current.xp + node.cost * SKILL_XP_PER_POINT,
      stats: { ...current.stats, intellect: current.stats.intellect + node.cost },
    });
    return null;
  }

  /** Учора нічого не зроблено (і не врятовано заморозкою) — у кімнаті безлад, поки не виконаєш квест. */
  readonly messy = computed(() => {
    const s = this.save();
    const yesterday = addDays(this.today(), -1);
    const hasHistory = Object.keys(s.days).some((d) => d < yesterday);
    if (!hasHistory || s.frozen.includes(yesterday)) return false;
    if (dayQualifies(s.days[yesterday], QUESTS)) return false;
    return !dayQualifies(s.days[this.today()], QUESTS);
  });

  // ---------- фокус-таймер ----------

  readonly focus = computed(() => this.save().focus);
  readonly focusToday = computed(() =>
    (this.save().focusLog[this.today()] ?? []).reduce((a, e) => a + e.minutes, 0),
  );

  startFocus(kind: FocusKind, minutes: number): void {
    if (this.save().focus) return;
    this.commit({
      ...this.save(),
      focus: {
        kind,
        minutes: Math.min(180, Math.max(1, Math.round(minutes))),
        start: this.clock().toISOString(),
      },
    });
  }

  cancelFocus(): void {
    if (this.save().focus) this.commit({ ...this.save(), focus: null });
  }

  /**
   * Завершує фокус: зараховує час, що минув (не більше запланованого).
   * Повертає нагороду або null, якщо пройшло менше MIN_FOCUS_MINUTES.
   */
  finishFocus(): { minutes: number; xpGained: number; leveledUp: boolean; level: number } | null {
    const current = this.save();
    const session = current.focus;
    if (!session) return null;
    const minutes = Math.min(session.minutes, Math.floor(focusElapsed(session, this.clock())));
    if (minutes < MIN_FOCUS_MINUTES) {
      this.commit({ ...current, focus: null });
      return null;
    }
    const entry = { kind: session.kind, minutes };
    const reward = focusReward(entry);
    const day = dateKey(new Date(session.start));
    const before = levelInfo(current.xp).level;
    const next: SaveData = {
      ...current,
      focus: null,
      xp: current.xp + reward.xp,
      stats: { ...current.stats, [reward.stat]: current.stats[reward.stat] + reward.points },
      focusLog: { ...current.focusLog, [day]: [...(current.focusLog[day] ?? []), entry] },
    };
    this.commit(next);
    const level = levelInfo(next.xp).level;
    return { minutes, xpGained: reward.xp, leveledUp: level > before, level };
  }

  // ---------- Apple Health ----------

  readonly healthToday = computed(() => this.save().health[this.today()] ?? null);

  /** Показники з «Команд». Повертає нараховані XP. */
  applyHealth(input: HealthInput, day?: string): number {
    const key = day && isDateKey(day) ? day : this.today();
    const current = this.save();
    const before = current.health[key];
    const merged = mergeHealth(before, input);
    const reachedBefore = new Set(
      HEALTH_GOALS.filter((g) => before && g.reached(before)).map((g) => g.id),
    );
    const gained = HEALTH_GOALS.filter((g) => g.reached(merged) && !reachedBefore.has(g.id));
    const total = healthXp(merged);
    const xpGained = Math.max(0, total - merged.xp);
    const stats = { ...current.stats };
    for (const goal of gained) stats[goal.stat] += 1;
    this.commit({
      ...current,
      xp: current.xp + xpGained,
      stats,
      health: { ...current.health, [key]: { ...merged, xp: Math.max(merged.xp, total) } },
    });
    return xpGained;
  }

  // ---------- список справ ----------

  readonly todos = computed(() => this.save().todos);

  addTodo(input: TodoInput): Todo | null {
    const clean = cleanInput(input);
    if (!clean) return null;
    const todo: Todo = {
      id: newTodoId(),
      ...clean,
      done: false,
      doneAt: null,
      createdAt: this.clock().toISOString(),
    };
    const current = this.save();
    this.commit({ ...current, todos: [...current.todos, todo] });
    return todo;
  }

  updateTodo(id: string, input: TodoInput): boolean {
    const clean = cleanInput(input);
    if (!clean) return false;
    const current = this.save();
    if (!current.todos.some((t) => t.id === id)) return false;
    this.commit({
      ...current,
      todos: current.todos.map((t) => (t.id === id ? { ...t, ...clean } : t)),
    });
    return true;
  }

  removeTodo(id: string): void {
    const current = this.save();
    this.commit({ ...current, todos: current.todos.filter((t) => t.id !== id) });
  }

  /** Відмічає справу виконаною (+XP і Дисципліна) або повертає назад. Повертає зміну XP. */
  toggleTodo(id: string): number {
    const current = this.save();
    const todo = current.todos.find((t) => t.id === id);
    if (!todo) return 0;
    const done = !todo.done;
    const delta = done ? TODO_XP : -TODO_XP;
    this.commit({
      ...current,
      xp: Math.max(0, current.xp + delta),
      stats: {
        ...current.stats,
        discipline: Math.max(0, current.stats.discipline + (done ? 1 : -1)),
      },
      todos: current.todos.map((t) =>
        t.id === id ? { ...t, done, doneAt: done ? this.clock().toISOString() : null } : t,
      ),
    });
    return delta;
  }

  clearDoneTodos(): void {
    const current = this.save();
    const done = current.todos.filter((t) => t.done).length;
    this.commit({
      ...current,
      todos: current.todos.filter((t) => !t.done),
      todosArchived: current.todosArchived + done,
    });
  }

  /** Резервна копія прогресу у вигляді JSON. */
  exportData(): string {
    return JSON.stringify(
      { app: 'life-game', exportedAt: this.clock().toISOString(), save: this.save() },
      null,
      2,
    );
  }

  /** Відновлює прогрес із резервної копії. Повертає текст помилки або null. */
  importData(text: string): string | null {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return 'Файл пошкоджений або це не JSON.';
    }
    const candidate =
      data && typeof data === 'object' && 'save' in data ? (data as { save: unknown }).save : data;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !('days' in candidate) ||
      !('xp' in candidate)
    ) {
      return 'Це не резервна копія «Гри про життя».';
    }
    this.commit(parseSave(JSON.stringify(candidate)), true);
    return null;
  }

  /** Записує нові досягнення й нараховує за них монети. */
  private withAchievements(save: SaveData, quiet: boolean): SaveData {
    const best = bestStreak(save.days, QUESTS, save.frozen);
    const fresh: Achievement[] = newAchievements(save, best);
    if (fresh.length === 0) return save;
    const today = this.today();
    if (!quiet) {
      this.notices.update((list) => [
        ...list,
        ...fresh.map((a) => `Досягнення «${a.title}» · +${a.coins} монет`),
      ]);
    }
    return {
      ...save,
      coinBonus: save.coinBonus + fresh.reduce((a, x) => a + x.coins, 0),
      achievements: {
        ...save.achievements,
        ...Object.fromEntries(fresh.map((a) => [a.id, today])),
      },
    };
  }

  private load(): SaveData {
    try {
      return parseSave(this.storage.getItem(STORAGE_KEY));
    } catch {
      return emptySave();
    }
  }

  private commit(input: SaveData, quiet = false): void {
    const next = this.withAchievements(input, quiet);
    this.save.set(next);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // сховище переповнене або недоступне — прогрес лишиться до закриття вкладки
    }
  }
}

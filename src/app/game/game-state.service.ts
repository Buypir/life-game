import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  bestStreak,
  currentStreak,
  dateKey,
  emptySave,
  isQuestDone,
  levelInfo,
  parseSave,
  recentDays,
  SaveData,
} from './progress';
import { findTask, Quest, QUEST_BONUS_XP, QUESTS } from './quests';
import { cleanInput, newTodoId, Todo, TODO_XP, TodoInput } from './todos';

export const STORAGE_KEY = 'life-game:v1';

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
  readonly streak = computed(() => currentStreak(this.save().days, this.today(), QUESTS));
  readonly bestStreak = computed(() => bestStreak(this.save().days, QUESTS));
  readonly week = computed(() => recentDays(this.save().days, this.today(), QUESTS, 7));
  /** Герой спить, поки за день нічого не зроблено, і після «Лягти спати». */
  readonly asleep = computed(() => {
    const done = this.doneToday();
    return done.has('sleep') || done.size === 0;
  });
  readonly awake = computed(() => !this.asleep());
  readonly wentToBed = computed(() => this.doneToday().has('sleep'));
  readonly breakfastDone = computed(() => this.doneToday().has('breakfast'));

  /** Перевіряє, чи не настав новий день. */
  refreshDay(): void {
    const key = dateKey(this.clock());
    if (key !== this.today()) this.today.set(key);
  }

  questProgress(quest: Quest): { done: number; total: number; complete: boolean } {
    const done = this.doneToday();
    const count = quest.tasks.filter((t) => done.has(t.id)).length;
    return { done: count, total: quest.tasks.length, complete: count === quest.tasks.length };
  }

  complete(taskId: string): CompleteResult | null {
    const found = findTask(taskId);
    if (!found) return null;
    const { task, quest } = found;
    const today = this.today();
    const current = this.save();
    const doneIds = current.days[today] ?? [];
    if (doneIds.includes(taskId)) return null;

    const nextDone = [...doneIds, taskId];
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
    const { sound, todos } = this.save();
    this.commit({ ...emptySave(), sound, todos });
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
    this.commit({ ...current, todos: current.todos.filter((t) => !t.done) });
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
    this.commit(parseSave(JSON.stringify(candidate)));
    return null;
  }

  private load(): SaveData {
    try {
      return parseSave(this.storage.getItem(STORAGE_KEY));
    } catch {
      return emptySave();
    }
  }

  private commit(next: SaveData): void {
    this.save.set(next);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // сховище переповнене або недоступне — прогрес лишиться до закриття вкладки
    }
  }
}

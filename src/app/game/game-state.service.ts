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
  readonly awake = computed(() => this.doneToday().has('wake'));
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

  reset(): void {
    const sound = this.save().sound;
    this.commit({ ...emptySave(), sound });
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

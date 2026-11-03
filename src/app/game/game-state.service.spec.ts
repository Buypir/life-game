import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_CLOCK, GAME_STORAGE, GameStateService, STORAGE_KEY } from './game-state.service';
import { QUEST_BONUS_XP } from './quests';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe('GameStateService', () => {
  let storage: MemoryStorage;
  let now: Date;

  function create(): GameStateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GAME_STORAGE, useValue: storage },
        { provide: GAME_CLOCK, useValue: () => now },
      ],
    });
    return TestBed.inject(GameStateService);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    now = new Date(2026, 10, 4, 8, 30);
  });

  it('awards XP and a stat point for a task', () => {
    const game = create();
    const result = game.complete('wake');
    expect(result).toEqual({ xpGained: 10, questCompleted: null, leveledUp: false, level: 1 });
    expect(game.xp()).toBe(10);
    expect(game.stats().energy).toBe(1);
    expect(game.awake()).toBe(true);
  });

  it('ignores a task that is already done today', () => {
    const game = create();
    game.complete('wake');
    expect(game.complete('wake')).toBeNull();
    expect(game.xp()).toBe(10);
  });

  it('adds the quest bonus, discipline and a level-up', () => {
    const game = create();
    game.complete('wake');
    game.complete('brush');
    game.complete('wash');
    const result = game.complete('breakfast');
    expect(result?.questCompleted?.id).toBe('morning');
    expect(result?.xpGained).toBe(20 + QUEST_BONUS_XP);
    expect(game.xp()).toBe(55 + QUEST_BONUS_XP);
    expect(game.stats().discipline).toBe(1);
    expect(game.streak()).toBe(1);

    const work = game.complete('work');
    expect(work?.leveledUp).toBe(true);
    expect(work?.level).toBe(2);
  });

  it('undo takes back the task and the quest bonus', () => {
    const game = create();
    for (const id of ['wake', 'brush', 'wash', 'breakfast']) game.complete(id);
    const lost = game.undo('brush');
    expect(lost).toBe(15 + QUEST_BONUS_XP);
    expect(game.xp()).toBe(40);
    expect(game.stats().discipline).toBe(0);
    expect(game.doneToday().has('brush')).toBe(false);
    expect(game.streak()).toBe(0);
  });

  it('saves progress and loads it back', () => {
    create().complete('wake');
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}').xp).toBe(10);
    const reloaded = create();
    expect(reloaded.xp()).toBe(10);
    expect(reloaded.awake()).toBe(true);
  });

  it('starts a fresh day after midnight but keeps XP', () => {
    const game = create();
    game.complete('wake');
    now = new Date(2026, 10, 5, 0, 1);
    game.refreshDay();
    expect(game.awake()).toBe(false);
    expect(game.doneToday().size).toBe(0);
    expect(game.xp()).toBe(10);
  });

  it('reset clears progress but keeps the sound setting', () => {
    const game = create();
    game.setSound(false);
    game.complete('wake');
    game.reset();
    expect(game.xp()).toBe(0);
    expect(game.sound()).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GAME_CLOCK, GAME_STORAGE, GameStateService } from './game-state.service';
import { bossFor, dailyXp, daysToFreeze, weekStart } from './progression';
import { addDays, currentStreak, emptySave, parseSave } from './progress';
import { QUESTS } from './quests';
import { coinBalance } from './shop';

const MORNING = ['wake', 'brush', 'wash', 'breakfast'];

function createGame(now = new Date(2026, 10, 4, 9, 0), saved?: object) {
  const memory = new Map<string, string>();
  if (saved) memory.set('life-game:v1', JSON.stringify(saved));
  const clock = { now };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GAME_STORAGE,
        useValue: {
          getItem: (k: string) => memory.get(k) ?? null,
          setItem: (k: string, v: string) => void memory.set(k, v),
          removeItem: (k: string) => void memory.delete(k),
        },
      },
      { provide: GAME_CLOCK, useValue: () => clock.now },
    ],
  });
  return { game: TestBed.inject(GameStateService), clock, memory };
}

describe('coins and shop', () => {
  it('earns a coin per 2 XP and loses them on undo', () => {
    expect(coinBalance(25, 0, 0)).toBe(12);
    const { game } = createGame();
    game.complete('wake');
    // 10 XP → 5 монет + 50 за досягнення «Перший крок»
    expect(game.coins()).toBe(55);
    game.undo('wake');
    expect(game.coins()).toBe(50);
  });

  it('buys, equips and refuses without money', () => {
    const { game } = createGame(undefined, { ...emptySave(), xp: 1000 });
    expect(game.coins()).toBe(500 + 150); // + «Рівень 5»
    expect(game.buy('room-cat')).toBe('Не вистачає монет.');
    expect(game.buy('shirt-green')).toBeNull();
    expect(game.equipped().shirt).toBe('shirt-green');
    expect(game.look().shirt).toBe('#16A34A');
    expect(game.buy('shirt-green')).toBe('Уже куплено.');
    game.toggleEquip('shirt-green');
    expect(game.equipped().shirt).toBe('shirt-blue');
    expect(game.buy('hat-cap')).toBeNull();
    expect(game.equipped().hat).toBe('hat-cap');
    game.toggleEquip('hat-cap');
    expect(game.equipped().hat).toBeNull();
    expect(game.coins()).toBe(650 - 150 - 250);
  });

  it('redeems real-life rewards', () => {
    const { game } = createGame(undefined, { ...emptySave(), xp: 1000 });
    expect(game.addReward('Кіно', 300)).toBe(true);
    const cinema = game.rewards().find((r) => r.title === 'Кіно')!;
    expect(game.redeem(cinema.id)).toBeNull();
    expect(game.redeemed()).toHaveLength(1);
    expect(game.addReward('  ', 10)).toBe(false);
  });

  it('caps streak freezes and keeps data through save/load', () => {
    const { game, memory } = createGame(undefined, { ...emptySave(), xp: 4000 });
    for (let i = 0; i < 3; i++) expect(game.buy('freeze')).toBeNull();
    expect(game.buy('freeze')).toContain('не більше');
    const restored = parseSave(memory.get('life-game:v1')!);
    expect(restored.freezes).toBe(3);
    expect(restored.spent).toBe(900);
  });
});

describe('streak freeze', () => {
  it('covers a missed day after a streak', () => {
    const save = {
      ...emptySave(),
      freezes: 1,
      days: { '2026-11-01': MORNING, '2026-11-02': MORNING },
    };
    expect(daysToFreeze(save, '2026-11-04')).toEqual(['2026-11-03']);
    expect(daysToFreeze({ ...save, freezes: 0 }, '2026-11-04')).toEqual([]);
    // два пропуски, а заморозка одна — не рятуємо
    expect(daysToFreeze(save, '2026-11-05')).toEqual([]);
  });

  it('applies on refresh and keeps the streak alive', () => {
    const { game } = createGame(new Date(2026, 10, 4, 9, 0), {
      ...emptySave(),
      freezes: 1,
      days: { '2026-11-01': MORNING, '2026-11-02': MORNING },
    });
    expect(game.streak()).toBe(0);
    game.refreshDay();
    expect(game.freezes()).toBe(0);
    expect(game.streak()).toBe(2);
    expect(game.takeNotices().some((n) => n.includes('Заморозка'))).toBe(true);
    expect(game.week()[5]).toMatchObject({ key: '2026-11-03', frozen: true });
    expect(currentStreak({}, '2026-11-04', QUESTS, ['2026-11-03'])).toBe(0);
  });

  it('marks the room messy after a missed day until a quest is done', () => {
    const { game } = createGame(new Date(2026, 10, 4, 9, 0), {
      ...emptySave(),
      days: { '2026-11-02': MORNING },
    });
    expect(game.messy()).toBe(true);
    for (const id of MORNING) game.complete(id);
    expect(game.messy()).toBe(false);
  });
});

describe('achievements', () => {
  it('unlock once and pay coins', () => {
    const { game } = createGame();
    for (const id of MORNING) game.complete(id);
    expect(game.achievements().find((a) => a.id === 'first')?.unlockedAt).toBe('2026-11-04');
    const notices = game.takeNotices();
    expect(notices).toHaveLength(1);
    game.complete('work');
    expect(game.takeNotices()).toHaveLength(0);
  });

  it('import does not spam toasts', () => {
    const { game } = createGame();
    game.importData(JSON.stringify({ ...emptySave(), xp: 5000 }));
    expect(game.takeNotices()).toHaveLength(0);
    expect(game.achievements().find((a) => a.id === 'level-10')?.unlockedAt).not.toBeNull();
  });
});

describe('boss of the week', () => {
  it('rotates weekly and pays once', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(bossFor('2026-11-04').boss.id).not.toBe(bossFor('2026-11-11').boss.id);

    const { game } = createGame();
    const boss = game.boss();
    expect(boss.done).toBe(false);
    expect(game.claimBoss()).toBe(false);
  });

  it('counts this week only', () => {
    // знаходимо тиждень з босом «Залізний тиждень»
    let day = '2026-11-04';
    for (let i = 0; i < 10 && bossFor(day).boss.id !== 'iron'; i++) day = addDays(day, 7);
    const { days } = bossFor(day);
    const log = Object.fromEntries(days.slice(0, 4).map((d) => [d, ['gym-workout']]));
    const [y, m, d] = days[4].split('-').map(Number);
    const { game } = createGame(new Date(y, m - 1, d, 12), { ...emptySave(), log });
    expect(game.boss().done).toBe(true);
    const xp = game.xp();
    expect(game.claimBoss()).toBe(true);
    expect(game.xp()).toBe(xp + 100);
    expect(game.claimBoss()).toBe(false);
  });
});

describe('skills', () => {
  it('needs points from embedded and prerequisites', () => {
    const { game } = createGame();
    expect(game.learnSkill('c')).toContain('очок');
    game.doActivity('embedded');
    game.doActivity('embedded');
    expect(game.skillPoints().free).toBe(2);
    expect(game.learnSkill('uart')).toContain('попередні');
    expect(game.learnSkill('c')).toBeNull();
    expect(game.learnSkill('gpio')).toBeNull();
    expect(game.skillPoints().free).toBe(0);
    expect(game.skills().find((s) => s.id === 'uart')?.state).toBe('available');
  });
});

describe('focus timer', () => {
  it('awards minutes actually spent', () => {
    const { game, clock } = createGame();
    game.startFocus('embedded', 25);
    clock.now = new Date(2026, 10, 4, 9, 3);
    expect(game.finishFocus()).toBeNull(); // менше 5 хв
    game.startFocus('embedded', 25);
    clock.now = new Date(2026, 10, 4, 9, 40);
    const result = game.finishFocus();
    expect(result?.minutes).toBe(25);
    expect(game.focusToday()).toBe(25);
    expect(game.skillPoints().earned).toBe(1);
    expect(game.focus()).toBeNull();
  });
});

describe('health', () => {
  it('pays each goal once per day', () => {
    const { game } = createGame();
    expect(game.applyHealth({ steps: 7000 })).toBe(15);
    expect(game.applyHealth({ steps: 6500, sleep: 7.5 })).toBe(20);
    expect(game.applyHealth({ steps: 12000 })).toBe(20);
    expect(game.applyHealth({ steps: 12000, sleep: 8 })).toBe(0);
    expect(game.healthToday()).toMatchObject({ steps: 12000, sleep: 8, xp: 55 });
  });
});

describe('stats', () => {
  it('sums XP per day from every source', () => {
    const save = {
      ...emptySave(),
      days: { '2026-11-03': MORNING },
      log: { '2026-11-04': ['to-office', 'office-work'] },
      focusLog: { '2026-11-04': [{ kind: 'study' as const, minutes: 30 }] },
    };
    const xp = dailyXp(save);
    expect(xp.get('2026-11-03')).toBe(10 + 15 + 10 + 20 + 25);
    expect(xp.get('2026-11-04')).toBe(10 + 30 + 30);
  });
});

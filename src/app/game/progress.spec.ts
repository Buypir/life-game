import { describe, expect, it } from 'vitest';
import {
  addDays,
  bestStreak,
  currentStreak,
  dateKey,
  dayQualifies,
  levelInfo,
  parseSave,
  recentDays,
  xpToNext,
} from './progress';
import { QUESTS } from './quests';

const MORNING = ['wake', 'brush', 'wash', 'breakfast'];
const WORK = ['work', 'study', 'workout'];

describe('levels', () => {
  it('grows the requirement by 50 XP per level', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(150);
    expect(xpToNext(5)).toBe(300);
  });

  it('turns total XP into level and progress', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelInfo(99)).toEqual({ level: 1, into: 99, need: 100 });
    expect(levelInfo(100)).toEqual({ level: 2, into: 0, need: 150 });
    expect(levelInfo(260)).toEqual({ level: 3, into: 10, need: 200 });
  });

  it('treats negative XP as zero', () => {
    expect(levelInfo(-20).level).toBe(1);
  });
});

describe('dates', () => {
  it('uses the local calendar date', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('moves across month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('streaks', () => {
  it('counts a day only when a whole quest is done', () => {
    expect(dayQualifies(['wake', 'brush'], QUESTS)).toBe(false);
    expect(dayQualifies(MORNING, QUESTS)).toBe(true);
    expect(dayQualifies(WORK, QUESTS)).toBe(true);
    expect(dayQualifies(undefined, QUESTS)).toBe(false);
  });

  it('keeps the streak alive until today is over', () => {
    const days = { '2026-11-02': MORNING, '2026-11-03': WORK, '2026-11-04': ['wake'] };
    expect(currentStreak(days, '2026-11-04', QUESTS)).toBe(2);
    expect(currentStreak({ ...days, '2026-11-04': MORNING }, '2026-11-04', QUESTS)).toBe(3);
  });

  it('breaks on a missed day', () => {
    const days = { '2026-11-01': MORNING, '2026-11-03': MORNING };
    expect(currentStreak(days, '2026-11-04', QUESTS)).toBe(1);
    expect(currentStreak(days, '2026-11-05', QUESTS)).toBe(0);
  });

  it('finds the best run', () => {
    const days = {
      '2026-10-01': MORNING,
      '2026-10-02': MORNING,
      '2026-10-03': MORNING,
      '2026-10-10': WORK,
      '2026-10-11': ['wake'],
    };
    expect(bestStreak(days, QUESTS)).toBe(3);
  });

  it('lists the last week oldest first', () => {
    const week = recentDays({ '2026-11-04': MORNING }, '2026-11-04', QUESTS);
    expect(week).toHaveLength(7);
    expect(week[0].key).toBe('2026-10-29');
    expect(week[6]).toEqual({ key: '2026-11-04', qualified: true, isToday: true });
  });
});

describe('parseSave', () => {
  it('returns an empty save for missing or broken data', () => {
    expect(parseSave(null).xp).toBe(0);
    expect(parseSave('{not json').xp).toBe(0);
  });

  it('keeps valid fields and drops garbage', () => {
    const save = parseSave(
      JSON.stringify({
        xp: 120,
        stats: { strength: 3, intellect: 'x', energy: -5 },
        days: { '2026-11-04': ['wake', 7], nonsense: ['brush'] },
        sound: false,
      }),
    );
    expect(save.xp).toBe(120);
    expect(save.stats).toEqual({ strength: 3, intellect: 0, energy: 0, discipline: 0, work: 0 });
    expect(save.days).toEqual({ '2026-11-04': ['wake'] });
    expect(save.sound).toBe(false);
  });
});

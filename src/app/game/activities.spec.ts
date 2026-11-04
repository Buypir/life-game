import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ACTIVITIES, commuteTo, distanceMeters, parsePlaces, Place, placeAt } from './activities';
import { GAME_CLOCK, GAME_STORAGE, GameStateService } from './game-state.service';
import { parseSave } from './progress';

function createGame(): GameStateService {
  const memory = new Map<string, string>();
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
      { provide: GAME_CLOCK, useValue: () => new Date(2026, 10, 4, 9, 0) },
    ],
  });
  return TestBed.inject(GameStateService);
}

// Львів: площа Ринок і ~1 км від неї
const RYNOK = { lat: 49.8419, lon: 24.0316 };
const OPERA = { lat: 49.8441, lon: 24.0262 };

describe('activities', () => {
  it('have unique ids and a commute to every saved place', () => {
    expect(new Set(ACTIVITIES.map((a) => a.id)).size).toBe(ACTIVITIES.length);
    expect(commuteTo('office')?.id).toBe('to-office');
    expect(commuteTo('gym')?.id).toBe('to-gym');
    expect(commuteTo('home')?.id).toBe('to-home');
  });

  it('give XP, can repeat, move the hero and can be undone', () => {
    const game = createGame();
    expect(game.location()).toBe('home');
    const result = game.doActivity('to-office');
    expect(result?.xpGained).toBe(10);
    expect(game.location()).toBe('office');
    game.doActivity('office-work');
    game.doActivity('office-work');
    expect(game.activityCounts().get('office-work')).toBe(2);
    expect(game.stats().work).toBe(2);

    expect(game.undoActivity('office-work')).toBe(30);
    expect(game.activityCounts().get('office-work')).toBe(1);
    expect(game.xp()).toBe(40);
    expect(game.undoActivity('date-walk')).toBe(0);
  });

  it('brings the hero home for daily quests', () => {
    const game = createGame();
    game.doActivity('date-dinner');
    expect(game.location()).toBe('cafe');
    expect(game.stats().love).toBe(1);
    game.complete('brush');
    expect(game.location()).toBe('home');
  });

  it('keeps places when progress is reset', () => {
    const game = createGame();
    game.savePlace('office', OPERA.lat, OPERA.lon);
    game.setTracking(true);
    game.doActivity('embedded');
    game.reset();
    expect(game.places()).toHaveLength(1);
    expect(game.tracking()).toBe(true);
    expect(game.xp()).toBe(0);
  });
});

describe('gps', () => {
  it('measures distance in meters', () => {
    const d = distanceMeters(RYNOK, OPERA);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(500);
    expect(distanceMeters(RYNOK, RYNOK)).toBe(0);
  });

  it('finds the saved place you are in', () => {
    const places: Place[] = [
      { id: 'home', ...RYNOK, radius: 150 },
      { id: 'office', ...OPERA, radius: 150 },
    ];
    expect(placeAt(places, { lat: 49.842, lon: 24.0318 })).toBe('home');
    expect(placeAt(places, { lat: 49.8441, lon: 24.0263 })).toBe('office');
    expect(placeAt(places, { lat: 49.85, lon: 24.05 })).toBeNull();
    // неточний GPS трохи розширює радіус, але не більше ніж на 100 м
    expect(placeAt(places, { lat: 49.8431, lon: 24.0316, accuracy: 80 })).toBe('home');
    expect(placeAt(places, { lat: 49.8445, lon: 24.0316, accuracy: 500 })).toBeNull();
  });

  it('parses saved places defensively', () => {
    expect(
      parsePlaces([
        { id: 'home', lat: 49.8, lon: 24, radius: 10 },
        { id: 'home', lat: 1, lon: 1 },
        { id: 'mars', lat: 1, lon: 1 },
        { id: 'gym', lat: 200, lon: 1 },
      ]),
    ).toEqual([{ id: 'home', lat: 49.8, lon: 24, radius: 150 }]);
    expect(parseSave(JSON.stringify({ xp: 1, days: {}, location: 'moon' })).location).toBe('home');
  });
});

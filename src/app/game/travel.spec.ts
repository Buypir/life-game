import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { RemindersService, ServerAction, ServerArrival } from '../reminders/reminders.service';
import { GAME_CLOCK, GAME_STORAGE, GameStateService } from './game-state.service';
import { GEOLOCATION, orderArrivals, radiusFor, TravelService } from './travel.service';

// Львів: площа Ринок (дім) і Оперний театр (офіс), ~450 м
const HOME = { lat: 49.8419, lon: 24.0316 };
const OFFICE = { lat: 49.8441, lon: 24.0262 };
const FAR = { lat: 49.81, lon: 23.98 };

interface Setup {
  position?: { lat: number; lon: number; accuracy?: number };
  geoError?: number;
  arrivals?: ServerArrival[];
  actions?: ServerAction[];
  noGeo?: boolean;
}

function setup(options: Setup = {}) {
  const memory = new Map<string, string>();
  const state = {
    position: options.position,
    arrivals: options.arrivals ?? [],
    actions: options.actions ?? [],
  };
  const geo = {
    getCurrentPosition: (ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      if (options.geoError) {
        fail?.({ code: options.geoError, message: 'x' } as GeolocationPositionError);
        return;
      }
      const p: { lat: number; lon: number; accuracy?: number } = state.position ?? HOME;
      ok({
        coords: { latitude: p.lat, longitude: p.lon, accuracy: p.accuracy ?? 20 },
        timestamp: 0,
      } as GeolocationPosition);
    },
  };
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
      { provide: GEOLOCATION, useValue: options.noGeo ? null : geo },
      {
        provide: RemindersService,
        useValue: {
          claim: async () => {
            const arrivals = state.arrivals;
            const actions = state.actions;
            state.arrivals = [];
            state.actions = [];
            return { arrivals, actions };
          },
          createArrivalLink: async () => ({ baseUrl: 'https://api.example.com/api/arrive/k' }),
        },
      },
    ],
  });
  const game = TestBed.inject(GameStateService);
  const travel = TestBed.inject(TravelService);
  return { game, travel, state };
}

describe('travel', () => {
  it('counts a trip only when the hero changes place', () => {
    const { game, travel } = setup();
    expect(travel.arrive('home', 'gps')).toBeNull();
    const trip = travel.arrive('office', 'gps');
    expect(trip?.activity.id).toBe('to-office');
    expect(game.location()).toBe('office');
    expect(game.xp()).toBe(10);
    // повтор GPS у тому самому місці
    expect(travel.arrive('office', 'gps')).toBeNull();
    expect(travel.lastArrival()?.seq).toBe(1);
  });

  it('saves the current spot as a place without giving XP', async () => {
    const { game, travel } = setup({ position: { ...OFFICE, accuracy: 30 } });
    expect(await travel.saveHere('office')).toBeNull();
    expect(game.places()).toEqual([{ id: 'office', ...OFFICE, radius: 150 }]);
    expect(game.location()).toBe('office');
    expect(game.xp()).toBe(0);
  });

  it('detects arrival by GPS and reports being away', async () => {
    const { game, travel, state } = setup({ position: HOME });
    await travel.saveHere('home');
    state.position = OFFICE;
    await travel.saveHere('office');
    state.position = HOME;
    await travel.checkNow();
    expect(game.location()).toBe('home');
    expect(game.activityCounts().get('to-home')).toBe(1);
    expect(travel.check().kind).toBe('at');

    state.position = FAR;
    await travel.checkNow();
    expect(travel.check().kind).toBe('away');
    expect(game.location()).toBe('home');
  });

  it('applies arrivals queued by iOS automations in order', async () => {
    const { game, travel } = setup({
      arrivals: [
        { place: 'home', at: '2026-11-04T16:30:00Z' },
        { place: 'office', at: '2026-11-04T07:10:00Z' },
        { place: 'park', at: '2026-11-04T08:00:00Z' },
        { place: 'gym', at: 'not a date' },
      ],
    });
    expect(await travel.claimFromServer()).toBe(2);
    expect(game.activityCounts().get('to-office')).toBe(1);
    expect(game.activityCounts().get('to-home')).toBe(1);
    expect(game.location()).toBe('home');
    expect(travel.lastArrival()?.source).toBe('shortcut');
    // черга забрана — повторне відкриття нічого не додає
    expect(await travel.claimFromServer()).toBe(0);
  });

  it('logs an old arrival under its own day', async () => {
    const { game, travel } = setup({
      arrivals: [{ place: 'gym', at: '2026-11-03T18:00:00+02:00' }],
    });
    await travel.claimFromServer();
    expect(game.activityCounts().get('to-gym')).toBeUndefined();
    expect(game.xp()).toBe(10);
  });

  it('explains geolocation problems', async () => {
    const denied = setup({ geoError: 1 });
    expect(await denied.travel.saveHere('home')).toContain('дозволу');
    const none = setup({ noGeo: true });
    expect(none.travel.supported).toBe(false);
    await none.travel.checkNow();
    expect(none.travel.check()).toEqual({
      kind: 'error',
      message: 'Цей браузер не вміє визначати місце.',
    });
  });

  it('refresh checks GPS only when tracking is on', async () => {
    const { game, travel, state } = setup({ position: OFFICE });
    await travel.saveHere('office');
    state.position = HOME;
    await travel.saveHere('home');
    state.position = OFFICE;
    await travel.refresh();
    expect(game.location()).toBe('home');
    game.setTracking(true);
    await travel.refresh();
    expect(game.location()).toBe('office');
  });

  it('keeps helpers sane', () => {
    expect(radiusFor(10)).toBe(150);
    expect(radiusFor(200)).toBe(300);
    expect(radiusFor(5000)).toBe(500);
    expect(orderArrivals([{ place: 'office', at: '2026-11-04T07:10:00Z' }])[0].place).toBe(
      'office',
    );
  });

  it('applies Siri, Health and device actions', async () => {
    const { game, travel } = setup({
      actions: [
        { action: 'brush', at: '2026-11-04T06:05:00Z' },
        { action: 'wake', at: '2026-11-04T06:00:00Z' },
        { action: 'health', at: '2026-11-04T20:00:00Z', steps: 11000, sleep: null },
        { action: 'embedded', at: '2026-11-04T17:00:00Z' },
        { action: 'to-gym', at: '2026-11-04T16:00:00Z' },
        { action: 'unknown-thing', at: '2026-11-04T16:00:00Z' },
      ],
    });
    expect(await travel.claimFromServer()).toBe(5);
    expect([...game.doneToday()]).toEqual(['wake', 'brush']);
    expect(game.activityCounts().get('embedded')).toBe(1);
    expect(game.activityCounts().get('to-gym')).toBe(1);
    expect(game.healthToday()?.steps).toBe(11000);
    expect(game.takeNotices().some((n) => n.startsWith('Siri: «Почистити зуби»'))).toBe(true);
  });
});

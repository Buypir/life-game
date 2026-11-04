import { Capacitor, registerPlugin } from '@capacitor/core';

/** Застосунок запущено як iOS-застосунок (Capacitor), а не в браузері. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export interface NativePlace {
  id: string;
  lat: number;
  lon: number;
  radius: number;
}

/** Методи Swift-плагіна native/life-game-native. */
export interface LifeGameNativePlugin {
  currentPosition(): Promise<{ lat: number; lon: number; accuracy: number }>;
  setPlaces(options: {
    enabled: boolean;
    places: NativePlace[];
  }): Promise<{ monitoring: number; always: boolean }>;
  takeArrivals(): Promise<{ arrivals: { place: string; at: string }[] }>;
  takeActions(): Promise<{ actions: { action: string; at: string }[] }>;
  alarmSupported(): Promise<{ supported: boolean }>;
  setAlarm(options: {
    enabled: boolean;
    hour: number;
    minute: number;
    title: string;
  }): Promise<{ scheduled: boolean }>;
}

export const LifeGameNative = registerPlugin<LifeGameNativePlugin>('LifeGameNative');

/**
 * Геолокація через нативний плагін у форматі navigator.geolocation —
 * TravelService працює однаково і в браузері, і в застосунку.
 */
export const nativeGeolocation: Pick<Geolocation, 'getCurrentPosition'> = {
  getCurrentPosition(success, error) {
    LifeGameNative.currentPosition().then(
      (p) =>
        success({
          coords: {
            latitude: p.lat,
            longitude: p.lon,
            accuracy: p.accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition),
      (err: { code?: string; message?: string }) =>
        error?.({
          code: Number(err?.code) || 2,
          message: err?.message ?? 'location error',
        } as GeolocationPositionError),
    );
  },
};

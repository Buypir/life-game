import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { GEOLOCATION } from './game/travel.service';
import { isNative, nativeGeolocation } from './native/native';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideServiceWorker('ngsw-worker.js', {
      // у iOS-застосунку файли вже лежать на телефоні — Service Worker не потрібен
      enabled: !isDevMode() && !isNative(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: GEOLOCATION,
      useFactory: () =>
        isNative()
          ? nativeGeolocation
          : typeof navigator !== 'undefined' && 'geolocation' in navigator
            ? navigator.geolocation
            : null,
    },
  ],
};

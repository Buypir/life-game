import { computed, Injectable, signal } from '@angular/core';

const OVERRIDE_KEY = 'life-game:api-url';

/** Перетворює введену адресу на базовий URL без завершального «/», або повертає null, якщо вона неприйнятна. */
export function normalizeApiUrl(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * Налаштування, які можна змінити без перезбирання: public/config.json (адреса сервера нагадувань)
 * плюс ручне перевизначення з екрана «Нагадування».
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly fromFile = signal('');
  private readonly override = signal(readOverride());
  readonly loaded = signal(false);

  readonly apiUrl = computed(() => this.override() || this.fromFile());
  readonly isOverridden = computed(() => !!this.override());

  constructor() {
    void this.load();
  }

  /** Зберігає адресу сервера. Порожній рядок повертає значення з config.json. */
  setApiUrl(raw: string): boolean {
    const url = normalizeApiUrl(raw);
    if (url === null) return false;
    try {
      if (url) localStorage.setItem(OVERRIDE_KEY, url);
      else localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      // без localStorage адреса діятиме до перезапуску
    }
    this.override.set(url);
    return true;
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch('config.json', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { apiUrl?: unknown };
        if (typeof data.apiUrl === 'string') this.fromFile.set(normalizeApiUrl(data.apiUrl) ?? '');
      }
    } catch {
      // офлайн або файлу немає — нагадування просто не налаштовані
    } finally {
      this.loaded.set(true);
    }
  }
}

function readOverride(): string {
  try {
    return localStorage.getItem(OVERRIDE_KEY) ?? '';
  } catch {
    return '';
  }
}

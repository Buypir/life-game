import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { PLACE_LABELS, PlaceId } from '../game/activities';
import { GameStateService } from '../game/game-state.service';
import { TravelService } from '../game/travel.service';
import { RemindersService } from '../reminders/reminders.service';
import { daysLabel } from '../game/plural';
import { STAT_LABELS, STAT_ORDER } from '../game/quests';
import { HeroSpriteComponent } from '../scene/hero-sprite.component';

const WEEKDAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const PLACE_ORDER: PlaceId[] = ['home', 'office', 'gym'];
/** Місце у формі «де?» для статусу перевірки. */
const PLACE_WHERE: Record<PlaceId, string> = {
  home: 'вдома',
  office: 'в офісі',
  gym: 'у спортзалі',
};

@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroSpriteComponent],
  templateUrl: './hero.component.html',
})
export class HeroComponent {
  protected readonly game = inject(GameStateService);
  protected readonly travel = inject(TravelService);
  private readonly reminders = inject(RemindersService);
  protected readonly confirmReset = signal(false);
  readonly openReminders = output<void>();
  protected readonly editingName = signal(false);

  protected saveName(value: string): void {
    this.game.setName(value);
    this.editingName.set(false);
  }
  protected readonly streakText = computed(() => daysLabel(this.game.streak()));
  protected readonly bestText = computed(() => daysLabel(this.game.bestStreak()));

  protected readonly stats = computed(() => {
    const stats = this.game.stats();
    const max = Math.max(10, ...STAT_ORDER.map((k) => stats[k]));
    return STAT_ORDER.map((key) => ({
      key,
      label: STAT_LABELS[key],
      value: stats[key],
      width: Math.round((stats[key] / max) * 100),
    }));
  });

  protected readonly week = computed(() =>
    this.game.week().map((day) => {
      const [y, m, d] = day.key.split('-').map(Number);
      return { ...day, label: WEEKDAYS[new Date(y, m - 1, d).getDay()] };
    }),
  );

  protected readonly xpPercent = computed(() => {
    const { into, need } = this.game.level();
    return Math.round((into / need) * 100);
  });

  protected readonly installed = (() => {
    try {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  })();

  // ---------- місця й поїздки ----------

  protected readonly savingPlace = signal<PlaceId | null>(null);
  protected readonly placeError = signal<string | null>(null);
  protected readonly serverReady = computed(() => this.reminders.status() === 'on');
  protected readonly linkBusy = signal(false);
  protected readonly linkError = signal<string | null>(null);
  protected readonly copiedPlace = signal<PlaceId | null>(null);

  protected readonly placeRows = computed(() => {
    const saved = this.game.places();
    const here = this.game.location();
    return PLACE_ORDER.map((id) => {
      const place = saved.find((p) => p.id === id);
      return {
        id,
        label: PLACE_LABELS[id],
        saved: !!place,
        radius: place?.radius ?? 0,
        here: here === id,
      };
    });
  });

  protected readonly arrivalUrls = computed(() => {
    const base = this.travel.arrivalLink();
    return base
      ? PLACE_ORDER.map((id) => ({ id, label: PLACE_LABELS[id], url: `${base}/${id}` }))
      : [];
  });

  protected readonly checkText = computed(() => {
    const state = this.travel.check();
    const time = (d: Date) => d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    switch (state.kind) {
      case 'checking':
        return 'Визначаю місце…';
      case 'at':
        return `${time(state.time)} — ти ${PLACE_WHERE[state.place]}.`;
      case 'away':
        return `${time(state.time)} — поза збереженими місцями (мабуть, у дорозі).`;
      case 'error':
        return state.message;
      default:
        return null;
    }
  });

  protected async saveHere(id: PlaceId): Promise<void> {
    if (this.savingPlace()) return;
    this.savingPlace.set(id);
    this.placeError.set(null);
    try {
      this.placeError.set(await this.travel.saveHere(id));
    } finally {
      this.savingPlace.set(null);
    }
  }

  protected removePlace(id: PlaceId): void {
    this.game.removePlace(id);
  }

  protected toggleTracking(): void {
    const on = !this.game.tracking();
    this.game.setTracking(on);
    if (on) void this.travel.checkNow();
  }

  protected checkNow(): void {
    void this.travel.checkNow();
  }

  protected async createLink(): Promise<void> {
    if (this.linkBusy()) return;
    this.linkBusy.set(true);
    try {
      this.linkError.set(await this.travel.createArrivalLink());
    } finally {
      this.linkBusy.set(false);
    }
  }

  protected async copyUrl(id: PlaceId, url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedPlace.set(id);
      setTimeout(() => this.copiedPlace.set(null), 2000);
    } catch {
      this.copiedPlace.set(null);
    }
  }

  protected readonly backupMessage = signal<string | null>(null);
  protected readonly pendingImport = signal<string | null>(null);

  protected async exportBackup(): Promise<void> {
    const json = this.game.exportData();
    const name = `life-game-${this.game.today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Гра про життя — резервна копія' });
        this.backupMessage.set('Копію збережено.');
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.backupMessage.set(`Файл ${name} завантажено.`);
  }

  protected async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.pendingImport.set(await file.text());
    this.backupMessage.set('Поточний прогрес буде замінено даними з файлу.');
  }

  protected confirmImport(): void {
    const text = this.pendingImport();
    this.pendingImport.set(null);
    if (text === null) return;
    const error = this.game.importData(text);
    this.backupMessage.set(error ?? 'Прогрес відновлено.');
  }

  protected cancelImport(): void {
    this.pendingImport.set(null);
    this.backupMessage.set(null);
  }

  protected toggleSound(): void {
    this.game.setSound(!this.game.sound());
  }

  protected reset(): void {
    if (!this.confirmReset()) {
      this.confirmReset.set(true);
      setTimeout(() => this.confirmReset.set(false), 4000);
      return;
    }
    this.game.reset();
    this.confirmReset.set(false);
  }
}

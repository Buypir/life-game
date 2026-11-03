import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { daysLabel } from '../game/plural';
import { STAT_LABELS, STAT_ORDER } from '../game/quests';
import { HeroSpriteComponent } from '../scene/hero-sprite.component';

const WEEKDAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroSpriteComponent],
  templateUrl: './hero.component.html',
})
export class HeroComponent {
  protected readonly game = inject(GameStateService);
  protected readonly confirmReset = signal(false);
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

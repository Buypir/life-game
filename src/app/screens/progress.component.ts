import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ACTIVITIES } from '../game/activities';
import { GameStateService } from '../game/game-state.service';
import { BOSS_COINS, BOSS_XP, SKILLS } from '../game/progression';
import { addDays } from '../game/progress';

const HEAT_WEEKS = 15;
const WEEKDAY_LABELS = ['Пн', '', 'Ср', '', 'Пт', '', 'Нд'];

@Component({
  selector: 'app-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './progress.component.html',
})
export class ProgressComponent {
  protected readonly game = inject(GameStateService);
  protected readonly bossXp = BOSS_XP;
  protected readonly bossCoins = BOSS_COINS;
  protected readonly weekdayLabels = WEEKDAY_LABELS;
  protected readonly skillMessage = signal<string | null>(null);

  protected readonly bossPercent = computed(() => {
    const b = this.game.boss();
    return Math.round((b.value / b.target) * 100);
  });

  protected readonly bossDaysLeft = computed(() => {
    const end = addDays(this.game.boss().week, 6);
    const [y, m, d] = end.split('-').map(Number);
    const [ty, tm, td] = this.game.today().split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000) + 1;
  });

  /** Теплова карта: стовпці — тижні (від понеділка), рядки — дні. */
  protected readonly heatmap = computed(() => {
    const xp = this.game.xpByDay();
    const today = this.game.today();
    const [y, m, d] = today.split('-').map(Number);
    const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
    const start = addDays(today, -weekday - (HEAT_WEEKS - 1) * 7);
    return Array.from({ length: HEAT_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, day) => {
        const key = addDays(start, w * 7 + day);
        const value = xp.get(key) ?? 0;
        const level =
          key > today
            ? -1
            : value === 0
              ? 0
              : value < 60
                ? 1
                : value < 150
                  ? 2
                  : value < 250
                    ? 3
                    : 4;
        return { key, value, level };
      }),
    );
  });

  protected readonly bars = computed(() => {
    const xp = this.game.xpByDay();
    const today = this.game.today();
    const days = Array.from({ length: 14 }, (_, i) => {
      const key = addDays(today, i - 13);
      const [y, m, d] = key.split('-').map(Number);
      return {
        key,
        value: xp.get(key) ?? 0,
        label: String(d),
        weekend: [0, 6].includes(new Date(y, m - 1, d).getDay()),
      };
    });
    const max = Math.max(100, ...days.map((d) => d.value));
    return days.map((d) => ({ ...d, height: Math.round((d.value / max) * 100) }));
  });

  protected readonly tiles = computed(() => {
    const t = this.game.totals();
    const act = (ids: string[]) => ids.reduce((a, id) => a + (t.activities.get(id) ?? 0), 0);
    const trips = ACTIVITIES.filter((a) => a.action === 'drive').map((a) => a.id);
    return [
      { label: 'активних днів', value: t.activeDays },
      { label: 'годин фокусу', value: Math.round((t.focusMinutes / 60) * 10) / 10 },
      { label: 'тренувань', value: act(['gym-workout']) + (t.tasks.get('workout') ?? 0) },
      {
        label: 'сесій embedded',
        value: act(['embedded']) + Math.floor(t.embeddedFocusMinutes / 25),
      },
      { label: 'поїздок', value: act(trips) },
      { label: 'побачень', value: act(['date-walk', 'date-dinner']) },
    ];
  });

  protected readonly unlockedCount = computed(
    () => this.game.achievements().filter((a) => a.unlockedAt).length,
  );

  protected readonly tiers = computed(() => {
    const skills = this.game.skills();
    const tiers = [...new Set(skills.map((s) => s.tier))];
    return tiers.map((tier) => skills.filter((s) => s.tier === tier));
  });

  protected skillTitle(id: string): string {
    return SKILLS.find((s) => s.id === id)?.title ?? id;
  }

  protected requiresText(ids: string[]): string {
    return ids.map((id) => this.skillTitle(id)).join(', ');
  }

  protected learn(id: string): void {
    const error = this.game.learnSkill(id);
    this.skillMessage.set(error ?? `Вивчено: ${this.skillTitle(id)}`);
  }

  protected claimBoss(): void {
    this.game.claimBoss();
  }

  protected dateLabel(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  }
}

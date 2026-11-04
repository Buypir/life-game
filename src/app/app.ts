import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { GameStateService } from './game/game-state.service';
import { arrivalText, TravelService } from './game/travel.service';
import { RemindersService } from './reminders/reminders.service';
import { HeroComponent } from './screens/hero.component';
import { ProgressComponent } from './screens/progress.component';
import { ShopComponent } from './screens/shop.component';
import { RemindersComponent } from './screens/reminders.component';
import { TodosComponent } from './screens/todos.component';
import { TodayComponent } from './screens/today.component';

type Screen = 'today' | 'todos' | 'shop' | 'progress' | 'hero' | 'reminders';
const SCREENS: Screen[] = ['today', 'todos', 'shop', 'progress', 'hero', 'reminders'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TodayComponent,
    TodosComponent,
    ShopComponent,
    ProgressComponent,
    RemindersComponent,
    HeroComponent,
  ],
  templateUrl: './app.html',
})
export class App {
  private readonly game = inject(GameStateService);
  // сервіс нагадувань стартує разом із застосунком: він синхронізує прогрес із сервером
  private readonly reminders = inject(RemindersService);
  private readonly travel = inject(TravelService);
  protected readonly screen = signal<Screen>(initialScreen());
  /** Повідомлення про поїздку, коли користувач не на екрані «Сьогодні» (там її показує сцена). */
  protected readonly notice = signal<string | null>(null);
  private noticeTimer?: ReturnType<typeof setTimeout>;
  /** Досягнення й заморозки — зверху екрана, по черзі. */
  protected readonly award = signal<string | null>(null);
  private readonly awardQueue: string[] = [];
  private awardTimer?: ReturnType<typeof setTimeout>;

  /** Скільки справ на сьогодні (і прострочених) ще не виконано — для значка в меню. */
  protected readonly todosBadge = computed(() => {
    const today = this.game.today();
    return this.game.todos().filter((t) => !t.done && t.date !== null && t.date <= today).length;
  });

  constructor() {
    // новий день починається опівночі, навіть якщо застосунок не закривали
    const refresh = () => this.game.refreshDay();
    const timer = setInterval(refresh, 60_000);
    refresh();

    // поїздки: черга з сервера + GPS — при відкритті, поверненні й раз на 3 хв, поки застосунок на екрані
    const travel = () => {
      if (!document.hidden) void this.travel.refresh();
    };
    const travelTimer = setInterval(() => {
      if (this.game.tracking()) travel();
    }, 180_000);
    setTimeout(travel, 800);

    const onVisible = () => {
      if (document.hidden) return;
      refresh();
      travel();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearInterval(travelTimer);
      clearTimeout(this.noticeTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });

    effect(() => {
      if (this.game.notices().length === 0) return;
      untracked(() => {
        const fresh = this.game.takeNotices();
        const awards = fresh.filter((n) => n.startsWith('Досягнення'));
        // після оновлення гри може відкритися багато досягнень разом — показуємо одним повідомленням
        if (awards.length > 2) {
          const coins = awards.reduce((a, n) => a + Number(n.match(/\+(\d+)/)?.[1] ?? 0), 0);
          this.awardQueue.push(
            ...fresh.filter((n) => !n.startsWith('Досягнення')),
            `Нові досягнення: ${awards.length} · +${coins} монет`,
          );
        } else {
          this.awardQueue.push(...fresh);
        }
        if (!this.award()) this.nextAward();
      });
    });

    let seen = 0;
    effect(() => {
      const event = this.travel.lastArrival();
      if (!event || event.seq <= seen) return;
      seen = event.seq;
      if (untracked(() => this.screen()) === 'today') return;
      this.notice.set(arrivalText(event));
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => this.notice.set(null), 5000);
    });
  }

  private nextAward(): void {
    const text = this.awardQueue.shift() ?? null;
    this.award.set(text);
    clearTimeout(this.awardTimer);
    if (text) this.awardTimer = setTimeout(() => this.nextAward(), 3500);
  }

  protected go(screen: Screen): void {
    this.screen.set(screen);
    window.scrollTo({ top: 0 });
  }
}

/** Сповіщення про справу відкриває застосунок з ?screen=todos. */
function initialScreen(): Screen {
  const params = new URLSearchParams(location.search);
  const screen = params.get('screen') as Screen | null;
  if (screen && SCREENS.includes(screen)) {
    params.delete('screen');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
    return screen;
  }
  return 'today';
}

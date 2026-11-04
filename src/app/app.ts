import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { GameStateService } from './game/game-state.service';
import { RemindersService } from './reminders/reminders.service';
import { HeroComponent } from './screens/hero.component';
import { RemindersComponent } from './screens/reminders.component';
import { TodosComponent } from './screens/todos.component';
import { TodayComponent } from './screens/today.component';

type Screen = 'today' | 'todos' | 'reminders' | 'hero';
const SCREENS: Screen[] = ['today', 'todos', 'reminders', 'hero'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TodayComponent, TodosComponent, RemindersComponent, HeroComponent],
  templateUrl: './app.html',
})
export class App {
  private readonly game = inject(GameStateService);
  // сервіс нагадувань стартує разом із застосунком: він синхронізує прогрес із сервером
  private readonly reminders = inject(RemindersService);
  protected readonly screen = signal<Screen>(initialScreen());

  /** Скільки справ на сьогодні (і прострочених) ще не виконано — для значка в меню. */
  protected readonly todosBadge = computed(() => {
    const today = this.game.today();
    return this.game.todos().filter((t) => !t.done && t.date !== null && t.date <= today).length;
  });

  constructor() {
    // новий день починається опівночі, навіть якщо застосунок не закривали
    const refresh = () => this.game.refreshDay();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
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

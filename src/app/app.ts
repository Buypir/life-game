import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { GameStateService } from './game/game-state.service';
import { RemindersService } from './reminders/reminders.service';
import { HeroComponent } from './screens/hero.component';
import { RemindersComponent } from './screens/reminders.component';
import { TodayComponent } from './screens/today.component';

type Screen = 'today' | 'reminders' | 'hero';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TodayComponent, RemindersComponent, HeroComponent],
  templateUrl: './app.html',
})
export class App {
  private readonly game = inject(GameStateService);
  // сервіс нагадувань стартує разом із застосунком: він синхронізує прогрес із сервером
  private readonly reminders = inject(RemindersService);
  protected readonly screen = signal<Screen>('today');

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

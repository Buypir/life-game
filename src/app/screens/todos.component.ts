import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { addDays } from '../game/progress';
import { SoundService } from '../game/sound.service';
import {
  eventDate,
  groupTodos,
  MAX_TITLE,
  notifyAt,
  REMIND_OPTIONS,
  remindLabel,
  Todo,
  TODO_XP,
  whenLabel,
} from '../game/todos';
import { RemindersService } from '../reminders/reminders.service';

const DEFAULT_REMIND = 30;

@Component({
  selector: 'app-todos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './todos.component.html',
})
export class TodosComponent {
  protected readonly game = inject(GameStateService);
  private readonly sound = inject(SoundService);
  protected readonly reminders = inject(RemindersService);
  readonly openReminders = output<void>();

  private readonly titleInput = viewChild.required<ElementRef<HTMLInputElement>>('titleInput');

  protected readonly maxTitle = MAX_TITLE;
  protected readonly remindOptions = REMIND_OPTIONS;
  protected readonly xp = TODO_XP;

  protected readonly title = signal('');
  protected readonly date = signal<string | null>(this.game.today());
  protected readonly time = signal<string | null>(null);
  protected readonly remind = signal<number | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;
  /** Хвилинний «тік», щоб позначки «минуло» оновлювалися. */
  private readonly now = signal(Date.now());

  protected readonly tomorrow = computed(() => addDays(this.game.today(), 1));
  protected readonly groups = computed(() => groupTodos(this.game.todos(), this.game.today()));
  protected readonly openCount = computed(() => this.game.todos().filter((t) => !t.done).length);

  /** Попередження під формою: нагадування в минулому або вимкнені сповіщення. */
  protected readonly formHint = computed(() => {
    if (!this.time() || this.remind() === null) return null;
    const at = notifyAt({ date: this.date(), time: this.time(), remindBefore: this.remind() });
    if (at && at.getTime() < this.now()) return 'Час нагадування вже минув — сповіщення не прийде.';
    return null;
  });

  protected readonly needsReminders = computed(
    () =>
      this.reminders.status() !== 'on' &&
      this.game.todos().some((t) => !t.done && t.remindBefore !== null),
  );

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(this.toastTimer);
    });
  }

  protected when(todo: Todo, groupKey: string): string {
    const withDay = groupKey !== 'today' && groupKey !== 'tomorrow';
    return whenLabel(todo, this.game.today(), withDay);
  }

  protected remindText(todo: Todo): string {
    return remindLabel(todo.remindBefore);
  }

  protected isPast(todo: Todo): boolean {
    const at = eventDate(todo);
    return !todo.done && !!at && at.getTime() < this.now();
  }

  protected onTitle(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  protected onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.date.set(value || null);
    if (!value) {
      this.time.set(null);
      this.remind.set(null);
    }
  }

  protected setDate(value: string | null): void {
    this.date.set(value);
    if (!value) {
      this.time.set(null);
      this.remind.set(null);
    }
  }

  protected onTime(event: Event): void {
    const value = (event.target as HTMLInputElement).value || null;
    // перший вибір часу пропонує нагадування за 30 хв
    if (value && !this.time() && this.remind() === null) this.remind.set(DEFAULT_REMIND);
    if (!value) this.remind.set(null);
    this.time.set(value);
  }

  protected onRemind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.remind.set(value === '' ? null : Number(value));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const input = {
      title: this.title(),
      date: this.date(),
      time: this.time(),
      remindBefore: this.remind(),
    };
    const editing = this.editingId();
    const ok = editing ? this.game.updateTodo(editing, input) : !!this.game.addTodo(input);
    if (!ok) {
      this.titleInput().nativeElement.focus();
      return;
    }
    this.showToast(editing ? 'Справу оновлено' : 'Справу додано');
    this.resetForm();
  }

  protected edit(todo: Todo): void {
    this.editingId.set(todo.id);
    this.title.set(todo.title);
    this.date.set(todo.date);
    this.time.set(todo.time);
    this.remind.set(todo.remindBefore);
    const input = this.titleInput().nativeElement;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }

  protected cancelEdit(): void {
    this.resetForm();
  }

  protected toggle(todo: Todo): void {
    const delta = this.game.toggleTodo(todo.id);
    if (delta > 0) {
      this.showToast(`+${delta} XP · ${todo.title}`);
      if (this.game.sound()) this.sound.play('complete');
    } else {
      this.showToast(`Повернуто: ${todo.title} (${delta} XP)`);
      if (this.game.sound()) this.sound.play('undo');
    }
  }

  protected remove(todo: Todo): void {
    if (this.editingId() === todo.id) this.resetForm();
    this.game.removeTodo(todo.id);
    this.showToast(`Видалено: ${todo.title}`);
  }

  protected clearDone(): void {
    this.game.clearDoneTodos();
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.title.set('');
    this.date.set(this.game.today());
    this.time.set(null);
    this.remind.set(null);
  }

  private showToast(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(text);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}

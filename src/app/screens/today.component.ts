import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CompleteResult, GameStateService } from '../game/game-state.service';
import { daysLabel } from '../game/plural';
import { Quest, Task } from '../game/quests';
import { Activity, ACTIVITIES } from '../game/activities';
import { SoundService } from '../game/sound.service';
import { ArrivalEvent, arrivalText, TravelService } from '../game/travel.service';
import { FOCUS_KINDS, FOCUS_PRESETS, FocusKind, focusElapsed } from '../game/progression';
import { SceneComponent } from '../scene/scene.component';

interface Popup {
  id: number;
  text: string;
}

interface Toast {
  id: number;
  text: string;
  actionLabel: string;
  action: () => void;
}

/** Вкладка з активностями поруч із квестами. */
export const MORE_TAB = 'more';

@Component({
  selector: 'app-today',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SceneComponent],
  templateUrl: './today.component.html',
})
export class TodayComponent {
  protected readonly game = inject(GameStateService);
  private readonly sound = inject(SoundService);
  private readonly travel = inject(TravelService);
  private readonly scene = viewChild.required(SceneComponent);
  private readonly scenePanel = viewChild.required<ElementRef<HTMLElement>>('scenePanel');

  protected readonly busy = signal(false);
  protected readonly activeTask = signal<Task | null>(null);
  protected readonly lastDone = signal<Task | null>(null);
  protected readonly popups = signal<Popup[]>([]);
  protected readonly banner = signal<string | null>(null);
  protected readonly toast = signal<Toast | null>(null);
  protected readonly activities = ACTIVITIES;
  protected readonly moreTab = MORE_TAB;
  protected readonly activeActivity = signal<Activity | null>(null);
  protected readonly lastActivity = signal<Activity | null>(null);
  protected readonly activitiesToday = computed(() =>
    [...this.game.activityCounts().values()].reduce((a, b) => a + b, 0),
  );
  protected readonly selectedQuestId = signal(this.defaultQuestId());

  private nextId = 1;
  /** Приїзди, що сталися до відкриття екрана, не програємо повторно. */
  private seenArrival = this.travel.lastArrival()?.seq ?? 0;

  // ---------- фокус-таймер ----------

  protected readonly focusKinds = FOCUS_KINDS;
  protected readonly focusPresets = FOCUS_PRESETS;
  protected readonly focusKind = signal<FocusKind>('embedded');
  protected readonly focusMinutes = signal(25);
  /** Тікає щосекунди, поки йде фокус. */
  private readonly tick = signal(Date.now());

  protected readonly focusScene = computed(() => this.game.focus()?.kind ?? null);

  protected readonly focusLeftMs = computed(() => {
    this.tick();
    const f = this.game.focus();
    if (!f) return 0;
    return Math.max(0, f.minutes * 60_000 - focusElapsed(f, new Date()) * 60_000);
  });

  protected readonly focusLeft = computed(() => {
    const total = Math.ceil(this.focusLeftMs() / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });

  protected readonly focusPercent = computed(() => {
    const f = this.game.focus();
    return f ? Math.round(100 - (this.focusLeftMs() / (f.minutes * 60_000)) * 100) : 0;
  });

  protected focusTitle(kind: FocusKind): string {
    return FOCUS_KINDS.find((k) => k.id === kind)?.title ?? kind;
  }

  protected startFocus(): void {
    this.beep('tap');
    this.game.startFocus(this.focusKind(), this.focusMinutes());
    this.revealScene();
  }

  protected cancelFocus(): void {
    this.game.cancelFocus();
  }

  protected finishFocus(): void {
    const result = this.game.finishFocus();
    if (!result) {
      this.showToast('Менше 5 хвилин — не зараховано', 'OK', () => undefined);
      return;
    }
    this.popXp(result.xpGained);
    if (result.leveledUp) {
      this.showBanner(`Новий рівень ${result.level}!`);
      this.beep('level');
    } else {
      this.beep('complete');
    }
    this.showToast(`+${result.xpGained} XP · фокус ${result.minutes} хв`, 'OK', () => undefined);
  }

  constructor() {
    // таймер: оновлюємо відлік і самі завершуємо, коли час вийшов (і після повернення в гру)
    effect((onCleanup) => {
      if (!this.game.focus()) return;
      const timer = setInterval(() => {
        this.tick.set(Date.now());
        if (this.focusLeftMs() <= 0) untracked(() => this.finishFocus());
      }, 1000);
      onCleanup(() => clearInterval(timer));
    });

    effect(() => {
      const event = this.travel.lastArrival();
      if (!event || event.seq <= this.seenArrival) return;
      this.seenArrival = event.seq;
      untracked(() => void this.playArrival(event));
    });
  }
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected readonly level = this.game.level;
  protected readonly streak = this.game.streak;
  protected readonly streakLabel = computed(() => `${daysLabel(this.streak())} поспіль`);

  /** Кільце рівня: довжина заповненої дуги з 157 (2πr, r = 25). */
  protected readonly ringDash = computed(() => {
    const { into, need } = this.level();
    const full = 2 * Math.PI * 25;
    return `${((into / need) * full).toFixed(1)} ${full.toFixed(1)}`;
  });

  protected readonly dateLabel = computed(() => {
    const [y, m, d] = this.game.today().split('-').map(Number);
    const text = new Intl.DateTimeFormat('uk-UA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(y, m - 1, d));
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  protected readonly quest = computed(
    () => this.game.quests.find((q) => q.id === this.selectedQuestId()) ?? this.game.quests[0],
  );

  protected readonly progress = computed(() => {
    // залежність від doneToday, щоб прогрес оновлювався
    this.game.doneToday();
    return new Map(this.game.quests.map((q) => [q.id, this.game.questProgress(q)]));
  });

  protected readonly nextTask = computed(() => {
    const done = this.game.doneToday();
    return this.quest().tasks.find((t) => !done.has(t.id)) ?? null;
  });

  protected readonly otherOpenQuest = computed(() => {
    const done = this.game.doneToday();
    return (
      this.game.quests.find(
        (q) => q.id !== this.selectedQuestId() && q.tasks.some((t) => !done.has(t.id)),
      ) ?? null
    );
  });

  protected readonly allDone = computed(() => {
    const done = this.game.doneToday();
    return this.game.quests.every((q) => q.tasks.every((t) => done.has(t.id)));
  });

  protected readonly caption = computed(() => {
    const active = this.activeTask() ?? this.activeActivity();
    if (active) return `${active.doing}…`;
    const focus = this.game.focus();
    if (focus) return `Фокус · ${this.focusTitle(focus.kind)} · ${this.focusLeft()}`;
    const lastActivity = this.lastActivity();
    if (lastActivity) return lastActivity.done;
    const last = this.lastDone();
    if (last && this.game.doneToday().has(last.id)) return last.done;
    if (this.game.wentToBed()) return 'Герой спить. Добраніч!';
    if (this.game.asleep()) return 'Герой спить. Час прокидатись!';
    if (this.allDone()) return 'Усе зроблено — герой відпочиває';
    if (this.game.messy()) return 'Учора день пропущено — безлад. Виконай квест, щоб прибрати';
    return 'Герой чекає на наступну справу';
  });

  protected readonly captionDone = computed(() => {
    if (this.activeTask() || this.activeActivity()) return false;
    if (this.lastActivity()) return true;
    const last = this.lastDone();
    return !!last && this.game.doneToday().has(last.id);
  });

  protected isDone(task: Task): boolean {
    return this.game.doneToday().has(task.id);
  }

  protected questProgress(quest: Quest) {
    return this.progress().get(quest.id) ?? { done: 0, total: quest.tasks.length, complete: false };
  }

  protected selectQuest(id: string): void {
    this.selectedQuestId.set(id);
    this.beep('tap');
  }

  protected onTaskTap(task: Task): void {
    if (this.busy()) return;
    if (this.isDone(task)) {
      const lost = this.game.undo(task.id);
      if (this.lastDone()?.id === task.id) this.lastDone.set(null);
      // прибираємо святкування, яке стосувалося скасованої справи
      clearTimeout(this.bannerTimer);
      this.banner.set(null);
      this.popups.set([]);
      this.beep('undo');
      this.showToast(`Скасовано: ${task.title} (−${lost} XP)`, 'Повернути', () =>
        this.restore(task),
      );
    } else {
      void this.perform(task);
    }
  }

  protected runToast(toast: Toast): void {
    this.toast.set(null);
    toast.action();
  }

  private restore(task: Task): void {
    const result = this.game.complete(task.id);
    if (result) this.celebrate(task, result);
  }

  protected activityCount(activity: Activity): number {
    return this.game.activityCounts().get(activity.id) ?? 0;
  }

  protected async performActivity(activity: Activity): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.toast.set(null);
    this.beep('tap');
    this.activeActivity.set(activity);
    this.revealScene();
    try {
      await this.scene().playActivity(activity);
      const result = this.game.doActivity(activity.id);
      if (result) {
        this.lastDone.set(null);
        this.lastActivity.set(activity);
        this.popXp(result.xpGained);
        if (result.leveledUp) {
          this.showBanner(`Новий рівень ${result.level}!`);
          this.beep('level');
        } else {
          this.beep('complete');
        }
        this.showToast(`+${result.xpGained} XP · ${activity.title}`, 'Скасувати', () => {
          this.game.undoActivity(activity.id);
          this.lastActivity.set(null);
          this.beep('undo');
        });
      }
    } finally {
      this.activeActivity.set(null);
      this.busy.set(false);
    }
  }

  /** Поїздку зараховано за GPS або автоматизацією — показуємо її в сцені. */
  private async playArrival(event: ArrivalEvent): Promise<void> {
    const { activity, day } = event.result;
    const undo = () => {
      this.game.undoActivity(activity.id, day);
      this.beep('undo');
    };
    if (this.busy()) {
      this.showToast(arrivalText(event), 'Скасувати', undo);
      return;
    }
    this.busy.set(true);
    this.toast.set(null);
    this.activeActivity.set(activity);
    try {
      await this.scene().playActivity(activity);
      this.lastDone.set(null);
      this.lastActivity.set(activity);
      this.popXp(event.result.xpGained);
      if (event.result.leveledUp) {
        this.showBanner(`Новий рівень ${event.result.level}!`);
        this.beep('level');
      } else {
        this.beep('complete');
      }
      this.showToast(arrivalText(event), 'Скасувати', undo);
    } finally {
      this.activeActivity.set(null);
      this.busy.set(false);
    }
  }

  private popXp(xp: number): void {
    const popup = { id: this.nextId++, text: `+${xp} XP` };
    this.popups.set([popup]);
    setTimeout(() => this.popups.update((list) => list.filter((p) => p.id !== popup.id)), 1400);
  }

  protected async perform(task: Task): Promise<void> {
    if (this.busy() || this.isDone(task)) return;
    this.busy.set(true);
    this.toast.set(null);
    this.beep('tap');
    this.activeTask.set(task);
    this.revealScene();
    try {
      await this.scene().play(task.action, task.spot);
      const result = this.game.complete(task.id);
      this.activeTask.set(null);
      if (result) this.celebrate(task, result);
      // після «Лягти спати» герой після будь-якої справи повертається в ліжко
      if (task.action !== 'sleep' && this.game.wentToBed()) void this.scene().goToBed();
    } finally {
      this.activeTask.set(null);
      this.busy.set(false);
    }
  }

  /** Якщо сцена прокручена за межі екрана, показуємо її — інакше анімацію не видно. */
  private revealScene(): void {
    const el = this.scenePanel().nativeElement;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  private celebrate(task: Task, result: CompleteResult): void {
    this.lastDone.set(task);
    this.lastActivity.set(null);
    this.popXp(result.xpGained);

    if (result.leveledUp) {
      this.showBanner(`Новий рівень ${result.level}!`);
      this.beep('level');
    } else if (result.questCompleted) {
      this.showBanner(`Квест «${result.questCompleted.title}» виконано!`);
      this.beep('quest');
    } else {
      this.beep('complete');
    }
  }

  private showBanner(text: string): void {
    clearTimeout(this.bannerTimer);
    this.banner.set(text);
    this.bannerTimer = setTimeout(() => this.banner.set(null), 2400);
  }

  private showToast(text: string, actionLabel: string, action: () => void): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ id: this.nextId++, text, actionLabel, action });
    this.toastTimer = setTimeout(() => this.toast.set(null), 5000);
  }

  private beep(melody: Parameters<SoundService['play']>[0]): void {
    if (this.game.sound()) this.sound.play(melody);
  }

  /** Квест за часом доби (ранок / робота / вечір), а якщо він виконаний — перший відкритий. */
  private defaultQuestId(): string {
    // з нагадування відкриваємо одразу потрібний квест (?quest=morning)
    const fromLink = new URLSearchParams(location.search).get('quest');
    if (fromLink && this.game.quests.some((q) => q.id === fromLink)) {
      history.replaceState(null, '', location.pathname);
      return fromLink;
    }
    const done = this.game.doneToday();
    const open = (q: Quest) => q.tasks.some((t) => !done.has(t.id));
    const hour = new Date().getHours();
    const preferred = hour < 12 ? 'morning' : hour < 18 ? 'work' : 'evening';
    const pick = this.game.quests.find((q) => q.id === preferred && open(q));
    return (pick ?? this.game.quests.find(open) ?? this.game.quests[0]).id;
  }
}

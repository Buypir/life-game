import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CompleteResult, GameStateService } from '../game/game-state.service';
import { daysLabel } from '../game/plural';
import { Quest, Task } from '../game/quests';
import { SoundService } from '../game/sound.service';
import { HeroSpriteComponent } from '../scene/hero-sprite.component';
import { PixelSceneComponent } from '../scene/pixel-scene.component';

interface Popup {
  id: number;
  text: string;
}

interface Toast {
  id: number;
  text: string;
  taskId: string;
}

const XP_SEGMENTS = 10;

@Component({
  selector: 'app-today',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PixelSceneComponent, HeroSpriteComponent],
  templateUrl: './today.component.html',
})
export class TodayComponent {
  protected readonly game = inject(GameStateService);
  private readonly sound = inject(SoundService);
  private readonly scene = viewChild.required(PixelSceneComponent);
  private readonly scenePanel = viewChild.required<ElementRef<HTMLElement>>('scenePanel');

  protected readonly busy = signal(false);
  protected readonly activeTask = signal<Task | null>(null);
  protected readonly lastDone = signal<Task | null>(null);
  protected readonly popups = signal<Popup[]>([]);
  protected readonly banner = signal<string | null>(null);
  protected readonly toast = signal<Toast | null>(null);
  protected readonly selectedQuestId = signal(this.defaultQuestId());

  private nextId = 1;
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected readonly level = this.game.level;
  protected readonly streak = this.game.streak;
  protected readonly streakLabel = computed(() => `${daysLabel(this.streak())} поспіль`);

  protected readonly segments = computed(() => {
    const { into, need } = this.level();
    const filled = Math.floor((into / need) * XP_SEGMENTS);
    return Array.from({ length: XP_SEGMENTS }, (_, i) => i < filled);
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
    const active = this.activeTask();
    if (active) return `${active.doing}…`;
    const last = this.lastDone();
    if (last && this.game.doneToday().has(last.id)) return last.done;
    if (this.game.wentToBed()) return 'Герой спить. Добраніч!';
    if (this.game.asleep()) return 'Герой спить. Час прокидатись!';
    if (this.allDone()) return 'Усе зроблено — герой відпочиває';
    return 'Герой чекає на наступну справу';
  });

  protected readonly captionDone = computed(() => {
    const last = this.lastDone();
    return !this.activeTask() && !!last && this.game.doneToday().has(last.id);
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
      this.showToast(`Скасовано: ${task.title} (−${lost} XP)`, task.id);
    } else {
      void this.perform(task);
    }
  }

  protected restore(toast: Toast): void {
    this.toast.set(null);
    const found = this.game.quests.flatMap((q) => q.tasks).find((t) => t.id === toast.taskId);
    if (!found) return;
    const result = this.game.complete(found.id);
    if (result) this.celebrate(found, result);
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
    const popup = { id: this.nextId++, text: `+${result.xpGained} XP` };
    this.popups.set([popup]);
    setTimeout(() => this.popups.update((list) => list.filter((p) => p.id !== popup.id)), 1400);

    if (result.leveledUp) {
      this.showBanner(`НОВИЙ РІВЕНЬ ${result.level}!`);
      this.beep('level');
    } else if (result.questCompleted) {
      this.showBanner(`КВЕСТ «${result.questCompleted.short.toUpperCase()}» ВИКОНАНО!`);
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

  private showToast(text: string, taskId: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ id: this.nextId++, text, taskId });
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

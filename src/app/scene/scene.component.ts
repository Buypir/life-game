import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Activity, LocationId } from '../game/activities';
import { ActionKind, Spot } from '../game/quests';
import { Look } from './flat';
import { FocusScene, SceneEngine } from './scene-engine';

@Component({
  selector: 'app-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas class="scene-canvas" role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `
    :host {
      display: block;
    }
    .scene-canvas {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 320 / 200;
    }
  `,
})
export class SceneComponent {
  readonly sleeping = input(false);
  readonly breakfastDone = input(false);
  readonly location = input<LocationId>('home');
  readonly label = input('Кімната героя');
  readonly look = input<Partial<Look>>({});
  readonly room = input<readonly string[]>([]);
  readonly messy = input(false);
  readonly focus = input<FocusScene | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private engine: SceneEngine | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.engine = new SceneEngine(this.canvas().nativeElement);
      this.engine.setLocation(this.location());
      this.engine.setSleeping(this.sleeping());
      this.engine.setFlags({ breakfastDone: this.breakfastDone(), messy: this.messy() });
      this.engine.setStyle(this.look(), this.room());
      this.engine.setFocus(this.focus());
      this.engine.renderOnce();
      this.engine.start();

      const onVisibility = () => {
        if (document.hidden) this.engine?.stop();
        else this.engine?.start();
      };
      document.addEventListener('visibilitychange', onVisibility);
      destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        this.engine?.stop();
      });
    });

    effect(() => {
      const sleeping = this.sleeping();
      const breakfastDone = this.breakfastDone();
      const location = this.location();
      this.engine?.setLocation(location);
      this.engine?.setSleeping(sleeping);
      // сигнали читаємо до ?. — інакше без рушія вони не відстежуються
      const messy = this.messy();
      const look = this.look();
      const room = this.room();
      const focus = this.focus();
      this.engine?.setFlags({ breakfastDone, messy });
      this.engine?.setStyle(look, room);
      this.engine?.setFocus(focus);
    });
  }

  play(action: ActionKind, spot: Spot): Promise<void> {
    return this.engine ? this.engine.play(action, spot) : Promise.resolve();
  }

  playActivity(activity: Activity): Promise<void> {
    return this.engine ? this.engine.playActivity(activity) : Promise.resolve();
  }

  goToBed(): Promise<void> {
    return this.engine ? this.engine.goToBed() : Promise.resolve();
  }
}

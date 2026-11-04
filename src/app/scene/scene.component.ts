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
import { ActionKind, Spot } from '../game/quests';
import { SceneEngine } from './scene-engine';

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
  readonly label = input('Кімната героя');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private engine: SceneEngine | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.engine = new SceneEngine(this.canvas().nativeElement);
      this.engine.setSleeping(this.sleeping());
      this.engine.setFlags({ breakfastDone: this.breakfastDone() });
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
      this.engine?.setSleeping(sleeping);
      this.engine?.setFlags({ breakfastDone });
    });
  }

  play(action: ActionKind, spot: Spot): Promise<void> {
    return this.engine ? this.engine.play(action, spot) : Promise.resolve();
  }

  goToBed(): Promise<void> {
    return this.engine ? this.engine.goToBed() : Promise.resolve();
  }
}

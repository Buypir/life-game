import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { AVATAR, drawGrid, drawHero, FACE, IDLE_POSE } from './sprites';

/** Статичний або «дихаючий» герой для аватарки й екрана «Герой». */
@Component({
  selector: 'app-hero-sprite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: `
    :host {
      display: block;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
  `,
})
export class HeroSpriteComponent {
  /** `avatar` — лише голова, `full` — герой на весь зріст із диханням. */
  readonly variant = input<'avatar' | 'full'>('full');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (this.variant() === 'avatar') {
        canvas.width = 12;
        canvas.height = 11;
        drawGrid(ctx, AVATAR, 0, 0);
        return;
      }
      canvas.width = 16;
      canvas.height = 25;
      let frame = 0;
      const draw = () => {
        const now = performance.now();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawHero(ctx, 2, 4, {
          ...IDLE_POSE,
          face: now % 3200 < 140 ? FACE.blink : undefined,
          dy: Math.floor(now / 700) % 2,
        });
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      destroyRef.onDestroy(() => cancelAnimationFrame(frame));
    });
  }
}

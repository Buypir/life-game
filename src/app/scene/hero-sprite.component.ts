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
import { drawAvatar, drawHero, HERO_LOOK, Look, STAND } from './flat';

/** Аватарка (голова в колі) або герой на весь зріст, який дихає й моргає. */
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
    }
  `,
})
export class HeroSpriteComponent {
  readonly variant = input<'avatar' | 'full'>('full');
  readonly look = input<Partial<Look>>({});
  private avatarCtx: CanvasRenderingContext2D | null = null;

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const look = this.look();
      if (this.avatarCtx) drawAvatar(this.avatarCtx, this.avatarCtx.canvas.width, look);
    });
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round((canvas.clientWidth || 40) * dpr);
      canvas.height = Math.round((canvas.clientHeight || 40) * dpr);

      if (this.variant() === 'avatar') {
        this.avatarCtx = ctx;
        drawAvatar(ctx, canvas.width, this.look());
        return;
      }

      // герой 80 одиниць заввишки в рамці 60 × 96
      const scale = canvas.width / 60;
      let frame = 0;
      const draw = () => {
        const now = performance.now();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        drawHero(
          ctx,
          30,
          90,
          {
            ...STAND,
            bob: (Math.sin(now / 700) + 1) * 0.6,
            eyes: now % 3600 < 140 ? 'closed' : 'open',
          },
          { ...HERO_LOOK, ...this.look() },
        );
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      destroyRef.onDestroy(() => cancelAnimationFrame(frame));
    });
  }
}

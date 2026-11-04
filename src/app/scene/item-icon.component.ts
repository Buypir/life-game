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
import { findItem } from '../game/shop';
import { C, capsule, drawAvatar } from './flat';
import { drawCat, drawRoomItem, ITEM_BOX } from './room-items';

/** Мініатюра речі з магазину, намальована тим самим кодом, що й сцена. */
@Component({
  selector: 'app-item-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: `
    :host {
      display: block;
      width: 56px;
      height: 56px;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class ItemIconComponent {
  readonly item = input.required<string>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const size = Math.round((canvas.clientWidth || 56) * dpr);
      canvas.width = size;
      canvas.height = size;
      const id = this.item();
      const item = findItem(id);
      if (!item) return;

      if (item.category === 'shirt') return drawAvatar(ctx, size, { shirt: item.color });
      if (item.category === 'hat') return drawAvatar(ctx, size, { hat: id });
      if (item.category === 'face') return drawAvatar(ctx, size, { face: id });
      if (item.category === 'bonus') return drawSnowflake(ctx, size);

      const [x, y, w, h] = ITEM_BOX[id] ?? [0, 0, 320, 200];
      const scale = (size * 0.8) / Math.max(w, h);
      const paint = (t: number) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = C.wall;
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, size * 0.22);
        ctx.fill();
        ctx.setTransform(
          scale,
          0,
          0,
          scale,
          size / 2 - (x + w / 2) * scale,
          size / 2 - (y + h / 2) * scale,
        );
        if (id === 'room-cat') drawCat(ctx, t, false);
        else drawRoomItem(ctx, id, true);
      };
      if (id !== 'room-cat') return paint(0);
      let frame = 0;
      const loop = (t: number) => {
        paint(t);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      destroyRef.onDestroy(() => cancelAnimationFrame(frame));
    });
  }
}

function drawSnowflake(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#E0F2FE';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.22);
  ctx.fill();
  const c = size / 2;
  const r = size * 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const end = { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
    capsule(ctx, { x: c, y: c }, end, size * 0.05, '#0EA5E9');
    const mid = { x: c + Math.cos(a) * r * 0.6, y: c + Math.sin(a) * r * 0.6 };
    for (const d of [-0.6, 0.6]) {
      capsule(
        ctx,
        mid,
        { x: mid.x + Math.cos(a + d) * r * 0.3, y: mid.y + Math.sin(a + d) * r * 0.3 },
        size * 0.04,
        '#0EA5E9',
      );
    }
  }
}

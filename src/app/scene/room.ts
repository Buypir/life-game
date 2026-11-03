import { drawGrid } from './sprites';

/** Логічний розмір сцени в пікселях. На екрані вона масштабується без згладжування. */
export const SCENE_W = 96;
export const SCENE_H = 60;

/** Верхній край спрайта героя, коли він стоїть на підлозі. */
export const HERO_Y = 36;

/** X-координата героя біля кожного місця в кімнаті. */
export const SPOT_X = { bed: 29, desk: 44, sink: 65 } as const;

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    ctx.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export type TimeOfDay = 'dawn' | 'day' | 'evening' | 'night';

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function drawWindow(ctx: Ctx, tod: TimeOfDay): void {
  rect(ctx, 32, 6, 19, 16, '#c9b48a');
  const gx = 33;
  const gy = 7;
  switch (tod) {
    case 'dawn':
      rect(ctx, gx, gy, 17, 7, '#ff9f7a');
      rect(ctx, gx, gy + 7, 17, 7, '#ffd9a0');
      rect(ctx, 44, 16, 3, 2, '#ffe066');
      break;
    case 'day':
      rect(ctx, gx, gy, 17, 14, '#8fd3ff');
      rect(ctx, 45, 9, 3, 3, '#ffe066');
      rect(ctx, 35, 10, 4, 1, '#ffffff');
      rect(ctx, 36, 9, 2, 1, '#ffffff');
      rect(ctx, 43, 17, 5, 1, '#ffffff');
      rect(ctx, 44, 16, 3, 1, '#ffffff');
      break;
    case 'evening':
      rect(ctx, gx, gy, 17, 7, '#6b4c9a');
      rect(ctx, gx, gy + 7, 17, 7, '#ff8a5b');
      rect(ctx, 36, 17, 3, 2, '#ffb347');
      break;
    case 'night':
      rect(ctx, gx, gy, 17, 14, '#1b2450');
      rect(ctx, 45, 9, 3, 3, '#f2f0e6');
      rect(ctx, 46, 9, 1, 1, '#1b2450');
      for (const [sx, sy] of [
        [35, 9],
        [38, 16],
        [48, 17],
        [36, 14],
        [48, 13],
      ]) {
        rect(ctx, sx, sy, 1, 1, '#ffffff');
      }
      break;
  }
  rect(ctx, 41, 7, 1, 14, '#c9b48a');
  rect(ctx, 33, 13, 17, 1, '#c9b48a');
  rect(ctx, 31, 22, 21, 1, '#a8946c');
}

function drawClock(ctx: Ctx, now: Date): void {
  rect(ctx, 59, 7, 9, 9, '#c9b48a');
  rect(ctx, 60, 8, 7, 7, '#f2f0e6');
  const cx = 63;
  const cy = 11;
  const minutes = now.getMinutes();
  const hours = (now.getHours() % 12) + minutes / 60;
  const ma = (minutes / 60) * Math.PI * 2;
  const ha = (hours / 12) * Math.PI * 2;
  line(
    ctx,
    cx,
    cy,
    Math.round(cx + Math.sin(ma) * 3),
    Math.round(cy - Math.cos(ma) * 3),
    '#1b1f3b',
  );
  line(
    ctx,
    cx,
    cy,
    Math.round(cx + Math.sin(ha) * 2),
    Math.round(cy - Math.cos(ha) * 2),
    '#b83f3f',
  );
}

/** Нерухомий фон: стіни, підлога, вікно, годинник, полиця, ліжко без ковдри, умивальник. */
export function drawRoomBackground(ctx: Ctx, now: Date): void {
  // стіна та підлога
  rect(ctx, 0, 0, SCENE_W, 42, '#3b4a8c');
  rect(ctx, 0, 33, SCENE_W, 1, '#2d3a73');
  rect(ctx, 0, 34, SCENE_W, 6, '#34437f');
  rect(ctx, 0, 40, SCENE_W, 2, '#2d3a73');
  rect(ctx, 0, 42, SCENE_W, 18, '#7a5232');
  for (const y of [46, 51, 56]) rect(ctx, 0, y, SCENE_W, 1, '#66432a');
  for (const [x, y, h] of [
    [12, 42, 4],
    [40, 42, 4],
    [70, 42, 4],
    [26, 47, 4],
    [58, 47, 4],
    [86, 47, 4],
    [8, 52, 4],
    [48, 52, 4],
    [78, 52, 4],
    [30, 57, 3],
    [64, 57, 3],
  ]) {
    rect(ctx, x, y, 1, h, '#66432a');
  }

  // полиця з рослиною та книжками
  rect(ctx, 4, 24, 18, 1, '#6e3b1f');
  rect(ctx, 6, 25, 1, 2, '#5a2f18');
  rect(ctx, 19, 25, 1, 2, '#5a2f18');
  rect(ctx, 5, 21, 3, 3, '#c9785a');
  rect(ctx, 5, 18, 1, 3, '#5ee27a');
  rect(ctx, 6, 17, 1, 4, '#4fc46a');
  rect(ctx, 7, 18, 1, 3, '#5ee27a');
  rect(ctx, 11, 19, 2, 5, '#ff6b9a');
  rect(ctx, 13, 20, 2, 4, '#ffcc33');
  rect(ctx, 15, 18, 2, 6, '#5fd3ff');
  rect(ctx, 17, 22, 4, 2, '#f2f0e6');

  drawWindow(ctx, timeOfDay(now.getHours()));
  drawClock(ctx, now);

  // рушник
  rect(ctx, 70, 22, 5, 1, '#9aa0b5');
  rect(ctx, 70, 23, 5, 8, '#5ee27a');
  rect(ctx, 70, 28, 5, 1, '#f2f0e6');

  // дзеркало й умивальник
  rect(ctx, 79, 14, 13, 18, '#c9b48a');
  rect(ctx, 80, 15, 11, 16, '#b9e6ff');
  rect(ctx, 82, 17, 1, 4, '#ffffff');
  rect(ctx, 83, 16, 1, 1, '#ffffff');
  rect(ctx, 84, 33, 3, 1, '#9aa0b5');
  rect(ctx, 85, 34, 1, 2, '#9aa0b5');
  rect(ctx, 77, 36, 17, 3, '#e8e8f0');
  rect(ctx, 77, 36, 17, 1, '#ffffff');
  rect(ctx, 78, 39, 15, 2, '#c7c7d6');
  rect(ctx, 83, 41, 5, 14, '#c7c7d6');
  rect(ctx, 86, 41, 2, 14, '#a9a9bb');
  rect(ctx, 82, 54, 7, 1, '#a9a9bb');

  // ліжко (ковдра малюється окремо)
  rect(ctx, 2, 55, 26, 1, '#5e3f26');
  rect(ctx, 0, 33, 5, 2, '#6e3b1f');
  rect(ctx, 1, 35, 3, 19, '#5a2f18');
  rect(ctx, 24, 39, 5, 2, '#6e3b1f');
  rect(ctx, 25, 41, 3, 13, '#5a2f18');
  rect(ctx, 4, 44, 21, 4, '#f2f0e6');
  rect(ctx, 4, 48, 21, 3, '#6e3b1f');
  rect(ctx, 4, 51, 2, 3, '#5a2f18');
  rect(ctx, 23, 51, 2, 3, '#5a2f18');
  rect(ctx, 4, 41, 6, 3, '#ffffff');
  rect(ctx, 4, 43, 6, 1, '#d8d8e6');
}

/** Ковдра: розстелена, коли героя немає в ліжку, і горбиком, коли він спить. */
export function drawBlanket(ctx: Ctx, occupied: boolean): void {
  if (occupied) {
    rect(ctx, 12, 40, 12, 1, '#b83f3f');
    rect(ctx, 11, 41, 14, 7, '#b83f3f');
    rect(ctx, 11, 41, 2, 7, '#d65a5a');
  } else {
    rect(ctx, 10, 43, 15, 5, '#b83f3f');
    rect(ctx, 10, 43, 15, 1, '#d65a5a');
  }
}

/** Стіл попереду героя, щоб той міг «стояти» за ним. */
export function drawDesk(ctx: Ctx): void {
  rect(ctx, 40, 50, 25, 2, '#8a5a35');
  rect(ctx, 40, 50, 25, 1, '#a46d43');
  rect(ctx, 41, 52, 23, 5, '#6e4526');
  rect(ctx, 41, 54, 23, 1, '#5a3820');
  rect(ctx, 51, 53, 3, 1, '#c9b48a');
  rect(ctx, 41, 57, 2, 2, '#5a3820');
  rect(ctx, 62, 57, 2, 2, '#5a3820');
}

const CODE_COLORS = ['#5ee27a', '#ffcc33', '#5fd3ff', '#ff6b9a'];

/** Ноутбук на столі; `typing` — на екрані біжить код. */
export function drawLaptop(ctx: Ctx, typing: boolean, t: number): void {
  rect(ctx, 56, 49, 9, 1, '#9aa0b5');
  rect(ctx, 57, 42, 7, 7, '#9aa0b5');
  rect(ctx, 58, 43, 5, 5, '#0e1022');
  if (typing) {
    const shift = Math.floor(t / 180);
    for (let i = 0; i < 4; i++) {
      const len = 1 + ((shift + i * 3) % 5);
      rect(ctx, 58, 43 + i, Math.min(len, 5), 1, CODE_COLORS[(shift + i) % CODE_COLORS.length]);
    }
  } else {
    rect(ctx, 60, 45, 1, 1, '#3b4170');
  }
}

export function drawPlate(ctx: Ctx, withFood: boolean): void {
  rect(ctx, 45, 49, 6, 1, '#f2f0e6');
  if (withFood) {
    rect(ctx, 46, 48, 3, 1, '#ffffff');
    rect(ctx, 47, 48, 1, 1, '#ffcc33');
    rect(ctx, 49, 48, 1, 1, '#e0a85a');
  } else {
    rect(ctx, 47, 48, 1, 1, '#e0a85a');
  }
}

export function drawBook(ctx: Ctx, flip: boolean): void {
  rect(ctx, 44, 48, 4, 2, '#f2f0e6');
  rect(ctx, 49, 48, 4, 2, '#f2f0e6');
  rect(ctx, 48, 48, 1, 2, '#3b4a8c');
  rect(ctx, 45, 48, 2, 1, '#a9a7cc');
  rect(ctx, 50, 48, 2, 1, '#a9a7cc');
  if (flip) rect(ctx, 46, 47, 2, 1, '#ffffff');
}

export function drawWater(ctx: Ctx, t: number): void {
  const phase = Math.floor(t / 90) % 2;
  rect(ctx, 85, 36, 1, 2, phase ? '#8fd3ff' : '#d6f1ff');
}

const Z_BIG = ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'];
const Z_SMALL = ['ZZZ', '.Z.', 'ZZZ'];

export function drawSnore(ctx: Ctx, t: number): void {
  const phase = (t / 1600) % 1;
  const rise = Math.floor(phase * 6);
  drawGrid(ctx, Z_SMALL, 13, 33 - rise);
  if (phase > 0.4) drawGrid(ctx, Z_BIG, 17, 29 - rise);
}

export function drawSparkles(ctx: Ctx, x: number, y: number, t: number): void {
  const on = Math.floor(t / 120) % 2 === 0;
  ctx.fillStyle = '#ffcc33';
  const points = on
    ? [
        [-2, 2],
        [13, 4],
        [-1, 12],
        [14, 10],
      ]
    : [
        [-1, 5],
        [12, 1],
        [-2, 9],
        [13, 13],
      ];
  for (const [px, py] of points) ctx.fillRect(x + px, y + py, 1, 1);
}

export function drawNightTint(ctx: Ctx): void {
  ctx.fillStyle = 'rgba(8, 10, 30, 0.22)';
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
}

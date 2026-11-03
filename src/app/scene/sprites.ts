/**
 * Піксельні спрайти героя. Кожен символ у рядку — один піксель кольору з PALETTE,
 * крапка — прозорий. Герой складається з частин (тулуб, ноги, руки, міміка, предмети),
 * тож нова анімація — це просто нова комбінація частин.
 */

export const PALETTE: Record<string, string> = {
  H: '#4a2c1a', // волосся
  S: '#f2c28b', // шкіра
  s: '#d9a066', // тінь шкіри / заплющені очі
  E: '#1b1f3b', // очі
  C: '#e89a7a', // рум'янець
  M: '#b5524a', // рот
  T: '#3fa7d6', // футболка
  t: '#2f86b0', // тінь футболки
  W: '#ffffff', // біле (лого, піна)
  P: '#2d3561', // штани
  B: '#1a1a1a', // кросівки
  G: '#5ee27a', // зелене (щітка, салат)
  Y: '#e0a85a', // хліб
  D: '#8fd3ff', // вода
  O: '#ffcc33', // золото (!, іскри)
  Z: '#c8c6e8', // «Zzz»
};

/** Голова й тулуб без рук і ніг: 12 × 16 пікселів. */
export const UPPER: readonly string[] = [
  '...HHHHHH...',
  '..HHHHHHHH..',
  '..HHHSSHHH..',
  '..HSSSSSSH..',
  '..SSESSESS..',
  '..SSESSESS..',
  '..SCSSSSCS..',
  '..SSSMMSSS..',
  '...SSSSSS...',
  '.....SS.....',
  '...TTTTTT...',
  '..TTTTTTTT..',
  '..TTTWWTTT..',
  '..TTTTTTTT..',
  '..tTTTTTTt..',
  '..TTTTTTTT..',
];

export const HERO_WIDTH = 12;
export const HERO_HEIGHT = 20;

/** Ноги: рядки 16–19. */
export const LEGS = {
  stand: ['..PPPPPPPP..', '..PPP..PPP..', '..PPP..PPP..', '..BBB..BBB..'],
  walkA: ['..PPPPPPPP..', '..PPP..PPP..', '..PPP..BBB..', '..BBB.......'],
  walkB: ['..PPPPPPPP..', '..PPP..PPP..', '..BBB..PPP..', '.......BBB..'],
  jack: ['..PPPPPPPP..', '.PPP....PPP.', 'PPP......PPP', 'BBB......BBB'],
} satisfies Record<string, readonly string[]>;

export type LegsKey = keyof typeof LEGS;

export interface Part {
  x: number;
  y: number;
  rows: readonly string[];
}

const ARM_UP = ['S', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T'];

export const ARM_L = {
  down: { x: 1, y: 11, rows: ['T', 'T', 'T', 'T', 'S'] },
  type: { x: 1, y: 11, rows: ['T', 'T', 'S'] },
  up: { x: 1, y: -1, rows: ARM_UP },
  face: { x: 1, y: 6, rows: ['.S', '.S', 'T.', 'T.', 'T.', 'T.'] },
} satisfies Record<string, Part>;

export const ARM_R = {
  down: { x: 10, y: 11, rows: ['T', 'T', 'T', 'T', 'S'] },
  type: { x: 10, y: 11, rows: ['T', 'T', 'S'] },
  up: { x: 10, y: -1, rows: ARM_UP },
  face: { x: 9, y: 6, rows: ['S.', 'S.', '.T', '.T', '.T', '.T'] },
  mouth: { x: 10, y: 7, rows: ['S', 'S', 'T', 'T', 'T'] },
} satisfies Record<string, Part>;

export type ArmLKey = keyof typeof ARM_L;
export type ArmRKey = keyof typeof ARM_R;

/** Окремий піксель: [x, y, колір] у координатах героя. */
export type Pixel = readonly [number, number, string];

export const FACE = {
  blink: [
    [4, 4, 'S'],
    [7, 4, 'S'],
    [4, 5, 's'],
    [7, 5, 's'],
  ],
  yawn: [
    [4, 4, 'S'],
    [7, 4, 'S'],
    [4, 5, 's'],
    [7, 5, 's'],
    [5, 8, 'M'],
    [6, 8, 'M'],
  ],
  lookDown: [
    [4, 4, 'S'],
    [7, 4, 'S'],
  ],
  chew: [
    [5, 7, 'S'],
    [6, 7, 'M'],
  ],
} satisfies Record<string, readonly Pixel[]>;

export const PROPS = {
  brushA: [
    [7, 7, 'G'],
    [8, 7, 'G'],
    [9, 7, 'G'],
    [5, 7, 'W'],
    [6, 7, 'W'],
  ],
  brushB: [
    [6, 7, 'G'],
    [7, 7, 'G'],
    [8, 7, 'G'],
    [9, 7, 'G'],
    [5, 7, 'W'],
    [4, 8, 'W'],
    [6, 8, 'W'],
  ],
  dropsA: [
    [0, 4, 'D'],
    [11, 6, 'D'],
    [1, 2, 'D'],
  ],
  dropsB: [
    [0, 6, 'D'],
    [11, 3, 'D'],
    [10, 1, 'D'],
  ],
  sandwichMouth: [
    [7, 6, 'Y'],
    [8, 6, 'Y'],
    [9, 6, 'Y'],
    [7, 7, 'G'],
    [8, 7, 'G'],
    [9, 7, 'G'],
    [7, 8, 'Y'],
    [8, 8, 'Y'],
    [9, 8, 'Y'],
  ],
  sandwichHold: [
    [11, 11, 'Y'],
    [12, 11, 'Y'],
    [11, 12, 'G'],
    [12, 12, 'G'],
    [11, 13, 'Y'],
    [12, 13, 'Y'],
  ],
  alert: [
    [5, -5, 'O'],
    [5, -4, 'O'],
    [5, -3, 'O'],
    [5, -1, 'O'],
  ],
} satisfies Record<string, readonly Pixel[]>;

export interface Pose {
  legs: LegsKey;
  armL: ArmLKey;
  armR: ArmRKey;
  face?: readonly Pixel[];
  props?: readonly Pixel[];
  /** Зсув тулуба вниз (дихання). Ноги стоять на місці. */
  dy?: number;
  /** Зсув усього героя вгору (стрибок). */
  lift?: number;
}

export const IDLE_POSE: Pose = { legs: 'stand', armL: 'down', armR: 'down' };

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  ox: number,
  oy: number,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const color = PALETTE[row[c]];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(ox + c, oy + r, 1, 1);
      }
    }
  }
}

export function drawPixels(
  ctx: CanvasRenderingContext2D,
  pixels: readonly Pixel[],
  ox: number,
  oy: number,
): void {
  for (const [x, y, key] of pixels) {
    const color = PALETTE[key] ?? key;
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }
}

function drawPart(ctx: CanvasRenderingContext2D, part: Part, ox: number, oy: number): void {
  drawGrid(ctx, part.rows, ox + part.x, oy + part.y);
}

/** Малює героя: (x, y) — лівий верхній кут спрайта 12 × 20. */
export function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, pose: Pose): void {
  const baseY = y - (pose.lift ?? 0);
  const upperY = baseY + (pose.dy ?? 0);
  drawGrid(ctx, LEGS[pose.legs], x, baseY + 16);
  drawGrid(ctx, UPPER, x, upperY);
  if (pose.face) drawPixels(ctx, pose.face, x, upperY);
  drawPart(ctx, ARM_L[pose.armL], x, upperY);
  drawPart(ctx, ARM_R[pose.armR], x, upperY);
  if (pose.props) drawPixels(ctx, pose.props, x, upperY);
}

/** Голова (рядки 0–8, колонки 2–9) із заплющеними очима, повернута на 90° — герой лежить. */
export const SLEEP_HEAD: readonly string[] = (() => {
  const head = UPPER.slice(0, 9).map((row) => row.slice(2, 10).split(''));
  head[4] = head[4].map((ch) => (ch === 'E' ? 'S' : ch));
  head[5] = head[5].map((ch) => (ch === 'E' ? 's' : ch));
  const w = head[0].length;
  const h = head.length;
  const rotated: string[] = [];
  for (let ny = 0; ny < w; ny++) {
    let line = '';
    for (let nx = 0; nx < h; nx++) {
      line += head[nx][w - 1 - ny];
    }
    rotated.push(line);
  }
  return rotated;
})();

/** Голова для аватарки: рядки 0–10. */
export const AVATAR: readonly string[] = UPPER.slice(0, 11);

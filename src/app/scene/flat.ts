/**
 * Мінімалістична пласка графіка: кімната й герой з простих фігур.
 * Усе малюється у логічних координатах 320 × 200; полотно масштабується під екран (devicePixelRatio).
 */

export const SCENE_W = 320;
export const SCENE_H = 200;
export const FLOOR_Y = 172;

/** X-координата героя біля кожного місця. */
export const SPOT_X = { bed: 124, desk: 180, sink: 254 } as const;

export const C = {
  wall: '#EEF1FB',
  floor: '#E3E8FB',
  line: '#D5DBF7',
  soft: '#C7D2FE',
  white: '#FFFFFF',
  ink: '#101217',
  muted: '#5A6170',
  accent: '#3B5BFD',
  skin: '#F3C9A6',
  skinShade: '#E2B08C',
  teal: '#14B8A6',
  amber: '#F59E0B',
  water: '#7FA2FF',
  leaf: '#7BC8A4',
  bread: '#E0A85A',
};

type Ctx = CanvasRenderingContext2D;
export type Vec = { x: number; y: number };

export function rrect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function capsule(ctx: Ctx, a: Vec, b: Vec, width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ---------------------------------------------------------------- кімната

export type TimeOfDay = 'dawn' | 'day' | 'evening' | 'night';

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const SKY: Record<TimeOfDay, [string, string]> = {
  dawn: ['#FFD9C7', '#FFE9D6'],
  day: ['#CFE3FF', '#E4EFFF'],
  evening: ['#B9C2F7', '#F7C8B4'],
  night: ['#28305E', '#3A4378'],
};

function drawWindow(ctx: Ctx, tod: TimeOfDay): void {
  const x = 128;
  const y = 26;
  const w = 60;
  const h = 56;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, SKY[tod][0]);
  sky.addColorStop(1, SKY[tod][1]);
  ctx.fillStyle = sky;
  ctx.fill();
  ctx.clip();
  if (tod === 'night') {
    circle(ctx, x + 44, y + 15, 6, '#F2F0E6');
    circle(ctx, x + 47, y + 13, 5, SKY.night[0]);
    for (const [sx, sy] of [
      [10, 12],
      [22, 30],
      [52, 40],
      [14, 44],
      [34, 10],
    ]) {
      circle(ctx, x + sx, y + sy, 1, '#FFFFFF');
    }
  } else {
    const sunY = tod === 'day' ? y + 16 : y + 40;
    circle(ctx, x + 44, sunY, 7, tod === 'day' ? '#FFD66B' : '#FFB27A');
    rrect(ctx, x + 6, y + 30, 22, 7, 3.5, 'rgba(255,255,255,0.9)');
    rrect(ctx, x + 12, y + 26, 12, 7, 3.5, 'rgba(255,255,255,0.9)');
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 3;
  ctx.stroke();
  capsule(ctx, { x: x + w / 2, y }, { x: x + w / 2, y: y + h }, 2.5, C.white);
  capsule(ctx, { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }, 2.5, C.white);
}

function drawClock(ctx: Ctx, now: Date): void {
  const cx = 218;
  const cy = 46;
  circle(ctx, cx, cy, 13, C.white);
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  const ma = (m / 60) * Math.PI * 2;
  const ha = (h / 12) * Math.PI * 2;
  capsule(
    ctx,
    { x: cx, y: cy },
    { x: cx + Math.sin(ha) * 6, y: cy - Math.cos(ha) * 6 },
    2.2,
    C.ink,
  );
  capsule(
    ctx,
    { x: cx, y: cy },
    { x: cx + Math.sin(ma) * 9, y: cy - Math.cos(ma) * 9 },
    1.6,
    C.accent,
  );
  circle(ctx, cx, cy, 1.8, C.ink);
}

function drawShelf(ctx: Ctx): void {
  rrect(ctx, 26, 74, 60, 3, 1.5, C.line);
  rrect(ctx, 32, 63, 10, 11, 3, C.soft);
  ctx.save();
  ctx.fillStyle = C.leaf;
  ctx.beginPath();
  ctx.ellipse(34, 58, 3, 7, -0.5, 0, Math.PI * 2);
  ctx.ellipse(40, 57, 3, 7, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  rrect(ctx, 52, 60, 5, 14, 1.5, C.accent);
  rrect(ctx, 58, 63, 5, 11, 1.5, C.amber);
  rrect(ctx, 64, 58, 5, 16, 1.5, C.teal);
  rrect(ctx, 72, 69, 12, 5, 1.5, C.white, C.line);
}

/** Нерухомий фон: стіни, підлога, вікно, годинник, полиця, ліжко, умивальник. */
export function drawRoom(ctx: Ctx, now: Date): void {
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.fillStyle = C.floor;
  ctx.fillRect(0, 160, SCENE_W, SCENE_H - 160);
  ctx.fillStyle = C.line;
  ctx.fillRect(0, 159, SCENE_W, 1.5);

  drawWindow(ctx, timeOfDay(now.getHours()));
  drawClock(ctx, now);
  drawShelf(ctx);

  // ліжко
  rrect(ctx, 10, 116, 9, 56, 4.5, C.soft);
  rrect(ctx, 14, 158, 92, 8, 4, C.line);
  rrect(ctx, 18, 166, 6, 6, 2, C.line);
  rrect(ctx, 96, 166, 6, 6, 2, C.line);
  rrect(ctx, 14, 145, 92, 15, 6, C.white, C.line);

  // умивальник і дзеркало
  rrect(ctx, 270, 68, 32, 46, 12, C.white, C.line);
  capsule(ctx, { x: 279, y: 78 }, { x: 279, y: 90 }, 2, '#E6ECFF');
  rrect(ctx, 240, 98, 11, 26, 3, C.accent);
  capsule(ctx, { x: 238, y: 98 }, { x: 253, y: 98 }, 2, C.muted);
  rrect(ctx, 283, 126, 6, 9, 2, C.muted);
  rrect(ctx, 280, 144, 12, 28, 3, '#DDE3F8');
  rrect(ctx, 262, 133, 48, 12, 5, C.white, C.line);
}

/** Ковдра на порожньому ліжку. */
export function drawMadeBed(ctx: Ctx): void {
  rrect(ctx, 20, 137, 24, 11, 5, C.white, C.line);
  rrect(ctx, 48, 141, 58, 16, 6, C.soft);
  rrect(ctx, 48, 141, 58, 4, 2, '#B4C2FB');
}

/** Герой спить: голова на подушці, ковдра горбиком. */
export function drawSleepingHero(ctx: Ctx, t: number): void {
  rrect(ctx, 20, 137, 24, 11, 5, C.white, C.line);
  drawHead(ctx, { x: 33, y: 130 }, 11, { eyes: 'closed', mouth: 'none', rotate: -0.25 });
  ctx.beginPath();
  ctx.roundRect(40, 130 + Math.sin(t / 700) * 0.8, 66, 27, [12, 8, 6, 6]);
  ctx.fillStyle = C.soft;
  ctx.fill();
  rrect(ctx, 40, 130 + Math.sin(t / 700) * 0.8, 66, 5, 3, '#B4C2FB');
}

export function drawSnore(ctx: Ctx, t: number): void {
  const phase = (t / 1800) % 1;
  ctx.save();
  ctx.fillStyle = C.accent;
  ctx.font = '700 11px Manrope, system-ui, sans-serif';
  ctx.globalAlpha = 1 - phase;
  ctx.fillText('z', 46, 120 - phase * 14);
  ctx.font = '700 15px Manrope, system-ui, sans-serif';
  ctx.globalAlpha = Math.max(0, 1 - Math.abs(phase - 0.6) * 2);
  ctx.fillText('z', 54, 110 - phase * 14);
  ctx.restore();
}

// ---------------------------------------------------------------- стіл і предмети

export function drawDesk(ctx: Ctx): void {
  rrect(ctx, 152, 172 - 22, 5, 22, 2, C.line);
  rrect(ctx, 225, 172 - 22, 5, 22, 2, C.line);
  rrect(ctx, 146, 146, 90, 6, 3, C.white, C.line);
}

const CODE = [C.accent, C.teal, C.amber, '#EC4899'];

export function drawLaptop(ctx: Ctx, typing: boolean, t: number): void {
  rrect(ctx, 203, 125, 26, 18, 3, C.ink);
  if (typing) {
    const shift = Math.floor(t / 160);
    for (let i = 0; i < 4; i++) {
      const len = 5 + ((shift + i * 3) % 4) * 4;
      rrect(ctx, 207, 129 + i * 3.4, Math.min(len, 18), 1.8, 0.9, CODE[(shift + i) % CODE.length]);
    }
  } else {
    circle(ctx, 216, 134, 1.6, '#3B4170');
  }
  rrect(ctx, 199, 143, 34, 3, 1.5, '#9AA3BF');
}

export function drawPlate(ctx: Ctx, withFood: boolean): void {
  ctx.beginPath();
  ctx.ellipse(168, 145, 10, 2.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = C.white;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (withFood) {
    circle(ctx, 165, 143, 2.6, C.amber);
    circle(ctx, 170, 143.5, 2.2, C.leaf);
  }
}

export function drawWater(ctx: Ctx, t: number): void {
  const len = 6 + Math.sin(t / 90) * 1.5;
  capsule(ctx, { x: 286, y: 135 }, { x: 286, y: 135 + len }, 1.6, C.water);
}

export function drawSparkles(ctx: Ctx, x: number, y: number, t: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  const points = [
    [-26, -14],
    [24, -24],
    [30, 6],
    [-30, 14],
  ];
  points.forEach(([dx, dy], i) => {
    const s = 3 + Math.sin(t / 120 + i) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x + dx - s, y + dy);
    ctx.lineTo(x + dx + s, y + dy);
    ctx.moveTo(x + dx, y + dy - s);
    ctx.lineTo(x + dx, y + dy + s);
    ctx.stroke();
  });
  ctx.restore();
}

export function drawNightTint(ctx: Ctx): void {
  ctx.fillStyle = 'rgba(16, 18, 40, 0.10)';
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
}

// ---------------------------------------------------------------- герой

/** Пози задаються цілями для кистей і стоп; лікті рахує проста інверсна кінематика. */
export interface FlatPose {
  /** Кисті відносно плечей: x — назовні від тіла, y — вниз. */
  handL: Vec;
  handR: Vec;
  /** Стопи відносно стегон: x — назовні, y — підйом угору. */
  footL: Vec;
  footR: Vec;
  /** Зсув тулуба вниз (дихання). */
  bob?: number;
  /** Зсув усього героя вгору (стрибок). */
  lift?: number;
  eyes?: 'open' | 'closed';
  mouth?: 'smile' | 'open' | 'none';
  /** Нахил голови вниз (читання). */
  headDown?: number;
  props?: Prop[];
}

export type Prop = 'brush' | 'foam' | 'drops' | 'sandwich' | 'book' | 'dumbbells';

/** Зовнішність персонажа: герой або дівчина. */
export interface Look {
  shirt: string;
  pants: string;
  hair: string;
  long: boolean;
}

export const HERO_LOOK: Look = { shirt: C.accent, pants: '#2A2F45', hair: C.ink, long: false };
export const GIRL_LOOK: Look = { shirt: '#EC4899', pants: '#3B3F5C', hair: '#6B3E26', long: true };

export const STAND: FlatPose = {
  handL: { x: 3, y: 26 },
  handR: { x: 3, y: 26 },
  footL: { x: 0, y: 0 },
  footR: { x: 0, y: 0 },
};

const UPPER = 13;
const FORE = 13;
const LEG = 24;

function ik(shoulder: Vec, target: Vec, outward: number): Vec {
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const d = Math.min(Math.max(dist, Math.abs(UPPER - FORE) + 0.5), UPPER + FORE - 0.5);
  const a = Math.acos((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d));
  const base = Math.atan2(dy, dx);
  const e1 = {
    x: shoulder.x + Math.cos(base + a) * UPPER,
    y: shoulder.y + Math.sin(base + a) * UPPER,
  };
  const e2 = {
    x: shoulder.x + Math.cos(base - a) * UPPER,
    y: shoulder.y + Math.sin(base - a) * UPPER,
  };
  // лікоть відводимо назовні від тулуба
  return (e1.x - shoulder.x) * outward > (e2.x - shoulder.x) * outward ? e1 : e2;
}

interface HeadOptions {
  eyes: 'open' | 'closed';
  mouth: 'smile' | 'open' | 'none';
  rotate?: number;
  hair?: string;
  long?: boolean;
}

function drawHead(ctx: Ctx, c: Vec, r: number, o: HeadOptions): void {
  ctx.save();
  ctx.translate(c.x, c.y);
  if (o.rotate) ctx.rotate(o.rotate);
  const hair = o.hair ?? C.ink;
  // довге волосся позаду голови
  if (o.long) rrect(ctx, -r - 2, -r * 0.4, r * 2 + 4, r * 1.9, [4, 4, 8, 8], hair);
  circle(ctx, 0, 0, r, C.skin);
  // волосся: шапочка зверху
  ctx.beginPath();
  ctx.moveTo(-r, -1);
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.quadraticCurveTo(r * 0.3, -r * 0.55, -r, -1);
  ctx.fillStyle = hair;
  ctx.fill();
  const ey = r * 0.12;
  if (o.eyes === 'closed') {
    capsule(ctx, { x: -r * 0.45, y: ey }, { x: -r * 0.2, y: ey }, 1.4, C.ink);
    capsule(ctx, { x: r * 0.2, y: ey }, { x: r * 0.45, y: ey }, 1.4, C.ink);
  } else {
    circle(ctx, -r * 0.33, ey, 1.6, C.ink);
    circle(ctx, r * 0.33, ey, 1.6, C.ink);
  }
  circle(ctx, -r * 0.55, r * 0.45, 2, 'rgba(255,120,120,0.25)');
  circle(ctx, r * 0.55, r * 0.45, 2, 'rgba(255,120,120,0.25)');
  if (o.mouth === 'open') {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.52, 2.4, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#B5524A';
    ctx.fill();
  } else if (o.mouth === 'smile') {
    ctx.beginPath();
    ctx.arc(0, r * 0.38, 3, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.restore();
}

/** Малює героя: x — центр, groundY — лінія стоп. */
export function drawHero(
  ctx: Ctx,
  x: number,
  groundY: number,
  pose: FlatPose,
  look: Look = HERO_LOOK,
): void {
  const lift = pose.lift ?? 0;
  const bob = pose.bob ?? 0;
  const hipY = groundY - LEG - lift;
  const top = hipY - 30 + bob;
  const shoulderY = top + 6;
  const head = { x, y: top - 12 + (pose.headDown ?? 0) };

  // ноги
  for (const side of [-1, 1] as const) {
    const foot = side < 0 ? pose.footL : pose.footR;
    const hip = { x: x + side * 6, y: hipY };
    const end = { x: hip.x + side * foot.x, y: groundY - lift - foot.y - 3 };
    capsule(ctx, hip, end, 8, look.pants);
    rrect(ctx, end.x - 5 + side * 1.5, end.y + 1, 10, 4, 2, C.ink);
  }

  // тулуб
  rrect(ctx, x - 15, top, 30, hipY - top + 4, 12, look.shirt);
  rrect(ctx, x - 4, top + 9, 8, 4, 2, 'rgba(255,255,255,0.85)');

  drawHead(ctx, head, 13, {
    eyes: pose.eyes ?? 'open',
    mouth: pose.mouth ?? 'smile',
    hair: look.hair,
    long: look.long,
  });

  // руки
  const hands: Vec[] = [];
  for (const side of [-1, 1] as const) {
    const target = side < 0 ? pose.handL : pose.handR;
    const shoulder = { x: x + side * 12, y: shoulderY };
    const hand = { x: shoulder.x + side * target.x, y: shoulder.y + target.y };
    const elbow = ik(shoulder, hand, side);
    capsule(ctx, shoulder, elbow, 7.5, look.shirt);
    capsule(ctx, elbow, hand, 6, C.skin);
    circle(ctx, hand.x, hand.y, 3.6, C.skin);
    hands.push(hand);
  }

  for (const prop of pose.props ?? []) drawProp(ctx, prop, head, hands[0], hands[1]);
}

function drawProp(ctx: Ctx, prop: Prop, head: Vec, handL: Vec, handR: Vec): void {
  switch (prop) {
    case 'brush':
      capsule(
        ctx,
        { x: handR.x - 1, y: handR.y - 1 },
        { x: head.x + 2, y: head.y + 6 },
        2.4,
        C.teal,
      );
      break;
    case 'foam':
      circle(ctx, head.x - 1, head.y + 7, 2.4, C.white);
      circle(ctx, head.x + 3, head.y + 6, 1.8, C.white);
      break;
    case 'drops':
      for (const [dx, dy] of [
        [-17, -2],
        [16, 4],
        [-12, 10],
      ]) {
        ctx.beginPath();
        ctx.ellipse(head.x + dx, head.y + dy, 1.6, 2.4, 0, 0, Math.PI * 2);
        ctx.fillStyle = C.water;
        ctx.fill();
      }
      break;
    case 'sandwich':
      rrect(ctx, handR.x - 5, handR.y - 6, 10, 3, 1.5, C.bread);
      rrect(ctx, handR.x - 5, handR.y - 3.5, 10, 2, 1, C.leaf);
      rrect(ctx, handR.x - 5, handR.y - 1.5, 10, 3, 1.5, C.bread);
      break;
    case 'dumbbells':
      for (const h of [handL, handR]) {
        capsule(ctx, { x: h.x - 6, y: h.y }, { x: h.x + 6, y: h.y }, 2, '#6B7280');
        rrect(ctx, h.x - 9, h.y - 4, 4, 8, 1.5, C.ink);
        rrect(ctx, h.x + 5, h.y - 4, 4, 8, 1.5, C.ink);
      }
      break;
    case 'book':
      rrect(
        ctx,
        Math.min(handL.x, handR.x) - 2,
        handL.y - 6,
        Math.abs(handR.x - handL.x) + 4,
        9,
        2,
        C.white,
        C.line,
      );
      capsule(
        ctx,
        { x: (handL.x + handR.x) / 2, y: handL.y - 6 },
        { x: (handL.x + handR.x) / 2, y: handL.y + 3 },
        1.2,
        C.accent,
      );
      break;
  }
}

/** Аватарка: лише голова в колі. */
export function drawAvatar(ctx: Ctx, size: number): void {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 40, size / 40);
  circle(ctx, 20, 20, 20, C.wall);
  rrect(ctx, 6, 30, 28, 20, 12, C.accent);
  drawHead(ctx, { x: 20, y: 19 }, 11, { eyes: 'open', mouth: 'smile' });
  ctx.restore();
}

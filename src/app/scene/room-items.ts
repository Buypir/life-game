import { C, capsule, circle, rrect } from './flat';

type Ctx = CanvasRenderingContext2D;

/** Межі кожної речі в координатах кімнати — для мініатюр у магазині. */
export const ITEM_BOX: Record<string, [number, number, number, number]> = {
  'room-plant': [168, 56, 24, 28],
  'room-poster': [92, 26, 30, 40],
  'room-rug': [86, 168, 128, 18],
  'room-lamp': [144, 112, 26, 36],
  'room-lights': [96, 6, 128, 22],
  'room-guitar': [234, 112, 26, 62],
  'room-console': [158, 156, 52, 16],
  'room-cat': [80, 146, 30, 28],
};

/** Порядок малювання: килим під усім, гірлянда й постер на стіні, далі решта. */
const ORDER = [
  'room-rug',
  'room-lights',
  'room-poster',
  'room-plant',
  'room-guitar',
  'room-console',
  'room-lamp',
];

/** Статичні речі (кешуються разом із фоном кімнати). Кіт малюється окремо — він рухається. */
export function drawRoomItems(ctx: Ctx, items: readonly string[], night: boolean): void {
  for (const id of ORDER) if (items.includes(id)) drawRoomItem(ctx, id, night);
}

export function drawRoomItem(ctx: Ctx, id: string, night = false, t = 0): void {
  switch (id) {
    case 'room-rug':
      ctx.beginPath();
      ctx.ellipse(150, 177, 62, 7.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#C9B8FF';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(150, 177, 48, 4.8, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    case 'room-lights': {
      ctx.beginPath();
      ctx.moveTo(98, 10);
      ctx.quadraticCurveTo(160, 30, 222, 10);
      ctx.strokeStyle = '#7C849C';
      ctx.lineWidth = 1;
      ctx.stroke();
      const colors = ['#F59E0B', '#EC4899', '#14B8A6', '#3B5BFD'];
      for (let i = 0; i < 9; i++) {
        const u = (i + 0.5) / 9;
        const x = 98 + u * 124;
        const y = 10 + 2 * u * (1 - u) * 20 + 3;
        const color = colors[i % colors.length];
        if (night) circle(ctx, x, y, 5, color + '44');
        circle(ctx, x, y, 2.4, color);
      }
      break;
    }
    case 'room-poster':
      rrect(ctx, 94, 28, 26, 36, 3, C.white, C.line);
      rrect(ctx, 97, 31, 20, 22, 2, '#1E1B4B');
      circle(ctx, 112, 37, 3, '#FDE68A');
      ctx.beginPath();
      ctx.moveTo(97, 53);
      ctx.lineTo(104, 42);
      ctx.lineTo(110, 49);
      ctx.lineTo(113, 45);
      ctx.lineTo(117, 53);
      ctx.closePath();
      ctx.fillStyle = '#6366F1';
      ctx.fill();
      rrect(ctx, 99, 56, 16, 2.4, 1.2, C.soft);
      break;
    case 'room-plant':
      rrect(ctx, 168, 81, 24, 3, 1.5, C.white, C.line);
      ctx.fillStyle = '#5DB38A';
      for (const [lx, ly, rot] of [
        [176, 66, -0.5],
        [184, 65, 0.5],
        [180, 61, 0],
      ]) {
        ctx.beginPath();
        ctx.ellipse(lx, ly, 3.5, 8, rot, 0, Math.PI * 2);
        ctx.fill();
      }
      rrect(ctx, 174, 71, 12, 10, [2, 2, 4, 4], '#E07A5F');
      break;
    case 'room-guitar':
      capsule(ctx, { x: 247, y: 150 }, { x: 251, y: 118 }, 3.4, '#7C4A1E');
      rrect(ctx, 247.5, 112, 7, 8, 2, '#3F2A14');
      ctx.fillStyle = '#E09F3E';
      ctx.beginPath();
      ctx.ellipse(246, 162, 10, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(247, 149, 7.5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      circle(ctx, 246.5, 156, 2.6, '#3F2A14');
      rrect(ctx, 241, 164, 11, 2.4, 1, '#3F2A14');
      break;
    case 'room-console':
      rrect(ctx, 162, 160, 28, 12, 3, '#F4F5F8', C.line);
      rrect(ctx, 166, 163, 10, 2, 1, C.soft);
      circle(ctx, 184, 166, 1.6, '#22C55E');
      // джойстик на підлозі
      rrect(ctx, 194, 165, 14, 7, 3.5, '#22252F');
      circle(ctx, 198, 168.5, 1.3, '#9AA3BF');
      circle(ctx, 204, 167.5, 1, '#E5484D');
      circle(ctx, 205.5, 169.5, 1, C.accent);
      break;
    case 'room-lamp':
      rrect(ctx, 146, 143, 14, 3.5, 1.7, '#22252F');
      capsule(ctx, { x: 152, y: 143 }, { x: 149, y: 128 }, 1.6, '#22252F');
      capsule(ctx, { x: 149, y: 128 }, { x: 158, y: 120 }, 1.6, '#22252F');
      ctx.beginPath();
      ctx.moveTo(154, 115);
      ctx.lineTo(168, 120);
      ctx.lineTo(162, 128);
      ctx.closePath();
      ctx.fillStyle = C.amber;
      ctx.fill();
      if (night) {
        ctx.beginPath();
        ctx.moveTo(162, 126);
        ctx.lineTo(186, 146);
        ctx.lineTo(160, 146);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 214, 107, 0.25)';
        ctx.fill();
      }
      break;
    case 'room-cat':
      drawCat(ctx, t, false);
      break;
  }
}

/** Кіт: сидить біля ліжка й махає хвостом або спить калачиком на ліжку. */
export function drawCat(ctx: Ctx, t: number, sleeping: boolean): void {
  const fur = '#F2A65A';
  const dark = '#D9822B';
  if (sleeping) {
    ctx.beginPath();
    ctx.ellipse(86, 141, 11, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = fur;
    ctx.fill();
    circle(ctx, 94, 139, 5, fur);
    ctx.beginPath();
    ctx.moveTo(91, 135);
    ctx.lineTo(92.5, 131);
    ctx.lineTo(95, 134.5);
    ctx.moveTo(95.5, 134.5);
    ctx.lineTo(98, 131.5);
    ctx.lineTo(98.5, 136);
    ctx.fillStyle = fur;
    ctx.fill();
    capsule(ctx, { x: 92, y: 140 }, { x: 94, y: 140 }, 0.9, C.ink);
    capsule(ctx, { x: 96, y: 140 }, { x: 98, y: 140 }, 0.9, C.ink);
    capsule(ctx, { x: 76, y: 143 }, { x: 88, y: 146 }, 2.6, dark);
    return;
  }
  const x = 96;
  const ground = 172;
  // хвіст
  const swing = Math.sin(t / 420) * 6;
  ctx.beginPath();
  ctx.moveTo(x + 7, ground - 3);
  ctx.quadraticCurveTo(
    x + 16,
    ground - 6,
    x + 14 + swing * 0.4,
    ground - 16 - Math.abs(swing) * 0.3,
  );
  ctx.strokeStyle = dark;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
  // тіло й голова
  ctx.beginPath();
  ctx.ellipse(x, ground - 8, 8, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = fur;
  ctx.fill();
  circle(ctx, x, ground - 20, 6.5, fur);
  ctx.beginPath();
  ctx.moveTo(x - 6, ground - 23);
  ctx.lineTo(x - 5, ground - 30);
  ctx.lineTo(x - 1, ground - 25.5);
  ctx.moveTo(x + 1, ground - 25.5);
  ctx.lineTo(x + 5, ground - 30);
  ctx.lineTo(x + 6, ground - 23);
  ctx.fillStyle = fur;
  ctx.fill();
  const blink = t % 3800 < 150;
  if (blink) {
    capsule(ctx, { x: x - 3.4, y: ground - 20 }, { x: x - 1.6, y: ground - 20 }, 0.8, C.ink);
    capsule(ctx, { x: x + 1.6, y: ground - 20 }, { x: x + 3.4, y: ground - 20 }, 0.8, C.ink);
  } else {
    circle(ctx, x - 2.5, ground - 20, 1.1, C.ink);
    circle(ctx, x + 2.5, ground - 20, 1.1, C.ink);
  }
  circle(ctx, x, ground - 17.5, 0.9, '#C2410C');
  rrect(ctx, x - 6, ground - 3, 4, 3, 1.5, dark);
  rrect(ctx, x + 2, ground - 3, 4, 3, 1.5, dark);
}

/** Безлад після пропущеного дня: розкидані речі на підлозі. */
export function drawMess(ctx: Ctx): void {
  // футболка
  ctx.save();
  ctx.translate(64, 178);
  ctx.rotate(-0.25);
  rrect(ctx, -9, -4, 18, 8, 3, '#9AA3BF');
  rrect(ctx, -13, -4, 6, 4, 2, '#9AA3BF');
  rrect(ctx, 7, -3, 6, 4, 2, '#9AA3BF');
  ctx.restore();
  // шкарпетки
  capsule(ctx, { x: 196, y: 182 }, { x: 204, y: 180 }, 3, C.white);
  capsule(ctx, { x: 214, y: 186 }, { x: 222, y: 186 }, 3, C.white);
  // коробка з-під піци й папірці
  rrect(ctx, 232, 176, 20, 6, 1.5, '#E0A85A', '#C08A3E');
  circle(ctx, 140, 186, 2.6, C.white);
  circle(ctx, 176, 190, 2.2, C.white);
  circle(ctx, 30, 186, 2.4, C.white);
}

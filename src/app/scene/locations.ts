/** Фони й передній план для нових локацій: офіс, спортзал, дорога, парк, кафе, плата для embedded. */
import { C, capsule, circle, FLOOR_Y, rrect, SCENE_H, SCENE_W, timeOfDay } from './flat';

type Ctx = CanvasRenderingContext2D;

function base(ctx: Ctx, wall: string, floor: string): void {
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.fillStyle = floor;
  ctx.fillRect(0, 160, SCENE_W, SCENE_H - 160);
  ctx.fillStyle = C.line;
  ctx.fillRect(0, 159, SCENE_W, 1.5);
}

function skyColor(now: Date): string {
  const tod = timeOfDay(now.getHours());
  return tod === 'night'
    ? '#2B3566'
    : tod === 'evening'
      ? '#C9CFF7'
      : tod === 'dawn'
        ? '#FFE3D3'
        : '#D6E6FF';
}

function heart(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-6, -2, -3, -7, 0, -3.5);
  ctx.bezierCurveTo(3, -7, 6, -2, 0, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export function drawHearts(ctx: Ctx, x: number, y: number, t: number): void {
  for (let i = 0; i < 3; i++) {
    const phase = (((t / 2200 + i / 3) % 1) + 1) % 1;
    ctx.save();
    ctx.globalAlpha = Math.sin(phase * Math.PI);
    heart(
      ctx,
      x + Math.sin(phase * 6 + i) * 8 + (i - 1) * 10,
      y - phase * 26,
      1 + i * 0.15,
      '#EC4899',
    );
    ctx.restore();
  }
}

// ---------------------------------------------------------------- офіс

export function drawOffice(ctx: Ctx, now: Date): void {
  base(ctx, '#EEF1FB', '#E3E8FB');
  // велике вікно з містом
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(18, 22, 120, 84, 10);
  ctx.fillStyle = skyColor(now);
  ctx.fill();
  ctx.clip();
  const night = timeOfDay(now.getHours()) === 'night';
  const buildings: [number, number, number][] = [
    [18, 60, 22],
    [42, 44, 18],
    [62, 70, 26],
    [90, 38, 20],
    [112, 56, 26],
  ];
  for (const [bx, by, bw] of buildings) {
    rrect(ctx, bx, by, bw, 60, 2, night ? '#3A4378' : '#B9C5F2');
    for (let wy = by + 6; wy < 104; wy += 8) {
      for (let wx = bx + 4; wx < bx + bw - 4; wx += 6) {
        ctx.fillStyle = night ? 'rgba(255,214,107,0.8)' : 'rgba(255,255,255,0.7)';
        ctx.fillRect(wx, wy, 2.5, 3);
      }
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(18, 22, 120, 84, 10);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 3;
  ctx.stroke();
  capsule(ctx, { x: 78, y: 22 }, { x: 78, y: 106 }, 2.5, C.white);

  // логотип і полиця
  rrect(ctx, 168, 30, 64, 22, 8, C.white, C.line);
  ctx.fillStyle = C.accent;
  ctx.font = '800 11px Manrope, system-ui, sans-serif';
  ctx.fillText('OFFICE', 179, 45);
  // рослина у великому вазоні
  rrect(ctx, 276, 136, 22, 24, 5, C.soft);
  ctx.fillStyle = C.leaf;
  for (const [lx, ly, rot] of [
    [281, 122, -0.4],
    [293, 120, 0.4],
    [287, 112, 0],
  ]) {
    ctx.beginPath();
    ctx.ellipse(lx, ly, 5, 14, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  // кулер
  rrect(ctx, 246, 92, 16, 22, 6, '#CFE3FF', C.line);
  rrect(ctx, 244, 114, 20, 46, 4, C.white, C.line);
}

export function drawOfficeDesk(ctx: Ctx, typing: boolean, t: number): void {
  rrect(ctx, 148, 150, 5, 22, 2, C.line);
  rrect(ctx, 229, 150, 5, 22, 2, C.line);
  rrect(ctx, 140, 146, 100, 6, 3, C.white, C.line);
  // два монітори праворуч від героя
  for (const mx of [204, 226]) {
    rrect(ctx, mx - 1, 140, 4, 6, 1, '#9AA3BF');
    rrect(ctx, mx - 11, 114, 24, 27, 3, C.ink);
    if (typing) {
      const shift = Math.floor(t / 170) + mx;
      for (let i = 0; i < 5; i++) {
        const len = 6 + ((shift + i * 3) % 4) * 3;
        rrect(
          ctx,
          mx - 7,
          118 + i * 4,
          len,
          2,
          1,
          [C.accent, C.teal, C.amber, '#EC4899'][(shift + i) % 4],
        );
      }
    }
  }
  // клавіатура перед героєм і чашка кави
  rrect(ctx, 158, 142.5, 26, 4, 1.5, '#C9D0E6');
  rrect(ctx, 145, 138, 8, 8, 2, C.white, C.line);
}

// ---------------------------------------------------------------- спортзал

export function drawGym(ctx: Ctx): void {
  base(ctx, '#EEF1FB', '#D9DFF5');
  // дзеркало на всю стіну
  rrect(ctx, 96, 30, 130, 100, 8, '#F7F9FF', C.line);
  capsule(ctx, { x: 120, y: 40 }, { x: 108, y: 70 }, 3, '#E6ECFF');
  capsule(ctx, { x: 134, y: 40 }, { x: 122, y: 70 }, 2, '#E6ECFF');
  // стійка з гантелями
  rrect(ctx, 16, 112, 64, 6, 3, '#9AA3BF');
  rrect(ctx, 20, 118, 5, 54, 2, '#9AA3BF');
  rrect(ctx, 71, 118, 5, 54, 2, '#9AA3BF');
  rrect(ctx, 16, 140, 64, 5, 2.5, '#9AA3BF');
  for (const [dx, y] of [
    [24, 106],
    [44, 106],
    [62, 106],
    [30, 134],
    [54, 134],
  ]) {
    capsule(ctx, { x: dx, y }, { x: dx + 12, y }, 2, '#6B7280');
    rrect(ctx, dx - 3, y - 4, 5, 8, 2, C.ink);
    rrect(ctx, dx + 10, y - 4, 5, 8, 2, C.ink);
  }
  // лава
  rrect(ctx, 236, 140, 64, 9, 4, C.accent);
  rrect(ctx, 244, 149, 4, 23, 2, '#9AA3BF');
  rrect(ctx, 288, 149, 4, 23, 2, '#9AA3BF');
  // пляшка води
  rrect(ctx, 268, 128, 8, 12, 3, C.water);
  // напис
  ctx.fillStyle = C.accent;
  ctx.font = '800 12px Manrope, system-ui, sans-serif';
  ctx.fillText('GYM', 254, 46);
  rrect(ctx, 250, 52, 34, 3, 1.5, C.accent);
}

// ---------------------------------------------------------------- дорога

/** Місто пролітає за вікном машини; t — час у мс, від нього залежить зсув. */
export function drawRoad(ctx: Ctx, now: Date, t: number, label: string): void {
  const sky = ctx.createLinearGradient(0, 0, 0, 140);
  sky.addColorStop(0, skyColor(now));
  sky.addColorStop(1, '#EEF1FB');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  const night = timeOfDay(now.getHours()) === 'night';

  // далекі будинки (повільно)
  const far = (t * 0.02) % 80;
  for (let i = -1; i < 6; i++) {
    const x = i * 80 - far;
    rrect(ctx, x, 70, 34, 70, 3, night ? '#3A4378' : '#C9D2F5');
    rrect(ctx, x + 40, 92, 28, 48, 3, night ? '#333C70' : '#D5DBF7');
  }
  // дерева й ліхтарі (швидше)
  const near = (t * 0.09) % 110;
  for (let i = -1; i < 5; i++) {
    const x = i * 110 - near;
    rrect(ctx, x + 18, 118, 4, 24, 2, '#B08968');
    circle(ctx, x + 20, 110, 13, C.leaf);
    capsule(ctx, { x: x + 72, y: 142 }, { x: x + 72, y: 100 }, 2.5, '#9AA3BF');
    circle(ctx, x + 72, 99, 4, night ? '#FFD66B' : C.white);
  }
  // дорога з розміткою
  ctx.fillStyle = '#C3C9DB';
  ctx.fillRect(0, 142, SCENE_W, 58);
  ctx.fillStyle = '#B2B9CE';
  ctx.fillRect(0, 142, SCENE_W, 3);
  const dash = (t * 0.25) % 40;
  for (let x = -dash; x < SCENE_W; x += 40) rrect(ctx, x, 178, 20, 3, 1.5, C.white);

  // табличка з пунктом призначення
  rrect(ctx, 226, 18, 82, 24, 8, C.white, C.line);
  ctx.fillStyle = C.ink;
  ctx.font = '800 11px Manrope, system-ui, sans-serif';
  ctx.fillText(`→ ${label}`, 236, 34);
}

/** Машина з героєм за кермом; `bump` — легке підстрибування. */
export function drawCar(ctx: Ctx, x: number, t: number): void {
  const bump = Math.sin(t / 90) * 0.8;
  const y = 150 + bump;
  // кузов
  rrect(ctx, x - 44, y - 16, 88, 22, 10, C.accent);
  ctx.beginPath();
  ctx.moveTo(x - 26, y - 16);
  ctx.quadraticCurveTo(x - 20, y - 38, x + 2, y - 38);
  ctx.lineTo(x + 12, y - 38);
  ctx.quadraticCurveTo(x + 26, y - 38, x + 32, y - 16);
  ctx.closePath();
  ctx.fillStyle = C.accent;
  ctx.fill();
  // вікно
  ctx.beginPath();
  ctx.moveTo(x - 20, y - 17);
  ctx.quadraticCurveTo(x - 15, y - 33, x + 2, y - 33);
  ctx.lineTo(x + 10, y - 33);
  ctx.quadraticCurveTo(x + 21, y - 33, x + 25, y - 17);
  ctx.closePath();
  ctx.fillStyle = '#DCE6FF';
  ctx.fill();
  // голова героя у вікні
  circle(ctx, x + 6, y - 23, 8, C.skin);
  ctx.beginPath();
  ctx.arc(x + 6, y - 23, 8, Math.PI, 0);
  ctx.fillStyle = C.ink;
  ctx.fill();
  circle(ctx, x + 10, y - 22, 1.2, C.ink);
  capsule(ctx, { x: x + 3, y: y - 17 }, { x: x - 2, y: y - 11 }, 2, '#5A6170'); // кермо
  // фари й ручка
  rrect(ctx, x + 38, y - 10, 6, 4, 2, '#FFD66B');
  rrect(ctx, x - 44, y - 10, 4, 4, 2, '#FF8A8A');
  capsule(ctx, { x: x - 4, y: y - 9 }, { x: x + 2, y: y - 9 }, 1.5, 'rgba(255,255,255,0.7)');
  // колеса зі спицями
  for (const wx of [x - 26, x + 26]) {
    circle(ctx, wx, y + 6, 9, C.ink);
    circle(ctx, wx, y + 6, 4, '#9AA3BF');
    const a = t / 80;
    capsule(
      ctx,
      { x: wx + Math.cos(a) * 3, y: y + 6 + Math.sin(a) * 3 },
      { x: wx - Math.cos(a) * 3, y: y + 6 - Math.sin(a) * 3 },
      1.2,
      C.ink,
    );
  }
}

// ---------------------------------------------------------------- парк

export function drawPark(ctx: Ctx, now: Date, t: number): void {
  ctx.fillStyle = skyColor(now);
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  // пагорби
  ctx.fillStyle = '#CDEBDC';
  ctx.beginPath();
  ctx.ellipse(70, 150, 140, 46, 0, Math.PI, 0);
  ctx.ellipse(260, 152, 130, 40, 0, Math.PI, 0);
  ctx.fill();
  // дерева прокручуються, поки пара йде
  const shift = (t * 0.03) % 90;
  for (let i = -1; i < 5; i++) {
    const x = i * 90 - shift;
    rrect(ctx, x + 22, 108, 5, 46, 2.5, '#B08968');
    circle(ctx, x + 24, 96, 20, '#9AD1B5');
    circle(ctx, x + 12, 106, 12, '#8CCAA9');
  }
  // доріжка
  ctx.fillStyle = '#EFE7D6';
  ctx.fillRect(0, 154, SCENE_W, 46);
  ctx.fillStyle = '#E2D7C1';
  ctx.fillRect(0, 154, SCENE_W, 2);
  const dots = (t * 0.06) % 30;
  for (let x = -dots; x < SCENE_W; x += 30) circle(ctx, x, 186, 1.5, '#D6C9AE');
  // сонце/місяць
  circle(ctx, 280, 34, 10, timeOfDay(now.getHours()) === 'night' ? '#F2F0E6' : '#FFD66B');
}

// ---------------------------------------------------------------- кафе

export function drawCafe(ctx: Ctx, now: Date): void {
  base(ctx, '#F7F0EA', '#EADFD4');
  // вікно з видом на вулицю
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(212, 30, 84, 70, 10);
  ctx.fillStyle = skyColor(now);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(212, 30, 84, 70, 10);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 3;
  ctx.stroke();
  capsule(ctx, { x: 254, y: 30 }, { x: 254, y: 100 }, 2.5, C.white);
  // підвісні лампи
  for (const lx of [110, 210]) {
    capsule(ctx, { x: lx, y: 0 }, { x: lx, y: 22 }, 1.2, '#9AA3BF');
    ctx.beginPath();
    ctx.moveTo(lx - 10, 32);
    ctx.quadraticCurveTo(lx, 14, lx + 10, 32);
    ctx.closePath();
    ctx.fillStyle = '#2A2F45';
    ctx.fill();
    circle(ctx, lx, 33, 3, '#FFD66B');
  }
  // картина
  rrect(ctx, 28, 40, 52, 38, 4, C.white, C.line);
  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.moveTo(34, 72);
  ctx.lineTo(50, 52);
  ctx.lineTo(62, 66);
  ctx.lineTo(68, 60);
  ctx.lineTo(76, 72);
  ctx.closePath();
  ctx.fill();
  circle(ctx, 66, 50, 4, '#EC4899');
}

/** Стіл зі скатертиною перед парою: ховає ноги, тож здається, що вони сидять. */
export function drawCafeTable(ctx: Ctx, t: number): void {
  rrect(ctx, 100, 140, 120, 32, [6, 6, 2, 2], C.white, C.line);
  rrect(ctx, 100, 140, 120, 6, 3, '#F3E8E0');
  // тарілки
  for (const px of [134, 186]) {
    ctx.beginPath();
    ctx.ellipse(px, 141, 12, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.white;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    circle(ctx, px - 3, 139.5, 2.5, C.amber);
    circle(ctx, px + 3, 140, 2.2, C.leaf);
  }
  // свічка
  rrect(ctx, 158, 128, 5, 12, 1.5, C.white, C.line);
  ctx.save();
  ctx.translate(160.5, 125 + Math.sin(t / 140) * 0.6);
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.2, 3.6, Math.sin(t / 200) * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFB020';
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- embedded

/** Плата з мікроконтролером на домашньому столі: світлодіод блимає, поки йде прошивка. */
export function drawDevBoard(ctx: Ctx, t: number, active: boolean): void {
  rrect(ctx, 164, 139, 30, 8, 2, '#1F7A4D');
  rrect(ctx, 174, 140, 9, 6, 1, C.ink);
  for (let i = 0; i < 6; i++) rrect(ctx, 166 + i * 4.6, 139, 1.6, 1.6, 0.4, '#E5C07B');
  const on = active && Math.floor(t / 260) % 2 === 0;
  circle(ctx, 189, 142, 1.8, on ? '#22C55E' : '#14532D');
  if (on) circle(ctx, 189, 142, 4, 'rgba(34,197,94,0.25)');
  // кабель до ноутбука
  ctx.beginPath();
  ctx.moveTo(194, 143);
  ctx.quadraticCurveTo(200, 150, 206, 144);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

export { heart, FLOOR_Y };

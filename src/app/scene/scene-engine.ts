import { ActionKind, Spot } from '../game/quests';
import {
  drawDesk,
  drawHero,
  drawLaptop,
  drawMadeBed,
  drawNightTint,
  drawPlate,
  drawRoom,
  drawSleepingHero,
  drawSnore,
  drawSparkles,
  drawWater,
  FlatPose,
  FLOOR_Y,
  SCENE_H,
  SCENE_W,
  SPOT_X,
  STAND,
  timeOfDay,
} from './flat';

/** Скільки триває кожна анімація, мс. */
export const ACTION_DURATION: Record<ActionKind, number> = {
  wake: 3000,
  brush: 2800,
  wash: 2600,
  eat: 2800,
  type: 3000,
  study: 3000,
  jacks: 2700,
  sleep: 2600,
};

/** Частина «Прокинутись», поки герой ще лежить. */
const WAKE_IN_BED_MS = 1000;
/** Частина «Лягти спати», поки герой ще стоїть і позіхає. */
const SLEEP_STAND_MS = 1100;
const WALK_SPEED = 95; // одиниць сцени за секунду
const SPARKLE_MS = 900;

type Mode = 'sleep' | 'idle' | 'walk' | 'act';

export interface SceneFlags {
  /** Чи сніданок уже з'їдено сьогодні — тоді на столі лишається тарілка. */
  breakfastDone: boolean;
}

/**
 * Невеликий ігровий рушій: тримає стан героя, рухає його по кімнаті
 * й малює кадри на canvas через requestAnimationFrame.
 */
export class SceneEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private bgStamp = '';

  private mode: Mode = 'idle';
  private heroX: number = SPOT_X.bed;
  private walkTarget = 0;
  private walkDone?: () => void;
  private action: ActionKind | null = null;
  private actionStart = 0;
  private actionDone?: () => void;
  private wakeFromBed = false;
  private sparkleUntil = 0;
  private flags: SceneFlags = { breakfastDone: false };

  private raf = 0;
  private lastFrame = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступний');
    this.ctx = ctx;
    this.bg = document.createElement('canvas');
    this.resize();
  }

  get busy(): boolean {
    return this.mode === 'walk' || this.mode === 'act';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Малює один кадр без циклу (для першого рендеру й тестів). */
  renderOnce(now = performance.now()): void {
    this.render(now);
  }

  setSleeping(sleeping: boolean): void {
    if (this.busy) return;
    if (sleeping) {
      this.mode = 'sleep';
      this.heroX = SPOT_X.bed;
    } else if (this.mode === 'sleep') {
      this.mode = 'idle';
    }
  }

  setFlags(flags: Partial<SceneFlags>): void {
    this.flags = { ...this.flags, ...flags };
  }

  /** Програє дію: герой іде до потрібного місця, виконує її й повертається в очікування. */
  async play(action: ActionKind, spot: Spot): Promise<void> {
    if (action === 'wake') {
      if (this.mode === 'sleep') {
        this.wakeFromBed = true;
      } else {
        await this.walkTo(SPOT_X.bed);
        this.wakeFromBed = false;
      }
    } else {
      if (this.mode === 'sleep') {
        this.mode = 'idle';
        this.heroX = SPOT_X.bed;
      }
      await this.walkTo(SPOT_X[spot]);
    }
    await this.runAction(action);
    if (action !== 'sleep') this.sparkleUntil = performance.now() + SPARKLE_MS;
  }

  /** Герой повертається в ліжко й засинає (коли «Лягти спати» вже виконано). */
  async goToBed(): Promise<void> {
    if (this.mode === 'sleep') return;
    await this.walkTo(SPOT_X.bed);
    this.mode = 'sleep';
  }

  private walkTo(x: number): Promise<void> {
    if (Math.abs(this.heroX - x) < 0.5) {
      this.heroX = x;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.mode = 'walk';
      this.walkTarget = x;
      this.walkDone = resolve;
    });
  }

  private runAction(action: ActionKind): Promise<void> {
    return new Promise((resolve) => {
      if (action === 'wake') this.heroX = SPOT_X.bed;
      this.mode = 'act';
      this.action = action;
      this.actionStart = performance.now();
      this.actionDone = resolve;
    });
  }

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.mode === 'walk') {
      const dir = Math.sign(this.walkTarget - this.heroX);
      this.heroX += dir * WALK_SPEED * dt;
      if (
        (dir > 0 && this.heroX >= this.walkTarget) ||
        (dir < 0 && this.heroX <= this.walkTarget)
      ) {
        this.heroX = this.walkTarget;
        this.mode = 'idle';
        const done = this.walkDone;
        this.walkDone = undefined;
        done?.();
      }
    } else if (this.mode === 'act' && this.action) {
      if (now - this.actionStart >= ACTION_DURATION[this.action]) {
        this.mode = this.action === 'sleep' ? 'sleep' : 'idle';
        this.action = null;
        this.wakeFromBed = false;
        const done = this.actionDone;
        this.actionDone = undefined;
        done?.();
      }
    }

    this.render(now);
  }

  /** Підганяє роздільність полотна під його ширину на екрані й щільність пікселів. */
  private resize(): number {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssWidth = this.canvas.clientWidth || SCENE_W * 2;
    const width = Math.round(cssWidth * dpr);
    const height = Math.round((width * SCENE_H) / SCENE_W);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.bg.width = width;
      this.bg.height = height;
      this.bgStamp = '';
    }
    return width / SCENE_W;
  }

  private ensureBackground(scale: number): void {
    const now = this.clock();
    const stamp = `${now.getHours()}:${now.getMinutes()}:${this.bg.width}`;
    if (stamp === this.bgStamp) return;
    this.bgStamp = stamp;
    const bctx = this.bg.getContext('2d');
    if (!bctx) return;
    bctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawRoom(bctx, now);
  }

  private render(now: number): void {
    const scale = this.resize();
    this.ensureBackground(scale);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const elapsed = now - this.actionStart;
    const inBed =
      this.mode === 'sleep' ||
      (this.mode === 'act' &&
        this.action === 'wake' &&
        this.wakeFromBed &&
        elapsed < WAKE_IN_BED_MS) ||
      (this.mode === 'act' && this.action === 'sleep' && elapsed >= SLEEP_STAND_MS);

    if (inBed) {
      drawSleepingHero(ctx, now);
      if (this.mode === 'sleep' || this.action === 'sleep') {
        drawSnore(ctx, now);
      } else if (elapsed > WAKE_IN_BED_MS * 0.45) {
        ctx.fillStyle = '#3B5BFD';
        ctx.font = '800 16px Manrope, system-ui, sans-serif';
        ctx.fillText('!', 30, 112);
      }
    } else {
      drawMadeBed(ctx);
      drawHero(ctx, this.heroX, FLOOR_Y, this.pose(now, elapsed));
    }

    // передній план: стіл і те, що на ньому
    drawDesk(ctx);
    const acting = this.mode === 'act' ? this.action : null;
    drawLaptop(ctx, acting === 'type', now);
    if (acting === 'eat') drawPlate(ctx, true);
    else if (this.flags.breakfastDone) drawPlate(ctx, false);
    if (acting === 'wash') drawWater(ctx, now);

    const sparkleLeft = this.sparkleUntil - now;
    if (!inBed && sparkleLeft > 0) {
      drawSparkles(ctx, this.heroX, FLOOR_Y - 50, now, sparkleLeft / SPARKLE_MS);
    }

    if (timeOfDay(this.clock().getHours()) === 'night') drawNightTint(ctx);
  }

  private pose(now: number, elapsed: number): FlatPose {
    const wave = (ms: number) => Math.sin((elapsed / ms) * Math.PI * 2);

    if (this.mode === 'walk') {
      const s = Math.sin((now / 260) * Math.PI);
      return {
        handL: { x: 3 + s * 2, y: 25 - Math.abs(s) * 2 },
        handR: { x: 3 - s * 2, y: 25 - Math.abs(s) * 2 },
        footL: { x: 0, y: Math.max(0, s) * 4 },
        footR: { x: 0, y: Math.max(0, -s) * 4 },
        bob: Math.abs(s) * -1.5,
      };
    }

    if (this.mode === 'act' && this.action) {
      switch (this.action) {
        case 'wake': {
          const local = this.wakeFromBed ? elapsed - WAKE_IN_BED_MS : elapsed;
          const stretch = Math.max(0, Math.sin((local / 900) * Math.PI));
          return {
            ...STAND,
            handL: { x: 3 + stretch * 5, y: 26 - stretch * 50 },
            handR: { x: 3 + stretch * 5, y: 26 - stretch * 50 },
            eyes: stretch > 0.3 ? 'closed' : 'open',
            mouth: stretch > 0.3 ? 'open' : 'smile',
            lift: stretch * 1.5,
          };
        }
        case 'brush':
          return {
            ...STAND,
            handR: { x: -9 + wave(220) * 2.5, y: -9 },
            eyes: Math.floor(elapsed / 1200) % 2 ? 'closed' : 'open',
            mouth: 'none',
            props: ['brush', 'foam'],
          };
        case 'wash': {
          const w = wave(420);
          return {
            ...STAND,
            handL: { x: -7, y: -12 + w * 2.5 },
            handR: { x: -7, y: -12 + w * 2.5 },
            eyes: 'closed',
            mouth: 'none',
            bob: 1 + w,
            props: ['drops'],
          };
        }
        case 'eat': {
          const bite = Math.floor(elapsed / 650) % 2 === 0;
          return {
            ...STAND,
            handR: bite ? { x: -9, y: -9 } : { x: 1, y: 14 },
            mouth: bite ? 'none' : 'open',
            props: ['sandwich'],
          };
        }
        case 'type': {
          const tap = Math.floor(elapsed / 130) % 2;
          return {
            ...STAND,
            handL: { x: -18, y: 19 + tap * 2 },
            handR: { x: 18, y: 21 - tap * 2 },
            mouth: 'none',
          };
        }
        case 'study':
          return {
            ...STAND,
            handL: { x: -4, y: 13 },
            handR: { x: -4, y: 13 },
            headDown: 2 + wave(1800),
            mouth: 'none',
            props: ['book'],
          };
        case 'jacks': {
          const up = Math.max(0, Math.sin((elapsed / 600) * Math.PI * 2));
          return {
            handL: { x: 3 + up * 9, y: 26 - up * 50 },
            handR: { x: 3 + up * 9, y: 26 - up * 50 },
            footL: { x: up * 9, y: 0 },
            footR: { x: up * 9, y: 0 },
            lift: up * 4,
            mouth: 'open',
          };
        }
        case 'sleep': {
          const yawn = Math.max(0, Math.sin((elapsed / 1100) * Math.PI));
          return {
            ...STAND,
            handL: { x: 3 + yawn * 4, y: 26 - yawn * 46 },
            eyes: yawn > 0.4 ? 'closed' : 'open',
            mouth: yawn > 0.4 ? 'open' : 'none',
          };
        }
      }
    }

    // очікування: дихає й моргає
    return {
      ...STAND,
      bob: (Math.sin(now / 700) + 1) * 0.6,
      eyes: now % 3600 < 140 ? 'closed' : 'open',
    };
  }
}

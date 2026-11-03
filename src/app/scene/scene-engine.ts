import { ActionKind, Spot } from '../game/quests';
import {
  drawBlanket,
  drawBook,
  drawDesk,
  drawLaptop,
  drawNightTint,
  drawPlate,
  drawRoomBackground,
  drawSnore,
  drawSparkles,
  drawWater,
  HERO_Y,
  SCENE_H,
  SCENE_W,
  SPOT_X,
  timeOfDay,
} from './room';
import { drawGrid, drawHero, FACE, IDLE_POSE, Pose, PROPS, SLEEP_HEAD } from './sprites';

/** Скільки триває кожна анімація, мс. */
export const ACTION_DURATION: Record<ActionKind, number> = {
  wake: 3000,
  brush: 2800,
  wash: 2600,
  eat: 2800,
  type: 3000,
  study: 3000,
  jacks: 2700,
};

/** Частина анімації «Прокинутись», поки герой ще лежить. */
const WAKE_IN_BED_MS = 1000;
const WALK_SPEED = 28; // пікселів сцени за секунду
const SPARKLE_MS = 800;

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
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступний');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.bg = document.createElement('canvas');
    this.bg.width = SCENE_W;
    this.bg.height = SCENE_H;
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
    this.sparkleUntil = performance.now() + SPARKLE_MS;
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
        this.mode = 'idle';
        this.action = null;
        this.wakeFromBed = false;
        const done = this.actionDone;
        this.actionDone = undefined;
        done?.();
      }
    }

    this.render(now);
  }

  private ensureBackground(): void {
    const now = this.clock();
    const stamp = `${now.getHours()}:${now.getMinutes()}`;
    if (stamp === this.bgStamp) return;
    this.bgStamp = stamp;
    const bctx = this.bg.getContext('2d');
    if (!bctx) return;
    bctx.imageSmoothingEnabled = false;
    drawRoomBackground(bctx, now);
  }

  private render(now: number): void {
    const ctx = this.ctx;
    this.ensureBackground();
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    ctx.drawImage(this.bg, 0, 0);

    const elapsed = now - this.actionStart;
    const inBed =
      this.mode === 'sleep' ||
      (this.mode === 'act' &&
        this.action === 'wake' &&
        this.wakeFromBed &&
        elapsed < WAKE_IN_BED_MS);

    if (inBed) {
      drawGrid(ctx, SLEEP_HEAD, 4, 36);
      drawBlanket(ctx, true);
      if (this.mode === 'sleep') {
        drawSnore(ctx, now);
      } else if (elapsed > WAKE_IN_BED_MS * 0.45) {
        // прокинувся: «!» над головою
        ctx.fillStyle = '#ffcc33';
        ctx.fillRect(8, 29, 1, 3);
        ctx.fillRect(8, 33, 1, 1);
      }
    } else {
      drawBlanket(ctx, false);
    }

    if (!inBed) {
      const x = Math.round(this.heroX);
      const pose = this.pose(now, elapsed);
      drawHero(ctx, x, HERO_Y, pose);
    }

    // передній план: стіл і те, що на ньому
    drawDesk(ctx);
    const acting = this.mode === 'act' ? this.action : null;
    drawLaptop(ctx, acting === 'type', now);
    if (acting === 'eat') drawPlate(ctx, true);
    else if (this.flags.breakfastDone) drawPlate(ctx, false);
    if (acting === 'study') drawBook(ctx, Math.floor(elapsed / 600) % 2 === 1);
    if (acting === 'wash') drawWater(ctx, now);

    if (!inBed && now < this.sparkleUntil) {
      drawSparkles(ctx, Math.round(this.heroX), HERO_Y, now);
    }

    if (timeOfDay(this.clock().getHours()) === 'night') drawNightTint(ctx);
  }

  private pose(now: number, elapsed: number): Pose {
    if (this.mode === 'walk') {
      const step = Math.floor(now / 130) % 2;
      return { ...IDLE_POSE, legs: step ? 'walkA' : 'walkB' };
    }

    if (this.mode === 'act' && this.action) {
      const beat = (ms: number) => Math.floor(elapsed / ms) % 2 === 1;
      switch (this.action) {
        case 'wake': {
          const local = this.wakeFromBed ? elapsed - WAKE_IN_BED_MS : elapsed;
          const up = Math.floor(local / 450) % 2 === 0;
          return up
            ? { legs: 'stand', armL: 'up', armR: 'up', face: FACE.yawn }
            : { ...IDLE_POSE, face: FACE.blink };
        }
        case 'brush':
          return {
            legs: 'stand',
            armL: 'down',
            armR: 'mouth',
            props: beat(180) ? PROPS.brushB : PROPS.brushA,
            face: beat(1200) ? FACE.blink : undefined,
          };
        case 'wash':
          return {
            legs: 'stand',
            armL: 'face',
            armR: 'face',
            face: FACE.blink,
            props: beat(200) ? PROPS.dropsB : PROPS.dropsA,
            dy: beat(400) ? 1 : 0,
          };
        case 'eat':
          return beat(420)
            ? {
                legs: 'stand',
                armL: 'down',
                armR: 'type',
                props: PROPS.sandwichHold,
                face: FACE.chew,
              }
            : { legs: 'stand', armL: 'down', armR: 'mouth', props: PROPS.sandwichMouth };
        case 'type': {
          const left = beat(120);
          return { legs: 'stand', armL: left ? 'type' : 'down', armR: left ? 'down' : 'type' };
        }
        case 'study':
          return {
            legs: 'stand',
            armL: 'type',
            armR: 'type',
            face: FACE.lookDown,
            dy: beat(900) ? 1 : 0,
          };
        case 'jacks':
          return beat(300)
            ? { legs: 'jack', armL: 'up', armR: 'up', lift: 1 }
            : { legs: 'stand', armL: 'down', armR: 'down' };
      }
    }

    // очікування: дихає й моргає
    const blink = now % 3200 < 140;
    return {
      ...IDLE_POSE,
      face: blink ? FACE.blink : undefined,
      dy: Math.floor(now / 700) % 2,
    };
  }
}

import { Activity, ActivityAction, LocationId, PLACE_LABELS, PlaceId } from '../game/activities';
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
  GIRL_LOOK,
  SCENE_H,
  SCENE_W,
  SPOT_X,
  STAND,
  timeOfDay,
} from './flat';
import {
  drawCafe,
  drawCafeTable,
  drawCar,
  drawDevBoard,
  drawGym,
  drawHearts,
  drawOffice,
  drawOfficeDesk,
  drawPark,
  drawRoad,
} from './locations';

/** Скільки триває кожна анімація щоденних справ, мс. */
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

/** Скільки триває кожна анімація активностей, мс. */
export const ACTIVITY_DURATION: Record<ActivityAction, number> = {
  embedded: 3200,
  drive: 3600,
  type: 3000,
  lift: 3200,
  'date-walk': 3800,
  'date-dinner': 3600,
};

/** Частина «Прокинутись», поки герой ще лежить. */
const WAKE_IN_BED_MS = 1000;
/** Частина «Лягти спати», поки герой ще стоїть і позіхає. */
const SLEEP_STAND_MS = 1100;
const WALK_SPEED = 95; // одиниць сцени за секунду
const SPARKLE_MS = 900;
const FADE_MS = 380;
/** Звідки герой заходить у нову локацію. */
const ENTRY_X = 24;
/** Де герой стоїть у кожній локації. */
const STAND_X: Record<LocationId, number> = {
  home: SPOT_X.bed,
  office: 171,
  gym: 165,
  road: 150,
  park: 140,
  cafe: 132,
};
const GIRL_X: Partial<Record<LocationId, number>> = { park: 174, cafe: 188 };

type Mode = 'sleep' | 'idle' | 'walk' | 'act';

export interface SceneFlags {
  /** Чи сніданок уже з'їдено сьогодні — тоді на столі лишається тарілка. */
  breakfastDone: boolean;
}

/**
 * Невеликий ігровий рушій: тримає стан героя, рухає його між локаціями
 * й малює кадри на canvas через requestAnimationFrame.
 */
export class SceneEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private bgStamp = '';

  private mode: Mode = 'idle';
  private loc: LocationId = 'home';
  private heroX: number = SPOT_X.bed;
  private walkTarget = 0;
  private walkDone?: () => void;
  private action: ActionKind | null = null;
  private activity: ActivityAction | null = null;
  private driveTo: PlaceId = 'office';
  private actionStart = 0;
  private actionDone?: () => void;
  private wakeFromBed = false;
  private sparkleUntil = 0;
  private fadeStart = -1e9;
  /** Час, що минув у русі (для прокручування фону дороги й парку). */
  private scroll = 0;
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
      this.switchTo('home', false);
      this.mode = 'sleep';
      this.heroX = SPOT_X.bed;
    } else if (this.mode === 'sleep') {
      this.mode = 'idle';
    }
  }

  /** Миттєво переносить героя (напр. після відкриття гри або визначення місця за GPS). */
  setLocation(location: LocationId): void {
    if (this.busy || location === this.loc || location === 'road') return;
    if (this.mode === 'sleep' && location !== 'home') this.mode = 'idle';
    this.switchTo(location, true);
    this.heroX = STAND_X[location];
  }

  setFlags(flags: Partial<SceneFlags>): void {
    this.flags = { ...this.flags, ...flags };
  }

  /** Щоденна справа вдома: герой іде до потрібного місця, виконує її й повертається в очікування. */
  async play(action: ActionKind, spot: Spot): Promise<void> {
    if (this.loc !== 'home') {
      this.switchTo('home', true);
      this.heroX = SPOT_X.bed;
    }
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
    await this.run(() => {
      if (action === 'wake') this.heroX = SPOT_X.bed;
      this.action = action;
    });
    if (action !== 'sleep') this.sparkleUntil = performance.now() + SPARKLE_MS;
  }

  /** Активність: поїздка, офіс, зал, побачення, embedded. */
  async playActivity(activity: Activity): Promise<void> {
    if (this.mode === 'sleep') {
      this.mode = 'idle';
      this.heroX = SPOT_X.bed;
    }
    const { location, action } = activity;
    if (action === 'drive' && activity.to) {
      this.driveTo = activity.to;
      this.switchTo('road', true);
      await this.run(() => (this.activity = action));
      this.switchTo(activity.to, true);
      this.heroX = activity.to === 'home' ? SPOT_X.desk + 60 : ENTRY_X;
      await this.walkTo(STAND_X[activity.to]);
    } else if (location === 'home') {
      if (this.loc !== 'home') {
        this.switchTo('home', true);
        this.heroX = SPOT_X.bed;
      }
      await this.walkTo(SPOT_X.desk);
      await this.run(() => (this.activity = action));
    } else if (location === 'office' || location === 'gym') {
      if (this.loc !== location) {
        this.switchTo(location, true);
        this.heroX = ENTRY_X;
      }
      await this.walkTo(STAND_X[location]);
      await this.run(() => (this.activity = action));
    } else {
      this.switchTo(location, true);
      this.heroX = STAND_X[location];
      await this.run(() => (this.activity = action));
    }
    this.sparkleUntil = performance.now() + SPARKLE_MS;
  }

  /** Герой повертається в ліжко й засинає (коли «Лягти спати» вже виконано). */
  async goToBed(): Promise<void> {
    if (this.mode === 'sleep') return;
    if (this.loc !== 'home') {
      this.switchTo('home', true);
      this.heroX = SPOT_X.desk;
    }
    await this.walkTo(SPOT_X.bed);
    this.mode = 'sleep';
  }

  private switchTo(location: LocationId, fade: boolean): void {
    if (location === this.loc) return;
    this.loc = location;
    this.bgStamp = '';
    if (fade) this.fadeStart = performance.now();
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

  private run(setup: () => void): Promise<void> {
    return new Promise((resolve) => {
      this.action = null;
      this.activity = null;
      setup();
      this.mode = 'act';
      this.actionStart = performance.now();
      this.actionDone = resolve;
    });
  }

  private duration(): number {
    if (this.activity) return ACTIVITY_DURATION[this.activity];
    return this.action ? ACTION_DURATION[this.action] : 0;
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
    } else if (this.mode === 'act') {
      if (this.activity === 'drive' || this.activity === 'date-walk') this.scroll += dt * 1000;
      if (now - this.actionStart >= this.duration()) {
        this.mode = this.action === 'sleep' ? 'sleep' : 'idle';
        this.action = null;
        this.activity = null;
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

  /** Нерухомі фони кешуються в окремому полотні й оновлюються раз на хвилину. */
  private drawStaticBackground(scale: number): void {
    const now = this.clock();
    const stamp = `${this.loc}:${now.getHours()}:${now.getMinutes()}:${this.bg.width}`;
    if (stamp !== this.bgStamp) {
      this.bgStamp = stamp;
      const bctx = this.bg.getContext('2d');
      if (bctx) {
        bctx.setTransform(scale, 0, 0, scale, 0, 0);
        if (this.loc === 'office') drawOffice(bctx, now);
        else if (this.loc === 'gym') drawGym(bctx);
        else if (this.loc === 'cafe') drawCafe(bctx, now);
        else drawRoom(bctx, now);
      }
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.bg, 0, 0);
  }

  private render(now: number): void {
    const scale = this.resize();
    const ctx = this.ctx;
    const elapsed = now - this.actionStart;
    const date = this.clock();
    const animated = this.loc === 'road' || this.loc === 'park';

    if (!animated) this.drawStaticBackground(scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    switch (this.loc) {
      case 'road':
        drawRoad(ctx, date, this.scroll, PLACE_LABELS[this.driveTo]);
        drawCar(ctx, 140 + Math.sin(now / 1400) * 6, this.mode === 'act' ? now : 0);
        break;
      case 'park': {
        drawPark(ctx, date, this.scroll);
        this.drawCouple(now, elapsed);
        if (this.activity === 'date-walk') drawHearts(ctx, 157, 70, now);
        break;
      }
      case 'cafe':
        this.drawCouple(now, elapsed);
        drawCafeTable(ctx, now);
        if (this.activity === 'date-dinner') drawHearts(ctx, 160, 92, now);
        break;
      case 'office':
        drawHero(ctx, this.heroX, FLOOR_Y, this.pose(now, elapsed));
        drawOfficeDesk(ctx, this.activity === 'type', now);
        break;
      case 'gym':
        drawHero(ctx, this.heroX, FLOOR_Y, this.pose(now, elapsed));
        break;
      default:
        this.renderHome(now, elapsed);
    }

    const sparkleLeft = this.sparkleUntil - now;
    if (sparkleLeft > 0 && this.mode !== 'sleep' && this.loc !== 'road') {
      drawSparkles(ctx, this.heroX, FLOOR_Y - 50, now, sparkleLeft / SPARKLE_MS);
    }
    if (timeOfDay(date.getHours()) === 'night') drawNightTint(ctx);

    const fade = 1 - (now - this.fadeStart) / FADE_MS;
    if (fade > 0) {
      ctx.fillStyle = `rgba(245, 246, 248, ${fade.toFixed(3)})`;
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    }
  }

  private renderHome(now: number, elapsed: number): void {
    const ctx = this.ctx;
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

    drawDesk(ctx);
    const acting = this.mode === 'act' ? this.action : null;
    const embedded = this.mode === 'act' && this.activity === 'embedded';
    drawLaptop(ctx, acting === 'type' || embedded, now);
    if (embedded) drawDevBoard(ctx, now, true);
    else if (acting === 'eat') drawPlate(ctx, true);
    else if (this.flags.breakfastDone) drawPlate(ctx, false);
    if (acting === 'wash') drawWater(ctx, now);
  }

  /** Герой і дівчина поруч: у парку йдуть за руку, у кафе вечеряють. */
  private drawCouple(now: number, elapsed: number): void {
    const girlX = GIRL_X[this.loc] ?? this.heroX + 34;
    const acting = this.mode === 'act';
    let hero: FlatPose;
    let girl: FlatPose;
    if (this.loc === 'park') {
      const s = acting ? Math.sin((now / 300) * Math.PI) : 0;
      const legs = (phase: number) => ({
        footL: { x: 0, y: Math.max(0, phase) * 4 },
        footR: { x: 0, y: Math.max(0, -phase) * 4 },
      });
      hero = { ...STAND, ...legs(s), handR: { x: 5, y: 22 }, handL: { x: 3 + s * 2, y: 25 } };
      girl = { ...STAND, ...legs(-s), handL: { x: 5, y: 22 }, handR: { x: 3 - s * 2, y: 25 } };
      if (acting) {
        hero.bob = Math.abs(s) * -1.2;
        girl.bob = Math.abs(s) * -1.2;
      }
    } else {
      const atTable = { x: -4, y: 17 };
      const toMouth = { x: -9, y: -9 };
      const heroBite = acting && Math.floor(elapsed / 900) % 2 === 1;
      const girlBite = acting && Math.floor((elapsed + 450) / 900) % 2 === 1;
      hero = {
        ...STAND,
        handL: atTable,
        handR: heroBite ? toMouth : atTable,
        mouth: heroBite ? 'none' : 'smile',
      };
      girl = {
        ...STAND,
        handR: atTable,
        handL: girlBite ? toMouth : atTable,
        mouth: girlBite ? 'none' : 'smile',
      };
    }
    girl.eyes = now % 4100 < 140 ? 'closed' : 'open';
    hero.eyes = now % 3600 < 140 ? 'closed' : 'open';
    drawHero(this.ctx, this.heroX, FLOOR_Y, hero);
    drawHero(this.ctx, girlX, FLOOR_Y, girl, GIRL_LOOK);
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

    if (this.mode === 'act' && this.activity) {
      switch (this.activity) {
        case 'embedded': {
          const tap = Math.floor(elapsed / 220) % 2;
          return {
            ...STAND,
            handL: { x: -6, y: 19 + tap },
            handR: { x: -6, y: 20 - tap },
            headDown: 2,
            mouth: 'none',
          };
        }
        case 'type': {
          const tap = Math.floor(elapsed / 130) % 2;
          return {
            ...STAND,
            handL: { x: -5, y: 17 + tap * 1.5 },
            handR: { x: -5, y: 18.5 - tap * 1.5 },
            mouth: 'none',
          };
        }
        case 'lift': {
          const up = Math.max(0, Math.sin((elapsed / 800) * Math.PI * 2));
          return {
            ...STAND,
            handL: { x: 7 + up * 4, y: 4 - up * 26 },
            handR: { x: 7 + up * 4, y: 4 - up * 26 },
            mouth: up > 0.6 ? 'open' : 'none',
            eyes: up > 0.8 ? 'closed' : 'open',
            props: ['dumbbells'],
          };
        }
        default:
          break;
      }
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

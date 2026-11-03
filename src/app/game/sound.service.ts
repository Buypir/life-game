import { Injectable } from '@angular/core';

type Tone = readonly [frequency: number, durationMs: number];

const MELODIES = {
  complete: [
    [523, 70],
    [784, 110],
  ],
  quest: [
    [523, 80],
    [659, 80],
    [784, 80],
    [1047, 160],
  ],
  level: [
    [392, 90],
    [523, 90],
    [659, 90],
    [784, 90],
    [1047, 90],
    [1319, 220],
  ],
  undo: [
    [330, 80],
    [247, 120],
  ],
  tap: [[660, 35]],
} satisfies Record<string, readonly Tone[]>;

export type Melody = keyof typeof MELODIES;

/** 8-бітні звуки через Web Audio. Контекст створюється лише після дотику (вимога iOS). */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private ctx: AudioContext | null = null;

  play(melody: Melody): void {
    const ctx = this.context();
    if (!ctx) return;
    let at = ctx.currentTime + 0.01;
    for (const [freq, ms] of MELODIES[melody]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, at);
      const dur = ms / 1000;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      at += dur;
    }
  }

  private context(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }
}

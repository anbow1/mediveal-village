// Stage 6 Positional Web Audio Engine (BRIEF.md F18):
// - Physical 343 m/s speed-of-sound delay (`distM / 343`), distance rolloff & stereo panning
// - Zero-click scheduling (gains initialized to 0 before delayed ramp/start)
// - Pre-baked procedural medieval AudioBuffers (zero extra download weight, zero mid-play allocations)
// - Continuous meadow wind & forest birdsong (< 80 m from mature trees), cleanly muted when paused!

import type { FxEvent } from '../sim/types.ts';

export type SoundKind =
  | 'swordClash'
  | 'arrowFire'
  | 'crossbowFire'
  | 'gunshot'
  | 'cannonFire'
  | 'mortarFire'
  | 'impact'
  | 'horn'
  | 'hammer'
  | 'chop'
  | 'uiClick'
  | 'uiError';

const SPEED_OF_SOUND_MS = 343;
const STORAGE_KEY_VOLUME = 'marchland.volume.v1';

/** 23 real medieval MP3 sound effects imported from anbow1/FPS (marchland/public/sounds/). */
const MP3_CLIP_POOLS: Partial<Record<SoundKind, readonly string[]>> = {
  swordClash: [
    'assets/marchland/sounds/impact_metal_light_000.mp3',
    'assets/marchland/sounds/impact_metal_light_001.mp3',
    'assets/marchland/sounds/impact_metal_medium_000.mp3',
    'assets/marchland/sounds/impact_metal_medium_001.mp3',
    'assets/marchland/sounds/impact_metal_medium_002.mp3',
    'assets/marchland/sounds/impact_plate_medium_000.mp3',
    'assets/marchland/sounds/impact_plate_medium_001.mp3',
    'assets/marchland/sounds/impact_plate_heavy_000.mp3',
    'assets/marchland/sounds/rpg_knife_slice.mp3',
    'assets/marchland/sounds/rpg_knife_slice_2.mp3',
  ],
  impact: [
    'assets/marchland/sounds/impact_punch_heavy_000.mp3',
    'assets/marchland/sounds/impact_punch_medium_000.mp3',
    'assets/marchland/sounds/impact_punch_medium_001.mp3',
    'assets/marchland/sounds/impact_soft_heavy_000.mp3',
    'assets/marchland/sounds/impact_soft_heavy_001.mp3',
    'assets/marchland/sounds/impact_soft_medium_000.mp3',
    'assets/marchland/sounds/impact_soft_medium_001.mp3',
  ],
  hammer: [
    'assets/marchland/sounds/impact_mining_000.mp3',
    'assets/marchland/sounds/impact_mining_001.mp3',
    'assets/marchland/sounds/impact_mining_002.mp3',
  ],
  chop: ['assets/marchland/sounds/rpg_chop.mp3'],
  uiClick: [
    'assets/marchland/sounds/rpg_metal_click.mp3',
    'assets/marchland/sounds/rpg_metal_latch.mp3',
  ],
};

/** Deterministic small PRNG for reproducible procedural AudioBuffer baking. */
function makeBufferRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function bakeProceduralBuffer(ctx: AudioContext, kind: SoundKind): AudioBuffer {
  const sr = ctx.sampleRate;
  const durMap: Record<SoundKind, number> = {
    swordClash: 0.28,
    arrowFire: 0.16,
    crossbowFire: 0.12,
    gunshot: 0.32,
    cannonFire: 0.95,
    mortarFire: 0.72,
    impact: 0.42,
    horn: 0.95,
    hammer: 0.14,
    chop: 0.18,
    uiClick: 0.06,
    uiError: 0.16,
  };
  const dur = durMap[kind];
  const len = Math.max(64, Math.floor(sr * dur));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const rand = makeBufferRng(kind.charCodeAt(0) * 997 + len);

  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const u = i / len;
    const n = rand();
    let sample = 0;

    switch (kind) {
      case 'swordClash': {
        const env = Math.exp(-t * 16);
        const ring =
          Math.sin(2 * Math.PI * 2240 * t) * 0.45 +
          Math.sin(2 * Math.PI * 3610 * t) * 0.35 +
          Math.sin(2 * Math.PI * 5180 * t) * 0.2;
        sample = (ring * 0.65 + n * 0.35 * Math.exp(-t * 34)) * env;
        break;
      }
      case 'arrowFire': {
        const twang = Math.sin(2 * Math.PI * (240 - 70 * u) * t) * Math.exp(-t * 22);
        const whoosh = n * Math.sin(Math.PI * u) * 0.35;
        sample = twang * 0.55 + whoosh * 0.45;
        break;
      }
      case 'crossbowFire': {
        const snap = (n * 0.7 + Math.sin(2 * Math.PI * 620 * t) * 0.3) * Math.exp(-t * 36);
        sample = snap * 0.85;
        break;
      }
      case 'gunshot': {
        lp = lp * 0.72 + n * 0.28;
        const crack = n * Math.exp(-t * 28) * 0.75;
        const thump = Math.sin(2 * Math.PI * (145 * Math.exp(-t * 9)) * t) * Math.exp(-t * 14) * 0.55;
        sample = crack + lp * Math.exp(-t * 9) * 0.4 + thump;
        break;
      }
      case 'cannonFire': {
        lp = lp * 0.92 + n * 0.08;
        const boom = Math.sin(2 * Math.PI * (78 * Math.exp(-t * 3.8) + 28) * t) * Math.exp(-t * 4.2);
        const blast = lp * Math.exp(-t * 3.1) * 1.45;
        const muzzle = n * Math.exp(-t * 18) * 0.5;
        sample = Math.tanh((boom * 0.95 + blast + muzzle) * 1.15);
        break;
      }
      case 'mortarFire': {
        lp = lp * 0.88 + n * 0.12;
        const hollow = Math.sin(2 * Math.PI * (112 * Math.exp(-t * 4.5) + 42) * t) * Math.exp(-t * 5.6);
        sample = Math.tanh(hollow * 0.85 + lp * Math.exp(-t * 4.8) * 0.9);
        break;
      }
      case 'impact': {
        lp = lp * 0.84 + n * 0.16;
        const thud = Math.sin(2 * Math.PI * (95 * Math.exp(-t * 8)) * t) * Math.exp(-t * 9);
        sample = (lp * 0.95 + thud * 0.65) * Math.exp(-t * 6.5);
        break;
      }
      case 'horn': {
        const env = Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.55) * 4.5);
        const f = 196 * (1 + 0.008 * Math.sin(2 * Math.PI * 5.2 * t));
        const brass =
          Math.sin(2 * Math.PI * f * t) * 0.5 +
          Math.sin(2 * Math.PI * f * 2 * t) * 0.32 +
          Math.sin(2 * Math.PI * f * 3 * t) * 0.18 +
          Math.sin(2 * Math.PI * f * 4 * t) * 0.08;
        sample = Math.tanh(brass * 1.25) * env * 0.55;
        break;
      }
      case 'hammer': {
        const knock = Math.sin(2 * Math.PI * 310 * t) * 0.5 + n * 0.5;
        sample = knock * Math.exp(-t * 34) * 0.7;
        break;
      }
      case 'chop': {
        lp = lp * 0.65 + n * 0.35;
        const wood = Math.sin(2 * Math.PI * 185 * t) * 0.45 + lp * 0.65;
        sample = wood * Math.exp(-t * 24) * 0.75;
        break;
      }
      case 'uiClick': {
        sample = (Math.sin(2 * Math.PI * 820 * t) * 0.4 + n * 0.25) * Math.exp(-t * 68) * 0.5;
        break;
      }
      case 'uiError': {
        sample = (Math.sin(2 * Math.PI * 160 * t) * 0.55 + Math.sin(2 * Math.PI * 124 * t) * 0.35) * Math.exp(-t * 16) * 0.55;
        break;
      }
    }
    out[i] = Math.max(-0.98, Math.min(0.98, sample));
  }
  return buf;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private buffers = new Map<SoundKind, AudioBuffer>();
  private clipPools = new Map<SoundKind, AudioBuffer[]>();
  private volume = 0.65;
  private muted = false;
  private paused = false;
  private birdCooldownS = 2.5;
  private activeVoices = 0;
  private lastEventS = new Map<SoundKind, number>();

  constructor() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (saved !== null) {
        const v = Number(saved);
        if (Number.isFinite(v)) this.volume = Math.max(0, Math.min(1, v));
      }
    } catch {
      // Ignore storage failures in sandboxed contexts
    }
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(vol01: number): void {
    this.volume = Math.max(0, Math.min(1, vol01));
    try {
      localStorage.setItem(STORAGE_KEY_VOLUME, String(this.volume));
    } catch {
      // ignore
    }
    this.syncMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncMasterGain();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncMasterGain();
  }

  private syncMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const target = this.muted ? 0 : this.volume;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.04);

    if (this.windGain) {
      const windTarget = this.paused || this.muted ? 0 : 0.085;
      this.windGain.gain.cancelScheduledValues(now);
      this.windGain.gain.setTargetAtTime(windTarget, now, 0.08);
    }
  }

  /** Lazily initializes AudioContext + pre-baked buffers on first user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);
      this.masterGain = master;

      const kinds: readonly SoundKind[] = [
        'swordClash',
        'arrowFire',
        'crossbowFire',
        'gunshot',
        'cannonFire',
        'mortarFire',
        'impact',
        'horn',
        'hammer',
        'chop',
        'uiClick',
        'uiError',
      ];
      for (const k of kinds) {
        this.buffers.set(k, bakeProceduralBuffer(ctx, k));
      }
      this.loadMp3Pools(ctx);

      // Continuous looping filtered meadow wind bed (initialized at gain 0 to avoid pop)
      const windLen = Math.floor(ctx.sampleRate * 3.0);
      const windBuf = ctx.createBuffer(1, windLen, ctx.sampleRate);
      const wd = windBuf.getChannelData(0);
      const rand = makeBufferRng(4242);
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < windLen; i++) {
        const w = rand();
        b0 = 0.96 * b0 + w * 0.04;
        b1 = 0.85 * b1 + b0 * 0.15;
        // Seamless crossfade edges
        const fade = Math.min(1, i / 1200, (windLen - 1 - i) / 1200);
        wd[i] = b1 * 2.2 * fade;
      }
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = windBuf;
      windSrc.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 340;
      filter.Q.value = 0.9;

      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSrc.connect(filter);
      filter.connect(windGain);
      windGain.connect(master);
      windSrc.start();
      this.windGain = windGain;
      this.syncMasterGain();
    } catch {
      this.ctx = null;
    }
  }

  private loadMp3Pools(ctx: AudioContext): void {
    for (const [kind, urls] of Object.entries(MP3_CLIP_POOLS) as [SoundKind, readonly string[]][]) {
      const list: AudioBuffer[] = [];
      this.clipPools.set(kind, list);
      for (const url of urls) {
        void fetch(url)
          .then((res) => (res.ok ? res.arrayBuffer() : null))
          .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
          .then((decoded) => {
            if (decoded) list.push(decoded);
          })
          .catch(() => {
            // Keep procedural fallback if offline/missing
          });
      }
    }
  }

  private pickBuffer(kind: SoundKind): AudioBuffer | undefined {
    const pool = this.clipPools.get(kind);
    if (pool && pool.length > 0) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return this.buffers.get(kind);
  }

  /** Plays a non-positional UI cue immediately (works even during Active Pause). */
  playUi(kind: 'uiClick' | 'uiError' | 'horn'): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const buf = this.pickBuffer(kind);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = kind === 'horn' ? 0.36 : 0.42;
    src.connect(g);
    g.connect(this.masterGain);
    src.start();
  }

  /**
   * Plays a positional 3D world sound with physical `343 m/s` speed-of-sound delay,
   * distance attenuation, and stereo panning relative to the camera!
   */
  playWorld(
    kind: SoundKind,
    wx: number,
    wz: number,
    camX: number,
    camY: number,
    camZ: number,
    camRightX: number,
    camRightZ: number,
    gainMul = 1.0,
  ): void {
    if (!this.ctx || !this.masterGain || this.muted || this.paused || this.ctx.state !== 'running') return;
    if (this.activeVoices >= 18) return;

    const now = this.ctx.currentTime;
    const minSpacing = kind === 'swordClash' || kind === 'arrowFire' ? 0.08 : 0.04;
    if (now - (this.lastEventS.get(kind) ?? -99) < minSpacing) return;
    this.lastEventS.set(kind, now);

    const dx = wx - camX;
    const dy = -camY;
    const dz = wz - camZ;
    const dist = Math.hypot(dx, dy, dz);
    const maxAudibleM = kind === 'cannonFire' || kind === 'mortarFire' || kind === 'horn' ? 320 : 185;
    if (dist > maxAudibleM) return;

    const buf = this.pickBuffer(kind);
    if (!buf) return;

    // Physical speed-of-sound propagation delay (dist / 343 s)
    const delayS = Math.min(1.0, dist / SPEED_OF_SOUND_MS);
    const startAt = now + delayS;

    // Smooth inverse-distance rolloff
    const refDist = kind === 'cannonFire' || kind === 'mortarFire' ? 42 : 24;
    const atten = (refDist / (refDist + dist)) * (1 - dist / maxAudibleM);
    const finalGain = Math.max(0.001, Math.min(0.85, atten * gainMul * 0.72));

    // Stereo horizontal panning based on camera right vector
    const invHoriz = 1 / Math.max(1, Math.hypot(dx, dz));
    const panVal = Math.max(-0.85, Math.min(0.85, (dx * camRightX + dz * camRightZ) * invHoriz));

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Slight organic pitch variation (0.94..1.06)
    src.playbackRate.value = 0.94 + ((Math.abs(Math.sin(wx * 12.9 + wz * 7.1)) * 1000) % 1) * 0.12;

    const gain = this.ctx.createGain();
    // Initialize to 0 before delayed start so there is NEVER a click/pop!
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(finalGain, startAt);

    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(panVal, now);
      src.connect(gain);
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      src.connect(gain);
      gain.connect(this.masterGain);
    }

    this.activeVoices++;
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(startAt);
  }

  /** Plays a batch of simulation FX events from `SimEngine.drainFxEvents()`. */
  playSimEvents(
    events: readonly FxEvent[],
    camX: number,
    camY: number,
    camZ: number,
    camRightX: number,
    camRightZ: number,
  ): void {
    for (const ev of events) {
      let kind: SoundKind | null = null;
      let gain = 1.0;
      switch (ev.kind) {
        case 'swordClash':
          kind = 'swordClash';
          gain = 0.48;
          break;
        case 'arrowHit':
          kind = 'arrowFire';
          gain = 0.45;
          break;
        case 'musketShot':
          kind = 'gunshot';
          gain = 0.72;
          break;
        case 'cannonMuzzle':
          kind = 'cannonFire';
          gain = 1.0;
          break;
        case 'mortarImpact':
          kind = 'mortarFire';
          gain = 0.92;
          break;
        case 'wallCollapse':
          kind = 'impact';
          gain = 0.92;
          break;
        case 'horn':
          kind = 'horn';
          gain = 0.72;
          break;
        case 'buildHammer':
          kind = 'hammer';
          gain = 0.62;
          break;
        case 'woodChop':
          kind = 'chop';
          gain = 0.58;
          break;
      }
      if (kind) {
        this.playWorld(kind, ev.x, ev.z, camX, camY, camZ, camRightX, camRightZ, gain);
      }
    }
  }

  /** Steps ambient wind & forest birdsong (< 80 m from mature trees, muted on pause). */
  updateAmbient(dtS: number, nearestTreeDistM: number): void {
    if (!this.ctx || !this.masterGain || this.muted || this.paused || this.ctx.state !== 'running') return;
    if (nearestTreeDistM > 80) return;

    this.birdCooldownS -= dtS;
    if (this.birdCooldownS <= 0) {
      this.birdCooldownS = 2.6 + Math.random() * 4.2;
      const prox = Math.max(0.15, 1 - nearestTreeDistM / 80);
      this.playBirdChirp(prox * 0.065);
    }
  }

  private playBirdChirp(volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const baseHz = 2400 + Math.random() * 1400;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 1.32, now + 0.06);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.92, now + 0.14);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(volume, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

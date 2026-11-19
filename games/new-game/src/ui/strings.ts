// Bilingual UI strings (Polish & English). The Strings interface enforces completeness in both.

import type { LangCode, LightingPresetId, QualityPreset } from '../config.ts';

export interface Strings {
  readonly title: string;
  readonly subtitle: string;
  readonly loading: string;
  readonly play: string;
  readonly resume: string;
  readonly benchmark: string;
  readonly benchmarkRunning: string;
  readonly copy: string;
  readonly copied: string;
  readonly close: string;
  readonly pausedBadge: string;
  readonly pauseBtn: string;
  readonly playBtn: string;
  readonly menuBtn: string;
  readonly qualityLabel: string;
  readonly qualityHigh: string;
  readonly qualityLow: string;
  readonly langLabel: string;
  readonly lightingLabel: string;
  readonly governorLabel: string;
  readonly on: string;
  readonly off: string;
  readonly loadedIn: (seconds: number) => string;
  readonly lightingNames: Record<LightingPresetId, string>;
  readonly controlsHint: string;
}

const EN: Strings = {
  title: 'Marchland',
  subtitle: 'Stage 1 — Renderer, Physical Exposure & Measurement Skeleton',
  loading: 'Loading…',
  play: 'Enter World',
  resume: 'Resume',
  benchmark: 'Benchmark',
  benchmarkRunning: 'Running benchmark…',
  copy: 'Copy Table',
  copied: 'Copied',
  close: 'Close',
  pausedBadge: 'PAUSED',
  pauseBtn: 'Pause',
  playBtn: 'Play',
  menuBtn: 'Menu',
  qualityLabel: 'Graphics',
  qualityHigh: 'High',
  qualityLow: 'Low',
  langLabel: 'Language',
  lightingLabel: 'Lighting',
  governorLabel: 'Frame governor',
  on: 'On',
  off: 'Off',
  loadedIn: (s) => `Loaded in ${s.toFixed(2)} s`,
  lightingNames: {
    clearNoon: 'Clear Noon (100k lx)',
    lateAutumn: 'Late Autumn (30°)',
    goldenHour: 'Golden Hour (12°)',
    overcast: 'Overcast (8k lx)',
  },
  controlsHint: 'Middle-drag / WASD: pan · Right-drag / Q E: rotate · Wheel: zoom · Space: pause · F3: stats · L: lighting',
};

const PL: Strings = {
  title: 'Marchland',
  subtitle: 'Etap 1 — Szkielet renderera, ekspozycji fizycznej i pomiarów',
  loading: 'Wczytywanie…',
  play: 'Wejdź do świata',
  resume: 'Wznów',
  benchmark: 'Benchmark',
  benchmarkRunning: 'Trwa pomiar…',
  copy: 'Kopiuj tabelę',
  copied: 'Skopiowano',
  close: 'Zamknij',
  pausedBadge: 'PAUZA',
  pauseBtn: 'Pauza',
  playBtn: 'Start',
  menuBtn: 'Menu',
  qualityLabel: 'Grafika',
  qualityHigh: 'Wysoka',
  qualityLow: 'Niska',
  langLabel: 'Język',
  lightingLabel: 'Światło',
  governorLabel: 'Regulator klatek',
  on: 'Wł.',
  off: 'Wył.',
  loadedIn: (s) => `Wczytano w ${s.toFixed(2)} s`,
  lightingNames: {
    clearNoon: 'Południe (100 tys. lx)',
    lateAutumn: 'Późne popołudnie (30°)',
    goldenHour: 'Złota godzina (12°)',
    overcast: 'Pochmurno (8 tys. lx)',
  },
  controlsHint: 'Środkowy / WASD: przesuw · Prawy / Q E: obrót · Kółko: zoom · Spacja: pauza · F3: pomiary · L: światło',
};

export const STRINGS: Record<LangCode, Strings> = { en: EN, pl: PL };

export function qualityLabel(s: Strings, q: QualityPreset): string {
  return q === 'high' ? s.qualityHigh : s.qualityLow;
}

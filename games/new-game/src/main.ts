import './ui/style.css';
import { EXPOSURE, LIGHTING_PRESETS, type LangCode, type LightingPresetId, type QualityPreset, type ToneMappingChoice } from './config.ts';
import { Game } from './app/game.ts';

function parseQuality(raw: string | null): QualityPreset {
  if (raw === 'low') return 'low';
  if (raw === 'high') return 'high';
  // Default phones / coarse touch pointers to Low preset (2x DPR + TRAA + governor).
  return window.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high';
}

function parseLighting(raw: string | null): LightingPresetId {
  if (raw && raw in LIGHTING_PRESETS) return raw as LightingPresetId;
  // Default Marchland look (docs/PLAYBOOK.md §2): warm late-afternoon autumn light; pass ?light=clearNoon for 100k lx proof.
  return 'lateAutumn';
}

function parseToneMapping(raw: string | null): ToneMappingChoice {
  return raw === 'agx' ? 'agx' : EXPOSURE.defaultToneMapping;
}

function parseLang(raw: string | null): LangCode {
  if (raw === 'pl') return 'pl';
  if (raw === 'en') return 'en';
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

const params = new URLSearchParams(window.location.search);
const container = document.getElementById('app');
if (!container) throw new Error('#app mount element missing');

void Game.boot({
  container,
  autostart: params.has('autostart'),
  debug: params.has('debug'),
  autoBench: params.has('bench'),
  fastBench: params.has('fast'),
  quality: parseQuality(params.get('q')),
  lighting: parseLighting(params.get('light')),
  toneMapping: parseToneMapping(params.get('tm')),
  lang: parseLang(params.get('lang')),
});

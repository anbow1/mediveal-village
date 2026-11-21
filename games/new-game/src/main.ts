import './ui/style.css';
import {
  EXPOSURE,
  LIGHTING_PRESETS,
  type LangCode,
  type LightingPresetId,
  type QualityPreset,
  type ToneMappingChoice,
} from './config.ts';
import { parseMapId } from './sim/maps.ts';
import type { AiPersonality, CampaignMissionId, Difficulty, GameMode } from './sim/types.ts';
import { Game } from './app/game.ts';

function parseQuality(raw: string | null): QualityPreset {
  if (raw === 'minimal' || raw === 'low' || raw === 'high') return raw;
  try {
    const saved = localStorage.getItem('marchland.quality');
    if (saved === 'minimal' || saved === 'low' || saved === 'high') return saved;
  } catch {
    // Ignore storage restrictions
  }
  // Default phones / coarse touch pointers to Low preset; desktops to High.
  return window.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high';
}

// Register PWA Service Worker over HTTPS (or ?sw locally) so Chrome on Android tablets & desktops offers "Install App"
if ('serviceWorker' in navigator) {
  if (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

function parseLighting(raw: string | null): LightingPresetId {
  if (raw && raw in LIGHTING_PRESETS) return raw as LightingPresetId;
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

function parseMode(raw: string | null): GameMode {
  if (raw === 'defence' || raw === 'tutorial' || raw === 'campaign' || raw === 'skirmish') return raw;
  return 'skirmish';
}

function parseDifficulty(raw: string | null): Difficulty {
  if (raw === 'easy' || raw === 'hard') return raw;
  return 'normal';
}

function parsePersonality(raw: string | null): AiPersonality {
  if (raw === 'builder' || raw === 'knight') return raw;
  return 'raider';
}

function parseMission(raw: string | null): CampaignMissionId | undefined {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n;
  return undefined;
}

const params = new URLSearchParams(window.location.search);
const container = document.getElementById('app');
if (!container) throw new Error('#app mount element missing');

const bootQuality = parseQuality(params.get('q') ?? params.get('quality'));

Game.boot({
  container,
  autostart: params.has('autostart'),
  debug: params.has('debug'),
  autoBench: params.has('bench'),
  fastBench: params.has('fast'),
  quality: bootQuality,
  lighting: parseLighting(params.get('light') ?? params.get('time')),
  toneMapping: parseToneMapping(params.get('tm')),
  lang: parseLang(params.get('lang')),
  mapId: parseMapId(params.get('map')),
  initialSpot: params.get('spot'),
  mode: parseMode(params.get('mode')),
  missionId: parseMission(params.get('mission')),
  difficulty: parseDifficulty(params.get('diff')),
  aiPersonality: parsePersonality(params.get('ai')),
  showcaseMode: !params.has('mode') || params.get('showcase') === '1',
}).catch((err: unknown) => {
  console.error('[boot] fatal error:', err);
  const msg = err instanceof Error ? err.message : String(err);
  const stageEl = document.querySelector('#loading .loading-stage');
  if (stageEl) {
    stageEl.textContent = `Boot failed (${bootQuality}): ${msg}`;
    (stageEl as HTMLElement).style.color = '#e67c73';
  }
  if (bootQuality !== 'minimal') {
    // Prevent trapping low-RAM tablets in a boot crash loop after picking High/Low!
    try {
      localStorage.setItem('marchland.quality', 'minimal');
    } catch {
      // Ignore storage restrictions
    }
    const panel = document.querySelector('#loading .panel');
    if (panel && !panel.querySelector('.boot-recover-btn')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary boot-recover-btn';
      btn.style.marginTop = '12px';
      btn.textContent =
        parseLang(params.get('lang')) === 'pl' ? 'Uruchom w trybie: Minimalna' : 'Retry in Minimal Graphics';
      btn.addEventListener('click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('q', 'minimal');
        window.location.href = url.toString();
      });
      panel.appendChild(btn);
    }
  }
});

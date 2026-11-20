// Stage 6 Campaign Progression & Local Save/Load Store (BRIEF.md F20 & F22).
// Persists mission unlocks, 1–3 star badges, carry-over army/gold, and named save slots in localStorage.

import type { CampaignCarryOver, CampaignMissionId } from '../sim/types.ts';

export interface CampaignProgress {
  highestUnlocked: CampaignMissionId;
  stars: Partial<Record<CampaignMissionId, 1 | 2 | 3>>;
  carryOverByMission: Partial<Record<CampaignMissionId, CampaignCarryOver>>;
}

export interface SaveSlotMeta {
  readonly slot: 1 | 2 | 3;
  readonly savedAtIso: string;
  readonly label: string;
  readonly mapId: string;
  readonly mode: string;
  readonly timeS: number;
}

const KEY_CAMPAIGN = 'marchland.campaign.v1';
const KEY_SAVE_PREFIX = 'marchland.save.slot.';
const KEY_SAVE_META = 'marchland.save.meta.v1';

export function loadCampaignProgress(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY_CAMPAIGN);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CampaignProgress>;
      return {
        highestUnlocked: (parsed.highestUnlocked ?? 1) as CampaignMissionId,
        stars: parsed.stars ?? {},
        carryOverByMission: parsed.carryOverByMission ?? {},
      };
    }
  } catch {
    // ignore storage errors
  }
  return { highestUnlocked: 1, stars: {}, carryOverByMission: {} };
}

export function recordMissionVictory(
  missionId: CampaignMissionId,
  stars: 1 | 2 | 3,
  carryOver: CampaignCarryOver,
): CampaignProgress {
  const prog = loadCampaignProgress();
  const prevStars = prog.stars[missionId] ?? 0;
  prog.stars[missionId] = Math.max(prevStars, stars) as 1 | 2 | 3;
  if (missionId < 5) {
    const next = (missionId + 1) as CampaignMissionId;
    if (next > prog.highestUnlocked) prog.highestUnlocked = next;
    prog.carryOverByMission[next] = carryOver;
  }
  try {
    localStorage.setItem(KEY_CAMPAIGN, JSON.stringify(prog));
  } catch {
    // ignore
  }
  return prog;
}

export function listSaveSlots(): (SaveSlotMeta | null)[] {
  try {
    const raw = localStorage.getItem(KEY_SAVE_META);
    if (raw) {
      const map = JSON.parse(raw) as Partial<Record<string, SaveSlotMeta>>;
      return [map['1'] ?? null, map['2'] ?? null, map['3'] ?? null];
    }
  } catch {
    // ignore
  }
  return [null, null, null];
}

export function saveGameToSlot(
  slot: 1 | 2 | 3,
  snapshotJson: string,
  meta: Omit<SaveSlotMeta, 'slot' | 'savedAtIso'>,
): boolean {
  try {
    localStorage.setItem(`${KEY_SAVE_PREFIX}${slot}`, snapshotJson);
    const existing = listSaveSlots();
    const map: Record<string, SaveSlotMeta> = {};
    for (const s of existing) {
      if (s) map[String(s.slot)] = s;
    }
    map[String(slot)] = {
      ...meta,
      slot,
      savedAtIso: new Date().toISOString(),
    };
    localStorage.setItem(KEY_SAVE_META, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function loadGameFromSlot(slot: 1 | 2 | 3): string | null {
  try {
    return localStorage.getItem(`${KEY_SAVE_PREFIX}${slot}`);
  } catch {
    return null;
  }
}

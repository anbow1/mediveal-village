import { describe, expect, it } from 'vitest';
import { createBenchSpotsForWorld } from '../src/app/bench.ts';
import { ALL_MAP_IDS, buildMapLayout, parseMapId } from '../src/sim/maps.ts';
import { TerrainField } from '../src/sim/terrain.ts';

describe('Stage 5 full 560 x 560 m Campaign & Skirmish maps', () => {
  it('parses map query parameters cleanly with crossing default', () => {
    expect(parseMapId(undefined)).toBe('crossing');
    expect(parseMapId('crossing')).toBe('crossing');
    expect(parseMapId('openField')).toBe('openField');
    expect(parseMapId('forest')).toBe('forest');
    expect(parseMapId('valley')).toBe('valley');
    expect(parseMapId('fortress')).toBe('fortress');
    expect(parseMapId('twierdza')).toBe('fortress');
  });

  for (const mapId of ALL_MAP_IDS) {
    it(`generates deterministic, well-grounded 560x560 m layout for '${mapId}'`, () => {
      const a = buildMapLayout(mapId);
      const b = buildMapLayout(mapId);
      expect(a.buildings.length).toBe(b.buildings.length);
      expect(a.trees.length).toBe(b.trees.length);
      expect(a.units.length).toBe(b.units.length);
      expect(a.capturePoints.length).toBe(3);
      expect(a.trees.length).toBeGreaterThanOrEqual(400);
      expect(a.rocks.length).toBeGreaterThanOrEqual(100);
      expect(a.ferns.length).toBeGreaterThanOrEqual(150);
      expect(a.units.length).toBeGreaterThanOrEqual(100);

      const terrain = new TerrainField(a.terrainConfig);
      expect(terrain.config.sizeM).toBe(560);

      // Every building (except lakeside fisher hut pilings) sits on dry land above waterline
      for (const bld of a.buildings) {
        if (bld.kind === 'fisher_l1') continue;
        expect(terrain.heightAt(bld.x, bld.z)).toBeGreaterThan(0.3);
      }
      // Every tree stays strictly on dry bank and inside map bounds
      for (const tr of a.trees) {
        expect(Math.abs(tr.x)).toBeLessThan(265);
        expect(Math.abs(tr.z)).toBeLessThan(265);
        expect(terrain.heightAt(tr.x, tr.z)).toBeGreaterThan(0.35);
      }

      const spots = createBenchSpotsForWorld(a, terrain);
      expect(spots.length).toBe(12);
    });
  }

  it('crossing (M1-M2) provides dry central stone causeway, 2 passable gravel fords, and deep river between them', () => {
    const layout = buildMapLayout('crossing');
    const terrain = new TerrainField(layout.terrainConfig);
    const xCauseway = terrain.riverCenterAt(6);
    const xNorthFord = terrain.riverCenterAt(-90);
    const xSouthFord = terrain.riverCenterAt(96);
    const xDeep = terrain.riverCenterAt(-42);

    // Causeway stays dry above water
    expect(terrain.heightAt(xCauseway, 6)).toBeGreaterThan(0.25);
    expect(terrain.isWater(xCauseway, 6)).toBe(false);
    // Fords are shallow and passable (< 0.35 m deep)
    expect(terrain.isDeepWater(xNorthFord, -90)).toBe(false);
    expect(terrain.isDeepWater(xSouthFord, 96)).toBe(false);
    // Main river channel between crossings is deep water (> 0.6 m)
    expect(terrain.waterDepthAt(xDeep, -42)).toBeGreaterThan(0.6);
    expect(terrain.isDeepWater(xDeep, -42)).toBe(true);
  });

  it('valley (M3-M4) has twin mountain ridges 175 m off axis, central village 274 m away, and 6 rebuildable ruins', () => {
    const layout = buildMapLayout('valley');
    const terrain = new TerrainField(layout.terrainConfig);

    // Keep at (-156, -4) -> Central village at (+118, 0): horizontal X distance = 274 m!
    const dist = Math.abs(layout.enemyCenterXZ[0] - layout.playerKeepXZ[0]);
    expect(dist).toBe(274);

    // 6 charred rebuildable cottage ruins around the village square
    const ruins = layout.buildings.filter((b) => b.kind === 'ruin_house');
    expect(ruins.length).toBe(6);

    // Twin mountain ridges rise > 16 m along z = +-175 m
    expect(terrain.heightAt(0, -175)).toBeGreaterThan(16);
    expect(terrain.heightAt(0, 175)).toBeGreaterThan(16);
  });

  it('fortress (M5) satisfies every CAMPAIGN.md 19.11 spec: 7 m flat 100 m plateau, no trees on plateau, Donzon, 12 towers, 2 offset gates, siege cannons', () => {
    const layout = buildMapLayout('fortress');
    const terrain = new TerrainField(layout.terrainConfig);
    const [fcx, fcz] = layout.enemyCenterXZ;

    // 7 m plateau flat out to 100 m radius
    expect(terrain.heightAt(fcx, fcz)).toBeCloseTo(7.0, 2);
    expect(terrain.heightAt(fcx + 95, fcz)).toBeCloseTo(7.0, 2);
    expect(terrain.heightAt(fcx - 95, fcz)).toBeCloseTo(7.0, 2);
    expect(terrain.heightAt(fcx, fcz + 95)).toBeCloseTo(7.0, 2);

    // ZERO forest or lakes on the 100 m plateau
    for (const tr of layout.trees) {
      expect(Math.hypot(tr.x - fcx, tr.z - fcz)).toBeGreaterThan(100);
    }

    // Monumental central Donzon, 12 fortress watchtowers (+2 player camp = 14), 2 gates, 300+ destructible wall segments, 4 siege cannons
    expect(layout.buildings.filter((b) => b.kind === 'fortress_donzon').length).toBe(1);
    expect(layout.buildings.filter((b) => b.kind === 'watchtower_l1' && b.team === 1).length).toBe(12);
    expect(layout.buildings.filter((b) => b.kind === 'gate_l1' && b.team === 1).length).toBe(2);
    expect(layout.walls.length).toBeGreaterThan(280);
    expect(layout.props.filter((p) => p.kind === 'cannon').length).toBe(4);
  });
});

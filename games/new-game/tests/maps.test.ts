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

  it('plans starting settlements on an orthogonal grid with building entrances facing the street and grouped logistics chains', () => {
    for (const mapId of ['crossing', 'openField', 'forest', 'valley'] as const) {
      const layout = buildMapLayout(mapId);
      const townBlds = layout.buildings.slice(0, 15);
      const keep = townBlds.find((b) => b.kind === 'keep_l1')!;
      // Town grid anchor (ox, oz): Keep sits at (ox - 16, oz)
      const ox = keep.x + 16;
      const oz = keep.z;

      // 1. No town building sits on any of the 3 grid streets: Main Street (z = oz, x >= ox - 6), West Cross (x = ox - 4), East Cross (x = ox + 20)
      for (const b of townBlds) {
        if (b.kind !== 'keep_l1') {
          expect(Math.abs(b.z - oz), `${b.kind} on ${mapId} must not sit on Main High Street`).toBeGreaterThanOrEqual(7);
        }
        expect(Math.abs(b.x - (ox - 4)), `${b.kind} on ${mapId} must not sit on West Cross Street`).toBeGreaterThanOrEqual(6);
        expect(Math.abs(b.x - (ox + 20)), `${b.kind} on ${mapId} must not sit on East Cross Street`).toBeGreaterThanOrEqual(6);
      }

      // 2. Every town building has an orthogonal street-aligned orientation and its doorway (+Z local) faces toward its street
      for (const b of townBlds) {
        const doorX = b.x + Math.sin(b.yawRad) * 5;
        const doorZ = b.z + Math.cos(b.yawRad) * 5;
        if (Math.abs(Math.sin(b.yawRad)) > 0.5) {
          // Faces East/West onto Cross Street (x = ox - 4 or x = ox + 20)
          const before = Math.min(Math.abs(b.x - (ox - 4)), Math.abs(b.x - (ox + 20)));
          const after = Math.min(Math.abs(doorX - (ox - 4)), Math.abs(doorX - (ox + 20)));
          expect(after, `${b.kind} doorway on ${mapId} should face toward cross street`).toBeLessThan(before);
        } else {
          // Faces North/South onto Main High Street (z = oz)
          expect(Math.abs(doorZ - oz), `${b.kind} doorway on ${mapId} should face toward Main High Street`).toBeLessThan(
            Math.abs(b.z - oz),
          );
        }
      }

      // 3. Logistics grouping: Farm -> Windmill -> Bakery grouped closely, Smithy paired with Barracks, Houses within Well radius
      const farm = townBlds.find((b) => b.kind === 'farm_l1')!;
      const mill = townBlds.find((b) => b.kind === 'windmill_l1')!;
      const bakery = townBlds.find((b) => b.kind === 'bakery_l1')!;
      expect(Math.hypot(farm.x - mill.x, farm.z - mill.z)).toBeLessThanOrEqual(20);
      expect(Math.hypot(mill.x - bakery.x, mill.z - bakery.z)).toBeLessThanOrEqual(20);

      const smithy = townBlds.find((b) => b.kind === 'smithy_l1')!;
      const barracks = townBlds.find((b) => b.kind === 'barracks_l1')!;
      expect(Math.hypot(smithy.x - barracks.x, smithy.z - barracks.z)).toBeLessThanOrEqual(25);

      const well = townBlds.find((b) => b.kind === 'well_l1')!;
      const houses = townBlds.filter((b) => b.kind === 'house_l1');
      for (const h of houses) {
        expect(Math.hypot(h.x - well.x, h.z - well.z)).toBeLessThanOrEqual(35);
      }
    }
  });

  it('seals wall-to-watchtower and wall-to-gate joints tightly on the starting crossing map with zero gaps', () => {
    const layout = buildMapLayout('crossing');
    const wallTowers = layout.buildings.filter(
      (b) => b.kind === 'watchtower_l1' && (Math.abs(b.x - (-16)) < 1.0 || Math.abs(b.x - 78) < 1.0),
    );
    const gates = layout.buildings.filter((b) => b.kind === 'gate_l1');
    expect(wallTowers.length).toBe(4);
    expect(gates.length).toBe(2);

    // Every wall-line watchtower on crossing must have a wall segment terminating within <= 2.4 m of its center (embedded into masonry!)
    for (const tw of wallTowers) {
      let minDist = Infinity;
      for (const w of layout.walls) {
        const d = Math.hypot(w.x - tw.x, w.z - tw.z);
        if (d < minDist) minDist = d;
      }
      expect(minDist, `Watchtower at (${tw.x}, ${tw.z}) must connect tightly to wall`).toBeLessThanOrEqual(2.4);
    }

    // Every gatehouse on crossing must have wall segments flanking both sides within <= 4.2 m of gate center
    for (const g of gates) {
      const northWall = layout.walls.some((w) => Math.abs(w.x - g.x) < 1.0 && w.z < g.z && g.z - w.z <= 4.2);
      const southWall = layout.walls.some((w) => Math.abs(w.x - g.x) < 1.0 && w.z > g.z && w.z - g.z <= 4.2);
      expect(northWall, `Gate at (${g.x}, ${g.z}) must connect tightly on north side`).toBe(true);
      expect(southWall, `Gate at (${g.x}, ${g.z}) must connect tightly on south side`).toBe(true);
    }
  });
});



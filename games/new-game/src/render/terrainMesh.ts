// Single-height-function 560 x 560 m terrain mesh + 6-layer height-blended dual-scale TSL material.
// Uses the EXACT same `TerrainField.heightAt()` as gameplay/grass/water and the SAME 3 shared
// 12-layer KTX2 CompressedArrayTextures (`albedoArray`, `normalArray`, `ormArray`) -> only 4 textures total!

import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  RedFormat,
  UnsignedByteType,
} from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  int,
  mix,
  normalMap,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { TerrainField } from '../sim/terrain.ts';
import type { SurfaceLibrary } from './surfaces.ts';

export interface TerrainRenderHandles {
  readonly mesh: Mesh;
  readonly material: MeshStandardNodeMaterial;
  /** R32F height grid texture [gridResolution x gridResolution] shared 1-to-1 with `grassField.ts`. */
  readonly heightTexture: DataTexture;
  /** RGBA8 dynamic ground-works texture [resolution x resolution] shared with `grassField.ts`. */
  readonly groundWorksTexture: DataTexture;
  readonly heightGrid: Float32Array;
  readonly syncGroundWorks: () => void;
  readonly dispose: () => void;
}

/**
 * Builds the displaced 560 x 560 m terrain mesh and height-blended 6-layer TSL material:
 *   Layer 0 (grass)  — dual near/far meadow turf (zero visible tiling from 0.45 m to 460 m)
 *   Layer 1 (dirt)   — trampled village yards, road shoulders & wet lake shore silt
 *   Layer 2 (cobble) — cobbled medieval village lanes & market tracks
 *   Layer 8 (rubble) — hillside rock scree on steeper slopes
 *   Layer 10 (bark)  — needle/leaf forest-floor litter under tree canopies + indirect AO
 *   Layer 6 (thatch) — ploughed dark-earth agricultural furrows & straw stubble
 */
export function buildTerrainMesh(
  terrain: TerrainField,
  groundWorks: GroundWorksMap,
  surfaces: SurfaceLibrary,
): TerrainRenderHandles {
  const n = terrain.config.gridResolution;
  const segs = n - 1;
  const size = terrain.config.sizeM;

  const heightGrid = terrain.bakeHeightGrid();

  // Build PlaneGeometry rotated -PI/2 on X: vertex (ix, iz) maps 1-to-1 to heightGrid[iz * n + ix]!
  const geo = new PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.getAttribute('position');
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const ix = Math.max(0, Math.min(n - 1, Math.round((x + terrain.halfSizeM) / terrain.cellSizeM)));
    const iz = Math.max(0, Math.min(n - 1, Math.round((z + terrain.halfSizeM) / terrain.cellSizeM)));
    posAttr.setY(i, heightGrid[iz * n + ix]!);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  // R32F height grid texture (NearestFilter + manual textureLoad triangle-split in grassField.ts per playbook §11)
  const heightTexture = new DataTexture(heightGrid, n, n, RedFormat, FloatType);
  heightTexture.minFilter = NearestFilter;
  heightTexture.magFilter = NearestFilter;
  heightTexture.wrapS = ClampToEdgeWrapping;
  heightTexture.wrapT = ClampToEdgeWrapping;
  heightTexture.generateMipmaps = false;
  heightTexture.needsUpdate = true;

  // RGBA8 dynamic ground-works texture (R=dirt, G=cobble, B=farm furrows, A=canopy litter/shade)
  const groundWorksTexture = new DataTexture(
    groundWorks.data,
    groundWorks.resolution,
    groundWorks.resolution,
    RGBAFormat,
    UnsignedByteType,
  );
  groundWorksTexture.minFilter = LinearFilter;
  groundWorksTexture.magFilter = LinearFilter;
  groundWorksTexture.wrapS = ClampToEdgeWrapping;
  groundWorksTexture.wrapT = ClampToEdgeWrapping;
  groundWorksTexture.generateMipmaps = false;
  groundWorksTexture.needsUpdate = true;

  const mat = createTerrainMaterial(terrain, groundWorks, groundWorksTexture, surfaces);

  const mesh = new Mesh(geo, mat);
  mesh.name = 'MarchlandTerrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    material: mat,
    heightTexture,
    groundWorksTexture,
    heightGrid,
    syncGroundWorks() {
      groundWorksTexture.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      heightTexture.dispose();
      groundWorksTexture.dispose();
    },
  };
}

function createTerrainMaterial(
  terrain: TerrainField,
  groundWorks: GroundWorksMap,
  groundWorksTex: DataTexture,
  surfaces: SurfaceLibrary,
): MeshStandardNodeMaterial {
  const { albedoArray, normalArray, ormArray } = surfaces;
  const mat = new MeshStandardNodeMaterial({
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.name = 'MarchlandTerrainMaterial';

  const wp = positionWorld;
  const xz = wp.xz;

  // Sample dynamic groundWorks RGBA8 (R=dirt yard, G=cobble road, B=farm furrows, A=canopy shade/litter)
  const gwUv = xz.add(vec2(groundWorks.halfSpanM)).div(float(groundWorks.spanM));
  const inGw = gwUv.x
    .greaterThan(0.002)
    .and(gwUv.x.lessThan(0.998))
    .and(gwUv.y.greaterThan(0.002))
    .and(gwUv.y.lessThan(0.998));
  const gwRaw = texture(groundWorksTex, clamp(gwUv, vec2(0.002), vec2(0.998)));
  const gwMask = inGw.select(float(1.0), float(0.0));
  const dirtGw = gwRaw.r.mul(gwMask);
  const cobbleGw = gwRaw.g.mul(gwMask);
  const farmGw = gwRaw.b.mul(gwMask);
  const canopyGw = gwRaw.a.mul(gwMask);

  // Multi-scale organic macro variation breaks up any tile grid from 0.45 m up to 460 m overview
  const macroA = sin(xz.x.mul(0.043).add(sin(xz.y.mul(0.039)).mul(2.1)))
    .mul(sin(xz.y.mul(0.051).sub(xz.x.mul(0.034))))
    .mul(0.5)
    .add(0.5);
  const macroB = sin(xz.x.mul(0.19).add(xz.y.mul(0.14)))
    .mul(sin(xz.y.mul(0.23).sub(xz.x.mul(0.17))))
    .mul(0.5)
    .add(0.5);
  const macroFar = sin(xz.x.mul(0.014).sub(xz.y.mul(0.011))).mul(0.5).add(0.5);

  // Near + far dual-scale grass sampling (playbook §3 #6: kills tiling at both eye-level and RTS altitude)
  const grassUvNear = xz.div(2.8);
  const grassUvFar = xz.div(13.5).add(vec2(0.37, 0.61));
  const dirtUv = xz.div(2.4);
  const cobbleUv = xz.div(2.15);
  const rockUv = xz.div(3.4);
  const litterUv = xz.div(2.6);
  const farmUv = xz.div(2.5);

  const photo = surfaces.photoTerrain;
  const gAlbArr = photo ? photo.albedoArray : albedoArray;
  const gNorArr = photo ? photo.normalArray : normalArray;
  const gOrmArr = photo ? photo.ormArray : ormArray;

  // Photogrammetry indices: 0=meadow, 1=pasture, 2=dry_grass, 3=forest_floor, 4=farm_soil, 5=mud, 6=rock
  const hillDry = smoothstep(float(2.6), float(7.2), wp.y);
  const meadowAlbNear = texture(gAlbArr, grassUvNear).depth(int(0)).rgb;
  const pastureAlbFar = texture(gAlbArr, grassUvFar).depth(int(photo ? 1 : 0)).rgb;
  const dryGrassAlb = texture(gAlbArr, grassUvNear.mul(0.85)).depth(int(photo ? 2 : 0)).rgb;
  const baseMeadowAlb = mix(meadowAlbNear, pastureAlbFar, float(0.42).mul(macroA.mul(0.6).add(0.4)));
  const grassAlb = photo
    ? mix(baseMeadowAlb, dryGrassAlb, hillDry.mul(0.55).add(macroFar.mul(0.18)))
    : mix(meadowAlbNear, pastureAlbFar, float(0.36));
  const grassNor = texture(gNorArr, grassUvNear).depth(int(0)).rgb;
  const grassOrm = texture(gOrmArr, grassUvNear).depth(int(0));

  const dirtAlb = texture(gAlbArr, dirtUv).depth(int(photo ? 5 : 1)).rgb;
  const dirtNor = texture(gNorArr, dirtUv).depth(int(photo ? 5 : 1)).rgb;
  const dirtOrm = texture(gOrmArr, dirtUv).depth(int(photo ? 5 : 1));

  const cobbleAlb = texture(albedoArray, cobbleUv).depth(int(2)).rgb;
  const cobbleNor = texture(normalArray, cobbleUv).depth(int(2)).rgb;
  const cobbleOrm = texture(ormArray, cobbleUv).depth(int(2));

  const rockAlb = texture(gAlbArr, rockUv).depth(int(photo ? 6 : 8)).rgb;
  const rockNor = texture(gNorArr, rockUv).depth(int(photo ? 6 : 8)).rgb;
  const rockOrm = texture(gOrmArr, rockUv).depth(int(photo ? 6 : 8));

  const litterAlb = texture(gAlbArr, litterUv).depth(int(photo ? 3 : 10)).rgb;
  const litterNor = texture(gNorArr, litterUv).depth(int(photo ? 3 : 10)).rgb;
  const litterOrm = texture(gOrmArr, litterUv).depth(int(photo ? 3 : 10));

  const farmAlb = photo ? texture(gAlbArr, farmUv).depth(int(4)).rgb : dirtAlb;

  // Lush Central European meadow tint variation (gentle when photo biome textures are already colour-calibrated!)
  const meadowTint = photo
    ? mix(vec3(0.92, 1.0, 0.88), vec3(1.04, 1.0, 0.90), macroA)
    : mix(
        mix(vec3(0.58, 0.98, 0.42), vec3(0.84, 1.04, 0.48), macroA),
        vec3(0.94, 0.92, 0.50),
        hillDry.mul(0.34).add(macroFar.mul(0.14)),
      );
  const grassCol = grassAlb.mul(meadowTint);
  const dirtCol = dirtAlb.mul(photo ? vec3(0.98, 0.94, 0.88) : vec3(0.94, 0.86, 0.74)).mul(mix(float(0.88), float(1.08), macroB));
  const cobbleCol = cobbleAlb.mul(vec3(0.92, 0.95, 1.02)).mul(mix(float(0.88), float(1.14), macroB));
  const rockCol = rockAlb.mul(vec3(0.95, 0.93, 0.89));
  const litterCol = litterAlb.mul(photo ? vec3(0.92, 0.90, 0.85) : vec3(0.72, 0.64, 0.48));

  // Ploughed dark-loam agricultural furrows (oriented along farm rows with subtle parallel furrow troughs)
  const furrowWave = sin(xz.x.mul(9.2).add(macroB.mul(0.6))).mul(0.5).add(0.5);
  const farmCol = farmAlb.mul(
    photo
      ? mix(vec3(0.78, 0.74, 0.68), vec3(1.02, 0.96, 0.88), furrowWave)
      : mix(vec3(0.46, 0.39, 0.30), vec3(0.72, 0.61, 0.45), furrowWave),
  );

  // Height-blended splat weights (playbook §3 #4: stones/rock/cobbles poke sharply through turf/soil)
  const slope = float(1.0).sub(clamp(normalWorld.y, 0.0, 1.0));
  const rockW = smoothstep(float(0.065), float(0.18), slope).mul(float(0.85).add(rockOrm.r.mul(0.3)));
  const litterW = clamp(canopyGw.mul(1.15), 0.0, 0.88);
  // Subtle height sharpening on cobble stones so earth fills between stones naturally
  const cobbleSharp = smoothstep(float(0.18), float(0.68), cobbleGw.add(cobbleOrm.r.sub(0.5).mul(0.35)));
  const dirtSharp = smoothstep(float(0.12), float(0.78), dirtGw.add(dirtOrm.r.sub(0.5).mul(0.25)));

  // Compose base land cover: meadow -> canopy needle litter -> trampled dirt -> ploughed farm -> rock scree -> cobble road
  const c1 = mix(grassCol, litterCol, litterW);
  const c2 = mix(c1, dirtCol, dirtSharp);
  const c3 = mix(c2, farmCol, farmGw);
  const c4 = mix(c3, rockCol, clamp(rockW, 0.0, 0.92));
  const dryCol = mix(c4, cobbleCol, cobbleSharp);

  // Canopy shade subtly darkens indirect ground reflectance under dense trees (playbook §3 #7)
  const canopyShade = mix(float(1.0), float(0.68), clamp(canopyGw, 0.0, 1.0));
  const dryShaded = dryCol.mul(canopyShade);

  // Universal wet-silt shoreline band & sandy-gravel shallows for all lakes, rivers & shallow fords (playbook §6aa & §7.2b)
  const waterLevel = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  const hAboveWater = wp.y.sub(waterLevel);
  const dryRoadKeep = float(1.0).sub(cobbleSharp.mul(0.85));
  // Wet silt band hugging shorelines from -0.15 m to +0.44 m above waterline
  const wetSiltMask = float(1.0)
    .sub(smoothstep(float(0.02), float(0.44), abs(hAboveWater.sub(0.10))))
    .mul(dryRoadKeep);
  // Warm sandy-gravel riverbed & lakebed below water (hAboveWater < 0.04 m)
  const lakeBedMask = smoothstep(float(0.06), float(-0.20), hAboveWater);

  const shoreEarth = mix(dryShaded, dirtCol.mul(vec3(0.48, 0.44, 0.37)), wetSiltMask.mul(0.86));
  const lakeBedCol = dirtAlb.mul(vec3(0.88, 0.82, 0.66)).mul(mix(float(0.55), float(1.0), smoothstep(float(-1.2), float(-0.08), hAboveWater)));
  const finalCol = mix(shoreEarth, lakeBedCol, lakeBedMask);

  mat.colorNode = clamp(finalCol, vec3(0.02), vec3(0.76));

  // Blend corresponding tangent-space normals
  const n1 = mix(grassNor, litterNor, litterW);
  const n2 = mix(n1, dirtNor, dirtSharp);
  const n3 = mix(n2, rockNor, clamp(rockW, 0.0, 0.92));
  const finalNor = mix(n3, cobbleNor, cobbleSharp);
  mat.normalNode = normalMap(finalNor, vec2(0.88, 0.88));

  // Roughness: matte dry turf/earth/rock, damp specular sheen on wet lake shore silt
  const r1 = mix(grassOrm.g, litterOrm.g, litterW);
  const r2 = mix(r1, dirtOrm.g, dirtSharp);
  const r3 = mix(r2, rockOrm.g, clamp(rockW, 0.0, 0.92));
  const dryRough = mix(r3, cobbleOrm.g, cobbleSharp);
  const finalRough = mix(dryRough, float(0.46), wetSiltMask.mul(0.85));
  mat.roughnessNode = clamp(finalRough, 0.42, 0.96);
  mat.metalnessNode = float(0.0);

  return mat;
}

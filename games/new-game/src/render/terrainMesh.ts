// Single-height-function 560 x 560 m terrain mesh + 6-layer height-blended untiled TSL material
// (upgraded with FPS/marchland terrainView.ts realism techniques):
//   - High preset: irrational-angle dual-sample untiling (kills tiling grids from 0.45 m to 460 m),
//     distance-faded normal maps & AO (kills far-field shimmer), wheel-rutted cart tracks with grassy crown,
//     broad natural meadow swathes, and soft map-border transition into the distant wooded lowland.
//   - Low / Minimal presets: lean single-sample shader preserving full mobile/iPad smoothness.

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
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  int,
  length,
  max,
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
import type { QualityPreset } from '../config.ts';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { TerrainField } from '../sim/terrain.ts';
import { buildCloudShadowNode, type PhysicalSkyUniforms } from './sky.ts';
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

const TURN_COS = Math.cos(0.646); // ~37 deg irrational rotation prevents dual-sample repeat alignment
const TURN_SIN = Math.sin(0.646);

export function buildTerrainMesh(
  terrain: TerrainField,
  groundWorks: GroundWorksMap,
  surfaces: SurfaceLibrary,
  quality: QualityPreset = 'high',
  skyUniforms?: PhysicalSkyUniforms,
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

  const heightTexture = new DataTexture(heightGrid, n, n, RedFormat, FloatType);
  heightTexture.minFilter = NearestFilter;
  heightTexture.magFilter = NearestFilter;
  heightTexture.wrapS = ClampToEdgeWrapping;
  heightTexture.wrapT = ClampToEdgeWrapping;
  heightTexture.generateMipmaps = false;
  heightTexture.needsUpdate = true;

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

  const mat = createTerrainMaterial(terrain, groundWorks, groundWorksTexture, surfaces, quality, skyUniforms);

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
  quality: QualityPreset,
  skyUniforms?: PhysicalSkyUniforms,
): MeshStandardNodeMaterial {
  const { albedoArray, normalArray, ormArray } = surfaces;
  const untile = quality === 'high';
  const mat = new MeshStandardNodeMaterial({
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.name = 'MarchlandTerrainMaterial';

  const wp = positionWorld;
  const xz = wp.xz;
  const camDistM = length(wp.sub(cameraPosition));
  const farFade = smoothstep(float(55.0), float(210.0), camDistM);

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
  // Broad landscape meadow swathes (tens of metres across — FPS/marchland terrainView.ts)
  const swathe = sin(xz.x.mul(0.022).add(cos(xz.y.mul(0.019)))).mul(0.5).add(0.5);

  const turnedXz = vec2(xz.x.mul(TURN_COS).sub(xz.y.mul(TURN_SIN)), xz.x.mul(TURN_SIN).add(xz.y.mul(TURN_COS)));
  const untileBlend = smoothstep(float(0.26), float(0.74), macroA.mul(0.65).add(macroB.mul(0.35)));
  // Variance-preserving spread compensation keeps blended detail crisp instead of washed flat
  const untileSpread = untileBlend
    .mul(untileBlend)
    .add(float(1.0).sub(untileBlend).mul(float(1.0).sub(untileBlend)))
    .sqrt()
    .max(0.72);

  const photo = surfaces.photoTerrain;
  const gAlbArr = photo ? photo.albedoArray : albedoArray;
  const gNorArr = photo ? photo.normalArray : normalArray;
  const gOrmArr = photo ? photo.ormArray : ormArray;

  const sampleUntiledAlb = (arr: typeof albedoArray, scaleM: number, layerIdx: number, shift: number) => {
    const uA = xz.div(scaleM).add(vec2(shift, shift * 0.6));
    const a = texture(arr, uA).depth(int(layerIdx)).rgb;
    if (!untile) return a;
    const uB = turnedXz.div(scaleM * 1.27).add(vec2(0.43 + shift, 0.29));
    const b = texture(arr, uB).depth(int(layerIdx)).rgb;
    const blended = mix(a, b, untileBlend);
    const mean = a.add(b).mul(0.5);
    return clamp(blended.sub(mean).div(untileSpread).add(mean), vec3(0.01), vec3(1.0));
  };

  // Near + far dual-scale grass sampling (zero visible tiling from 0.45 m to 460 m)
  const grassUvNear = xz.div(2.8);
  const grassUvFar = xz.div(13.5).add(vec2(0.37, 0.61));
  const dirtUv = xz.div(2.4);
  const cobbleUv = xz.div(2.15);
  const rockUv = xz.div(3.4);
  const litterUv = xz.div(2.6);
  const farmUv = xz.div(2.5);

  // Photogrammetry indices: 0=meadow, 1=pasture, 2=dry_grass, 3=forest_floor, 4=farm_soil, 5=mud, 6=rock
  const hillDry = smoothstep(float(2.6), float(7.2), wp.y);
  const meadowAlbNear = sampleUntiledAlb(gAlbArr, 2.8, 0, 0.0);
  const pastureAlbFar = texture(gAlbArr, grassUvFar).depth(int(photo ? 1 : 0)).rgb;
  const dryGrassAlb = sampleUntiledAlb(gAlbArr, 3.3, photo ? 2 : 0, 0.17);
  const baseMeadowAlb = mix(meadowAlbNear, pastureAlbFar, float(0.42).mul(macroA.mul(0.6).add(0.4)));
  const grassAlb = photo
    ? mix(baseMeadowAlb, dryGrassAlb, hillDry.mul(0.55).add(macroFar.mul(0.18)))
    : mix(meadowAlbNear, pastureAlbFar, float(0.36));
  const grassNor = texture(gNorArr, grassUvNear).depth(int(0)).rgb;
  const grassOrm = texture(gOrmArr, grassUvNear).depth(int(0));

  const dirtAlb = sampleUntiledAlb(gAlbArr, 2.4, photo ? 5 : 1, 0.23);
  const dirtNor = texture(gNorArr, dirtUv).depth(int(photo ? 5 : 1)).rgb;
  const dirtOrm = texture(gOrmArr, dirtUv).depth(int(photo ? 5 : 1));

  const cobbleAlb = texture(albedoArray, cobbleUv).depth(int(2)).rgb;
  const cobbleNor = texture(normalArray, cobbleUv).depth(int(2)).rgb;
  const cobbleOrm = texture(ormArray, cobbleUv).depth(int(2));

  const rockAlb = sampleUntiledAlb(gAlbArr, 3.4, photo ? 6 : 8, 0.31);
  const rockNor = texture(gNorArr, rockUv).depth(int(photo ? 6 : 8)).rgb;
  const rockOrm = texture(gOrmArr, rockUv).depth(int(photo ? 6 : 8));

  const litterAlb = texture(gAlbArr, litterUv).depth(int(photo ? 3 : 10)).rgb;
  const litterNor = texture(gNorArr, litterUv).depth(int(photo ? 3 : 10)).rgb;
  const litterOrm = texture(gOrmArr, litterUv).depth(int(photo ? 3 : 10));

  const farmAlb = photo ? texture(gAlbArr, farmUv).depth(int(4)).rgb : dirtAlb;

  // Lush Central European meadow swathes (rich darker hollows, warm sunlit crests — FPS/marchland terrainView.ts)
  const swatheTint = mix(vec3(0.84, 0.92, 0.85), vec3(1.10, 1.06, 0.88), swathe);
  const meadowTint = (photo
    ? mix(vec3(0.92, 1.0, 0.88), vec3(1.04, 1.0, 0.90), macroA)
    : mix(
        mix(vec3(0.58, 0.98, 0.42), vec3(0.84, 1.04, 0.48), macroA),
        vec3(0.94, 0.92, 0.50),
        hillDry.mul(0.34).add(macroFar.mul(0.14)),
      )
  ).mul(swatheTint);
  const grassCol = grassAlb.mul(meadowTint);
  const dirtCol = dirtAlb.mul(photo ? vec3(0.98, 0.94, 0.88) : vec3(0.94, 0.86, 0.74)).mul(mix(float(0.88), float(1.08), macroB));
  // Cart-track wheel ruts darkening just inside road edges + faint grassy crown in the middle (FPS/marchland)
  const rutBand = smoothstep(float(0.45), float(0.65), cobbleGw).mul(float(1.0).sub(smoothstep(float(0.76), float(0.92), cobbleGw)));
  const roadCrown = smoothstep(float(0.95), float(1.0), cobbleGw).mul(smoothstep(float(0.45), float(0.75), macroB));
  const cobbleBase = cobbleAlb.mul(vec3(0.92, 0.95, 1.02)).mul(mix(float(0.88), float(1.14), macroB));
  const cobbleCol = mix(cobbleBase.mul(float(1.0).sub(rutBand.mul(0.18))), grassCol.mul(0.82), roadCrown.mul(0.18));
  const rockCol = rockAlb.mul(vec3(0.95, 0.93, 0.89));
  const litterCol = litterAlb.mul(photo ? vec3(0.92, 0.90, 0.85) : vec3(0.72, 0.64, 0.48));

  // Ploughed dark-loam agricultural furrows
  const furrowWave = sin(xz.x.mul(9.2).add(macroB.mul(0.6))).mul(0.5).add(0.5);
  const farmCol = farmAlb.mul(
    photo
      ? mix(vec3(0.78, 0.74, 0.68), vec3(1.02, 0.96, 0.88), furrowWave)
      : mix(vec3(0.46, 0.39, 0.30), vec3(0.72, 0.61, 0.45), furrowWave),
  );

  // Height-blended splat weights
  const slope = float(1.0).sub(clamp(normalWorld.y, 0.0, 1.0));
  const rockW = smoothstep(float(0.065), float(0.18), slope).mul(float(0.85).add(rockOrm.r.mul(0.3)));
  const litterW = clamp(canopyGw.mul(1.15), 0.0, 0.88);
  const cobbleSharp = smoothstep(float(0.18), float(0.68), cobbleGw.add(cobbleOrm.r.sub(0.5).mul(0.35)));
  const dirtSharp = smoothstep(float(0.12), float(0.78), dirtGw.add(dirtOrm.r.sub(0.5).mul(0.25)));

  const c1 = mix(grassCol, litterCol, litterW);
  const c2 = mix(c1, dirtCol, dirtSharp);
  const c3 = mix(c2, farmCol, farmGw);
  const c4 = mix(c3, rockCol, clamp(rockW, 0.0, 0.92));
  const dryCol = mix(c4, cobbleCol, cobbleSharp);

  const canopyShade = mix(float(1.0), float(0.68), clamp(canopyGw, 0.0, 1.0));
  const dryShaded = dryCol.mul(canopyShade);

  // Universal wet-silt shoreline band & sandy-gravel shallows
  const waterLevel = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  const hAboveWater = wp.y.sub(waterLevel);
  const dryRoadKeep = float(1.0).sub(cobbleSharp.mul(0.85));
  const wetSiltMask = float(1.0)
    .sub(smoothstep(float(0.02), float(0.44), abs(hAboveWater.sub(0.10))))
    .mul(dryRoadKeep);
  const lakeBedMask = smoothstep(float(0.06), float(-0.20), hAboveWater);

  const shoreEarth = mix(dryShaded, dirtCol.mul(vec3(0.48, 0.44, 0.37)), wetSiltMask.mul(0.86));
  const lakeBedCol = dirtAlb.mul(vec3(0.88, 0.82, 0.66)).mul(mix(float(0.55), float(1.0), smoothstep(float(-1.2), float(-0.08), hAboveWater)));
  const baseFinal = mix(shoreEarth, lakeBedCol, lakeBedMask);

  // Subtle natural darkening outside buildable border (|x|, |z| > 266 m) blending into distant wooded lowland
  const edgeM = max(abs(wp.x), abs(wp.z));
  const borderFade = smoothstep(float(terrain.halfSizeM - 16), float(terrain.halfSizeM - 2), edgeM);
  const luma = dot(baseFinal, vec3(0.2126, 0.7152, 0.0722));
  const borderedCol = mix(baseFinal, mix(baseFinal, vec3(luma), float(0.38)).mul(0.68), borderFade);

  // Manor Lords-style damp cart-track ruts & rain puddles (High & Low presets — 0 extra textures):
  // puddles pool naturally in flat wheel ruts & muddy yards above water and reflect the sky PMREM probe!
  const puddleNoise = sin(xz.x.mul(0.62).add(sin(xz.y.mul(0.57)).mul(1.7)))
    .mul(cos(xz.y.mul(0.71).sub(xz.x.mul(0.49))))
    .mul(0.5)
    .add(0.5);
  const flatGround = float(1.0).sub(smoothstep(float(0.025), float(0.08), slope));
  const aboveWater = smoothstep(float(0.25), float(0.75), hAboveWater);
  const puddleZone = clamp(rutBand.mul(1.15).add(dirtSharp.mul(0.45)), 0.0, 1.0);
  const puddleMask =
    quality !== 'minimal'
      ? smoothstep(float(0.66), float(0.84), puddleNoise).mul(puddleZone).mul(flatGround).mul(aboveWater)
      : float(0.0);

  // Drifting cloud shadows across the valley (synchronized with sky uCloudDrift & uCloudCoverage)
  const cloudShade = skyUniforms ? buildCloudShadowNode(xz, skyUniforms, 0.22) : float(1.0);
  const puddleDarkened = mix(borderedCol, borderedCol.mul(vec3(0.54, 0.56, 0.58)), puddleMask.mul(0.72));
  const finalCol = puddleDarkened.mul(cloudShade);

  mat.colorNode = clamp(finalCol, vec3(0.02), vec3(0.76));

  // Blend tangent-space normals, flatten inside glossy puddles, and fade bump amplitude with distance!
  const n1 = mix(grassNor, litterNor, litterW);
  const n2 = mix(n1, dirtNor, dirtSharp);
  const n3 = mix(n2, rockNor, clamp(rockW, 0.0, 0.92));
  const dryNor = mix(n3, cobbleNor, cobbleSharp);
  const finalNor = mix(dryNor, vec3(0.5, 0.5, 1.0), puddleMask.mul(0.92));
  const norScale = float(0.88).mul(float(1.0).sub(farFade.mul(0.72)));
  mat.normalNode = normalMap(finalNor, vec2(norScale, norScale));

  // Roughness (glossy sky-reflecting puddles ~0.09, damp shore ~0.46, dry earth 0.55–0.96) & distance-faded AO
  const r1 = mix(grassOrm.g, litterOrm.g, litterW);
  const r2 = mix(r1, dirtOrm.g, dirtSharp);
  const r3 = mix(r2, rockOrm.g, clamp(rockW, 0.0, 0.92));
  const dryRough = mix(r3, cobbleOrm.g, cobbleSharp);
  const shoreRough = mix(dryRough, float(0.42), wetSiltMask.mul(0.85));
  const finalRough = mix(shoreRough, float(0.09), puddleMask);
  mat.roughnessNode = clamp(finalRough, 0.08, 0.96);

  const a1 = mix(grassOrm.r, litterOrm.r, litterW);
  const a2 = mix(a1, dirtOrm.r, dirtSharp);
  const a3 = mix(a2, rockOrm.r, clamp(rockW, 0.0, 0.92));
  const finalAo = mix(mix(a3, cobbleOrm.r, cobbleSharp), float(1.0), farFade);
  mat.aoNode = clamp(finalAo, 0.55, 1.0);
  mat.metalnessNode = float(0.0);

  return mat;
}

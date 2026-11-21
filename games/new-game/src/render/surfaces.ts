// Stage 2 shared KTX2 surface library (12 layers -> 3 CompressedArrayTextures: albedo, normal, orm).
// Stays well within the WebGPU 16-texture-per-stage limit while giving buildings and ground real
// Poly Haven CC0 photogrammetry albedo, normal, roughness, and AO maps.

import {
  CompressedArrayTexture,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  float,
  int,
  mix,
  normalMap,
  positionLocal,
  positionWorld,
  round,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import type { AssetLoader, ByteProgressTracker } from './assetLoader.ts';

export const SURFACE_LAYERS = [
  'grass',    // 0: forrest_ground_01
  'dirt',     // 1: brown_mud_03
  'cobble',   // 2: cobblestone_02
  'plaster',  // 3: clay_plaster
  'beam',     // 4: dark_wood
  'boards',   // 5: oak_wood_planks
  'thatch',   // 6: reed_roof_04
  'shingles', // 7: roof_slates_02
  'rubble',   // 8: medieval_blocks_03
  'ashlar',   // 9: castle_brick_02_white
  'bark',     // 10: jolcham_oak_bark_01
  'linen',    // 11: rough_linen
] as const;

export type SurfaceLayerName = (typeof SURFACE_LAYERS)[number];

/** 7 Poly Haven photogrammetry terrain biomes imported from FPS/marchland (`assets/marchland/photo/`). */
export const PHOTO_TERRAIN_LAYERS = [
  'meadow',       // 0
  'pasture',      // 1
  'dry_grass',    // 2
  'forest_floor', // 3
  'farm_soil',    // 4
  'mud',          // 5
  'rock',         // 6
] as const;

export interface PhotoTerrainArrays {
  readonly albedoArray: DataArrayTexture;
  readonly normalArray: DataArrayTexture;
  readonly ormArray: DataArrayTexture;
  dispose(): void;
}

export interface SurfaceLibrary {
  readonly albedoArray: CompressedArrayTexture | DataArrayTexture;
  readonly normalArray: CompressedArrayTexture | DataArrayTexture;
  readonly ormArray: CompressedArrayTexture | DataArrayTexture;
  readonly photoTerrain: PhotoTerrainArrays | null;
  readonly buildingMaterial: MeshStandardNodeMaterial;
  /** Course-by-course shader-clipped material for buildings under construction (`object.userData.cutY`). */
  readonly siteBuildingMaterial: MeshStandardNodeMaterial;
  readonly groundMaterial: MeshStandardNodeMaterial;
  dispose(): void;
}

/** Packs 7 high-res photogrammetry JPEG texture sets into 3 GPU DataArrayTextures (512x512 RGBA8, mipmapped). */
async function loadPhotoTerrainArrays(anisotropy: number): Promise<PhotoTerrainArrays | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const size = 512;
  const depth = PHOTO_TERRAIN_LAYERS.length;

  const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${url}`));
      img.src = url;
    });

  const buildArray = async (file: 'color.jpg' | 'normal.jpg' | 'orm.jpg', srgb: boolean): Promise<DataArrayTexture> => {
    const imgs = await Promise.all(
      PHOTO_TERRAIN_LAYERS.map((name) => loadImage(`assets/marchland/photo/${name}/${file}`)),
    );
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    const sliceBytes = size * size * 4;
    const data = new Uint8Array(sliceBytes * depth);
    for (let z = 0; z < depth; z++) {
      ctx.drawImage(imgs[z]!, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      data.set(px, z * sliceBytes);
    }
    const arr = new DataArrayTexture(data, size, size, depth);
    arr.format = RGBAFormat;
    arr.type = UnsignedByteType;
    arr.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    arr.wrapS = RepeatWrapping;
    arr.wrapT = RepeatWrapping;
    arr.minFilter = LinearMipmapLinearFilter;
    arr.magFilter = LinearFilter;
    arr.generateMipmaps = true;
    arr.anisotropy = anisotropy;
    arr.needsUpdate = true;
    return arr;
  };

  try {
    const [albedoArray, normalArray, ormArray] = await Promise.all([
      buildArray('color.jpg', true),
      buildArray('normal.jpg', false),
      buildArray('orm.jpg', false),
    ]);
    return {
      albedoArray,
      normalArray,
      ormArray,
      dispose() {
        albedoArray.dispose();
        normalArray.dispose();
        ormArray.dispose();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Loads the 12-layer KTX2 surface library into 3 GPU texture arrays and compiles the shared
 * TSL building material (UV0 box-projected, UV1.x = layer/15, 1-UV1.y = iron metal flag, COLOR_0 = Cycles AO),
 * course-by-course construction site clipping material, photogrammetry terrain PBR arrays,
 * and dual-scale medieval village ground material.
 */
export async function loadSurfaceLibrary(
  loader: AssetLoader,
  anisotropy: number,
  tracker?: ByteProgressTracker,
): Promise<SurfaceLibrary> {
  const albedoUrls = SURFACE_LAYERS.map((id) => `assets/surfaces/${id}_albedo.ktx2`);
  const normalUrls = SURFACE_LAYERS.map((id) => `assets/surfaces/${id}_normal.ktx2`);
  const ormUrls = SURFACE_LAYERS.map((id) => `assets/surfaces/${id}_orm.ktx2`);

  const [albedoArray, normalArray, ormArray, photoTerrain] = await Promise.all([
    loader.loadKtx2Array(albedoUrls, true, anisotropy, tracker),
    loader.loadKtx2Array(normalUrls, false, anisotropy, tracker),
    loader.loadKtx2Array(ormUrls, false, anisotropy, tracker),
    loadPhotoTerrainArrays(anisotropy),
  ]);

  const buildingMaterial = createBuildingSurfaceMaterial(albedoArray, normalArray, ormArray, false);
  const siteBuildingMaterial = createBuildingSurfaceMaterial(albedoArray, normalArray, ormArray, true);
  const groundMaterial = createVillageGroundMaterial(albedoArray, normalArray, ormArray);

  return {
    albedoArray,
    normalArray,
    ormArray,
    photoTerrain,
    buildingMaterial,
    siteBuildingMaterial,
    groundMaterial,
    dispose() {
      buildingMaterial.dispose();
      siteBuildingMaterial.dispose();
      groundMaterial.dispose();
      albedoArray.dispose();
      normalArray.dispose();
      ormArray.dispose();
      photoTerrain?.dispose();
    },
  };
}

const UNCUT_Y = 1e6;

function createBuildingSurfaceMaterial(
  albedoArray: CompressedArrayTexture | DataArrayTexture,
  normalArray: CompressedArrayTexture | DataArrayTexture,
  ormArray: CompressedArrayTexture | DataArrayTexture,
  constructionSite: boolean,
): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.name = constructionSite ? 'MarchlandBuildingSiteMat' : 'MarchlandBuildingSurfaceMat';

  const uv0 = uv(0);
  const uv1 = uv(1);

  // UV1.x carries `layer / 15.0` from Blender; UV1.y is V-flipped by glTF so `1.0 - uv1.y` is metalFlag.
  const layerFloat = round(clamp(uv1.x.mul(15.0), 0.0, 11.0));
  const layerIdx = int(layerFloat);
  const ironMask = smoothstep(float(0.45), float(0.85), float(1.0).sub(uv1.y));

  const albSample = texture(albedoArray, uv0).depth(layerIdx).rgb;
  const norSample = texture(normalArray, uv0).depth(layerIdx).rgb;
  const ormSample = texture(ormArray, uv0).depth(layerIdx);

  // Lift clay_plaster (layer 3) gently into warm lime-washed medieval wattle-and-daub plaster
  // so dark oak half-timbering contrasts crisply in daylight (still strictly below 0.85 linear cap).
  const isPlaster = smoothstep(float(0.5), float(0.05), abs(layerFloat.sub(3.0)));
  const plasterLifted = albSample.mul(mix(vec3(1.0), vec3(1.62, 1.56, 1.44), isPlaster));

  // Forged iron door hinges, shutter straps, and handle override albedo/roughness/metalness.
  const baseAlb = mix(plasterLifted, vec3(0.24, 0.24, 0.26), ironMask);

  // Multiply by Cycles-baked vertex AO & weathering tint (COLOR_0) + micro-AO from ORM.r.
  const vcol = vertexColor().rgb;
  const microAo = mix(float(0.76), float(1.0), ormSample.r);

  // Stage 5 architectural realism: organic damp soil & moss weathering along lower stone/timber footings
  // (`positionLocal.y < 0.95 m`) modulated by world-space macro breakup — zero extra texture fetches!
  const footNoise = sin(positionWorld.x.mul(1.35).add(sin(positionWorld.z.mul(1.15)).mul(1.6)))
    .mul(sin(positionWorld.z.mul(1.48).sub(positionWorld.x.mul(0.92))))
    .mul(0.5)
    .add(0.5);
  const footHeight = float(1.0).sub(smoothstep(float(-0.15), float(0.95), positionLocal.y.add(footNoise.mul(0.32))));
  const dampMask = footHeight.mul(float(0.52).add(footNoise.mul(0.32))).mul(float(1.0).sub(ironMask));
  const mossTint = mix(vec3(0.42, 0.40, 0.34), vec3(0.30, 0.36, 0.22), footNoise);
  const weatheredAlb = mix(baseAlb, baseAlb.mul(mossTint), dampMask.mul(0.58));

  const finalColor = clamp(weatheredAlb.mul(vcol).mul(microAo), vec3(0.015), vec3(0.82));
  if (constructionSite) {
    // Course-by-course construction clipping (FPS/marchland townView.ts): discards geometry above `userData.cutY`
    // and washes out unbuilt courses slightly grey until the last course is laid!
    const cutY = uniform(UNCUT_Y).onObjectUpdate(
      (frame) => (frame.object?.userData['cutY'] as number | undefined) ?? UNCUT_Y,
    );
    mat.maskNode = positionWorld.y.lessThan(cutY);
    const grey = dot(finalColor, vec3(0.299, 0.587, 0.114)).mul(1.08);
    mat.colorNode = mix(finalColor, vec3(grey), float(0.72));
  } else {
    mat.colorNode = finalColor;
  }

  // Normal map detail (slightly damped on forged iron so straps stay cleanly read).
  const normalStrength = mix(float(1.0), float(0.45), ironMask);
  mat.normalNode = normalMap(norSample, vec2(normalStrength, normalStrength));

  // Physical roughness & metalness from ORM + forged iron flag (damp footings subtly tighten roughness).
  const dielectricRough = mix(clamp(ormSample.g, 0.42, 0.96), float(0.68), dampMask.mul(0.35));
  mat.roughnessNode = mix(dielectricRough, float(0.44), ironMask);
  mat.metalnessNode = mix(clamp(ormSample.b, 0.0, 0.15), float(0.88), ironMask);

  return mat;
}

function createVillageGroundMaterial(
  albedoArray: CompressedArrayTexture | DataArrayTexture,
  normalArray: CompressedArrayTexture | DataArrayTexture,
  ormArray: CompressedArrayTexture | DataArrayTexture,
): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.name = 'MarchlandVillageGroundMat';

  const wp = positionWorld.xz;

  // Real-world tile UVs matching Poly Haven physical texture scales (m per tile).
  const grassUv = wp.div(2.8);
  const dirtUv = wp.div(2.2);
  const cobbleUv = wp.div(1.9);

  // Two-scale organic macro variation breaks up tiling across the 560 m battlefield.
  const macroA = sin(wp.x.mul(0.065).add(sin(wp.y.mul(0.055)).mul(1.8)))
    .mul(sin(wp.y.mul(0.072).sub(wp.x.mul(0.048))))
    .mul(0.5)
    .add(0.5);
  const macroB = sin(wp.x.mul(0.27).add(wp.y.mul(0.19)))
    .mul(sin(wp.y.mul(0.31).sub(wp.x.mul(0.23))))
    .mul(0.5)
    .add(0.5);
  const edgeNoise = macroB.sub(0.5).mul(1.1);

  // Sample grass (0), dirt (1), cobble (2) from the SAME 3 shared texture arrays (0 extra textures).
  const grassAlb = texture(albedoArray, grassUv).depth(int(0)).rgb;
  const dirtAlb = texture(albedoArray, dirtUv).depth(int(1)).rgb;
  const cobbleAlb = texture(albedoArray, cobbleUv).depth(int(2)).rgb;

  const grassNor = texture(normalArray, grassUv).depth(int(0)).rgb;
  const dirtNor = texture(normalArray, dirtUv).depth(int(1)).rgb;
  const cobbleNor = texture(normalArray, cobbleUv).depth(int(2)).rgb;

  const grassOrm = texture(ormArray, grassUv).depth(int(0));
  const dirtOrm = texture(ormArray, dirtUv).depth(int(1));
  const cobbleOrm = texture(ormArray, cobbleUv).depth(int(2));

  // Village lane: gently curving cobbled road in front of the cottage (around z = 4.6 m).
  const laneCenterZ = float(4.6).add(sin(wp.x.mul(0.06)).mul(1.3));
  const laneDist = abs(wp.y.sub(laneCenterZ)).add(edgeNoise.mul(0.45));
  const laneSpan = smoothstep(float(46.0), float(28.0), abs(wp.x));
  const cobbleMask = float(1.0).sub(smoothstep(float(1.15), float(2.05), laneDist)).mul(laneSpan);

  // Trampled warm dirt cottage yard + path connecting cottage porch (0, -2.5) to cobbled lane.
  const yardDx = wp.x.sub(0.6).div(8.8);
  const yardDz = wp.y.add(0.8).div(7.2);
  const yardR = yardDx.mul(yardDx).add(yardDz.mul(yardDz)).add(edgeNoise.mul(0.18));
  const yardDirtMask = float(1.0).sub(smoothstep(float(0.58), float(1.15), yardR));

  // Soft dirt shoulder hugging the cobbled lane edges.
  const shoulderMask = float(1.0).sub(smoothstep(float(1.8), float(3.2), laneDist)).mul(laneSpan);
  const dirtMask = clamp(yardDirtMask.add(shoulderMask.mul(0.75)), 0.0, 1.0);

  // Subtle green-olive meadow lift & macro variation on grass so countryside feels alive in autumn light.
  const meadowTint = mix(vec3(0.88, 0.94, 0.78), vec3(1.14, 1.12, 0.88), macroA);
  const grassCol = grassAlb.mul(meadowTint);
  const dirtCol = dirtAlb.mul(vec3(1.26, 1.14, 0.96)).mul(mix(float(0.88), float(1.10), macroB));
  const cobbleCol = cobbleAlb.mul(mix(float(0.92), float(1.08), macroB));

  // Wet silt bank hugging the organic meadow pond at (-9.4, -0.4) (playbook §6aa: water needs a wet bank).
  const pondLpX = wp.x.add(9.4).div(3.4);
  const pondLpY = wp.y.add(0.4).div(-2.25);
  const pondEdgeWarp = sin(pondLpX.mul(3.1).add(pondLpY.mul(2.4)).add(0.5))
    .mul(0.11)
    .add(sin(pondLpX.mul(5.2).sub(pondLpY.mul(4.1)).add(1.5708)).mul(0.065));
  const pondR = pondLpX.mul(pondLpX).add(pondLpY.mul(pondLpY)).sqrt().add(pondEdgeWarp);
  const wetBankMask = float(1.0).sub(smoothstep(float(0.84), float(1.16), pondR));

  const grassDirtCol = mix(grassCol, dirtCol, clamp(dirtMask.add(wetBankMask.mul(0.9)), 0.0, 1.0));
  const dryFinalCol = mix(grassDirtCol, cobbleCol, cobbleMask);
  // Wet silt darkens albedo ~45% and tightens roughness into damp mud sheen.
  const finalCol = mix(dryFinalCol, dryFinalCol.mul(vec3(0.48, 0.45, 0.4)), wetBankMask);
  mat.colorNode = clamp(finalCol, vec3(0.02), vec3(0.72));

  const grassDirtNor = mix(grassNor, dirtNor, dirtMask);
  const finalNor = mix(grassDirtNor, cobbleNor, cobbleMask);
  mat.normalNode = normalMap(finalNor, vec2(0.85, 0.85));

  const grassDirtRough = mix(grassOrm.g, dirtOrm.g, dirtMask);
  const dryRough = mix(grassDirtRough, cobbleOrm.g, cobbleMask);
  const finalRough = mix(dryRough, float(0.28), wetBankMask);
  mat.roughnessNode = clamp(finalRough, 0.25, 0.96);
  mat.metalnessNode = float(0.0);

  return mat;
}

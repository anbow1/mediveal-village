// Stage 2 asset registry & medieval village showcase:
// - Loads real byte-accurate manifest.json + 12-layer KTX2 surface arrays + 4 Blender/Poly Haven assets
//   (house_l1 cottage, rigged animated swordsman, European oak, photogrammetry wine barrel).
// - Enforces 3 LODs + >100 m matte impostor cards + coarse opaque R7 shadow stand-ins (layer 1).
// - Preserves the Stage 1 18% grey calibration cube & PBR swatches at a dedicated spot (-26, 0, 22)
//   so exposure verification remains unbroken across every stage.

import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three/webgpu';
import { attribute } from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CALIBRATION, WORLD } from '../config.ts';
import {
  BUILDING_LOD_THRESHOLDS,
  PROP_LOD_THRESHOLDS,
  selectLodLevel,
  TREE_LOD_THRESHOLDS,
  UNIT_LOD_THRESHOLDS,
  type LodLevel,
  type LodThresholds,
} from '../sim/lodMath.ts';
import {
  type AssetLoader,
  type AssetManifest,
  createByteProgressTracker,
} from './assetLoader.ts';
import { ContactShadowBatch } from './contactShadows.ts';
import { SHADOW_ONLY_LAYER } from './lighting.ts';
import { createCalmWaterMaterial, type PhysicalSkyUniforms } from './sky.ts';
import { loadSurfaceLibrary, type SurfaceLibrary } from './surfaces.ts';

/** World position of the Stage 1 18% grey calibration plinth (offset from the village showcase). */
export const CALIBRATION_ANCHOR = new Vector3(-26, 0, 22);

interface LodTemplate {
  readonly lod0: Object3D;
  readonly lod1: Object3D;
  readonly lod2: Object3D;
  readonly shadow: Object3D;
  readonly animations: readonly AnimationClip[];
  readonly impostorTex?: Texture;
  readonly impostorWidthM?: number;
  readonly impostorHeightM?: number;
  readonly impostorBottomSinkM?: number;
  readonly skinned: boolean;
  readonly castFromLod0: boolean;
}

interface LodActor {
  readonly kind: 'building' | 'unit' | 'tree' | 'prop';
  readonly root: Group;
  readonly lodNodes: readonly [Object3D, Object3D, Object3D, Object3D | null];
  readonly shadowNode: Object3D;
  readonly thresholds: LodThresholds;
  readonly castFromLod0: boolean;
  readonly billboardNode: Object3D | null;
  level: LodLevel;
}

export interface Stage2WorldHandles {
  readonly surfaces: SurfaceLibrary;
  readonly manifest: AssetManifest;
  readonly update: (dtS: number, cameraPos: Vector3, paused: boolean) => void;
  readonly getLodSummary: () => Record<string, number>;
  readonly dispose: () => void;
}

function collectMeshMaterials(root: Object3D): Map<string, Material> {
  const map = new Map<string, Material>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat) return;
    if (mat.name) map.set(mat.name, mat);
    if (!map.has('__default')) map.set('__default', mat);
  });
  return map;
}

function configureModelMaterials(root: Object3D, opts: { alphaCutoutNames?: readonly string[]; forceVertexColor?: boolean }): void {
  const cutoutSet = new Set(opts.alphaCutoutNames ?? []);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geom = o.geometry as BufferGeometry;
    const hasColor = geom.hasAttribute('color');
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat instanceof MeshStandardMaterial) {
        if (hasColor && (opts.forceVertexColor ?? true)) {
          mat.vertexColors = true;
        }
        if (cutoutSet.has(mat.name) || o.name.toLowerCase().includes('canopy')) {
          // Crisp alpha-cutout foliage (never transparent:true or alphaToCoverage without MSAA).
          mat.transparent = false;
          mat.alphaTest = 0.45;
          mat.side = DoubleSide;
          mat.depthWrite = true;
          mat.roughness = 0.78;
          mat.metalness = 0.0;
        }
        mat.needsUpdate = true;
      }
    }
  });
}

function applySharedMaterialsFromLod0(target: Object3D, lod0Mats: Map<string, Material>): void {
  const fallback = lod0Mats.get('__default');
  target.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const cur = Array.isArray(o.material) ? o.material[0] : o.material;
    const byName = cur?.name ? lod0Mats.get(cur.name) : undefined;
    const byObject =
      o.name.toLowerCase().includes('canopy')
        ? lod0Mats.get('OakLeavesCutout')
        : o.name.toLowerCase().includes('trunk')
          ? lod0Mats.get('OakBarkPBR')
          : undefined;
    const chosen = byName ?? byObject ?? fallback;
    if (chosen) {
      o.material = chosen;
    }
  });
}

function overrideAllMaterials(root: Object3D, material: Material): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = material;
    }
  });
}

function setVisibleMeshFlags(root: Object3D, castShadow: boolean, receiveShadow: boolean): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.layers.set(0);
      o.castShadow = castShadow;
      o.receiveShadow = receiveShadow;
    }
  });
}

function configureShadowStandIn(root: Object3D, shadowMat: Material): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = shadowMat;
      // Layer 1 only: drawn exclusively by the sun shadow camera (invisible to main camera layer 0).
      o.layers.set(SHADOW_ONLY_LAYER);
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
}

/** Builds the Stage 1 calibration plinth, 18% grey cube, and PBR reference swatches offset to `CALIBRATION_ANCHOR`. */
function buildCalibrationRig(scene: Scene): void {
  const group = new Group();
  group.name = 'CalibrationRig';
  group.position.copy(CALIBRATION_ANCHOR);

  const greyMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.greyRoughness,
    metalness: 0.0,
  });
  greyMat.name = 'GreyCard18Material';
  greyMat.color.setRGB(CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear);

  const cubeSize = CALIBRATION.cubeSizeM;
  const greyCube = new Mesh(new BoxGeometry(cubeSize, cubeSize, cubeSize), greyMat);
  greyCube.name = 'GreyCard18Cube';
  greyCube.position.set(0, 0.16 + cubeSize * 0.5, 0);
  greyCube.castShadow = true;
  greyCube.receiveShadow = true;
  group.add(greyCube);

  interface SwatchDef {
    shape: 'box' | 'sphere';
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    r: number;
    g: number;
    b: number;
    rough: number;
    metal: number;
  }
  const swatches: SwatchDef[] = [
    { shape: 'box', x: 0, y: 0.08, z: 0, sx: 11.4, sy: 0.16, sz: 4.2, r: 0.21, g: 0.2, b: 0.19, rough: 0.88, metal: 0.0 },
    { shape: 'box', x: -3.6, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.026, g: 0.026, b: 0.027, rough: 0.96, metal: 0.0 },
    { shape: 'box', x: -2.2, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.18, g: 0.18, b: 0.18, rough: 0.9, metal: 0.0 },
    { shape: 'box', x: 2.2, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.21, g: 0.2, b: 0.19, rough: 0.85, metal: 0.0 },
    { shape: 'box', x: 3.6, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.67, g: 0.67, b: 0.63, rough: 0.72, metal: 0.0 },
    { shape: 'sphere', x: 4.9, y: 0.74, z: 0, sx: 0.58, sy: 0.58, sz: 0.58, r: 0.562, g: 0.565, b: 0.578, rough: 0.3, metal: 1.0 },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const surf: number[] = [];
  const indices: number[] = [];
  let vertOffset = 0;
  for (const s of swatches) {
    const geo = s.shape === 'sphere' ? new SphereGeometry(s.sx, 24, 16) : new BoxGeometry(s.sx, s.sy, s.sz);
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    const idx = geo.getIndex();
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i) + s.x, pos.getY(i) + s.y, pos.getZ(i) + s.z);
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      const ao = pos.getY(i) < 0 ? 0.84 : 1.0;
      colours.push(s.r * ao, s.g * ao, s.b * ao);
      surf.push(s.rough, s.metal);
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vertOffset);
    }
    vertOffset += pos.count;
    geo.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new Float32BufferAttribute(colours, 3));
  merged.setAttribute('aSurf', new Float32BufferAttribute(surf, 2));
  merged.setIndex(indices);

  const swatchMat = new MeshStandardNodeMaterial({ vertexColors: true });
  swatchMat.name = 'PbrSwatchMaterial';
  const aSurf = attribute('aSurf', 'vec2');
  swatchMat.roughnessNode = aSurf.x;
  swatchMat.metalnessNode = aSurf.y;

  const swatchMesh = new Mesh(merged, swatchMat);
  swatchMesh.name = 'PbrCalibrationSwatches';
  swatchMesh.castShadow = true;
  swatchMesh.receiveShadow = true;
  group.add(swatchMesh);
  scene.add(group);
}

/**
 * Loads all Stage 2 assets in parallel with real byte progress reporting and populates
 * the realistic medieval village showcase (cottage, animated swordsmen, oaks, barrels,
 * distant impostor hamlet, and calibration target).
 */
export async function buildStage2World(
  scene: Scene,
  loader: AssetLoader,
  skyUniforms: PhysicalSkyUniforms,
  anisotropy: number,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
): Promise<Stage2WorldHandles> {
  const manifestRes = await fetch('assets/manifest.json');
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch assets/manifest.json: HTTP ${manifestRes.status}`);
  }
  const manifest = (await manifestRes.json()) as AssetManifest;
  const tracker = createByteProgressTracker(manifest.totalBytes, onProgress);

  // Load all surface arrays, 4 asset LOD sets (16 GLBs), and 2 KTX2 matte impostors concurrently.
  const [
    surfaces,
    houseLod0,
    houseLod1,
    houseLod2,
    houseShadow,
    houseImpostorTex,
    unitLod0,
    unitLod1,
    unitLod2,
    unitShadow,
    oakLod0,
    oakLod1,
    oakLod2,
    oakShadow,
    oakImpostorTex,
    barrelLod0,
    barrelLod1,
    barrelLod2,
    barrelShadow,
  ] = await Promise.all([
    loadSurfaceLibrary(loader, anisotropy, tracker),
    loader.loadGlb('assets/buildings/house_l1_lod0.glb', tracker),
    loader.loadGlb('assets/buildings/house_l1_lod1.glb', tracker),
    loader.loadGlb('assets/buildings/house_l1_lod2.glb', tracker),
    loader.loadGlb('assets/buildings/house_l1_shadow.glb', tracker),
    loader.loadKtx2('assets/buildings/house_l1_impostor.ktx2', true, tracker),
    loader.loadGlb('assets/units/swordsman_lod0.glb', tracker),
    loader.loadGlb('assets/units/swordsman_lod1.glb', tracker),
    loader.loadGlb('assets/units/swordsman_lod2.glb', tracker),
    loader.loadGlb('assets/units/swordsman_shadow.glb', tracker),
    loader.loadGlb('assets/trees/oak_lod0.glb', tracker),
    loader.loadGlb('assets/trees/oak_lod1.glb', tracker),
    loader.loadGlb('assets/trees/oak_lod2.glb', tracker),
    loader.loadGlb('assets/trees/oak_shadow.glb', tracker),
    loader.loadKtx2('assets/trees/oak_impostor.ktx2', true, tracker),
    loader.loadGlb('assets/props/barrel_lod0.glb', tracker),
    loader.loadGlb('assets/props/barrel_lod1.glb', tracker),
    loader.loadGlb('assets/props/barrel_lod2.glb', tracker),
    loader.loadGlb('assets/props/barrel_shadow.glb', tracker),
  ]);

  // 1. Ground plane (560 x 560 m) using shared Poly Haven grass + dirt yard + cobbled village lane.
  const ground = new Mesh(new PlaneGeometry(WORLD.sizeM, WORLD.sizeM, 1, 1), surfaces.groundMaterial);
  ground.name = 'VillageGround';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Shared coarse opaque material for all R7 shadow stand-ins (layer 1 only; zero extra textures).
  const shadowStandInMat = new MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });
  shadowStandInMat.name = 'ShadowStandInMaterial';

  // 2. Wire shared materials onto every asset template.
  overrideAllMaterials(houseLod0.scene, surfaces.buildingMaterial);
  overrideAllMaterials(houseLod1.scene, surfaces.buildingMaterial);
  overrideAllMaterials(houseLod2.scene, surfaces.buildingMaterial);
  configureShadowStandIn(houseShadow.scene, shadowStandInMat);

  configureModelMaterials(unitLod0.scene, { forceVertexColor: true });
  const unitMats = collectMeshMaterials(unitLod0.scene);
  applySharedMaterialsFromLod0(unitLod1.scene, unitMats);
  applySharedMaterialsFromLod0(unitLod2.scene, unitMats);
  configureShadowStandIn(unitShadow.scene, shadowStandInMat);

  configureModelMaterials(oakLod0.scene, { alphaCutoutNames: ['OakLeavesCutout'], forceVertexColor: true });
  const oakMats = collectMeshMaterials(oakLod0.scene);
  applySharedMaterialsFromLod0(oakLod1.scene, oakMats);
  applySharedMaterialsFromLod0(oakLod2.scene, oakMats);
  configureShadowStandIn(oakShadow.scene, shadowStandInMat);

  configureModelMaterials(barrelLod0.scene, { forceVertexColor: true });
  const barrelMats = collectMeshMaterials(barrelLod0.scene);
  applySharedMaterialsFromLod0(barrelLod1.scene, barrelMats);
  applySharedMaterialsFromLod0(barrelLod2.scene, barrelMats);
  configureShadowStandIn(barrelShadow.scene, shadowStandInMat);

  const houseTemplate: LodTemplate = {
    lod0: houseLod0.scene,
    lod1: houseLod1.scene,
    lod2: houseLod2.scene,
    shadow: houseShadow.scene,
    animations: [],
    impostorTex: houseImpostorTex,
    impostorWidthM: 12.2,
    impostorHeightM: 12.2,
    impostorBottomSinkM: 3.25,
    skinned: false,
    castFromLod0: false,
  };

  const unitTemplate: LodTemplate = {
    lod0: unitLod0.scene,
    lod1: unitLod1.scene,
    lod2: unitLod2.scene,
    shadow: unitShadow.scene,
    animations: unitLod0.animations,
    skinned: true,
    castFromLod0: true,
  };

  const oakTemplate: LodTemplate = {
    lod0: oakLod0.scene,
    lod1: oakLod1.scene,
    lod2: oakLod2.scene,
    shadow: oakShadow.scene,
    animations: [],
    impostorTex: oakImpostorTex,
    impostorWidthM: 11.8,
    impostorHeightM: 11.8,
    impostorBottomSinkM: 0.35,
    skinned: false,
    castFromLod0: false,
  };

  const barrelTemplate: LodTemplate = {
    lod0: barrelLod0.scene,
    lod1: barrelLod1.scene,
    lod2: barrelLod2.scene,
    shadow: barrelShadow.scene,
    animations: [],
    skinned: false,
    castFromLod0: false,
  };

  // Shared matte impostor materials (roughness 0.92, metalness 0, alphaTest 0.45, DoubleSide — never glossy).
  const impostorMaterials = new Map<Texture, MeshStandardNodeMaterial>();
  const getImpostorMaterial = (tex: Texture, name: string): MeshStandardNodeMaterial => {
    const existing = impostorMaterials.get(tex);
    if (existing) return existing;
    const m = new MeshStandardNodeMaterial({
      map: tex,
      roughness: 0.92,
      metalness: 0.0,
      alphaTest: 0.45,
      side: DoubleSide,
      transparent: false,
    });
    m.name = name;
    impostorMaterials.set(tex, m);
    return m;
  };

  const actors: LodActor[] = [];
  const mixers: AnimationMixer[] = [];
  const disposableGeos: BufferGeometry[] = [];

  const spawnActor = (
    kind: LodActor['kind'],
    name: string,
    tpl: LodTemplate,
    thresholds: LodThresholds,
    pos: readonly [number, number, number],
    yawRad: number,
    scale = 1.0,
    animSpec?: { clipName: string; phaseOffsetS: number; speed?: number },
  ): LodActor => {
    const root = new Group();
    root.name = name;
    root.position.set(pos[0], pos[1], pos[2]);
    root.rotation.y = yawRad;
    root.scale.setScalar(scale);

    const n0 = tpl.skinned ? cloneSkinned(tpl.lod0) : tpl.lod0.clone(true);
    const n1 = tpl.lod1.clone(true);
    const n2 = tpl.lod2.clone(true);
    const nSh = tpl.shadow.clone(true);

    n0.name = `${name}_lod0`;
    n1.name = `${name}_lod1`;
    n2.name = `${name}_lod2`;
    nSh.name = `${name}_shadow`;

    setVisibleMeshFlags(n0, tpl.castFromLod0, true);
    setVisibleMeshFlags(n1, false, true);
    setVisibleMeshFlags(n2, false, true);
    configureShadowStandIn(nSh, shadowStandInMat);

    if (tpl.skinned) {
      n0.traverse((o) => {
        if (o instanceof Mesh) {
          o.frustumCulled = false;
        }
      });
    }

    let impNode: Mesh | null = null;
    if (tpl.impostorTex && tpl.impostorWidthM && tpl.impostorHeightM) {
      const geo = new PlaneGeometry(tpl.impostorWidthM, tpl.impostorHeightM);
      // KTX2 compressed textures have flipY=false (row 0 at top), so flip PlaneGeometry V to stand right-side up.
      const uvAttr = geo.getAttribute('uv');
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setY(i, 1.0 - uvAttr.getY(i));
      }
      uvAttr.needsUpdate = true;
      geo.translate(0, tpl.impostorHeightM * 0.5 - (tpl.impostorBottomSinkM ?? 0.35), 0);
      disposableGeos.push(geo);
      const impMat = getImpostorMaterial(tpl.impostorTex, `${kind}_ImpostorMat`);
      impNode = new Mesh(geo, impMat);
      impNode.name = `${name}_impostor`;
      impNode.layers.set(0);
      impNode.castShadow = false;
      impNode.receiveShadow = true;
      impNode.visible = false;
      root.add(impNode);
    }

    n0.visible = true;
    n1.visible = false;
    n2.visible = false;
    nSh.visible = !tpl.castFromLod0;

    root.add(n0, n1, n2, nSh);
    scene.add(root);

    if (tpl.skinned && animSpec && tpl.animations.length > 0) {
      const clip = tpl.animations.find((c) => c.name === animSpec.clipName) ?? tpl.animations[0];
      if (clip) {
        const mixer = new AnimationMixer(n0);
        const action = mixer.clipAction(clip);
        action.timeScale = animSpec.speed ?? 1.0;
        action.play();
        mixer.update(animSpec.phaseOffsetS);
        mixers.push(mixer);
      }
    }

    const actor: LodActor = {
      kind,
      root,
      lodNodes: [n0, n1, n2, impNode],
      shadowNode: nSh,
      thresholds,
      castFromLod0: tpl.castFromLod0,
      billboardNode: impNode,
      level: 0,
    };
    actors.push(actor);
    return actor;
  };

  // ---------------- STAGE 2 / STAGE 3 MEDIEVAL VILLAGE YARD SHOWCASE ----------------
  const contactBatch = new ContactShadowBatch();

  spawnActor('building', 'HouseL1_Hero', houseTemplate, BUILDING_LOD_THRESHOLDS, [0, 0, -2.6], 0.0, 1.0);
  contactBatch.addRect(0, -2.6, 8.2, 5.6, 0.0, 1.0, 0.95);

  spawnActor('unit', 'Swordsman_Hero', unitTemplate, UNIT_LOD_THRESHOLDS, [2.2, 0, 3.85], -0.32, 1.0, {
    clipName: 'idle',
    phaseOffsetS: 0.2,
    speed: 0.9,
  });
  contactBatch.addDisc(2.2, 3.85, 0.62, 0.85, 0.26);

  spawnActor('unit', 'Swordsman_GuardA', unitTemplate, UNIT_LOD_THRESHOLDS, [5.1, 0, 2.55], -0.58, 1.0, {
    clipName: 'idle',
    phaseOffsetS: 1.1,
    speed: 0.85,
  });
  contactBatch.addDisc(5.1, 2.55, 0.62, 0.85, 0.26);

  spawnActor('unit', 'Swordsman_GuardB', unitTemplate, UNIT_LOD_THRESHOLDS, [-4.9, 0, 3.65], 0.42, 1.0, {
    clipName: 'walk',
    phaseOffsetS: 0.4,
    speed: 0.72,
  });
  contactBatch.addDisc(-4.9, 3.65, 0.62, 0.85, 0.26);

  spawnActor('tree', 'Oak_West', oakTemplate, TREE_LOD_THRESHOLDS, [-7.2, 0, -3.8], 0.65, 1.02);
  contactBatch.addDisc(-7.2, -3.8, 1.35, 0.92, 0.3);
  contactBatch.addDisc(-7.2, -3.8, 4.5, 0.36, 0.22);

  spawnActor('tree', 'Oak_East', oakTemplate, TREE_LOD_THRESHOLDS, [8.4, 0, -4.6], 2.35, 0.94);
  contactBatch.addDisc(8.4, -4.6, 1.28, 0.92, 0.3);
  contactBatch.addDisc(8.4, -4.6, 4.2, 0.36, 0.22);

  spawnActor('prop', 'Barrel_PorchA', barrelTemplate, PROP_LOD_THRESHOLDS, [-3.35, 0, 1.48], 0.4, 1.0);
  contactBatch.addDisc(-3.35, 1.48, 0.56, 0.95, 0.42);
  spawnActor('prop', 'Barrel_PorchB', barrelTemplate, PROP_LOD_THRESHOLDS, [-4.05, 0, 1.16], 1.85, 0.96);
  contactBatch.addDisc(-4.05, 1.16, 0.54, 0.95, 0.42);
  spawnActor('prop', 'Barrel_PorchC', barrelTemplate, PROP_LOD_THRESHOLDS, [-3.52, 0, 0.68], 3.1, 1.03);
  contactBatch.addDisc(-3.52, 0.68, 0.58, 0.95, 0.42);

  // Midground farmstead (~65 m north-east) exercising CSM Cascade 1 (27..96 m) live
  spawnActor('building', 'HouseL1_Midground', houseTemplate, BUILDING_LOD_THRESHOLDS, [34, 0, -56], -0.45, 1.0);
  contactBatch.addRect(34, -56, 8.2, 5.6, -0.45, 0.9, 0.95);
  spawnActor('tree', 'Oak_Midground', oakTemplate, TREE_LOD_THRESHOLDS, [25, 0, -52], 1.7, 1.04);
  contactBatch.addDisc(25, -52, 4.4, 0.36, 0.25);

  // Distant hamlet (> 118 m north-west) exercising CSM Cascade 2 (96..320 m) & >100 m matte impostors live
  spawnActor('building', 'HouseL1_Distant', houseTemplate, BUILDING_LOD_THRESHOLDS, [-54, 0, -114], 0.35, 1.0);
  contactBatch.addRect(-54, -114, 8.2, 5.6, 0.35, 0.85, 0.95);
  spawnActor('tree', 'Oak_DistantA', oakTemplate, TREE_LOD_THRESHOLDS, [-64, 0, -118], 1.2, 1.05);
  spawnActor('tree', 'Oak_DistantB', oakTemplate, TREE_LOD_THRESHOLDS, [-44, 0, -112], 4.1, 0.92);

  // Stage 3 calm meadow pond (proves unified sky dome = PMREM = height fog = water reflection)
  const pondGeo = new CircleGeometry(1, 40);
  const pondMat = createCalmWaterMaterial(skyUniforms);
  const pondMesh = new Mesh(pondGeo, pondMat);
  pondMesh.name = 'VillageRainwaterPond';
  pondMesh.rotation.x = -Math.PI / 2;
  pondMesh.scale.set(3.4, 2.25, 1);
  pondMesh.position.set(-9.4, 0.02, -0.4);
  pondMesh.castShadow = false;
  pondMesh.receiveShadow = false;
  pondMesh.renderOrder = 3;
  scene.add(pondMesh);
  disposableGeos.push(pondGeo);

  buildCalibrationRig(scene);
  contactBatch.addRect(CALIBRATION_ANCHOR.x, CALIBRATION_ANCHOR.z, 11.4, 4.2, 0.0, 0.72, 0.55);

  const contactShadowsMesh = contactBatch.build(skyUniforms.uContactShadowGain, 0.012);
  scene.add(contactShadowsMesh);
  disposableGeos.push(contactShadowsMesh.geometry as BufferGeometry);

  const tmpPos = new Vector3();

  const update = (dtS: number, cameraPos: Vector3, paused: boolean): void => {
    if (!paused && dtS > 0) {
      for (const m of mixers) {
        m.update(dtS);
      }
    }

    for (const actor of actors) {
      actor.root.getWorldPosition(tmpPos);
      const dist = tmpPos.distanceTo(cameraPos);
      const next = selectLodLevel(dist, actor.level, actor.thresholds);
      if (next !== actor.level) {
        actor.level = next;
        const [n0, n1, n2, imp] = actor.lodNodes;
        n0.visible = next === 0;
        n1.visible = next === 1;
        n2.visible = next === 2;
        if (imp) imp.visible = next === 3;
        if (actor.castFromLod0) {
          actor.shadowNode.visible = next !== 0;
        }
      }
      if (actor.billboardNode && actor.billboardNode.visible) {
        const dx = cameraPos.x - tmpPos.x;
        const dz = cameraPos.z - tmpPos.z;
        actor.billboardNode.rotation.y = Math.atan2(dx, dz) - actor.root.rotation.y;
      }
    }
  };

  const getLodSummary = (): Record<string, number> => {
    const counts: Record<string, number> = { lod0: 0, lod1: 0, lod2: 0, impostor: 0 };
    for (const a of actors) {
      const k = a.level === 3 ? 'impostor' : `lod${a.level}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  };

  const dispose = (): void => {
    surfaces.dispose();
    shadowStandInMat.dispose();
    pondMat.dispose();
    (contactShadowsMesh.material as Material).dispose();
    houseImpostorTex.dispose();
    oakImpostorTex.dispose();
    for (const m of impostorMaterials.values()) m.dispose();
    for (const g of disposableGeos) g.dispose();
  };

  return { surfaces, manifest, update, getLodSummary, dispose };
}

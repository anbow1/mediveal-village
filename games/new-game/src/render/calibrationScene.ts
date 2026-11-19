// Stage 1 calibration & verification scene:
// - 18 % grey calibration cube (2 x 2 x 2 m) under 100 000 lx sun for exposure proof
// - PBR reference swatches (soot 0.04, grey 0.18, stone 0.50, plaster 0.85, iron metal F0)
// - 560 x 560 m ground plane with subtle dual-scale variation & metric grid lines
// - Static instanced boundary markers (exercising markStaticInstances + shareStaticInstanceShaders)

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Scene,
} from 'three/webgpu';
import { abs, attribute, float, fract, fwidth, max, min, mix, positionWorld, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import { CALIBRATION, WORLD } from '../config.ts';
import { markStaticInstances } from './instancing.ts';

export interface CalibrationSceneHandles {
  readonly ground: Mesh;
  readonly greyCube: Mesh;
  readonly markers: InstancedMesh;
}

/** Merges simple box/sphere geometries with per-vertex linear colour + (roughness, metalness) attributes. */
function makeSwatchGeometry(): BufferGeometry {
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

  // PBR reference values from NUMBERS.md (all in linear RGB).
  const swatches: SwatchDef[] = [
    // Low stone plinth beneath the calibration targets
    { shape: 'box', x: 0, y: 0.08, z: 0, sx: 11.4, sy: 0.16, sz: 4.2, r: 0.21, g: 0.2, b: 0.19, rough: 0.88, metal: 0.0 },
    // Dark soot / charcoal (linear ~0.026, NUMBERS.md floor 0.021)
    { shape: 'box', x: -3.6, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.026, g: 0.026, b: 0.027, rough: 0.96, metal: 0.0 },
    // 18 % grey reference block (left of main cube)
    { shape: 'box', x: -2.2, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.18, g: 0.18, b: 0.18, rough: 0.9, metal: 0.0 },
    // Granite / weathered stone (linear ~0.20)
    { shape: 'box', x: 2.2, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.21, g: 0.2, b: 0.19, rough: 0.85, metal: 0.0 },
    // Lime plaster / white paint (never pure white: #d6d6d0 -> linear ~0.67)
    { shape: 'box', x: 3.6, y: 0.76, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.67, g: 0.67, b: 0.63, rough: 0.72, metal: 0.0 },
    // Worn steel / iron sphere (F0 linear from NUMBERS.md: 0.562, 0.565, 0.578, metal 1.0, rough 0.30)
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
      // Subtle baked vertical AO at the base of each block (R3).
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
  return merged;
}

export function buildCalibrationScene(scene: Scene): CalibrationSceneHandles {
  // 1. 560 x 560 m ground slab with dual-scale organic tonal variation + anti-aliased 10 m / 50 m metric lines.
  const groundMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.groundRoughness,
    metalness: 0.0,
  });
  groundMat.name = 'CalibrationGroundMaterial';

  const baseSoil = new Color(CALIBRATION.groundBaseHex);
  const wp = positionWorld.xz;
  // Two-scale variation (~25 m macro and ~3 m micro, GUIDE.md §2b: never one flat tone).
  const macro = sin(wp.x.mul(0.08).add(sin(wp.y.mul(0.07)))).mul(sin(wp.y.mul(0.09).sub(wp.x.mul(0.05)))).mul(0.5).add(0.5);
  const micro = sin(wp.x.mul(1.7).add(wp.y.mul(1.3))).mul(sin(wp.y.mul(2.1).sub(wp.x.mul(1.9)))).mul(0.5).add(0.5);
  const tone = float(0.86).add(macro.mul(0.22)).add(micro.mul(0.08));

  // Derivative-anti-aliased 10 m and 50 m metric calibration lines (playbook §11 lineAA).
  const g10 = abs(fract(wp.div(10.0).sub(0.5)).sub(0.5)).div(max(fwidth(wp.div(10.0)), vec2(0.0001)));
  const line10 = float(1.0).sub(min(min(g10.x, g10.y), float(1.0)));
  const g50 = abs(fract(wp.div(50.0).sub(0.5)).sub(0.5)).div(max(fwidth(wp.div(50.0)), vec2(0.0001)));
  const line50 = float(1.0).sub(min(min(g50.x, g50.y), float(1.0)));

  const soilCol = vec3(baseSoil.r, baseSoil.g, baseSoil.b).mul(tone);
  const withGrid = mix(soilCol, soilCol.mul(1.22), line10.mul(0.18));
  const withMajor = mix(withGrid, vec3(0.42, 0.39, 0.33), line50.mul(0.35));
  groundMat.colorNode = withMajor;
  groundMat.roughnessNode = mix(float(0.95), float(0.82), smoothstep(float(0.2), float(0.8), macro));

  const ground = new Mesh(new PlaneGeometry(WORLD.sizeM, WORLD.sizeM, 1, 1), groundMat);
  ground.name = 'CalibrationGround';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 2. Primary 18 % grey calibration cube (2 x 2 x 2 m) at (0, 1.16, 0) atop the plinth.
  const greyMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.greyRoughness,
    metalness: 0.0,
  });
  greyMat.name = 'GreyCard18Material';
  // Exact linear 0.18 reflectance (do NOT pass through sRGB conversion).
  greyMat.color.setRGB(CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear);

  const cubeSize = CALIBRATION.cubeSizeM;
  const greyCube = new Mesh(new BoxGeometry(cubeSize, cubeSize, cubeSize), greyMat);
  greyCube.name = 'GreyCard18Cube';
  greyCube.position.set(0, 0.16 + cubeSize * 0.5, 0);
  greyCube.castShadow = true;
  greyCube.receiveShadow = true;
  scene.add(greyCube);

  // 3. Companion PBR calibration swatches (single material + vertex attributes).
  const swatchMat = new MeshStandardNodeMaterial({ vertexColors: true });
  swatchMat.name = 'PbrSwatchMaterial';
  const aSurf = attribute('aSurf', 'vec2');
  swatchMat.roughnessNode = aSurf.x;
  swatchMat.metalnessNode = aSurf.y;

  const swatchMesh = new Mesh(makeSwatchGeometry(), swatchMat);
  swatchMesh.name = 'PbrCalibrationSwatches';
  swatchMesh.castShadow = true;
  swatchMesh.receiveShadow = true;
  scene.add(swatchMesh);

  // 4. Static instanced map landmark posts (100 m vertical slice perimeter + 560 m map landmarks).
  const postMat = new MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0.0 });
  postMat.name = 'LandmarkPostMaterial';
  postMat.color.setHex(0x8f8b85);

  const postGeo = new BoxGeometry(0.8, 3.2, 0.8);
  postGeo.translate(0, 1.6, 0);

  const transforms: { x: number; z: number; sx: number; sy: number; sz: number; hex: number }[] = [];
  // 100 x 100 m vertical slice corner & edge posts
  for (let x = -50; x <= 50; x += 25) {
    for (let z = -50; z <= 50; z += 25) {
      if (Math.abs(x) !== 50 && Math.abs(z) !== 50) continue;
      const corner = Math.abs(x) === 50 && Math.abs(z) === 50;
      transforms.push({ x, z, sx: corner ? 1.5 : 0.8, sy: corner ? 1.6 : 1.0, sz: corner ? 1.5 : 0.8, hex: corner ? 0x8a4b3a : 0x8f8b85 });
    }
  }
  // Key battlefield landmarks for fixed bench views (rally, field, enemy keep)
  transforms.push(
    { x: 28, z: 18, sx: 4.0, sy: 1.5, sz: 4.0, hex: 0x6b5a47 },
    { x: 90, z: -60, sx: 5.0, sy: 2.0, sz: 5.0, hex: 0x7a7672 },
    { x: -140, z: -140, sx: 9.0, sy: 3.5, sz: 9.0, hex: 0x8a4b3a },
    { x: 140, z: 140, sx: 9.0, sy: 3.5, sz: 9.0, hex: 0x4b5d7a },
  );

  const markers = markStaticInstances(new InstancedMesh(postGeo, postMat, transforms.length));
  markers.name = 'LandmarkPosts';
  markers.castShadow = true;
  markers.receiveShadow = true;
  const mat4 = new Matrix4();
  const col = new Color();
  transforms.forEach((t, i) => {
    mat4.makeScale(t.sx, t.sy, t.sz).setPosition(t.x, 0, t.z);
    markers.setMatrixAt(i, mat4);
    col.setHex(t.hex);
    markers.setColorAt(i, col);
  });
  markers.instanceMatrix.needsUpdate = true;
  if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
  scene.add(markers);

  return { ground, greyCube, markers };
}

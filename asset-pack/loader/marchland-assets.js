// Marchland's ready assets in any three.js game (r186, WebGPURenderer or its WebGL2 fallback).
// No build step: an ES module that imports 'three', 'three/tsl' and the GLTF loader through an import
// map (see ../example/index.html). The formats are in ../FORMATS.md.
//
//   const knight = rigged(await loadJSON('models/soldiers/swordsman.json'), { team: 0x2f5fb0 });
//   scene.add(knight.mesh);
//   knight.play('walk', seconds);           // every frame
//
// What the game does on top of this (one instanced mesh per kind of unit, every man his own frame,
// the bone matrices in a texture read by the vertex shader) is in docs/PLAYBOOK.md §4; this module
// uses three's own SkinnedMesh so it is the shortest way to put a model on screen.

import * as THREE from 'three';
import { attribute, float, texture, triplanarTexture, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The scanned surfaces in textures/ (a material named otherwise is a plain colour). */
export const SURFACES = ['meadow', 'dry_grass', 'dirt', 'mud', 'forest_floor', 'farm_soil', 'plaster', 'beam', 'boards', 'thatch', 'shingles', 'tiles', 'rubble', 'ashlar', 'bark', 'leaves', 'rock', 'pasture'];

export async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/** Vertex colours with the side's colour laid over the garment (surface z: its share, 0..1). */
function colours(model, team, stride = 3) {
  const out = new Float32Array(model.colours.length);
  const t = new THREE.Color(team);
  for (let i = 0; i < out.length / 3; i++) {
    const share = model.surface && stride === 3 ? model.surface[i * 3 + 2] : 0;
    out[i * 3] = model.colours[i * 3] * (1 - share) + t.r * share;
    out[i * 3 + 1] = model.colours[i * 3 + 1] * (1 - share) + t.g * share;
    out[i * 3 + 2] = model.colours[i * 3 + 2] * (1 - share) + t.b * share;
  }
  return out;
}

/** A material with metalness and roughness per vertex (the models' `surface`). */
function surfaceMaterial(stride) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const s = attribute('aSurface', stride === 3 ? 'vec3' : 'vec2');
  m.metalnessNode = s.x;
  m.roughnessNode = s.y;
  return m;
}

function baseGeometry(model, stride) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(model.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(model.normals, 3));
  g.setIndex(model.triangles);
  if (model.surface) g.setAttribute('aSurface', new THREE.Float32BufferAttribute(model.surface, stride));
  return g;
}

/**
 * A rigged model (soldiers/*.json, people/*.json, warhorse.json): a SkinnedMesh whose bones take the
 * baked matrices of any frame. Returns { mesh, clips, frames, setFrame(f), play(name, seconds) }.
 */
export function rigged(model, { team = 0x2f5fb0 } = {}) {
  const g = baseGeometry(model, 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours(model, team), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(model.skin, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(model.weights, 4));
  const bones = model.bones.map((name) => Object.assign(new THREE.Bone(), { name, matrixAutoUpdate: false }));
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  const mesh = new THREE.SkinnedMesh(g, surfaceMaterial(3));
  // The frames map the bind pose to the pose in the model's own space: bones relative to the mesh.
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  const nb = model.bones.length;
  const frames = model.frames.length / (nb * 12);
  const clips = Object.fromEntries(model.clips.map((c) => [c.name, c]));
  const setFrame = (f) => {
    const base = Math.max(0, Math.min(frames - 1, f)) * nb * 12;
    for (let b = 0; b < nb; b++) {
      const m = model.frames;
      const o = base + b * 12;
      bones[b].matrixWorld.set(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], m[o + 6], m[o + 7], m[o + 8], m[o + 9], m[o + 10], m[o + 11], 0, 0, 0, 1);
    }
    skeleton.update();
  };
  /** Shows clip `name` at `seconds` (looping); the global frame it showed. */
  const play = (name, seconds, loop = true) => {
    const c = clips[name] ?? model.clips[0];
    let k = Math.floor(seconds * c.fps);
    k = loop ? ((k % c.frames) + c.frames) % c.frames : Math.min(c.frames - 1, Math.max(0, k));
    setFrame(c.start + k);
    return c.start + k;
  };
  setFrame(0);
  return { mesh, clips, frames, bones: model.bones, setFrame, play, model };
}

/** A rider (soldiers/rider.json: one seated pose, limbs instead of bones) as a plain mesh. */
export function body(model) {
  const g = baseGeometry(model, 2);
  g.setAttribute('color', new THREE.Float32BufferAttribute(model.colours, 3));
  const mesh = new THREE.Mesh(g, surfaceMaterial(2));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * Seats a rider (body()) on a rigged horse (rigged() of warhorse.json): his hips on the saddle, carried
 * by the horse's saddle bone. Call the returned function after every horse.play / setFrame.
 */
export function mount(horse, riderMesh, riderModel) {
  const { bone, y, z } = horse.model.saddle;
  const seat = new THREE.Matrix4().makeTranslation(0, y - riderModel.pivots.hipY, z - riderModel.pivots.hipZ);
  riderMesh.matrixAutoUpdate = false;
  horse.mesh.add(riderMesh);
  return () => {
    riderMesh.matrix.multiplyMatrices(horse.mesh.skeleton.bones[bone].matrixWorld, seat);
  };
}

/** A prop (props/*.json, props/goods/*.json): positions, normals, colours, triangles. */
export function prop(model) {
  const g = baseGeometry(model, 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(model.colours, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * A building (buildings/*.glb). Its materials name the game's scanned surfaces ('plaster',
 * 'beam#d8cfc6' tinted) or plain colours ('glass#20252a'); 'team' is the owner's colour. Surfaces are
 * laid on by world-scale triplanar mapping from textures/<surface>/color.jpg at their real size.
 */
export async function building(url, { textures = 'textures/', team = 0x2f5fb0 } = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const cache = new Map();
  const surfaceOf = async (id) => {
    if (!cache.has(id)) {
      cache.set(
        id,
        (async () => {
          const meta = await loadJSON(`${textures}${id}/meta.json`).catch(() => null);
          if (!meta) return null;
          const map = await new THREE.TextureLoader().loadAsync(`${textures}${id}/color.jpg`);
          map.colorSpace = THREE.SRGBColorSpace;
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          return { map, sizeM: meta.size_m };
        })(),
      );
    }
    return cache.get(id);
  };
  const jobs = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const [name, hex] = o.material.name.split('#');
    const tint = new THREE.Color(hex ? Number.parseInt(hex, 16) : 0xffffff);
    jobs.push(
      (async () => {
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
        if (name === 'team') m.color = new THREE.Color(team);
        else {
          const s = SURFACES.includes(name) ? await surfaceOf(name) : null;
          if (s) m.colorNode = triplanarTexture(texture(s.map), null, null, float(1 / s.sizeM)).rgb.mul(vec3(tint.r, tint.g, tint.b));
          else m.color = hex ? tint : new THREE.Color(0x808080);
        }
        o.material = m;
      })(),
    );
  });
  await Promise.all(jobs);
  return gltf.scene;
}

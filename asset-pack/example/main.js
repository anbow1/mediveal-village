// Every asset of the pack in one scene: soldiers and townsfolk playing their clips, the horse with its
// rider, props and buildings on scanned ground. Serve the pack's folder over http (fetch does not read
// files from the disk): `python -m http.server` in the pack, then http://localhost:8000/example/.

import * as THREE from 'three';
import { float, texture, triplanarTexture } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { body, building, loadJSON, mount, prop, rigged } from '../loader/marchland-assets.js';

const M = '../models/';
const T = '../textures/';
const BLUE = 0x2f5fb0;
const RED = 0xb03a2e;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb6cc);
scene.fog = new THREE.Fog(0x9fb6cc, 60, 160);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
camera.position.set(4, 7, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4, 1, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a5040, 1.2));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.set(-20, 30, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 100 });
scene.add(sun);

// The ground: the meadow scan at its real size (meta.json says how many metres one repeat covers).
{
  const meta = await loadJSON(`${T}meadow/meta.json`);
  const map = await new THREE.TextureLoader().loadAsync(`${T}meadow/color.jpg`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  m.colorNode = triplanarTexture(texture(map), null, null, float(1 / meta.size_m)).rgb;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), m);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/** Everything that plays clips: { name, model (rigged()), clip (null: cycle all), after (rider) }. */
const actors = [];
const place = (o, x, z, turn = 0) => {
  o.position.set(x, 0, z);
  o.rotation.y = turn;
  scene.add(o);
};

// Soldiers (they face -Z: turned to the camera).
const soldiers = ['swordsman', 'halberdier', 'pikeman', 'archer', 'crossbowman', 'militia', 'knight'];
for (const [i, name] of soldiers.entries()) {
  const data = await loadJSON(`${M}soldiers/${name}.json`);
  if (!data.bones) {
    // knight.json: the older body without bones (limbs per vertex), a plain mesh here.
    place(body(data), i * 2, 0, Math.PI);
    continue;
  }
  const a = rigged(data, { team: i % 2 ? RED : BLUE });
  place(a.mesh, i * 2, 0, Math.PI);
  actors.push({ name: `soldiers/${name}`, a, clip: null });
}
// The horse with its rider.
{
  const horse = rigged(await loadJSON(`${M}soldiers/warhorse.json`));
  const riderModel = await loadJSON(`${M}soldiers/rider.json`);
  const seat = mount(horse, body(riderModel), riderModel);
  place(horse.mesh, 14, 0, -Math.PI / 2);
  actors.push({ name: 'soldiers/warhorse (+ rider)', a: horse, clip: null, after: seat });
}
// Townsfolk.
const people = ['townsman', 'townsman-beard', 'townsman-wool', 'townsman-linen', 'townswoman', 'townswoman-dress', 'townswoman-worker', 'smith'];
for (const [i, name] of people.entries()) {
  const a = rigged(await loadJSON(`${M}people/${name}.json`), { team: BLUE });
  place(a.mesh, i * 1.6, -3, Math.PI);
  actors.push({ name: `people/${name}`, a, clip: null });
}
// Props.
const props = ['cannon', 'mortar', 'wagon', 'handcart', 'pig', 'goods/lumber', 'goods/stone', 'goods/sack', 'goods/barrel', 'goods/crate', 'goods/bread', 'goods/meat', 'goods/arrows'];
for (const [i, name] of props.entries()) place(prop(await loadJSON(`${M}props/${name}.json`)), i * 2.2 - 4, -9, Math.PI);
// Buildings (doors towards +Z).
const buildings = ['house_3', 'bakery_2', 'windmill_2', 'smithy_1', 'tower_2', 'keep_1', 'wall', 'gate'];
let x = -10;
for (const name of buildings) {
  const b = await building(`${M}buildings/${name}.glb`, { textures: T, team: BLUE });
  const size = new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3());
  place(b, x + size.x / 2, -22);
  x += size.x + 4;
}

// The panel: pick a model and one of its clips.
const modelSelect = document.getElementById('model');
const clipSelect = document.getElementById('clip');
const info = document.getElementById('info');
for (const [i, actor] of actors.entries()) modelSelect.append(new Option(actor.name, String(i)));
const fillClips = () => {
  const actor = actors[Number(modelSelect.value)];
  clipSelect.replaceChildren(new Option('(wszystkie po kolei)', ''), ...Object.values(actor.a.clips).map((c) => new Option(`${c.name} — ${c.frames} kl.`, c.name)));
  clipSelect.value = actor.clip ?? '';
  const p = actor.a.mesh.getWorldPosition(new THREE.Vector3());
  controls.target.set(p.x, 1, p.z);
  camera.position.set(p.x + 3, 2.5, p.z + 5);
  controls.update();
};
modelSelect.addEventListener('change', fillClips);
clipSelect.addEventListener('change', () => {
  actors[Number(modelSelect.value)].clip = clipSelect.value || null;
});
fillClips();

const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const t = timer.getElapsed();
  for (const actor of actors) {
    const names = Object.keys(actor.a.clips);
    // Without a chosen clip: each clip in turn for four seconds.
    const name = actor.clip ?? names[Math.floor(t / 4) % names.length];
    actor.a.play(name, t);
    actor.shown = name;
    actor.after?.();
  }
  const current = actors[Number(modelSelect.value)];
  info.textContent = `Gra teraz: ${current.shown}`;
  controls.update();
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
window.__ready = true;

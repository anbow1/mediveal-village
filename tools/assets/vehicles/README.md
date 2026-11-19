# Vehicles from ready-made models (Sketchfab CC BY / CC0, Poly Haven, BlenderKit free)

(English version of `README.md`; keep the two in step.)

`prepare_vehicle.py` turns a downloaded model into a vehicle ready for the
games: metres, Y up, the front toward −Z, the origin on the ground under the
middle of the wheelbase; the wheels split off and centred on their axles
(`wheel_FL/FR/RL/RR` — the game turns them), the lights gathered into
`lights_head` / `lights_rear` (brake lights and headlamps), the rest in `body`;
levels of detail by decimation symmetric about X, occlusion baked with Cycles
(OptiX on an RTX card) into the vertex colour `ao`, textures downscaled, glTF
with Draco compression.

```bat
blender -b --python prepare_vehicle.py -- C:\models\hatchback.glb --out out\hatchback --length 4.05 --forward -y --preview
```

- `--length` — the vehicle's real length in metres (models come in centimetres, or at toy scale),
- `--forward` — the axis the model's front faces in Blender after import (`x`, `-x`, `y`, `-y`);
  check the preview (`out\hatchback_preview.png`): the front should be at the lower right of the frame,
- `--wheels`, `--lights` — words in the names of the wheel and light objects or materials, if the
  model uses others (e.g. `--wheels "rim,wheel_"`); without names the script looks for four round
  parts near the corners,
- `--lod 60000,15000,3000` — triangle budgets for the body (each wheel 1/6, the lights 1/10),
- `--tex 2048` — the largest texture size,
- `--tex-far 512` — the texture size of `lod1` (each further level half of that); half of `--tex` by default,
- `--part "bonnet:x0,y0,z0,x1,y1,z1,min"` — loose pieces lying wholly inside the box (the game's frame, metres)
  and longer than `min`, as a node of their own (a bonnet, a door) that the game turns on a hinge; the
  option can be repeated.

The jeep of Castaway Lagoon (its star, numbers and plate painted out first, in the colour map **and** in
the roughness map — they were there too):

```bat
python -I scrub_marks.py tex\jeep.001_baseColor.png tex\jeep.001_baseColor.png --circle 3590,2200,168 --rect 3138,2100,3248,2490 --rect 3895,2140,4030,2490 --grain-patch 3250,2290,3400,2420
python -I scrub_marks.py tex\jeep.001_metallicRoughness.png tex\jeep.001_metallicRoughness.png --circle 449,275,23 --rect 391,261,407,312 --rect 486,266,505,312 --grain-patch 407,286,425,302
blender -b --python prepare_vehicle.py -- jeep\scene.gltf --out out\jeep_open --length 3.36 --forward=x --lod 12000 --tex 2048 --part "bonnet:-0.54,0.9,-1.42,0.58,1.09,-0.57,0.8" --preview
```

The whole process from download to game (licence, unpacking, markings, Blender, preview, credits, code,
render, APK) is in `docs/graphics-playbook.md`, §6q2.

Output: `out\hatchback_lod0.glb`, `_lod1.glb`, `_lod2.glb` and `out\hatchback.json`
(dimensions, wheel centres and radii, wheelbase). **Write the author, the page
address and the licence into the `.json`** — CC BY requires a credit in the game
(in its credits / README).

**Then the textures to KTX2** (playbook §8.4): `node tools/assets/ktx2_glb.mjs out/hatchback_lod*.glb --in-place`
(from the repository's root; the packages and `KTX2_TOOLS` are in the script's head). Its `auto` mode encodes
each texture in ETC1S, and one whose PSNR falls below 40 dB in UASTC. A game that loads the file needs
`GLTFLoader.setKTX2Loader` (see `field-line/src/render/vehicleModels.ts`) (no transcoder path: three's loader brings its own);
without it the model fails to load and the procedural stand-in stays.

## What to look for (realism, no brands)

Models carrying makers' logos and names must be de-branded (badges removed,
lettering changed) — the games use invented vehicles. On Sketchfab filter by
*Downloadable*, licence *CC Attribution* or *CC0*, ideally 50–300 thousand
triangles with PBR textures.

| Game | Vehicles |
| --- | --- |
| Paris | a European hatchback and estate, a taxi (saloon), a low-floor city bus, a delivery van, a scooter, a city bicycle |
| Field Line | a saloon, a pickup, a van, a flatbed lorry, a wrecked car, an unmarked ambulance |
| Tanks | a main battle tank, an infantry fighting vehicle, a military lorry, wrecks (invented markings) |

## Lorries (Tanks: scenery that can be destroyed)

`prepare_truck.py` — one `body` with its wheels (the game does not drive lorries, so any number of axles),
scale, orientation, normals outward, decimation, occlusion as for the tanks; it keeps only the base
colour (with alpha) and the normal map. Paint real markings out first with `scrub_marks.py`:

```bat
python -I scrub_marks.py tex\Material2_baseColor.jpeg tex\Material2_baseColor.jpeg --circle 1824,1359,80 --circle 1824,1769,80 --grain-patch 1790,1220,1930,1290
python -I scrub_marks.py tex\Material_baseColor.png tex\Material_baseColor.png --rect 946,1568,1046,1622 --rect 1442,1670,1494,1770
python -I scrub_marks.py m939\textures\Body1Mtl_baseColor.png m939\textures\Body1Mtl_baseColor.png --rect 543,412,598,460 --grain-from 0,60
blender -b --python prepare_truck.py -- military_truck\scene.gltf --out out\staff_car --length 5.6 --forward=-x --triangles 18000 --preview
blender -b --python prepare_truck.py -- m939\scene.gltf --out out\cargo_truck --length 7.75 --forward=-x --preview
```

(`--forward=-x` with the equals sign: argparse takes a bare `-x` for an option.)

## Weapons

`prepare_gun.py` — a first-person weapon: the body as one node and each moving part (magazine, bolt or
charging handle, trigger, selector) as its own, split by the rig's bones or by a box; see the script's
header and `docs/graphics-playbook.md` §6q2 ("Weapons").

## Helicopters and fighters: options for harder models

`prepare_heli.py`:
- `--glass glass,mirror` — words in the names of the cockpit glazing's materials,
- `--gun-object Object_20` — a gun modelled in a turned pose (an animation frame): the script straightens
  it about the turret's centre (the principal axis of its vertices),
- `--eyes gz,gy,pz,py` — the gunner's and the pilot's eyes (z, y), when the glazing does not split into two sections,
- `--stores "pod x,y,z,front;launcher x,y,z,length"` — pods and closed launchers merged into the fuselage
  (mirrored to both sides), measured on the file of a first run,
- objects with no material at all (helper spheres, collision hulls) are skipped.

```bat
blender -b --python prepare_heli.py -- mi28\scene.gltf --out out\heli_bulat --rotor-radius 8.6 --forward=-y --glass glass,mirror --gun-object Object_20 --eyes=-2.8,2.72,-1.0,3.17 --stores "pod 1.745,1.24,0.85,0.09;launcher 2.92,1.98,0.75,1.42"
```

`prepare_jet.py`:
- `--glass` — words in the canopy material's name (by default the palette of an F-35 model),
- `--drop landingon` — parts to leave out by name (with their children), e.g. a second, lowered undercarriage,
- `--no-surfaces` — the control surfaces are not separate pieces: they stay in the fuselage,
- `--engines 2` — two nozzles side by side,
- `--main-gear-z 1.6` — shifts the model along its length so the main wheels stand where the flight model has them,
- `--surfaces "stab=elevator;flaperon=aileron,flap;rudder=rudder"` — control surfaces by part names (the side
  from the position); a rudder so named is the whole moving fin (its axis through 30 % of the chord).

```bat
blender -b --python prepare_jet.py -- su57\scene.gltf --out out\jet_talon --length 21.9 --forward=-y --glass glass --drop gear_down,probe_on --surfaces "stab=elevator;flaperon=aileron,flap;rudder=rudder" --engines 2 --main-gear-z 1.6
```

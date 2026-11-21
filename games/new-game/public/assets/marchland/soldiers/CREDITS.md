# Soldiers

- `knight.json` — the plate-armoured body (now only where a skinned body is missing), made by
  `tools/blender/soldiers.py` from **"Rigged Knight in Armor"** by **Xali** (BlendSwap,
  https://blendswap.com/blend/28541), licensed **CC0**: thinned to about 3 200 triangles, the arms
  brought down from the rest pose, materials as plain colours. Weapons, shields and the surcoat in the
  side's colours are the game's own.
- `swordsman.json` — the swordsmen, made by `tools/blender/rigged.py` from **"Medieval Knight | Sculpture | Game
  ready"** by **by__Rx** (Sketchfab), licensed **CC BY 4.0**: full plate with a gilt visor, thinned to about 3 500
  triangles, colours from its textures. The sword and the heater shield in the side's colour are the game's own.
  The strike, guard, idle, walk, run, flinch and two deaths are motion from **Mixamo** (Adobe), retargeted and
  baked into bone matrices; the raw animation files are not part of this repository.
- `halberdier.json` — the halberdiers, from **"knight for game project (old)"** by **Thomas.Osterhammel**
  (https://sketchfab.com/3d-models/knight-for-game-project-old), licensed **CC BY 4.0**, thinned to about 3 400
  triangles, with the game's own halberd (`rigged.py --arms halberd`), striking with Mixamo's "Upward Thrust",
  "Great Sword Attack" and "Great Sword Slash" by turns.
- `militia.json` — the militia (the levy), made by `tools/blender/rigged.py --arms spear --shield small
  --two-hand-clips stab --team Image_3` from **"Virtual model wool tunic Svend"** by **ChamberSu1996**
  (Sketchfab), licensed **CC BY 4.0**: on Unreal's skeleton, read as Mixamo's; a 2.4 m spear held in both hands, a
  small wooden shield on the left forearm, the wool tunic a little in the side's colour; the pikemen's Mixamo
  motion.
- `pikeman.json` — the pikemen (a large shield in the side's colour on the left forearm: `--shield large`), made by `rigged.py --arms pike` from **".Fuse Warrior"** by **Leonardo
  Carvalho** (Sketchfab), licensed **CC BY 4.0**: its sword and shield left out, the helmet kept, the
  upper armour dyed in the side's colour; the pike is the game's own. Motion from Mixamo ("Bayonet Stab",
  with the pike along the line of both hands, `--two-hand-clips stab`; "Rifle Walk" and the sword-and-shield set).
- `archer.json` — the archers, made by `rigged.py --arms bow` from **".Fuse Civilian 2"** by **Leonardo
  Carvalho** (Sketchfab), licensed **CC BY 4.0**: the tunic dyed in the side's colour; the bow is the
  game's own. Motion from Mixamo (the Longbow Aiming Pack and the sword-and-shield set).
- `rider.json` — the light and heavy cavalry's rider: **Paladin J Nordstrom**, a character from **Mixamo** (Adobe),
  seated in the saddle by `rigged.py --seated --arms none --height 1.8 --tris 3200 --gain 2.5` (thighs forward and
  apart, arms to the lance and the reins), thinned to about 3 200 triangles, colours from its texture brightened;
  its own sword and shield left out. Lance, shield and surcoat in the side's colours are the game's own. The raw
  Mixamo file is not part of this repository. (Before: the Xali knight above, `soldiers.py --seated`.)
- `warhorse.json` — the cavalry's horse, made by `tools/blender/baked.py --clips idle:351:413,walk:74:107,
  gallop:0:16,graze:595:746 --saddle Spine2_04 --centre --height 1.95` from **"Horse"** by **MAXDESIGN-3D**
  (https://sketchfab.com/3d-models/horse-6d0f9c1ce82f41048a282b6c47a50684), licensed **CC BY 4.0**: thinned
  to about 3 000 triangles, colours from its textures, 40 bones; its own animation (one take) cut into
  standing, walking, galloping and grazing loops. Its fall (`fall`) is the fall of a second **"Horse"** by
  **MAXDESIGN-3D** (https://sketchfab.com/3d-models/horse-d9af6902210645d995e37ba4319957b6), licensed **CC BY 4.0**,
  retargeted onto it by `tools/blender/horsefall.py`; that horse's mesh is not used. The rider (`rider.json`) and his kit ride on its back bone; the
  saddle cloth or caparison is cut from the horse's own skin and moves on its bones.
- `horse.json` — the earlier horse, used only when `warhorse.json` is missing, made by `tools/blender/horse.py` from **"Armored Horse"** by
  **naminoff** (https://sketchfab.com/3d-models/armored-horse-98c3f1c40a6b422dba76bf5403e0a3d8), licensed
  **CC BY 4.0**: thinned to about 3 600 triangles, colours taken from its textures, legs walking in
  diagonal pairs about the shoulder and the hip.
- `crossbowman.json` — the crossbowmen, made by `rigged.py --arms crossbow` from **".Fuse Warrior"** by
  **Leonardo Carvalho** (Sketchfab), licensed **CC BY 4.0**; the crossbow is the game's own. Motion from
  Mixamo ("Firing Rifle" for the shot, "Rifle Down To Aim" to raise it, "Rifle Walk" and the sword-and-shield
  set).

# Credits for the models in this folder

Every building except the keep, the wall, the watchtower and the smithy at levels 2 and 3 is made for
Marchland in Blender (`tools/blender/build.py`).

## keep_1.glb — the keep

From **Buckstone Castle** by **Peter Leban**
(https://sketchfab.com/Pjotruska), https://sketchfab.com/3d-models/buckstone-castle-234b87842c2f4d46aea303c89a8dd2b7,
licensed under **CC BY 4.0** (http://creativecommons.org/licenses/by/4.0/).

Changes (`tools/blender/keep.py`): textures removed and every face given one of the game's own
scanned surfaces; the ground plate and the ivy removed; the densest meshes thinned (about 59 000 to
22 000 triangles); scaled to 24 m; a flag in the team's colour added.

## wall.glb, gate.glb, tower_1.glb, tower_2.glb, tower_3.glb — the wall, the gate and the watchtower

From **Tower and Castle Walls** by **LucasPresoto** (https://sketchfab.com/LucasPresoto),
https://sketchfab.com/3d-models/tower-and-castle-walls-fca85f8450604e6f98952a2739f92672,
licensed under **CC BY 4.0** (http://creativecommons.org/licenses/by/4.0/).

Changes (`tools/blender/walls.py`): textures removed and the stone given the game's own rubble and
ashlar; one merlon's period of the wall cut out, closed, stretched to the 2 m cell, its merlons made
taller and its foot sunk into the ground; the gate narrowed to three cells, its two leaves kept apart to
swing open; the tower scaled to a 8.6 m fighting floor, with a door, the
side's flag and, by level, a timber hoarding and a roof added.

## smithy_2.glb, smithy_3.glb — the smithy at levels 2 and 3

From **Medieval Blacksmith** by **Daniel** (https://sketchfab.com/DanielAndersson),
https://sketchfab.com/3d-models/medieval-blacksmith-2e4f2725963644c685419dea1e4430df,
licensed under **CC BY 4.0** (http://creativecommons.org/licenses/by/4.0/).

Changes (`tools/blender/convert.py`): textures removed and each material given one of the game's
surfaces by its name; thinned from 33 000 to 12 000 triangles; scaled to 10.5 m; smoke points added
at the chimney and the hearth.

## fortress_1.glb — the enemy's fortress in the campaign's last mission

From **Medieval Castle** by **Uğur Yakışık** (Sketchfab), licensed under **CC BY 4.0**
(http://creativecommons.org/licenses/by/4.0/).

Changes (`tools/blender/convert.py castle`): the source's Draco and Meshopt compression undone; textures removed and
every face given one of the game's surfaces (dressed stone for the walls, towers and keep, rubble for the
stairs, timber for the drawbridge's gear and doors); the piles of cannon balls and the ground plate removed;
thinned from 64 000 to 30 000 triangles; scaled to 130 m across, the gate towards the game's +Z.


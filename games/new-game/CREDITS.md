# Marchland — Third-Party Asset Credits & Licences (`CREDITS.md`)

Every third-party texture, scan, and model used in `games/new-game/` is strictly **CC0 1.0** or **CC BY 4.0**.
Original Blender-built architecture, vegetation, character meshes, and code are authored for Marchland.

| Category | Local Asset | Source Title | Author(s) | Source URL | Licence | Notes |
|---|---|---|---|---|---|---|
| Surface PBR scan | `surfaces/grass (layer 0)` | Forest Ground 01 | Rob Tuytel | https://polyhaven.com/a/forrest_ground_01 | CC0 1.0 | 512px array layer, real size 2.00 m |
| Surface PBR scan | `surfaces/dirt (layer 1)` | Brown Mud 03 | Rob Tuytel | https://polyhaven.com/a/brown_mud_03 | CC0 1.0 | 512px array layer, real size 1.30 m |
| Surface PBR scan | `surfaces/cobble (layer 2)` | Cobblestone 02 | Amal Kumar | https://polyhaven.com/a/cobblestone_02 | CC0 1.0 | 512px array layer, real size 1.80 m |
| Surface PBR scan | `surfaces/plaster (layer 3)` | Clay Plaster | Amal Kumar | https://polyhaven.com/a/clay_plaster | CC0 1.0 | 512px array layer, real size 2.00 m |
| Surface PBR scan | `surfaces/beam (layer 4)` | Dark Wood | Dario Barresi, Dimitrios Savva, Rico Cilliers | https://polyhaven.com/a/dark_wood | CC0 1.0 | 512px array layer, real size 2.00 m |
| Surface PBR scan | `surfaces/boards (layer 5)` | Oak Wood Planks | Dimitrios Savva | https://polyhaven.com/a/oak_wood_planks | CC0 1.0 | 512px array layer, real size 1.20 m |
| Surface PBR scan | `surfaces/thatch (layer 6)` | Reed Roof 04 | Rob Tuytel | https://polyhaven.com/a/reed_roof_04 | CC0 1.0 | 512px array layer, real size 2.50 m |
| Surface PBR scan | `surfaces/shingles (layer 7)` | Roof Slates 02 | Rob Tuytel | https://polyhaven.com/a/roof_slates_02 | CC0 1.0 | 512px array layer, real size 3.00 m |
| Surface PBR scan | `surfaces/rubble (layer 8)` | Medieval Blocks 03 | Rob Tuytel | https://polyhaven.com/a/medieval_blocks_03 | CC0 1.0 | 512px array layer, real size 2.00 m |
| Surface PBR scan | `surfaces/ashlar (layer 9)` | Castle Brick 02 White | Rob Tuytel | https://polyhaven.com/a/castle_brick_02_white | CC0 1.0 | 512px array layer, real size 2.50 m |
| Surface PBR scan | `surfaces/bark (layer 10)` | Jolcham Oak Bark 01 | Charlotte Baglioni | https://polyhaven.com/a/jolcham_oak_bark_01 | CC0 1.0 | 512px array layer, real size 1.00 m |
| Surface PBR scan | `surfaces/linen (layer 11)` | Rough Linen | colormass, Rico Cilliers | https://polyhaven.com/a/rough_linen | CC0 1.0 | 512px array layer, real size 0.27 m |
| 3D Prop (photogrammetry) | `props/barrel_*.glb` | Wine Barrel 01 | James Ray Cock | https://polyhaven.com/a/wine_barrel_01 | CC0 1.0 | Prepared via Blender 4.2 (Cycles vertex AO, 3 LODs + shadow stand-in, KTX2, Meshopt) |
| 3D Human Base & Rig | `units/{swordsman,archer,citizen}_*.glb` | MakeHuman Base Mesh (`base.obj`, `default.mhskel`, `default_weights.mhw`) | MakeHuman Community | https://github.com/makehumancommunity/makehuman | CC0 1.0 | Anatomical outer body & bone weights (`LICENSE.md` §C/§D CC0 1.0); clothed, rigged, Cycles AO baked & KTX2/Meshopt optimized in Blender 5.0 |
| 3D Weapon (photogrammetry) | `units/swordsman_*.glb` (right hand) | Antique Estoc | Poly Haven / James Ray Cock & contributors | https://polyhaven.com/a/antique_estoc | CC0 1.0 | Decimated & atlas-packed into `swordsman` KTX2 PBR material in Blender 5.0 |
| 3D Shield (photogrammetry) | `units/swordsman_*.glb` (left arm) | Kite Shield | Poly Haven / James Ray Cock & contributors | https://polyhaven.com/a/kite_shield | CC0 1.0 | Decimated & repainted with invented Marchland Cobalt-Ochre heraldry over real wood/iron photogrammetry grain |
| 3D Siege Artillery (photogrammetry) | `units/cannon_{lod0,lod1,lod2,shadow}.glb` | Cannon 01 | Yann Kervran, James Ray Cock | https://polyhaven.com/a/cannon_01 | CC0 1.0 | Decimated to 3 LODs + shadow proxy, KTX2 + Meshopt (`prepare_polyhaven_s5.py`) |
| 3D Nature (photogrammetry) | `nature/rock_moss_{a,b}_*.glb` | Rock Moss Set 01 | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_01 | CC0 1.0 | 2 rock variants (`rock01`, `rock04`), 3 LODs + shadow stand-in, KTX2 + Meshopt |
| 3D Nature (photogrammetry) | `nature/boulder_*.glb` | Boulder 01 | Rico Cilliers | https://polyhaven.com/a/boulder_01 | CC0 1.0 | 3 LODs + shadow stand-in, KTX2 + Meshopt |
| 3D Nature (photogrammetry) | `trees/stump_lod0.glb` | Tree Stump 01 | Rob Tuytel | https://polyhaven.com/a/tree_stump_01 | CC0 1.0 | Photogrammetry forestry stump replacing procedural stump, KTX2 + Meshopt |
| 3D Nature (photogrammetry) | `nature/fern_lod0.glb` | Fern 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fern_02 | CC0 1.0 | Forest floor fern with TSL backlit subsurface translucency, KTX2 + Meshopt |
| 3D Prop (photogrammetry) | `props/crate_lod0.glb` | Wooden Crate 01 | James Ray Cock | https://polyhaven.com/a/wooden_crate_01 | CC0 1.0 | Village & camp trade crate, KTX2 + Meshopt |
| 3D Prop (photogrammetry) | `props/bucket_lod0.glb` | Wooden Bucket 01 | James Ray Cock | https://polyhaven.com/a/wooden_bucket_01 | CC0 1.0 | Village well & bakery wooden bucket, KTX2 + Meshopt |
| 3D Prop (photogrammetry) | `props/pier_lod0.glb` | Modular Wooden Pier | Rico Cilliers | https://polyhaven.com/a/modular_wooden_pier | CC0 1.0 | 8.5 m weathered waterside pier paired with Fisher's Hut, KTX2 + Meshopt |
| Material PBR scan | `units/*` atlas leather | Brown Leather | Rob Tuytel | https://polyhaven.com/a/brown_leather | CC0 1.0 | Character belts, gauntlets, boots, quiver & pouches baked into character KTX2 atlases |
| Material PBR scan | `units/*` atlas wood | Medieval Wood | Rob Tuytel | https://polyhaven.com/a/medieval_wood | CC0 1.0 | Archer English yew warbow & arrow shafts baked into character KTX2 atlas |

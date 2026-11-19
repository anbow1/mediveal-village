# Reference numbers (text form of `reference-sheets/*.png`)

A value that disagrees with these needs a comment saying why.

## Light (EV100 = log2(lux · 100 / 250); exposure = 1 / (1.2 · 2^EV100))

| Condition | Illuminance lx | Sun K | Sky K | Note |
|---|---|---|---|---|
| Clear noon | 100 000 | 5500 | 10 000 | sun elev 60–75° |
| Hazy midday | 40 000 | 5500 | 7000 | soft shadow edges |
| Overcast | 8000 | – | 7000 | sky is the key light |
| Golden hour | 12 000 | 3200 | 9000 | long shadows, warm rim |
| Sunset / blue hour | 400 | 2000 | 12 000 | cold ambient |
| Civil twilight | 10 | – | 14 000 | headlights start to read |
| Full moon | 0.25 | 4100 | 4100 | render slightly blue |
| Overcast night | 0.002 | – | 4000 | NV / thermal |

Local lights (candela): rifle muzzle flash ~60 000 cd, 2400 K, 1–2 frames, no
shadow · burning wreck ~12 000 cd, 1900 K, flicker 4–9 Hz, casts shadow ·
weapon light ~15 000 cd, 6000 K, 10° hotspot · interior bulb ~80 cd, 2700 K.
Tone map: ACES filmic default, A/B against AgX. Never Reinhard or clamp.

## PBR (sRGB base colour, roughness; metal 0 unless marked)

Non-metal linear luminance 0.021–0.92; metal base = F0, never darker than
~#b4b4b4. F0 linear: iron (0.562, 0.565, 0.578), aluminium (0.913, 0.922,
0.924), copper (0.955, 0.638, 0.538), brass (0.910, 0.778, 0.423).

| Surface | Base | Rough | Note |
|---|---|---|---|
| Asphalt dry / wet | #3a3a3c / #2a2b2e | 0.92 / 0.35 | wet: clearcoat 1, ccRough 0.05 |
| Concrete weathered | #8f8b85 | 0.88 | runway #a09d96 0.85 |
| Road paint white | #d6d6d0 | 0.60 | never pure white |
| Brick red | #8a4b3a | 0.80 | |
| Window glass | #e6ebeb | 0.02 | transmission 1, IOR 1.52 |
| Car paint | #6e2a24 | 0.40 | clearcoat 1, ccRough 0.03 |
| Dry soil / wet mud | #6b5a47 / #3e3328 | 0.95 / 0.40 | |
| Sand | #c2b280 | 0.90 | |
| Grass dry / fresh | #6d7343 / #4a6030 | 0.90 / 0.85 | |
| Pine foliage | #3c4a2e | 0.85 | thin translucency |
| Bark | #4a3b30 | 0.93 | |
| Granite | #7a7672 | 0.85 | triplanar |
| Fresh snow | #f0f4f8 | 0.60 | watch exposure |
| River water tint | #3e5a4c | 0.02 | IOR 1.33 |
| Steel polished / worn edge | F0 iron | 0.12 / 0.35 | metal 1 |
| Aluminium brushed | F0 alu | 0.28 | metal 1, anisotropy 0.6 |
| Brass / copper | F0 | 0.25 / 0.30 | metal 1 |
| Parkerised gun finish | #3c3c3e | 0.62 | phosphate = non-metal |
| Aircraft grey matte | #6a6d71 | 0.58 | |
| Blue-grey camo | #7b8898 | 0.62 | |
| Green / khaki armour | #4b5340 / #5c5b3e | 0.76 / 0.80 | dust + mud masks |
| Uniform fabric | #5a5e48 | 0.90 | sheen 0.4 |
| Rubber track / tyre | #2b2b2d / #2c2c2e | 0.90 / 0.86 | |
| Canopy acrylic | #dfe6ea | 0.05 | trans 0.95, IOR 1.49 |
| Soot | #2b2b2c | 0.97 | |
| Rust | #7a4326 | 0.88 | non-metal |

## Scale (L × W × H, m)

Soldier 0.45 × 0.60 × 1.83 · 4×4 utility 4.60 × 2.16 × 1.83 · MBT (gun fwd)
~9.7 × 3.7 × 2.2–2.4 · attack heli ~17–17.7 × 4.9–5.2 × 3.8, rotor Ø 14.6–17.2
· fighter 15.7–21.9 long, span 10.7–15.3, H 4.3–5.9.
City: door 2.10 × 0.90 · storey 3.0 (shops 4.0) · stair 0.17 / 0.28 · sill
0.90 · kerb 0.15 · lane 3.5 · pavement 2.0–3.0. Eye: stand 1.70, crouch 1.15,
prone 0.45.

## Ballistics (point mass, standard G7 drag table, air 1.225, sound 340.3 m/s)

| Round | Muzzle m/s | G7 BC lb/in² | Zero m | Sight over bore m |
|---|---|---|---|---|
| 5.56 mm | 920 | 0.151 | 300 | 0.065 |
| 7.62 mm | 838 | 0.200 | 300 | 0.065 |
| Magnum sniper | 880 | 0.310 | 300 | 0.065 |
| 12.7 HMG | 890 | 0.330 | 300 | 0.080 |
| Tank APFSDS | 1600 | loses 65 m/s per km (v ∝ e^(−kx)) | 1000 | 0 |

Unit-test the integrator against a public G7 calculator (e.g. JBM) at 300 and
500 m; the PNG sheet has the plotted drop, mil holdover and time of flight.

## HUD

Title-safe 90 %. Centre zone 30 % of width: symbols only. FPS: ammo/mode
bottom-left, health bottom-right, objective top-left, compass top-right,
centre empty when aiming. Jet: green vector, flight-path marker on the true
velocity, speed left, altitude right, heading top. Tank: reticle + lead,
turret-vs-hull top-left, minimap bottom-left, module damage bottom-right. Heli:
torque/RPM/collective left, radar alt/VSI/airspeed right, velocity ball.
21:9 and wider anchor to the centred 16:9.

## Performance budget (1440p High)

GPU target 14 ms (16.6 = 60 fps): CSM 2.2 · opaque 3.8 · AO + SSR 1.6 · sky,
fog 0.8 · transparent + particles 1.8 · TAA, bloom, tone map, sharpen 1.2 ·
game-specific slot 2.0 (one signature feature) · HUD 0.3.
CPU main thread: physics 2.0 · AI + logic 2.5 · submit + culling 3.5 · audio
+ streaming 0.8.
Hard ceilings High / Low: draws 2500 / 1500 · triangles 12 / 4 M · materials
120 / 80 · shadow lights 4 / 2 · texture memory 8 / 2.5 GB · rigid bodies 250.
(The Stage 0 budget in `GUIDE.md` is stricter for the phone: use it.)

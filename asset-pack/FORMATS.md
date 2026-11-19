# Formaty plików paczki

Wszystkie modele są w **przestrzeni gry**: metry, oś Y w górę, postać patrzy wzdłuż **−Z**, jej lewa ręka
jest po stronie **−X**. Postacie stoją stopami na y = 0 w środku układu; koń stoi wyśrodkowany nad
środkiem układu. Kolory wierzchołków są **liniowe** (nie sRGB): podaje się je wprost do
`vertexColors`. Indeksy trójkątów to zwykłe trójki indeksów wierzchołków.

## 1. Model ze szkieletem (`soldiers/*.json`, `people/*.json`, `soldiers/warhorse.json`)

Postać z wypieczonymi klatkami ruchu, bez hierarchii kości: każda klatka niesie gotowe macierze skinningu.

| Pole | Opis |
|---|---|
| `source` | autor i licencja (pełne podpisy w `CREDITS.md`) |
| `bones` | nazwy kości (Mixamo: `Hips`, `Spine`, … `RightToeBase`, `Sword_joint`, `Shield_joint`; koń: nazwy z pliku źródłowego) |
| `clips` | `{ name, start, frames, fps, travelM }`: klip to klatki `start … start+frames−1` tablicy `frames`; `travelM` to ile metrów obejmuje jedna pętla marszu (dopasuj do niej szybkość ruchu, żeby stopy nie ślizgały się po ziemi; 0, gdy klip stoi w miejscu) |
| `frames` | dla każdej klatki, dla każdej kości: macierz 3×4 (12 liczb, wierszami) przenosząca wierzchołek z **pozy spoczynkowej tego pliku** do pozy w tej klatce. Czwarty wiersz to zawsze (0, 0, 0, 1). Liczba klatek = `frames.length / (bones.length × 12)` |
| `positions`, `normals` | xyz na wierzchołek, w pozie spoczynkowej |
| `colours` | rgb liniowe na wierzchołek (z tekstury modelu źródłowego) |
| `surface` | 3 liczby na wierzchołek: metaliczność, chropowatość, udział koloru strony (0 = własny kolor, 1 = cały w barwie strony: tunika, wapenrok, tarcza) |
| `skin`, `weights` | 4 indeksy kości i 4 wagi na wierzchołek (suma wag = 1) |
| `triangles` | indeksy |
| `saddle` (tylko koń) | `{ bone, x, y, z }`: kość siodła i punkt, w którym siedzą biodra jeźdźca (w pozie spoczynkowej) |

Pozycja wierzchołka w klatce `f`: `p' = Σ wᵢ · M[f][skinᵢ] · p`, gdzie `M` to macierz 3×4 z `frames`.
Normalne tak samo, tylko część 3×3. W three.js wystarczy `SkinnedMesh` z `DetachedBindMode`,
jednostkowymi macierzami odwrotnymi kości i `bone.matrixWorld` ustawianym z `frames`; tak to robi
`loader/marchland-assets.js`. Gra robi to samo w shaderze: macierze wszystkich klatek leżą w teksturze
(3 teksele RGBA na kość, wiersz na klatkę), każda instancja ma swój numer klatki (`docs/PLAYBOOK.md` §4).

Broń żołnierzy (miecz, tarcza, halabarda, pika, łuk, kusza) jest **wpieczona w model** i jeździ na kościach
`Sword_joint` / `Shield_joint` albo na dłoni. Narzędzia mieszczan (siekiera, młot) są wpieczone tak samo, a w
klipach, w których ich nie ma, ich kość jest ściśnięta do zera.

## 2. Ciało z częściami (`soldiers/rider.json`, `soldiers/knight.json`)

Jedna poza, bez klatek: jeździec w siodle albo starsze ciało rycerza.

| Pole | Opis |
|---|---|
| `pivots` | `hipY, hipZ` (biodra), `shoulderY, shoulderZ, shoulderX` (barki) |
| `positions`, `normals`, `colours`, `triangles` | jak wyżej |
| `surface` | **2** liczby na wierzchołek: metaliczność, chropowatość |
| `limbs` | część ciała na wierzchołek: 0 tułów, 1 lewa noga, 2 prawa noga, 3 lewa ręka, 4 prawa ręka (gra obraca ręce wokół barku przy ciosie) |

Jeźdźca sadza się na koniu tak, że jego `hipY/hipZ` trafia w `saddle.y/z` konia, a potem jedzie on na
macierzy kości siodła (`mount()` w loaderze).

## 3. Bryła (`props/*.json`, `props/goods/*.json`)

`size` (wymiary w metrach), `positions`, `normals`, `colours`, `triangles`. Armata i moździerz lufą do −Z;
towary (`goods/`) w skali, w jakiej niesie je tragarz albo leżą w stosie.

`soldiers/horse.json` to starszy koń bez szkieletu: do tego dochodzą `surface`, `parts` (część na wierzchołek:
oś obrotu nogi i faza kroku) i `saddle`. Dziś zastępuje go `warhorse.json`.

## 4. Budynki (`buildings/*.glb`)

glTF bez tekstur i bez UV. Drzwi patrzą w **+Z**, środek budynku w (0, 0). `index.json` mówi, który plik to
który budynek i poziom (`"bakery:2": { "file": "bakery_2.glb", "triangles": 8828 }`).

- **Materiały nazywają powierzchnię**: `plaster`, `beam`, `boards`, `thatch`, `shingles`, `tiles`, `rubble`,
  `ashlar`, `dirt`, `bark`, `rock`… (pełna lista: `SURFACES` w loaderze), z odcieniem po `#`
  (`beam#d8cfc6`). Tekstura powierzchni leży w `textures/<nazwa>/` i kładzie się ją rzutem z trzech stron
  (triplanar) w skali świata: `meta.json` → `size_m` mówi, ile metrów obejmuje jedno powtórzenie.
- Nazwa spoza listy to **zwykły kolor**: `glass#20252a`, `iron#4a4c50`. `team` to kolor właściciela.
- **Części ruchome** to osobne siatki o nazwach `sails` (skrzydła młyna) oraz `leaf_l` / `leaf_r` (skrzydła
  bramy), obracane wokół własnego środka. Puste obiekty `smoke_…` wskazują, skąd leci dym.

## 5. Tekstury (`textures/<powierzchnia>/`)

Skany Poly Haven (CC0), po 1024 px: `color.jpg` (sRGB), `normal.jpg` (konwencja OpenGL), `orm.jpg`
(R = okluzja, G = chropowatość, B = metaliczność), `meta.json` (`source`, `size_m`).

## 6. Spis modeli

| Plik | Rodzaj | Trójkąty | Kości | Klipy (klatki) |
|---|---|---|---|---|
| `people/smith.json` | szkielet | 2994 | 40 | work (193) |
| `people/townsman-beard.json` | szkielet | 1643 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townsman-linen.json` | szkielet | 1646 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townsman-wool.json` | szkielet | 1647 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townsman.json` | szkielet | 1244 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townswoman-dress.json` | szkielet | 1645 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townswoman-worker.json` | szkielet | 1641 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `people/townswoman.json` | szkielet | 1645 | 24 | boxwalk (19), boxidle (95), walk (16), idle (77), pickup (144), putdown (156), digging (73), fishing (132), chop (19), swing (79), harvest (37) |
| `props/cannon.json` | bryła (prop) | 1494 | — | — |
| `props/goods/arrows.json` | bryła (prop) | 260 | — | — |
| `props/goods/barrel.json` | bryła (prop) | 240 | — | — |
| `props/goods/bread.json` | bryła (prop) | 400 | — | — |
| `props/goods/crate.json` | bryła (prop) | 132 | — | — |
| `props/goods/lumber.json` | bryła (prop) | 220 | — | — |
| `props/goods/meat.json` | bryła (prop) | 400 | — | — |
| `props/goods/sack.json` | bryła (prop) | 92 | — | — |
| `props/goods/stone.json` | bryła (prop) | 220 | — | — |
| `props/handcart.json` | bryła (prop) | 522 | — | — |
| `props/mortar.json` | bryła (prop) | 1185 | — | — |
| `props/pig.json` | bryła (prop) | 320 | — | — |
| `props/wagon.json` | bryła (prop) | 1200 | — | — |
| `soldiers/archer.json` | szkielet | 3477 | 24 | recoil (22), draw (31), block_1 (18), idle (154), walk (32), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/crossbowman.json` | szkielet | 3443 | 24 | recoil (36), draw (27), block_1 (18), idle (154), walk (40), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/halberdier.json` | szkielet | 3449 | 24 | upward_thrust (71), chop (37), greatslash (56), block_1 (18), idle (227), walk (34), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/horse.json` | koń bez szkieletu (części) | 3591 | — | — |
| `soldiers/knight.json` | ciało z częściami (limbs) | 3189 | — | jedna poza |
| `soldiers/militia.json` | szkielet | 1683 | 24 | stab (99), block_1 (18), idle (227), walk (40), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/pikeman.json` | szkielet | 3551 | 24 | stab (99), block_1 (18), idle (227), walk (40), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/rider.json` | ciało z częściami (limbs) | 3199 | — | jedna poza |
| `soldiers/swordsman.json` | szkielet | 3523 | 24 | slash (46), block_1 (18), idle (227), walk (34), run (22), impact (22), death (118), death_1 (70) |
| `soldiers/warhorse.json` | szkielet + siodło | 2999 | 40 | idle (62), walk (33), gallop (16), graze (151), fall (25) |

| Budynek (`buildings/<nazwa>_<poziom>.glb`) | Poziomy | Trójkąty |
|---|---|---|
| `armourer` | 1, 2, 3 | 4690 / 4858 / 4858 |
| `bakery` | 1, 2, 3 | 8220 / 8828 / 8916 |
| `barracks` | 1, 2, 3 | 4768 / 4944 / 4944 |
| `butcher` | 1, 2, 3 | 3748 / 3924 / 3968 |
| `farm` | 1, 2, 3 | 3036 / 3152 / 3152 |
| `fisher` | 1, 2, 3 | 2612 / 3432 / 4252 |
| `fletcher` | 1, 2, 3 | 3484 / 3512 / 3540 |
| `fortress` | 1 | 29999 |
| `house` | 1, 2, 3 | 4936 / 5368 / 8124 |
| `ironMine` | 1, 2, 3 | 2628 / 2788 / 2788 |
| `keep` | 1 | 21790 |
| `pigFarm` | 1, 2, 3 | 756 / 756 / 756 |
| `quarry` | 1, 2, 3 | 1764 / 1896 / 2028 |
| `smelter` | 1, 2, 3 | 2132 / 2168 / 2168 |
| `smithy` | 1, 2, 3 | 2566 / 11991 / 11991 |
| `stable` | 1, 2, 3 | 952 / 952 / 952 |
| `tannery` | 1, 2, 3 | 1460 / 1644 / 1644 |
| `tower` | 1, 2, 3 | 6620 / 6700 / 7016 |
| `vineyard` | 1, 2, 3 | 1764 / 1820 / 1876 |
| `windmill` | 1, 2, 3 | 4788 / 4876 / 4964 |
| `winery` | 1, 2, 3 | 2740 / 3012 / 3012 |
| `woodcutter` | 1, 2, 3 | 2900 / 3140 / 3392 |
| `wall.glb`, `gate.glb` | — | odcinek muru 2 m, brama z dwoma skrzydłami |

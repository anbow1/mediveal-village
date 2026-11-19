# Marchland — paczka gotowych assetów

Wszystko, co Marchland wczytuje jako modele i animacje, w jednym miejscu, z loaderem dla three.js i
stroną pokazującą każdy model. Służy do zbudowania innej gry od zera na tych samych postaciach,
koniach, budynkach i teksturach.

Paczkę składa skrypt `marchland/tools/pack-assets.mjs` (`node tools/pack-assets.mjs` w katalogu
`marchland`) z plików gry, więc zawsze odpowiada temu, co gra ma w danej wersji.

## Co jest w środku

| Katalog | Zawartość |
|---|---|
| `models/soldiers/` | miecznik, halabardnik, pikinier, łucznik, kusznik, milicjant z włócznią i małą tarczą (każdy ze szkieletem, bronią i 8–10 klipami), koń z chodem, galopem, postojem, skubaniem trawy i upadkiem, jeździec w siodle, starszy rycerz i koń bez szkieletu |
| `models/people/` | czterech mieszczan i trzy mieszczanki (po 11 klipów pracy: noszenie skrzyni, kopanie, połów, rąbanie, młot, żniwa, podnoszenie i odkładanie, marsz, postój), kowal z własną animacją pracy |
| `models/props/` | armata, moździerz, wóz, taczka (gra przechyla ją do rąk tragarza: `PLAYBOOK.md` §4.5), świnia; towary do noszenia i stosów (deski, kamień, worek, beczka, skrzynia, chleb, mięso, strzały) |
| `models/buildings/` | 20 budynków po 3 poziomy (chata, młyn, piekarnia, kuźnia, koszary, wieża…), zamek, odcinek muru i brama |
| `sounds/` | 18 nagrań walki (MP3 mono): szczęk broni, uderzenia w zbroję, ciosy, upadki, pękający kamień — Kenney „Impact Sounds”, CC0 |
| `textures/` | 18 skanów powierzchni z Poly Haven (CC0): łąka, ziemia, błoto, tynk, belki, deski, strzecha, gont, dachówka, kamień łamany i ciosany, kora, liście, skała… |
| `loader/marchland-assets.js` | `rigged()`, `body()`, `mount()`, `prop()`, `building()`: każdy format na ekran w kilku linijkach |
| `example/` | strona z każdym modelem i klipem (wybór modelu i klipu w panelu) |
| `vendor/three/` | three.js r186 (licencja MIT), żeby przykład działał bez internetu |
| `tools/blender/` | skrypty Blendera, którymi powstały modele (wypiekanie postaci Mixamo, koni, budynków) |
| `docs/` | `PLAYBOOK.md` (wszystkie techniki gry krok po kroku), `ASSETS.md` (skąd co jest), `BLENDER.md` |
| `FORMATS.md` | dokładny opis każdego formatu i spis modeli z klipami |
| `CREDITS.md` | autorzy i licencje: **przeczytaj przed publikacją czegokolwiek** |

## Uruchomienie przykładu

`fetch` nie czyta plików prosto z dysku, więc paczkę trzeba podać przez lokalny serwer:

```bash
cd marchland-assets
python -m http.server 8000      # albo: npx serve
# w przeglądarce: http://localhost:8000/example/
```

## Użycie we własnej grze (three.js r186)

```js
import * as THREE from 'three/webgpu';
import { loadJSON, rigged, body, mount, prop, building } from './loader/marchland-assets.js';

const knight = rigged(await loadJSON('models/soldiers/swordsman.json'), { team: 0x2f5fb0 });
scene.add(knight.mesh);

const horse = rigged(await loadJSON('models/soldiers/warhorse.json'));
const riderModel = await loadJSON('models/soldiers/rider.json');
const seat = mount(horse, body(riderModel), riderModel);
scene.add(horse.mesh);

scene.add(await building('models/buildings/bakery_2.glb', { textures: 'textures/' }));

renderer.setAnimationLoop((ms) => {
  knight.play('walk', ms / 1000);
  horse.play('gallop', ms / 1000);
  seat();
  renderer.render(scene, camera);
});
```

Loader potrzebuje mapy importów `three`, `three/tsl` i `three/addons/` (jak w `example/index.html`)
albo bundlera (Vite), który je rozwiąże.

**Setki postaci naraz:** `rigged()` to jeden `SkinnedMesh` na postać, co wystarcza do kilkudziesięciu.
Gra rysuje każdy rodzaj żołnierza jednym `InstancedMesh`: macierze wszystkich klatek leżą w teksturze, a
shader wybiera klatkę każdej instancji. Opis jest w `docs/PLAYBOOK.md` §4, a kod w `armyView.ts`
(`boneTexture`, `skinnedMaterial`) w repozytorium gry.

## Licencje w skrócie

- **CC0** (tekstury Poly Haven, towary KayKit, rycerz Xali w `knight.json`): wolno wszystko.
- **CC BY 4.0** (większość postaci, koń, budynki ze Sketchfab, armaty, wozy): wolno wszystko, także
  komercyjnie, ale autor musi być podpisany w grze (ekran „Autorzy”). Gotowe podpisy są w `CREDITS.md`.
- **Mixamo** (ruchy żołnierzy i mieszczan, postacie Erika Archer i Paladin J Nordstrom): Adobe pozwala
  używać ich w swoich grach, także komercyjnych, ale **nie pozwala rozpowszechniać ich jako osobnej
  paczki**. Ta paczka jest więc do Twojego użytku: nie publikuj jej (ani katalogu `models/`) do
  pobrania; w opublikowanej grze modele mogą być, bo są jej częścią.
- Budynki zrobione skryptami gry (`tools/blender/`) i kod loadera należą do projektu.

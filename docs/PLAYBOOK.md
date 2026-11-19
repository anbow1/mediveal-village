# Marchland — playbook: techniki, assety i potok pracy

Ten dokument opisuje, **jak gra jest zrobiona**, tak dokładnie, żeby dało się to powtórzyć w innej grze:
skąd są modele i animacje, jak trafiają do gry, jak są rysowane, jak to mierzymy i jak gra trafia na
iPada i Windows. Każdy punkt wskazuje plik, w którym jest kod. Lista assetów z licencjami:
`ASSETS.md`. Formaty plików i spis modeli: `asset-pack/FORMATS.md`. Techniki wspólne z grami FPS
(trawa, pomiar klatek, warm-up shaderów) są szerzej opisane w `../../docs/graphics-playbook.md`.

## 1. Architektura

| Warstwa | Katalog | Zasada |
|---|---|---|
| Symulacja | `src/sim/` | Czysty TypeScript bez three.js: świat, ekonomia, ludzie, walka, komputer. Deterministyczna (ziarno `?seed=`), więc całe partie grają się w testach bez okna (`tests/`, `npm test`). |
| Pętla | `src/core/loop.ts` | Logika co 1/60 s, rysowanie z częstotliwością ekranu. Widok czyta ostatni stan bez interpolacji: z wysokości kamery RTS 16 ms nie widać. |
| Widok | `src/render/` | Tylko czyta świat i rysuje. Jeden instancjonowany mesh na rodzaj rzeczy (żołnierze danego rodzaju, drzewa w kwadracie mapy, budynek danego rodzaju i poziomu). |
| Aplikacja | `src/app/` | `game.ts` (jedna partia), `rtsCamera.ts` (zoom do całej mapy, obrót), `picking.ts`, `controls.ts`. |
| Interfejs | `src/ui/` | HTML nad płótnem: menu, HUD, minimapa, teksty PL/EN (`strings.ts`), zapis, tryb offline. |
| Liczby | `src/config.ts` | Wszystkie stałe gry (jednostki, budynki, czasy) w jednym miejscu; `docs/UNITS.md`, `BUILDINGS.md`, `ECONOMY.md` są z nich generowane (`npm run docs`). |

Przełączniki w adresie do pomiarów i zrzutów: `?autostart` (bez menu), `&q=high|low`, `&debug`
(`window.__debug`: `place()` kamera, `step(s)` przewinięcie symulacji, `game`), `&scene=town|battle`
(gotowe miasto albo bitwa), `&lang=pl|en`, `&sw` (tryb offline także na localhost).

## 2. Renderer, światło, obraz

- **Jedna ścieżka kodu**: `WebGPURenderer` z three.js r186, który sam przechodzi na WebGL2, gdy WebGPU
  brak (`stage.ts`). Materiały pisane w TSL (węzły), więc ten sam shader działa w obu backendach.
- **Łańcuch obrazu** (`stage.ts`): scena HDR do celu półzmiennoprzecinkowego z celem prędkości; na High
  TRAA i lekkie wyostrzenie, na Low FXAA; bloom z fizycznej jasności; tone mapping ACES i sRGB raz, na
  końcu.
- **Światło w jednostkach fizycznych** (`lighting.ts`): słońce, niebo, mgła i sonda otoczenia mnożone
  przez stałą pre-ekspozycję, więc bufory półprecyzji się nie przepełniają; ekspozycja stała dla presetu
  (kamera zawsze patrzy w dół na oświetlony teren). Późne popołudnie wczesnej jesieni: słońce 30° nad
  horyzontem, długie cienie.
- **Warm-up shaderów** (`warmup.ts`): za ekranem ładowania jedna klatka, w której jeden obiekt z każdej
  odmiany shadera jest wymuszony jako widoczny, żeby żaden potok nie kompilował się w trakcie gry (na
  telefonie to widoczne przycięcie). `compileAsync()` nie wystarcza: pomija ukryte obiekty i kompiluje dla
  zwykłego bufora, a nie dla przebiegu z post-processingiem.
- **Instancje statyczne** (`instancing.ts`): three r186 deklaruje bufor macierzy instancji pod nazwą
  mesha, więc każdy mesh budował własny shader. Mesh oznaczony `userData.staticInstances` dostaje bufor
  o jedną macierz większy niż limit i macierze idą atrybutem, a meshe z tym samym materiałem dzielą
  jeden shader.
- **Kwadraty mapy** (`chunks.ts`): drzewa, skały i krzaki jako jeden mesh na kwadrat mapy, nie jeden na
  całość, żeby renderer pomijał to, czego nie widać (także w przebiegu cieni).
- **Licznik klatek i regulator** (`perf.ts`): czas GPU na przebieg (timestampy, gdy są); regulator trzyma
  liczbę klatek, obniżając jakość obrazu, nigdy rozgrywki.
- **Zgodność** (`webgpuCompat.ts`): niektóre Chromium odrzucają `swizzle: 'rgba'` w widokach tekstur;
  ponowienie bez niego zamiast utraty WebGPU.

## 3. Teren, powierzchnie, roślinność

- **Skany powierzchni** (`surfaces.ts`, `src/assets/photo/`): 18 zestawów PBR z Poly Haven (CC0), po
  1024 px (kolor, normalne, ORM), jako warstwy **trzech tekstur tablicowych**. Shader próbkuje 3 tekstury,
  ile by powierzchni nie było (na telefonach shader z ponad 16 teksturami się nie kompiluje). Wierzchołek
  niesie `aLayer` (warstwa, powtórzenia na metr) i odcień. Każda ściana, dach i grunt w grze to jedna z
  tych powierzchni. Pobieranie i skalowanie: `tools/fetch_textures.py`.
- **Teren** (`terrainView.ts`): jeden mesh z funkcji wysokości symulacji, sięgający poza pole gry (horyzont
  to ląd). Sześć powierzchni rozkładają dwie mapy: **mapa pokrycia** (las, wysoko i sucho, skała, brzegi
  jezior, rysowana raz) i **mapa robót** (`groundWorks.ts`: R ubita ziemia, G zaorane, B zboże, A bruk),
  przerysowywana, gdy ktoś zbuduje drogę albo pole. Droga jest więc drogą na każdym zboczu, bez geometrii,
  która by wisiała albo się zapadała. Każda powierzchnia jest próbkowana w skali rzeczywistej z bliska i
  dużo większej z daleka, a wolny szum tonuje jasność, więc nie widać siatki powtórzeń.
- **Trawa przy kamerze** (`grassField.ts`, `grassView.ts`): prawdziwe źdźbła (krzywe Béziera) w kaflach
  4 m w trzech pierścieniach wokół kamery, w kolejności R2 (Roberts 2018), więc każdy prefiks to równy
  podzbiór; źdźbła rosną z trójkątów siatki terenu. Gdzie rośnie, czyta się z tych samych map co grunt.
  Włącza się tylko nisko nad ziemią.
- **Las** (`forestView.ts`, `foliage.ts`): drzewa z listy symulacji (`sim/trees.ts`), więc las, który
  widać, to ten, który spowalnia jazdę i zatrzymuje strzały. Korony to karty z liśćmi malowanymi w kodzie
  (bez pobierania), z normalnymi wygiętymi od środka korony (miękka bryła w słońcu) i kolorem
  wierzchołków przyciemniającym wnętrze (tania okluzja). Ścięte drzewo zostawia pień i sadzonkę, która
  odrasta.
- **Wycinka pod budowę** (`clearings.ts`): instancja drzewa czy krzaka pod budynkiem, drogą lub polem
  zmniejsza się do zera i wraca po rozbiórce.
- **Pola i winnice** (`cropsView.ts`, `vinesView.ts`): zboże rośnie zielone i złocieje, winorośl ma
  słupki, druty i grona, które ciemnieją. **Woda, wychodnie i głazy** (`landView.ts`), **horyzont**
  (`horizonView.ts`), **dym** z kominów pracujących budynków (`smokeView.ts`).

## 4. Postacie i animacja

### 4.1 Skąd są postacie i ruchy

- **Postacie**: modele ze szkieletem humanoidalnym z Sketchfab (CC BY 4.0: seria .Fuse Leonarda Carvalho,
  Medieval Knight, rycerz Thosta, ubrania ChamberSu1996, robotnica cattleya) i z Mixamo (Erika Archer,
  Paladin J Nordstrom). Postać może mieć szkielet Mixamo albo Unreala (`pelvis`, `thigh_l`…); nazwy kości
  są tłumaczone na nazwy Mixamo.
- **Ruchy**: Mixamo, pobierane jako FBX **Without Skin**, 30 kl./s, przy ruchu **In Place**. Do
  repozytorium trafiają tylko wypieczone macierze, nigdy surowe pliki Mixamo.
- **Zwierzęta i postacie z własną animacją** (kowal, konie MAXDESIGN-3D) idą osobną drogą (§4.3).

### 4.2 Przenoszenie ruchu na postać: `tools/blender/rigged.py`

Blender bez okna (`bl/bin/python -I rigged.py -- postać.gltf wyjście.json klipy.fbx…`). Kroki:

1. **Wczytanie i ustawienie**: glTF albo FBX. Szkielet „leżący” (eksport Unreala) jest stawiany obrotem z
   linii biodra → głowa na +Z, a potem obracany tak, żeby postać patrzyła tam, gdzie klipy (lewa strona
   z linii prawe → lewe biodro). Skala do zadanej wysokości (`--height`), niezależnie od jednostek pliku.
2. **Siatki**: pomijane są siatki związane daleko poza szkieletem (broda czy kok wyeksportowane z własnym
   wiązaniem), siatki związane tylko ze stawami broni (własny miecz i tarcza postaci) i części bez wag
   poza hełmem, kapeluszem i włosami, które jadą na głowie. Całość jest upraszczana do budżetu trójkątów
   (`--tris`, zwykle 1600 dla mieszczan i 3400 dla żołnierzy).
3. **Kolory z tekstury do wierzchołków**: średnia z tekseli rogów, z obrazu podpiętego do Base Color
   (także przez węzły Mix). Teksele półprzezroczyste (przerwy między pasmami włosów) są pomijane, a
   wierzchołek, który nie trafił w żadne pasmo, dostaje średni kolor nieprzezroczystych tekseli; bez tego
   wokół głów były jasne plamy. Metaliczność z mapy metallicRoughness, a bez niej z mapy odbić (specular).
4. **Barwy strony**: `--team <tekstura>` i `--team-share` zapisują w `surface.z` udział koloru strony;
   `--team-below` farbuje tylko ciemne teksele (ubranie, nie skórę na tej samej teksturze).
5. **Przeniesienie klipu, kość po kości**: każda kość postaci bierze obrót tej samej kości klipu od jej
   pozy spoczynkowej, po wcześniejszym obróceniu własnego kierunku spoczynkowego na kierunek klipu (poza A
   postaci nie przenosi się na ruch). Głowa kości leży tam, gdzie stawia ją obrócony rodzic; tylko biodra
   ruszają się same, w skali wysokości postaci i w miejscu (klip „nie w miejscu” zapisuje, ile metrów
   przeszedł: `travelM`).
6. **Broń z kodu**: miecz, halabarda, pika, łuk, kusza, siekiera, młot i tarcza trójkątna są bryłami
   skryptu na stawach broni klipów (`Sword_joint`, `Shield_joint`) albo na dłoni. Narzędzie poza swoimi
   klipami (`--tool-clips`) ma kość ściśniętą do zera. W klipach karabinowych (`--two-hand-clips`, np.
   Bayonet Stab) drzewce leży na linii od prawej do lewej dłoni, bo staw miecza nie leży tam wzdłuż broni.
7. **Jeździec** (`--seated`): bez klipów, jedna poza w siodle (uda 45° do przodu i 20° na boki, łydki w
   strzemionach, prawa ręka do kopii, lewa do wodzy), zapisana jako ciało z częściami (`limbs`, `pivots`);
   `--gain` rozjaśnia ciemną stal.

### 4.3 Własna animacja modelu: `tools/blender/baked.py` i `horsefall.py`

- `baked.py` wypieka model z jego własną animacją, bez przenoszenia: kości o małej wadze są składane do
  przodka (`--bones`), jedno nagranie tnie się na klipy (`--clips idle:351:413,walk:74:107,…`), `--centre`
  ustawia zwierzę środkiem nad punktem jednostki, `--saddle` zapisuje kość i punkt siodła, a `travelM` jest
  mierzone z poślizgu kopyt stojących na ziemi. Położenie szkieletu czyta się w każdej klatce (niektóre
  nagrania animują obiekt nadrzędny szkieletu).
- `horsefall.py` przenosi upadek z innego konia (inny szkielet, kości bez nazw, macierze niezgodne z
  siatką) na konia gry: obroty z położeń stawów (zad i kłąb z linii bioder lub łopatek i kręgosłupa,
  nogi, szyja i ogon z kierunku odcinków), nałożone od bioder w dół na szkielet konia gry, każda klatka
  postawiona na ziemi. Dwie odrzucone próby i ich powody są w `RESULTS.md` (17.11).

### 4.4 Rysowanie setek postaci: skinning na GPU (`armyView.ts`)

- **Jeden `InstancedMesh` na rodzaj żołnierza**, obie strony razem. Procesor pisze na żołnierza kilka
  liczb: miejsce i kierunek (`aPlace`), krok, cios i upadek (`aAnim`), stronę (`aSide`) i **numer klatki**
  (`aFrame`).
- **Klatki w teksturze** (`boneTexture`): `DataTexture` RGBA float, 3 teksele na kość (trzy wiersze macierzy
  3×4), jeden wiersz tekstury na klatkę wszystkich klipów. Shader (`skinnedMaterial`, TSL) czyta
  `textureLoad` cztery kości wierzchołka w klatce instancji i składa pozycję i normalną, potem obraca i
  przesuwa instancję. Każdy żołnierz ma więc własną klatkę przy jednym wywołaniu rysowania na rodzaj.
- **Najwyżej 8 buforów wierzchołków** (limit WebGPU): atrybuty są przeplatane w dwa bufory
  (`interleave`): pozycja, normalna, kolor, powierzchnia oraz kości, wagi i części, plus bufory instancji.
- **Wybór klatki** (`skinnedFrame`): upadek (klip śmierci, każdy żołnierz inny), cios trwający dokładnie
  między dwoma ciosami (długi przyspieszony), drgnięcie po trafieniu, marsz albo bieg zgrany z przebytą
  drogą (`travelM`, bez ślizgania), garda z tarczą, postawa z bronią wycelowaną we wroga, spoczynek z
  przesuniętą fazą (szereg nie oddycha jednocześnie). **Klatka zasięgu** pikinierów i halabardników (szyk z
  opuszczonymi pikami) jest wybierana przy wczytaniu: ta, w której grot jest najdalej z przodu i nie wyżej
  niż pierś.
- **Koń i jeździec**: koń gra swoje klipy (galop powyżej 1,8 m/s, chód, postój, skubanie trawy co trzeciego
  w spoczynku, upadek). Jeździec to dodatkowa „kość” (`withRider`): macierz kości siodła z jeźdźcem
  pochylonym i kołyszącym się wokół bioder w takt chodu albo galopu, bez klipu jazdy. **Kropierz** jest
  wycięty z trójkątów skóry konia (`caparison`), lekko odsunięty wzdłuż normalnych i na tych samych
  kościach, więc leży na koniu i się z nim rusza. **Wapenrok** jeźdźca jest tak samo wycięty z trójkątów
  jego tułowia (`cavalryGeometryOnModels`).
- **Obsługa dział** to mieszczanie ze szkieletem przy dziale (`loadCrew`, `writeCrews`).
- **Brak modelu = bryły z kodu** (`soldierGeometry.ts`): każda jednostka ma wersję z prostopadłościanów,
  która rysuje się, dopóki model się nie wczyta albo gdy go nie ma.

### 4.5 Mieszkańcy (`peopleView.ts`, `workersView.ts`)

Mieszkańców obu stron rysuje kilka ciał (czterech mężczyzn, trzy kobiety) z tymi samymi klipami pracy;
klatki wszystkich ciał leżą w jednej teksturze kości (każde ciało ma swój offset `base`), a materiał jest
wspólny. Co trzecia osoba to kobieta. Klip wynika z tego, co robi: niesie skrzynię, kopie, łowi, rąbie,
kuje, żnie, stoi albo idzie. Niesiony towar to osobna instancja, barwiona rodzajem towaru. Kowal przy
hucie, kuźni i płatnerzu to model z własną animacją pracy (`workersView.ts`), każdy w swojej fazie.

**Taczka** (`pushedBarrow` w `peopleView.ts`): model z Sketchfabu stoi w pozie spoczynkowej, na nóżkach.
Przy wczytaniu wierzchołki i normalne są obracane wokół osi koła, aż końce rączek trafią w dłonie tragarza
(0,85 m nad ziemią, 0,4 m przed nim), a koło zostaje na ziemi. Ten sam obrót wyznacza dno skrzyni, na którym
leży ładunek. Niesiony towar jest zbudowany na wysokości dłoni, więc w taczce opuszcza się go o różnicę
wysokości.

### 4.6 Ruch wojska: kolumna, przeprawy, kolejka (`movement.ts`, `nav.ts`)

- **Oddział to kotwica i miejsca w szyku.** Kotwica (czoło) idzie do celu, a każdy żołnierz do swojego
  miejsca. Gdy woda, skała albo mur leżą na drodze, `findRoute` (A* po komórkach 2 m) wyznacza punkty trasy,
  a oddział idzie po nich w kolumnie trzech.
- **Trasa środkiem przejścia.** Dla oddziałów komórka 1–2 komórki od wody, skały albo cudzego muru kosztuje
  więcej (`EDGE_COST`). Dzięki temu trasa przez bród albo bramę biegnie środkiem, a nie krawędzią.
- **Kolumna jak wąż.** Kotwica zostawia ślad (punkt co 2 m), a w kolumnie szereg *k* stoi na śladzie
  *k · odstęp szeregów* za czołem (`snakePlace` w `regiment.ts`). Ogon idzie więc tam, gdzie szło czoło,
  i nie zatacza łuku przez rzekę przy skręcie. Kolumna rozwija się w szyk, dopiero gdy przejdzie jej ostatni
  szereg (`columnLeftM`).
- **Pas, nie linia.** Czy droga jest wolna, sprawdza się w pasie o szerokości frontu (`wideBlocked`). Linia
  szersza niż brama przechodzi więc w kolumnie, zamiast utknąć skrzydłami na murze.
- **Kolejka na przeprawach.** Brody, grobla i bramy to przeprawy (bramy zebrane z komórek muru). Oddział
  w odległości 12 m od przeprawy, którego trasa w nią wchodzi, czeka, jeśli przez przeprawę idzie inny
  oddział jego strony albo inny jest bliżej wejścia. Reguła nie ma stanu: liczy się co krok z położeń, więc
  jest deterministyczna i nie trzeba jej zapisywać. `tests/crossing.test.ts` puszcza po 4 oddziały przez
  bród i przez bramę.
- **Front przeciągnięciem** (`dragFacing` w `commands.ts`): przeciągnięcie wyznacza front, a oddział patrzy
  zawsze w lewo od kierunku przeciągnięcia. Jedna reguła daje płynny obrót przez 360°. Wcześniejsza reguła
  „od środka oddziałów” przeskakiwała o 180°. Na dotyku to samo robi przytrzymany palec (350 ms), potem
  przeciągnięty. Ponowne stuknięcie zaznaczonego oddziału albo × na jego karcie odznacza go.

## 5. Budynki

- **Zestaw skryptów Blendera** (`tools/blender/kit.py`, `parts.py`, `buildings.py`, `build.py`): ściany
  szachulcowe, podmurówki, dachy z grubością i okapem, okna z okiennicami, kominy i drobiazgi przy ścianach
  składane w budynki gry po 3 poziomy (1–9 tys. trójkątów). `build.py` buduje wszystkie do
  `public/buildings/` z `index.json`; podgląd w `gallery.html`. Każdy budynek ma znak rozpoznawczy widoczny
  z kamery strategicznej (lista w `BLENDER.md`).
- **Materiały nazywają powierzchnię gry** (`plaster`, `beam#d8cfc6`), a nie tekstury: `surfaceModel.ts`
  zamienia nazwę na warstwę i odcień, więc jeden materiał rysuje wszystkie budynki tymi samymi skanami co
  teren. `team` to kolor właściciela, `sails`, `leaf_l` i `leaf_r` to części ruchome, puste obiekty
  `smoke_…` to miejsca dymu.
- **Modele z zewnątrz** (zamek z Buckstone Castle, mur, brama i wieża z Tower and Castle Walls, kuźnia):
  `keep.py`, `walls.py`, `convert.py` zdejmują tekstury, przypisują powierzchnie gry po nazwach
  materiałów, upraszczają i skalują.
- **Etapy budowy** (`townView.ts`): fundament, potem ściany rosną warstwami w rusztowaniu, dach na końcu.
  To ten sam model ucięty na wysokości postępu: materiał ma `maskNode` z uniformem na obiekt
  (`onObjectUpdate`, `userData.cutY`), więc jeden materiał tnie każdy plac inaczej; cienie są ucinane tak
  samo.
- **Mur** (`wallView.ts`): odcinek z modelu powtarzany co 2 m wzdłuż narysowanej linii; brama otwiera
  skrzydła, gdy podchodzą swoi. Linia pod dowolnym kątem to schodki komórek, które znają swój kierunek tylko
  z dokładnością do 45°. Kierunek odcinka bierze się więc z osi głównej komórek tej samej linii w promieniu
  3 komórek: odcinek stoi na tej osi i ma długość od komórki do komórki, z naddatkiem 6%.

## 6. Assety: skąd i na jakich zasadach

Pełna lista z autorami i licencjami jest w `ASSETS.md`, a podpisy w `public/*/CREDITS.md` i
`src/assets/photo/LICENSE.md`. Zasady, których się trzymamy:

1. Tylko **CC0**, **CC BY** albo **Mixamo**. Licencję sprawdzamy w pliku `license.txt` z pobrania.
2. **Nie bierzemy** modeli wyciągniętych z gier ani modów, ani cudzych postaci wrzuconych ponownie pod
   inną licencją (np. Paladin z Mixamo udostępniony jako „CC BY”). Odrzucone są wpisane w `ASSETS.md` z
   powodem.
3. Pobrane pliki są **niezaufane**: każdy w osobnym katalogu, skrypty Pythona z `-I`, `.blend` otwierane
   bez skryptów, nic nie jest uruchamiane z ich katalogu.
4. W repozytorium leżą tylko pliki przerobione dla gry (JSON, GLB bez tekstur), nigdy surowe pliki Mixamo.
5. Każdy nowy plik ma podpis w `CREDITS.md` swojego katalogu i wiersz w `ASSETS.md` w tej samej zmianie.

**Paczka assetów** do nowej gry: `node tools/pack-assets.mjs` → `asset-pack-out/marchland-assets.zip`
(modele, tekstury, loader three.js, strona z przykładem, skrypty Blendera, ten dokument, podpisy). Opis:
`asset-pack/README.md`, formaty: `asset-pack/FORMATS.md`.

## 7. Pomiary i sprawdzanie

- **Testy** (`npm test`, vitest): ekonomia, walka, łucznictwo, kamera, całe partie bez gracza. Każda zmiana
  przechodzi testy przed wypchnięciem.
- **Pomiar wczytania** (`../tools/measure/load.mjs --game generic --url … --extra "&scene=battle"`):
  liczba potoków i modułów shaderów, błędy WebGPU, pamięć tekstur, czas do gotowości. Każda zmiana grafiki
  ma pomiar na WebGPU (0 błędów) i liczbę potoków w `RESULTS.md`.
- **Zrzuty**: Playwright z Chromium na SwiftShader (`--use-angle=swiftshader`), strona z `?autostart&debug`,
  scena ustawiona przez `__debug` (zatrzymana pętla, żołnierze ustawieni w szereg, kamera z `place()`).
  Do zbliżeń tymczasowo `minDistanceM: 5` w `config.ts` (bez wypychania tej zmiany).
- **Podgląd modeli w Blenderze bez okna**: renderer Cycles na CPU (Workbench potrzebuje EGL), z
  `clip_end` dopasowanym do skali pliku (modele w centymetrach znikały za płaszczyzną odcięcia).
- **Dziennik**: każda zmiana ma wpis w `RESULTS.md`: co, dlaczego, liczby, co odrzucone.

## 8. Wydanie: przeglądarka, iPad, Windows, offline

- **Budowa** (`npm run build`): Vite, wynik w `dist/` (ok. 56 MB, 161 plików).
- **Tryb offline** (`src/ui/offline.ts`, `tools/pwa/`): wtyczka Vite po budowie zapisuje `dist/sw.js` z listą
  wszystkich plików i skrótem każdego. Service worker przy pierwszej wizycie zapisuje grę na urządzeniu.
  Nowa wersja instaluje się do własnej pamięci: niezmienione pliki kopiuje ze starej, pobiera tylko
  zmienione, i przejmuje grę przy następnym uruchomieniu albo od razu z paska „Uruchom teraz”. Pliki
  dopasowuje bez nagłówka `Vary` (moduł JS prosi z nagłówkiem Origin, którego zapisana kopia nie ma).
  Manifest, ikony i znaczniki Apple dają pełny ekran z ekranu początkowego iPada.
- **GitHub Pages** (`.github/workflows/marchland-web.yml`): każdy push do `main` buduje grę i wypycha ją
  jednym commitem na gałąź `gh-pages` (artefakty Actions na koncie są pełne, a gałąź z nich nie korzysta).
  Adres: https://anbow1.github.io/FPS/marchland/.
- **Windows**: najprościej Edge albo Chrome → „Zainstaluj aplikację” na stronie gry (ikona, offline,
  aktualizacje). `desktop/` to okno Electron na ten sam adres (`Marchland.exe`, przenośny, ok. 102 MB, bez
  podpisu); proces `.github/workflows/marchland-desktop.yml` buduje go na Linuksie bez Wine, a do
  publikacji w wydaniu potrzebuje zgody na zapis dla Actions w ustawieniach repozytorium.

## 9. Pułapki, na które już wpadliśmy

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| Koń biały | Tekstura podpięta przez węzeł Mix, nie wprost do Base Color | Szukanie obrazu w górę drzewa węzłów (`colour_image`) |
| Jasne plamy wokół głów, białe pasma grzywy | Kolor uśredniany także z przezroczystych tekseli kart włosów | Pomijanie tekseli z alfą < 0,5; wierzchołek bez trafienia dostaje średnią nieprzezroczystych |
| Postać z Unreala ma 14 m i leży | Szkielet położony pod obiektem nadrzędnym (Y w górę) | Obrót z linii biodra → głowa; uważać, żeby nie obrócić dwa razy |
| Postaci znikają włosy albo broda | Siatka wyeksportowana z wiązaniem daleko od ciała | Pomijanie tylko siatek związanych dalej niż pół zasięgu szkieletu |
| Własny miecz Paladina w biodrze | W FBX z Mixamo nazwy siatek są pomieszane; miecz był związany ze stawem broni | Pomijanie siatek związanych tylko ze stawami `*_joint`, niezależnie od nazwy |
| Tarcza do góry nogami | Kierunek szpica i kolejność wierzchołków | `HEATER_POINT = 1`, kolejność trójkątów sprawdzana z normalną |
| Jeździec czarny jak sylwetka | Ciemna stal tekstury, mała metaliczność | `--gain 2.5`, metaliczność z mapy odbić |
| Upadek drugiego konia „w górę” | Obiekt nadrzędny szkieletu odbity i w innej skali niż siatka | Obroty ze stawów zamiast macierzy kości (`horsefall.py`) |
| Pika pionowo w klipie karabinowym | Staw miecza nie leży wzdłuż broni | `--two-hand-clips`: drzewce na linii dłoni |
| Wspólny materiał nie zmniejsza liczby potoków | three.js kompiluje osobno dla każdej geometrii ciała | Liczyć potoki pomiarem; każde nowe ciało to ok. 2 potoki |
| Gra offline nie startuje (JS i CSS) | `cache.match` respektuje `Vary` | `ignoreVary: true` |
| Wdrożenie Pages pada | Pełny limit artefaktów Actions na koncie | Wypychanie na gałąź `gh-pages` |
| `.exe` nie trafia do wydania | Token Actions bez zgody na tworzenie wydań (HTTP 403) | Zgoda w ustawieniach repozytorium albo instalacja z przeglądarki |
| Żołnierze w głębokiej wodzie na brodzie pod kątem | Trasa krawędzią brodu; sztywna kolumna przy skręcie zatacza łuk ogonem | Koszt komórek przy brzegu, kolumna po śladzie czoła (§4.6) |
| Mur pod kątem rozpada się na schodki | Odcinki obrócone do najbliższej wielokrotności 45° | Kierunek z osi głównej sąsiednich komórek (§5) |
| Kierunek oddziału przeskakuje o 180° przy przeciąganiu | Zwrot wybierany „od środka oddziałów” | Stały zwrot: w lewo od przeciągnięcia (§4.6) |
| Długie złożone polecenia w powłoce odrzucane | Kontrola bezpieczeństwa narzędzia | Dzielić na krótsze kroki |

## 10. Nowa gra z gotowych assetów: kolejność pracy

1. `node tools/pack-assets.mjs`, rozpakować `marchland-assets.zip`, uruchomić `example/` (serwer HTTP) i
   obejrzeć każdy model i klip.
2. Nowy projekt Vite + three.js r186 (`three/webgpu`), skopiować `models/`, `textures/` i
   `loader/marchland-assets.js`. Pierwsza scena: teren z `textures/meadow`, kilka postaci z `rigged()`.
3. Do kilkudziesięciu postaci wystarczy `rigged()`. Powyżej przenieść skinning instancjonowany z §4.4
   (`boneTexture` i `skinnedMaterial` z `armyView.ts`): jeden mesh na rodzaj, klatka na instancję.
4. Budynki przez `building()` (triplanar ze skanów). Dla wydajności i spójności przenieść warstwy tekstur
   tablicowych z §3 (`surfaces.ts`, `surfaceModel.ts`).
5. Nowe postacie i ruchy: Mixamo (Without Skin, In Place) i `tools/blender/rigged.py`; zwierzęta i modele
   z własną animacją przez `baked.py`. Każdy nowy plik od razu z podpisem w `CREDITS.md`.
6. Przed publikacją: `CREDITS.md` w grze jako ekran „Autorzy”. Paczki samej w sobie nie publikować
   (licencja Mixamo).

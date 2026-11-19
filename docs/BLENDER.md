# Marchland — zadania dla Blendera

Co trzeba zrobić w Blenderze (albo znaleźć gotowe), żeby gra przestała
wyglądać jak zbudowana z klocków. Każde zadanie kończy się plikiem `.glb` w
ustalonym miejscu i o ustalonych nazwach; resztę (animacja w teksturze,
poziomy szczegółów, kompresja, podpięcie do gry) robi kod po stronie gry.

Kolejność = wpływ na obraz. Jeśli czasu jest mało, zrób **A1–A3** i **B1–B2**.

## Decyzja o stylu (2026-11-13)

**Styl realistyczny, wariant D** z porównania w `results/2026-11-13/style/`:
szachulec z wypełnieniem z tynku, kamienna podmurówka, strome dachy z gontu,
dachówki albo strzechy z grubością i okapem, prawdziwe okna z okiennicami,
kominy, drobiazgi przy ścianach (beczki, skrzynie, drabiny, narzędzia). Kolor
i faktura z fotograficznych skanów (Poly Haven, CC0), tak jak podłoże.
Styl rysunkowy (C) i płaskie kolory (A) odpadają.

Skąd modele:

- **Budujemy sami** w Blenderze skryptem (`tools/blender/`, bpy działa w
  kontenerze bez okna): jeden zestaw części (ściany szachulcowe, podmurówki,
  dachy, okna, drzwi, kominy) składany w każdy z 15 budynków i 3 poziomy, z
  tymi samymi skanami. Tak cały zestaw jest spójny, czego nie da mieszanie
  modeli różnych autorów.
- **Drobiazgi** z Poly Haven (CC0): beczki, skrzynie, wiadra, drabiny, ławy,
  stoły — wiarygodne i lekkie.
- **Gotowe modele z Sketchfab** (CC BY) tylko jako wyjątki i wzór; kuźnia D
  (33 tys. trójkątów) może zostać, dom z winiarnią (673 tys.) trzeba
  uprościć poniżej limitu.

**Zrobione (2026-11-13)** skryptami `tools/blender/` (`build.py` buduje wszystko do
`public/buildings/` z indeksem `index.json`; podgląd: `gallery.html`): **wszystkie 19
budynków gry** po 3 poziomy, 1–9 tys. trójkątów każdy. Każdy ma znak rozpoznawczy
widoczny z daleka:

| Budynek | Znak rozpoznawczy |
|---|---|
| chata | szachulec, strzecha (poz. 1) albo gont, komin z dymem |
| drwal | otwarta szopa pełna kłód, pnie przy drodze, pieniek z siekierą, kozioł z piłą |
| kamieniołom | schodkowa ściana skały, rzędy ciosów, żuraw, szopa kamieniarzy |
| zagroda | dom pod strzechą, stodoła, stogi, wóz, studnia; pola za nią rysuje gra |
| rybak | chata nad wodą, suszarnie z rybami, odwrócona łódź, sieć |
| młyn | koźlak na palach; skrzydła kręcą się, gdy miele |
| piekarnia | kopuła pieca z kominem, precel nad drzwiami, stragan z chlebem |
| chlewnia | niski chlew, błotnisty wybieg ze świniami, koryto |
| masarnia | wędzarnia z dymem, stojak z mięsem i kiełbasami, pieniek z tasakiem |
| winnica | biały dom z prasą i pergolą; rzędy winorośli na polach rysuje gra |
| winiarnia | kamienna piwnica, skład beczek, wiecha, wóz winogron |
| garbarnia | kadzie z garbnikiem, rozpięte skóry na ramach, kora |
| kopalnia | sztolnia w skale, tory, wózek z rudą, hałda |
| huta | kamienny piec z żarem i dymem, miechy, mielerz, żużel |
| kuźnia | otwarte palenisko z żarem, kowadło, szlifierka |
| płatnerz | stojaki z kolczugami, stojak drzewc, tarcze w barwach strony |
| łuczarz | stojak łuków, strzały w beczkach, drewno na łuki, tarcza strzelecka |
| stajnia | boksy, wybieg z końmi, koryto, siano |
| koszary | chorągiew strony, pale do ćwiczeń, stojak włóczni, tarcza strzelecka |

Dym (gra): z chat z mieszkańcami, z warsztatów przy pracy, z pieca i mielerza huty —
w punktach, które modele oznaczają pustymi obiektami `smoke_…`.

Zamek: **Buckstone Castle** (Peter Leban, CC BY 4.0; `public/buildings/CREDITS.md`),
przerobiony przez `tools/blender/keep.py` na powierzchnie gry: tynk, ciosy narożne,
rudy dach z dachówki i szare łupki, drewno, strzecha i bruk z atlasu domów (przypisane
według miejsca w atlasie, z którego ściana brała kolor); bez płyty gruntu i bluszczu,
przerzedzony z 59 do 22 tys. trójkątów, 24 m długości, flaga w barwie strony na
najwyższej iglicy. Kształt z kodu (`keepGeometry`) zostaje, gdy model się nie wczyta.

Mur i wieża strażnicza: **Tower and Castle Walls** (LucasPresoto, CC BY 4.0),
przerobione przez `tools/blender/walls.py`. Mur to jeden okres blanek wycięty ze źródła,
domknięty na końcach i rozciągnięty na komórkę 2 m (`wall.glb`, 204 trójkąty, rysowany
instancjami w `wallView.ts`); korpus z kamienia łamanego, korona i blanki z ciosu, blanki
o 80 % wyższe niż w źródle, żeby było je widać z góry. Wieża (5,1 m, taras na 8,6 m, gdzie
stoją łucznicy) dostaje drzwi i flagę, od poziomu 2 drewniany ganek (hurdycje), na
poziomie 3 lekki daszek na słupach.

Kuźnia na poziomach 2 i 3: **Medieval Blacksmith** (Daniel Andersson, CC BY 4.0),
przerobiona przez `tools/blender/convert.py`: konwerter dla pobranych budynków, który
po słowach w nazwach materiałów (drewno, dachówka, tynk, kamień, żelazo, szkło…)
przypisuje powierzchnie gry, wyrzuca liście i drobiazgi, scala płaskie ściany,
przerzedza do budżetu, ustawia rozmiar i dym (komin, palenisko). Odrzucone z
przesłanych: dom z winiarnią (670 tys. trójkątów w 9 457 kawałkach, nie da się go
przerzedzić w całości), karczma i kuźnia stylizowana (bajkowe dioramy na śniegu),
warsztat na skale (diorama), chałupa ze strzechą z wioski (po zdjęciu tekstur zostaje
gładka skrzynia — drzwi, okna i belki były tylko namalowane; własne chaty mówią więcej).

Brama (`gate.glb`): odcinek z łukiem z tego samego zestawu, zwężony do 3 komórek (6,1 m),
2,6 tys. trójkątów; dwa skrzydła to osobne części `leaf_l` / `leaf_r` z początkiem na
zawiasie, gra otwiera je, gdy swoi są blisko.

Do zrobienia: warianty (np. dwa wyglądy chaty
na poziom), poziomy szczegółów dla widoku z daleka.

Budżet budynku na poziom: do **12 tys. trójkątów** (koszary i zamek do 25
tys.), do **3 materiałów** (ściany, dach, drewno i drobiazgi), tekstury z
istniejących skanów gry, bez własnych map większych niż 1024 px.

## 0. Zasady wspólne

- **Blender 4.2 lub nowszy.** Eksport: *File → Export → glTF 2.0 (.glb)*,
  format **glTF Binary**, *+Y Up* włączone, *Apply Modifiers* włączone,
  tekstury osadzone (JPEG dla koloru, PNG tylko gdy jest przezroczystość),
  kompresja Draco **wyłączona** (robi ją później skrypt).
- **Skala 1 jednostka = 1 metr**, transformacje zastosowane (*Ctrl+A → All
  Transforms*). Człowiek ma 1,70–1,85 m, koń 1,55–1,65 m w kłębie, drzwi 2 m,
  kondygnacja 2,6–3 m.
- **Kierunek**: przód modelu patrzy w **−Y Blendera** (tak jak w widoku
  *Front*, klawisz 1). Postać stoi stopami w punkcie (0, 0, 0); budynek ma
  środek działki w (0, 0, 0) i drzwi od strony −Y.
- **Licencje**: tylko własna praca, **CC0** albo **CC BY**. Dla każdego
  cudzego pliku dopisz wiersz do `marchland/CREDITS.md`: nazwa, autor, adres,
  licencja. Licencja „tylko niekomercyjnie” albo niejasna — nie używaj.
  Animacje z Mixamo nie są CC0 ani CC BY (licencja Adobe pozwala użyć ich w
  grze, ale nie rozdawać dalej): jeśli chcesz ich użyć, to Twoja decyzja —
  zapisz ją w `CREDITS.md`.
- **Żadnych prawdziwych herbów, nazw i znaków** (reguły repo §11): herby
  wymyślone; orły, lwy i krzyże konkretnych państw i zakonów odpadają.
- **Bez krwi i ran.**
- Pliki źródłowe: `marchland/assets-src/…` (ścieżki niżej). Jeden plik do
  10 MB; całość do 80 MB. Większe tekstury zmniejsz do podanych rozmiarów.
- Do każdego pliku zrób podgląd: render 1024 × 1024 z kamery pod kątem 45° z
  góry, zapisany obok jako `<nazwa>.jpg`. Po nim oceniamy, zanim cokolwiek
  trafi do gry.

**Materiały — dwie drogi, do wyboru dla każdego modelu:**

1. **Nazwane powierzchnie gry (bez rozkładania UV).** Nadaj ścianom materiały
   o nazwach z listy; gra nałoży na nie własne skany (projekcja pudełkowa),
   więc wystarczy sama bryła:
   `plaster` (tynk na glinie), `beam` (ciemne belki), `boards` (deski),
   `thatch` (strzecha), `shingles` (gont), `tiles` (dachówka), `rubble` (mur
   łamany), `ashlar` (cios), `bark` (kora, kłody), `mud` (błoto), `farm_soil`
   (rola), `dirt` (ubita ziemia). Kolor materiału w Blenderze działa jak
   odcień (biały = skan bez zmian).
2. **Własne tekstury (z rozkładem UV).** Zestaw PBR: kolor (sRGB), normalna
   (OpenGL, zielony do góry), ORM (R = okluzja, G = szorstkość, B = metal).
   Rozmiary w zadaniach.

Dodatkowe nazwy materiałów, które gra rozumie w każdym modelu:

| Nazwa | Co robi gra |
|---|---|
| `team` | barwi na kolor strony (niebieski / czerwony), zachowując jasność tekstury. Tuniki herbowe, pola tarcz, kropierze, chorągwie. Tekstura biało-szara. |
| `cloth` | barwi **każdą postać inaczej** z palety spranych barw (len, brąz, zieleń, rdza, błękit). Tuniki, kaptury, nogawice milicji i robotników. Tekstura biało-szara. |
| `shield` | pole tarczy: gra nakłada wymyślony herb w kolorze strony. UV całego pola tarczy w kwadracie 0–1. |
| każda inna | rysowana własną teksturą modelu, bez zmian (skóra, kolczuga, stal, drewno, rzemienie). |

## A. Postacie (największa różnica w obrazie)

Gra wypala animację do tekstury i rysuje wszystkich żołnierzy jednego rodzaju
jednym wywołaniem. Dlatego **szkielet może być dowolny** (Rigify, MakeHuman,
Mixamo, własny) — liczy się siatka i nazwane akcje.

**Budżet na postać:** piesza do 2 500 trójkątów i 2 000 wierzchołków; jeździec
z koniem razem do 5 000 trójkątów; machina z obsługą do 6 000. Jedna tekstura
koloru 1024², normalna 1024², ORM 512² na rodzaj oddziału. Z 40–260 m liczy
się sylwetka i kolor, nie pory skóry: hełm, tarcza, broń i krój tuniki muszą
być czytelne z góry.

**Akcje** (nazwy dokładnie takie; 30 klatek/s; chód i bieg **w miejscu**, bez
przesuwania postaci):

| Akcja | Długość | Uwagi |
|---|---|---|
| `idle` | 2–3 s, pętla | stoi w szyku, broń u nogi |
| `walk` | 1 cykl, pętla | krok marszowy, ok. 1,4 m/s |
| `run` | 1 cykl, pętla | ok. 3 m/s |
| `attack` | 1,0–1,4 s | cios albo pchnięcie; trafienie w 40 % długości |
| `shoot` | łuk 1,5 s; kusza 1,0 s | tylko strzelcy: naciągnięcie i strzał |
| `reload` | 3 s | tylko kusznicy: napinanie |
| `brace` | 1 klatka | tylko pikinierzy i halabardnicy: broń pochylona na wroga |
| `die` | 1,2–1,8 s | upada i leży; ostatnia klatka to poza leżąca |

Jazda (jeden plik: koń + jeździec, jeden szkielet albo dwa): `idle`, `walk`
(stęp/kłus w miejscu), `gallop`, `attack`, `die`.
Robotnik: `idle`, `walk`, `carry` (chód z workiem na plecach), `work`
(pętla: młot / siekiera / motyka — jedna uniwersalna wystarczy), `die`.

Źródła ruchu z licencją do sprawdzenia przed użyciem: biblioteki animacji CC0
(np. Quaternius „Universal Animation Library”), baza CMU, własny mocap przez
`tools/mocap/bake_clip.py` z tego repo.

### A1. Piechota — 6 plików

`assets-src/units/militia.glb`, `pikemen.glb`, `archers.glb`, `swordsmen.glb`,
`halberdiers.glb`, `crossbowmen.glb`

Ciała: MPFB (MakeHuman, CC0) — w repo jest gotowy tor:
`docs/new-game-AAA-lite/tools/assets/people/build_people_mpfb.py` i jego
README. Ubiór XIII–XIV wieku, bez jednolitych mundurów:

| Oddział | Sylwetka |
|---|---|
| Milicja | tunika do kolan i kaptur (`cloth`), nogawice, tarcza migdałowa albo okrągła z umbem (`shield`), krótka włócznia 2,2 m; bez hełmu albo kapalin |
| Pikinierzy | przeszywanica (`cloth`), kapalin, pika 4,6 m trzymana oburącz, bez tarczy |
| Łucznicy | tunika i kaptur (`cloth`), łuk 1,8 m, kołczan u pasa, puginał |
| Miecznicy | kolczuga do kolan z kapturem kolczym, tunika herbowa (`team`), hełm łebka albo kapalin, tarcza trójkątna (`shield`), miecz |
| Halabardnicy | kolczuga, brygantyna albo płaty (własna tekstura), kapalin, halabarda 2,4 m, bez tarczy |
| Kusznicy | przeszywanica (`cloth`), kapalin, kusza, pawęż na plecach (`shield`), kołczan bełtów |

Kryterium: z kamery 45° z góry z 40 m każdy z sześciu daje się nazwać po
sylwetce; kolor strony widać na co najmniej jednej dużej płaszczyźnie (tarcza,
tunika albo proporzec); wszystkie akcje z tabeli obecne.

### A2. Jazda — 2 pliki

`assets-src/units/light_cavalry.glb` — koń bez kropierza, jeździec w
przeszywanicy i kapalinie, włócznia, tarcza (`shield`).
`assets-src/units/heavy_cavalry.glb` — rycerz: kolczuga, hełm garnczkowy,
tunika herbowa (`team`), kopia z proporcem (`team`), tarcza (`shield`); koń w
kropierzu do pęcin (`team`).

Koń: proporcje prawdziwe (nie kuc), grzywa i ogon jako bryła, nie włosy.

### A3. Robotnicy — 2 pliki

`assets-src/units/worker_man.glb`, `worker_woman.glb` — tunika albo suknia
(`cloth`), czepiec / kaptur; bez broni. Do 1 800 trójkątów. To oni będą nosić
towary i budować (plan rozgrywki M1), więc będzie ich na ekranie wielu.

### A4. Machiny — 2 pliki

`assets-src/units/ballista.glb` — łoże na kołach, ramiona, cięciwa; akcje
`idle`, `fire` (0,6 s), `reload` (3 s). Obsługa to osobne postacie (A3).
`assets-src/units/trebuchet.glb` — rama, oś, ramię z przeciwwagą i procą;
akcje `idle`, `fire` (2 s: ramię przechodzi przez pion), `reload` (5 s).
Drewno: materiał `beam` i `boards` (droga 1) albo własna tekstura.

## B. Budynki

Działka ma 11 × 11 m; budynek z zagrodą mieści się w niej. Drzwi od −Y. Budżet:
do 12 000 trójkątów na budynek z zagrodą, zamek do 25 000. Najprościej drogą 1
(nazwane powierzchnie): sama bryła, bez UV.

Wzorzec stylu: wieś z muru pruskiego. Strome dachy (50–58°), strzecha gruba na
40 cm z zaokrąglonym okapem i wiązaną kalenicą, gont w nierównych rzędach,
belki krzywe i nierówne, tynk między belkami, kamienna podmurówka, piętro
nadwieszone nad ulicą, małe okna z okiennicami. Nic nie jest proste ani nowe:
ugięta kalenica, łaty, osmolony komin, mech przy ziemi.

### B1. Domy — 3 pliki

`assets-src/buildings/house_l1.glb` (chata pod strzechą, ogródek, wygódka),
`house_l2.glb` (dom szkieletowy pod gontem, komin), `house_l3.glb` (piętrowy
dom mieszczański z nadwieszeniem, tynk w kolorze ochry).

### B2. Budynki gospodarcze — po 1 pliku (poziom 1); poziomy 2–3 później

`woodcutter`, `quarry`, `farm`, `bakery`, `pig_farm`, `butcher`, `tannery`,
`iron_mine`, `smithy`, `armourer`, `fletcher`, `stable`, `barracks` —
`assets-src/buildings/<nazwa>_l1.glb`.

Każdy musi dać się rozpoznać z góry po **podwórzu**, nie po szyldzie: drwal —
stosy kłód i kozioł do piłowania; kamieniołom — ściana skały, bloki, żuraw;
pole — łan i stogi; piekarnia — kopulasty piec z kominem; chlewnia — niski
chlew i błotnisty wybieg; masarnia — wędzarnia i żerdź z wędlinami; garbarnia —
ramy z rozpiętymi skórami i kadzie; kopalnia — hałda, obudowane wejście,
wózek; kuźnia — palenisko pod wiatą, kowadło, wysoki komin; płatnerz —
kamienny parter, stojaki ze zbrojami; łuczarz — tarcze strzelnicze ze słomy;
stajnia — długi niski budynek i padok; koszary — hala w palisadzie, plac z
pelami do ćwiczeń.

Dzisiejsze wersje z kodu (do podejrzenia układu):
`src/render/buildingGeometry.ts`.

### B3. Zamek — 3 pliki

`assets-src/buildings/keep_l1.glb` (drewniany dwór w palisadzie), `keep_l2.glb`
(kamienna wieża z bramą), `keep_l3.glb` (zamek z basztami). Podstawa do 20 m
średnicy. Na szczycie maszt: chorągiew dodaje gra.

### B4. Etapy budowy (opcjonalnie, do B1–B2)

W tym samym pliku obiekty o nazwach `stage1` (fundament i słupy), `stage2`
(szkielet i ściany), `stage3` (dach) — gra pokaże je po kolei w czasie budowy.
Bez nich budynek będzie „wyrastał” jak dziś.

## C. Zwierzęta — po 1 pliku

`assets-src/animals/pig.glb`, `horse.glb` (bez jeźdźca), `ox.glb`,
`chicken.glb` — do 1 200 trójkątów (kura 300); akcje `idle`, `walk`, `eat`.
Tekstura koloru 512².

## D. Drzewa (opcjonalnie)

Las zrobię z modeli CC0 z Poly Haven (jodła, sosna, drzewa liściaste), do
których mam dostęp, wypalonych do impostorów. Jeśli chcesz inne gatunki
(dąb, buk, brzoza w jesiennych barwach): `assets-src/trees/<gatunek>.glb`,
do 150 000 trójkątów, liście jako karty z przezroczystością, tekstury do
2048². Gra i tak pokaże je jako impostory, więc szczegół się nie marnuje.

## E. Drobiazgi (opcjonalnie)

`assets-src/props/`: wóz dwukołowy, beczka, skrzynia, worek, kosz, stragan z
pasiastym daszkiem, studnia z żurawiem, płot z plecionki (segment 2 m), płot
sztachetowy (segment 2 m), stóg, koryto. Do 800 trójkątów każdy, materiały
drogą 1.

## Co dostanę i co z tym zrobię

Po wrzuceniu plików do `marchland/assets-src/` (commit na gałąź roboczą albo
paczka). Narzędzi z punktów 1–3 jeszcze nie ma — powstaną, gdy przyjdą pierwsze
pliki (sprawdzarka jest zadaniem R12 w `ROUTINE.md`):

1. skrypt sprawdza budżety, skalę, kierunek i nazwy akcji, i wypisuje, co
   odbiega;
2. postacie: animacje są próbkowane do tekstury pozycji wierzchołków (15
   klatek/s), siatka dostaje dalszy poziom szczegółów;
3. budynki: materiały z listy dostają skany gry, reszta własne tekstury;
4. zrzuty z ustalonych widoków obok wzorców trafiają do `RESULTS.md`.

Nie musisz robić: poziomów szczegółów, kompresji tekstur, atlasów, kolizji,
cieni — to robi kod.

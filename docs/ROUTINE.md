# Marchland — prace rutynowe (dla słabszego modelu, np. Opus 5.5)

Zadania, które **nie** wymagają projektowania ani nowej techniki: każde ma cel,
pliki, kroki i kryterium odbioru. Rób je po jednym, w podanej kolejności albo
według wskazania użytkownika.

**Pierwsza wiadomość do modelu:**

> Przeczytaj `AGENT.md`, `games-ts-threejs.md`, `docs/new-game-AAA/ROUTINE-WORK.md`
> (§1 i §2), `marchland/README.md` i `marchland/docs/ROUTINE.md`. Zrób zadanie
> `R<n>` dokładnie tak, jak jest opisane. Nie zaczynaj niczego z listy
> „Zostaw” na końcu.

## Zasady stałe

1. Obowiązuje `docs/new-game-AAA/ROUTINE-WORK.md` §1 (jedna sprawa na commit,
   dowód zamiast opinii, żadnego wzrostu obciążenia bez liczb i zgody).
2. Logika gry (`src/sim/`) nie importuje three.js i jest testowana w Node.
   Gracz i komputer używają tych samych komend z `src/sim/commands.ts`.
3. Każda liczba strojenia trafia do `src/config.ts` z jednostką i komentarzem.
4. Każdy napis dla gracza przechodzi przez `src/ui/strings.ts` (polski i
   angielski; typ `Strings` wymusza oba).
5. Klawisze tylko przez `src/app/bindings.ts` — nigdzie indziej `event.code`.
6. Przed commitem: `npx tsc --noEmit && npx vitest run && npx vite build`.
7. Po każdym zadaniu wpis w `RESULTS.md` (wzór: istniejące wpisy) i raport:
   co zmienione (pliki), jak uruchomić, liczby, czego nie zrobiono.
8. Gałąź robocza według instrukcji sesji; `main` tylko na wyraźne polecenie.

## Jak mierzyć i robić zrzuty

```bash
cd marchland && npx vite build && cd ..
node tools/measure/serve.mjs marchland/dist 4173 &
export PLAYWRIGHT_MODULE=/ścieżka/do/playwright/index.mjs   # plik .mjs, nie index.js
node tools/measure/shots.mjs --game generic --gpu webgl --size 1280x720 \
  --extra '&q=high&scene=battle&seed=3&lang=pl&t=14' --out marchland/results/<data>/<nazwa> \
  --views '[{"spot":"town","name":"town"},{"spot":"field","name":"field"},{"spot":"close","name":"close"},{"spot":"overview","name":"overview"}]'
node tools/measure/load.mjs --game generic --extra '&q=high&scene=battle&seed=3'
```

Widoki: `spot` = `town | rally | field | close | enemy | overview`, albo
`{"x":…, "z":…, "distance":…, "yaw":…}`. Sceny: `&scene=town` (pełne miasto),
`&scene=battle` (po regimencie każdego rodzaju na stronę). Zrzuty zapisuj jako
JPEG (`convert plik.png -quality 86 plik.jpg`), PNG nie trafia do repo.
Programowy GPU jest wolny: jeden proces przeglądarki naraz, sekundy porównuj
tylko w obrębie jednego przebiegu.

## Zadania

### R1. Aktywna pauza
**Cel:** spacja zatrzymuje czas gry, ale rozkazy, budowa i werbunek dalej
działają (komendy zmieniają świat od razu, kroki symulacji stoją).
**Pliki:** `src/app/bindings.ts` (akcja `pause`: `Space`), `src/app/game.ts`
(`press`), `src/ui/hud.ts` (znacznik „PAUZA” i przycisk ⏸ obok przycisków
tempa), `src/ui/strings.ts`, `src/ui/style.css`.
**Kroki:** przełączaj `game.loop.paused`; nie otwieraj menu; Esc bez
zaznaczenia nadal otwiera menu pauzy.
**Kryterium:** w przeglądarce: spacja → zegar stoi, prawy klik zmienia
`regiment.order`, po drugiej spacji oddział rusza. Dopisz krok do skryptu
przejścia (wzór: sprawdzenia w `RESULTS.md` z 2026-11-11, „19 kroków”).

### R2. Grupy 1–9, dwuklik, zakładki kamery
**Cel:** Ctrl+cyfra zapisuje zaznaczenie, cyfra je przywraca, druga ta sama
cyfra centruje kamerę; dwuklik na żołnierzu zaznacza wszystkie widoczne oddziały
tego rodzaju; Ctrl+F5…F8 zapisuje widok kamery, F5…F8 go przywraca.
**Pliki:** nowy `src/app/selection.ts` (klasa bez three.js i bez DOM: zbiór
zaznaczenia, grupy, czyszczenie nieistniejących oddziałów) z testem
`tests/selection.test.ts`; `bindings.ts`, `game.ts`, `controls.ts` (dwuklik).
**Kryterium:** testy grup (zapis, przywrócenie, oddział zniszczony znika z
grupy, pusta grupa nic nie robi); istniejące testy przechodzą.

### R3. Ustawienia
**Cel:** ekran ustawień w menu: głośność (0–100), grafika (wysoka/niska),
język, przewijanie krawędzią (tak/nie), tempo kamery; zapis w `localStorage`.
**Pliki:** nowy `src/app/settings.ts` (typ, wartości domyślne, wczytanie z
walidacją: zły albo stary zapis = wartości domyślne, nigdy wyjątek) + test;
`src/ui/menu.ts`, `src/main.ts`, `src/ui/sound.ts` (`volume`).
**Kryterium:** test walidacji (śmieci, brak pola, zła wartość); po odświeżeniu
strony ustawienia zostają; `?q=` i `?lang=` z adresu mają pierwszeństwo.

### R4. Ekran produkcji
**Cel:** panel (klawisz P i przycisk): dla każdego towaru stan, wytworzone i
zużyte na minutę (średnia z ostatnich 60 s), i powód postoju dla każdego
stojącego budynku.
**Pliki:** `src/sim/economy.ts` — liczniki `producedPerMinute` /
`consumedPerMinute` na `Town` (okno 60 s, tablice o stałej długości, bez
alokacji w kroku) i funkcja `idleReason(town, building): 'none' | 'paused' |
'noInput' | 'building'`; test w `tests/economy.test.ts`; `src/ui/hud.ts`.
**Kryterium:** test: jedno pole → +12 zboża/min po 60 s; piekarnia bez zboża →
`noInput`.

### R5. Alarmy z „pokaż”
**Cel:** komunikat o zdarzeniu na mapie (ucieczka oddziału, utrata budynku,
wróg pod miastem, nowy oddział) da się kliknąć: kamera skacze w to miejsce.
**Pliki:** `src/ui/hud.ts` (`toast(text, tone, at?)`), `src/app/game.ts`
(`onEvent` podaje `e.x`, `e.z`), `style.css` (kursor, podkreślenie).
**Kryterium:** krok w skrypcie przejścia: wywołaj zdarzenie, kliknij komunikat,
`camera.goal.targetX/Z` równe pozycji zdarzenia.

### R6. Podpowiedź kontr przy werbunku
**Cel:** w opisie oddziału (`data-tip`) dwa krótkie wiersze: „Dobre na: …”,
„Słabe na: …”.
**Pliki:** `src/ui/strings.ts` (tabela dla 10 oddziałów w obu językach),
`src/ui/hud.ts`.
**Źródło prawdy:** macierz pojedynków z R7 — nie wpisuj kontry, której wynik
nie potwierdza.
**Kryterium:** każdy oddział ma oba wiersze; zrzut panelu werbunku.

### R7. Raport balansu
**Cel:** `npm run balance` wypisuje macierz pojedynków 10 × 10 (30 ziaren na
parę; obie strony atakują): kto wygrał ile razy, średni czas, straty.
**Pliki:** `tests/balance.report.ts` uruchamiany przez `vite-node` (przychodzi
razem z `vitest`; wzór skryptu: `"bench"` w `ridgeline/package.json`), skrypt
`"balance"` w `package.json`.
Wzór pętli: funkcja `duel` w `tests/combat.test.ts`.
**Kryterium:** tabela w `RESULTS.md`; lista par łamiących miary z
`docs/GAMEPLAY.md` §6 (bez zmiany liczb w `config.ts` — to osobna decyzja).

### R8. Przycisk Benchmark
**Cel:** przycisk w menu pauzy i `?bench`: 6 widoków (`spot`) po 5 s każdy,
tabela: fps, p95 ms, CPU ms (sim / draw / hud), wywołania, trójkąty.
**Pliki:** `src/render/benchRecorder.ts` jest skopiowany bez zmian — użyj go
tak, jak robi to `tanks/src/main.ts` (`new BenchRecorder`); `src/app/game.ts`,
`src/ui/menu.ts`.
**Kryterium:** tabela dla High i Low (scena `battle`) w `RESULTS.md`.

### R9. Dźwięk tła i głośność
**Cel:** cichy podkład z kodu (wiatr: szum przez filtr dolnoprzepustowy z
powolną zmianą; ptaki: krótkie ćwierknięcia co 3–9 s, tylko gdy kamera jest
bliżej niż 80 m od lasu), suwak głośności z R3.
**Pliki:** `src/ui/sound.ts`, `src/app/game.ts`.
**Kryterium:** brak nowych węzłów audio tworzonych co klatkę (ćwierknięcie =
jedno źródło, jak dziś `burst`); podkład milknie w pauzie.

### R10. Statystyki na ekranie końca
**Cel:** dwa wykresy liniowe (liczebność wojska i ludność/budynki obu stron w
czasie) i tabela strat według rodzaju oddziału.
**Pliki:** `src/sim/world.ts` — `history` próbkowana co 10 s do tablic o stałej
długości (30 min = 180 próbek, potem co drugą); test; `src/ui/menu.ts` (canvas
2D, kolory stron z `render/palette.ts`).
**Kryterium:** test próbkowania; zrzut ekranu końca po partii z `?seed=5`.

### R11. `CREDITS.md`
**Cel:** jeden plik `marchland/CREDITS.md` z każdym cudzym zasobem: nazwa,
autor, adres, licencja, gdzie użyty. Dziś: 16 skanów z
`src/assets/photo/LICENSE.md`.
**Kryterium:** liczba wierszy = liczba folderów w `src/assets/photo/`.

### R12. Sprawdzarka plików z Blendera
**Cel:** `node tools/check_assets.mjs assets-src` czyta nagłówek JSON każdego
`.glb` (bez bibliotek) i wypisuje dla pliku: trójkąty, wierzchołki, wymiary
(z `min`/`max` akcesorów pozycji), nazwy materiałów, nazwy animacji, rozmiary
tekstur; porównuje z budżetami i nazwami z `docs/BLENDER.md`; kod wyjścia 1,
gdy coś odbiega.
**Pliki:** `marchland/tools/check_assets.mjs`, test na małym `.glb` zrobionym
w teście z bufora (nie dodawaj pliku binarnego do repo).
**Kryterium:** dla postaci: brak akcji `walk` = błąd z nazwą pliku i akcji;
wysokość poza 1,6–2,0 m = błąd.

### R13. Zapis i wczytanie gry (średnie — rób po R1–R5)
**Cel:** „Zapisz” / „Wczytaj” w menu pauzy, jeden slot w `localStorage`.
**Pliki:** nowy `src/sim/snapshot.ts`: `toSnapshot(world): string`,
`fromSnapshot(text): World`. Uwaga na odwołania: `soldier.regiment`,
`soldier.target` i `regiment.def` to wskaźniki — w zapisie indeksy / nazwy
rodzaju, przy odczycie odtwórz. Stan RNG (`Rng.state`) musi wejść do zapisu
(dodaj metody `save()` / `restore()`).
**Kryterium:** test: graj 3 min komputer–komputer, zapisz, wczytaj do nowego
świata, oba światy graj 2 min → identyczny odcisk (`fingerprint` z
`tests/game.test.ts`); zapis z nieznaną wersją = czytelny błąd, nie wyjątek.

### R14. Wariant Android
**Cel:** `marchland.apk` w wydaniu `android-latest`.
**Pliki:** `android/app/build.gradle.kts` (nowy `productFlavor`, wzór:
`ridgeline`), `android/build-apks.sh`, `.github/workflows/android.yml` (ścieżka
`marchland/**` i plik w liście wydania), główny `README.md`.
**Kryterium:** workflow przechodzi; APK startuje na telefonie i pokazuje menu
(potwierdza użytkownik). Zmienia wspólny workflow pięciu gier — zrób jako
osobny commit i sprawdź, że pozostałe APK nadal się budują.

### R15. Minimapa
**Cel:** krótkie pulsujące kółko w miejscu zdarzenia (te same zdarzenia co R5),
cieniowanie rzeźby terenu ze światła słońca zamiast samej wysokości.
**Pliki:** `src/ui/minimap.ts`, `src/app/game.ts`.
**Kryterium:** zrzut minimapy przed i po; brak alokacji w `draw` (tablica
pulsów o stałej długości).

## Zostaw (silniejszy model albo decyzja użytkownika)

- ludność, tragarze, składy budynków, budowa z dostawą (`docs/GAMEPLAY.md` M1);
- szyki, postawy, weterani, kapitan, żołd, oblężenie (M2);
- rodzaje działek, punkty na mapie, generator map, rzeka (M3);
- animacja postaci z tekstury, impostory drzew, trawa, okluzja, cząsteczki,
  wczytywanie modeli budynków (M4);
- taktyka i charaktery komputera (M5);
- KTX2 dla tablic tekstur;
- każda zmiana liczb w `config.ts`, która zmienia balans, oraz wszystko, co
  dodaje przebieg renderowania, teksturę, światło albo materiał.

# Marchland — wytyczne gry

Wszystkie ustalenia o grze w jednym miejscu. Dokumenty opisują reguły wersji
rozwijanej na gałęzi `claude/rts-medieval-game-2lrgis`; kod na `main` może być
o krok starszy.

| Dokument | Co zawiera | Jak powstaje |
|---|---|---|
| [GAMEPLAY.md](GAMEPLAY.md) | filary rozgrywki, przebieg sesji, wojsko, przeciwnik, kamienie milowe | pisany ręcznie |
| [ECONOMY.md](ECONOMY.md) | ludność, logistyka, jedzenie, pola, stawianie budynków, drogi | generowany z `src/config.ts` |
| [BUILDINGS.md](BUILDINGS.md) | lista budynków (po angielsku): koszt, wymagany teren, produkcja; łańcuchy; budynki do dodania | generowany z `src/config.ts` |
| [UNITS.md](UNITS.md) | jednostki: cena, ekwipunek, statystyki, zastosowanie, kto kogo bije | generowany z `src/config.ts` |
| [BLENDER.md](BLENDER.md) | kontrakt na modele z Blendera: skala, materiały, animacje, budżety | pisany ręcznie |
| [ROUTINE.md](ROUTINE.md) | prostsze zadania do zrobienia przez słabszy model | pisany ręcznie |

## Zasady utrzymania

1. **Liczby mają jedno źródło: `src/config.ts`.** Dokumenty generowane czytają je
   stamtąd, więc nie mogą się rozjechać z grą.
2. Po każdej zmianie reguł: `npm run docs`. Test `tests/docs.test.ts` nie
   przechodzi, dopóki pliki na dysku różnią się od wygenerowanych.
3. Opisy słowne (do czego służy budynek, jak użyć jednostki) są w
   `tools/docs.ts` — poprawia się je tam, nie w plikach `.md`.
4. Zmiana zasad rozgrywki, której nie da się wyrazić liczbą (nowa mechanika,
   nowy budynek, zmiana sterowania), trafia do `GAMEPLAY.md` w tym samym
   commicie co kod.
5. Budynek albo jednostka dodane do gry muszą mieć wpis w `tools/docs.ts` —
   inaczej projekt się nie skompiluje (tabele są typowane po rodzajach).

# Marchland — jednostki

*Plik generowany przez `npm run docs` z `src/config.ts`. Nie poprawiaj ręcznie:
zmień konfigurację (albo tekst w `tools/docs.ts`) i wygeneruj ponownie.*

## 1. Zasady wspólne

- Limit: 100 żołnierzy na stronę (200 na polu). W kolejce koszar najwyżej 3 rozkazy.
- Regiment powstaje z mieszkańców: tylu ludzi, ilu żołnierzy (machiny: obsługa), idzie do koszar,
  bierze ekwipunek z magazynu zamku i dopiero wtedy staje w szyku przed miastem.
- Poziom koszar decyduje, kogo można szkolić (kolumna „Koszary”; 0 = w zamku, bez koszar).
- **Straż domowa**: milicja słucha rozkazów tylko do 115 m od własnego zamku i nie atakuje
  budynków; przy rozkazie dla grupy zostaje, a reszta idzie. Kto zapędzi się dalej w pościgu, wraca.
  Po przezbrojeniu przy koszarach oddział staje się zwykłym wojskiem i może iść do ataku.
  Komputer trzyma najwyżej 2 oddziały milicji, nie bierze ich do fal i przezbraja je, gdy ma broń.
- Żołnierz zjada 0.25 racji na minutę z magazynu zamku; głodne wojsko ma morale niższe o 25.
- Walka: szyk, zmęczenie, morale, flanka i tył, szarża, ucieczka i zbiórka — jak w grach Total War,
  w skali regimentów po 8–12 ludzi. Liczby w `src/config.ts` (COMBAT, FATIGUE, MORALE, MISSILE).

## 2. Tabela

Cena obejmuje cały regiment. Atak / obrona to punkty; pancerz to część ciosu, którą zbiera zbroja.

| Jednostka | Koszary | Ludzi | Cena regimentu | Życie | Atak / obrona | Pancerz | Obrażenia | Morale | Marsz / bieg (m/s) |
|---|---|---|---|---|---|---|---|---|---|
| **Milicja z tarczami** | 0 | 12 | 30 zł + 12 drewno | 24 | 4 / 5 | 0 % | 4 | 45 | 1.4 / 3.1 |
| **Pikinierzy** | 1 | 12 | 50 zł + 12 zbroja skórzana, 12 broń | 30 | 6 / 7 | 20 % | 5 | 60 | 1.4 / 2.9 |
| **Łucznicy** | 1 | 12 | 50 zł + 12 zbroja skórzana, 12 łuk | 24 | 3 / 3 | 20 % | 3 | 50 | 1.4 / 3.1 |
| **Miecznicy** | 2 | 12 | 90 zł + 12 broń, 12 kolczuga | 36 | 9 / 9 | 40 % | 7 | 75 | 1.4 / 2.7 |
| **Halabardnicy** | 2 | 12 | 100 zł + 12 broń, 12 kolczuga | 34 | 10 / 6 | 35 % | 10 | 70 | 1.4 / 2.7 |
| **Kusznicy** | 2 | 12 | 80 zł + 12 drewno, 12 zbroja skórzana, 12 łuk | 26 | 4 / 5 | 20 % | 4 | 55 | 1.4 / 2.9 |
| **Lekka jazda** | 2 | 8 | 100 zł + 8 zbroja skórzana, 8 broń, 8 koń | 40 | 7 / 5 | 20 % | 6 | 65 | 3.6 / 8.5 |
| **Ciężka jazda** | 3 | 8 | 160 zł + 8 broń, 8 kolczuga, 8 koń | 52 | 10 / 9 | 45 % | 8 | 85 | 3.6 / 7.5 |
| **Armaty** | 1 | 2 (6 ludzi) | 140 zł + 12 drewno, 12 żelazo | 80 | 0 / 0 | 0 % | 0 | 55 | 0.9 / 0.9 |
| **Moździerz** | 2 | 1 (5 ludzi) | 200 zł + 8 kamień, 10 żelazo | 120 | 0 / 0 | 0 % | 0 | 60 | 0.6 / 0.6 |

## 3. Strzelcy i machiny

| Jednostka | Zasięg | Obrażenia | Przebicie pancerza | Przeładowanie | Rozprysk | Obrażenia budynków |
|---|---|---|---|---|---|---|
| **Łucznicy** | 80 m | 20 | 0 % | 6 s | — | 1.5 |
| **Kusznicy** | 70 m | 30 | 60 % | 10 s | — | 2 |
| **Armaty** | 10–120 m | 55 | 90 % | 10 s | — | 30 |
| **Moździerz** | 40–150 m | 30 | 50 % | 15 s | 3.5 m | 110 |

Zamek strzela sam: zasięg 55 m, strzała co 1 s, 9 obrażeń.

## 4. Do czego służą

- **Milicja z tarczami** — Jednostka startowa: włócznia i drewniana tarcza (1 drewno na człowieka), bez zbroi; werbowana w zamku, zanim staną koszary. Trzyma linię za tarczą, szybko ucieka. Później do przezbrojenia. *(tylko obrona: rozkazy do 115 m od własnego zamku, bez ataku na budynki; 20 % szans zatrzymania pocisku)*
- **Pikinierzy** — Las pik zatrzymuje jazdę, zwłaszcza szarżę od czoła. Bezbronni wobec strzelców. *(+8 do ataku przeciw jeździe; 35 % szans zatrzymania pocisku; zasięg broni 3 m)*
- **Łucznicy** — Daleki, szybki ostrzał lekko zbrojnych. W zwarciu giną; trzymać za linią.
- **Miecznicy** — Miecz, tarcza, kolczuga: wygrywają zwykłą walkę pieszą i znoszą ostrzał. *(35 % szans zatrzymania pocisku)*
- **Halabardnicy** — Biją mocniej niż miecznicy i zatrzymują konie, ale bez tarczy cierpią od strzał. *(+5 do ataku przeciw jeździe; zasięg broni 2.3 m)*
- **Kusznicy** — Wolno ładują, bełt przebija kolczugę: odpowiedź na ciężkozbrojnych. *(30 % szans zatrzymania pocisku)*
- **Lekka jazda** — Najszybsza: zagony na wsie, strzelców i machiny, pościg za uciekającymi. *(szarża +8 do ataku, wstrząs 9)*
- **Ciężka jazda** — Rycerstwo: szarża, która łamie linię. Nie na piki od czoła. *(szarża +12 do ataku, wstrząs 15; 30 % szans zatrzymania pocisku)*
- **Armaty** — Dwa działa z ludwisarni: kula na wprost przebija każdą zbroję i wybija dziury w murach. Bezradne, gdy wróg dojdzie. *(70 % szans zatrzymania pocisku)*
- **Moździerz** — Jedno działo (ludwisarnia poz. 2): ciężka kula stromym torem nad murami rozbija szyk i burzy mury, wieże i zamek. *(80 % szans zatrzymania pocisku)*

## 5. Przezbrojenie

Oddział stojący do 40 m od własnych koszar (poza walką) można przezbroić: zostaje ten sam
oddział — ci sami ludzie, ich rany (jako część życia), zmęczenie i morale (jako część pełnego) — a płaci się
tylko za to, czego jeszcze nie mają: ekwipunek nowego rodzaju minus ten, który już noszą, za każdego żywego,
oraz różnicę w złocie, jeśli nowy rodzaj jest droższy. Wydawanie broni trwa 20 s; oddział stoi.
Wymagany poziom koszar jak przy werbunku.

- **Milicja z tarczami** → Pikinierzy, Łucznicy, Miecznicy, Halabardnicy, Kusznicy
- **Pikinierzy** → Halabardnicy, Miecznicy
- **Łucznicy** → Kusznicy
- **Miecznicy** → Halabardnicy
- **Halabardnicy** → Miecznicy
- **Lekka jazda** → Ciężka jazda

Konni zostają konnymi, machin się nie przezbraja.

## 6. Kto kogo bije

- **Piki i halabardy** zatrzymują **jazdę**; jazda nie szarżuje na nie od czoła.
- **Jazda** rozjeżdża **strzelców** i **machiny** oraz dobija uciekających.
- **Strzelcy** wykrwawiają **pikinierów** i **halabardników** (brak tarcz); **kusze** biją **kolczugi**.
- **Miecznicy** wygrywają z każdą piechotą w zwarciu i znoszą ostrzał za tarczą.
- **Trebusz** rozbija zwarty szyk i mury; **balista** zdejmuje pojedynczych ciężkozbrojnych z daleka.
- Atak z **flanki** i od **tyłu** trafia łatwiej i łamie morale szybciej niż jakakolwiek przewaga punktów.

## 7. Łańcuchy ekwipunku

- zbroja skórzana ← garbarnia ← skóry ← chlewnia ← zboże
- broń ← kuźnia ← żelazo + drewno ← huta ← ruda + drewno
- kolczuga ← płatnerz ← żelazo ← huta ← ruda + drewno
- łuk ← łuczarz ← drewno
- koń ← stajnia ← zboże

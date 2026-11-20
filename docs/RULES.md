# Marchland — wszystkie zasady gry

*Plik generowany przez `npm run docs` z `src/config.ts` (tekst w `tools/rulesDoc.ts`). Nie poprawiaj ręcznie.
Ceny i statystyki jednostek: [UNITS.md](UNITS.md); budynki, receptury i ceny: [BUILDINGS.md](BUILDINGS.md);
ludność, jedzenie, transport, pola: [ECONOMY.md](ECONOMY.md); ekran, menu i sterowanie: [MANUAL.md](MANUAL.md);
misje: [CAMPAIGN.md](CAMPAIGN.md).*

## 1. Cel gry i tryby

- **Potyczka:** wygrywa strona, która zburzy zamek przeciwnika (1800 punktów wytrzymałości na poziomie 1,
  więcej na wyższych). Zamek bronią łucznicy na murach: strzelają do wroga w promieniu 55 m co
  1 / 0.75 / 0.5 s (poziom zamku 1 / 2 / 3), za 9 obrażeń.
- **Obrona:** 30 min przeciw falom; pierwsza po 7 min, kolejne co
  4 min; fale rosną. Przetrwanie do końca to wygrana, upadek zamku — przegrana.
- **Samouczek:** kroki od drwala do koszar; bez przeciwnika.
- **Kampania:** pięć misji z własnymi celami (§14).

## 2. Mapa

- Mapa 680 × 680 m. Trzy miejsca zamku; zamek przeciwnika stoi zawsze naprzeciw (ten sam układ obrócony).
- Układy: Otwarte pole, Przeprawa (rzeka z groblą i dwoma brodami), Bór, Dolina, Twierdza (kampania).
- **Woda, skała i góry** są nieprzechodnie; w lesie oddziały idą wolniej (piechota ×0.85,
  jazda ×0.6), a strzały trafiają dwa razy rzadziej (×0.5). Wycięty las
  jest zwykłym polem.
- **Wysokość:** strzelcy na wyższym terenie sięgają dalej (do +15 % przy przewadze
  8 m); szarża w dół zboczu (różnica ponad 1.5 m) jest mocniejsza ×1.25,
  cios pod górę słabszy o 1.
- **Punkty do zajęcia** (kopalnia, kamieniołom, wieś): oddział w szyku stoi przy punkcie (do 16 m)
  przez 20 s, a w promieniu 30 m nie ma wroga — punkt przechodzi na jego stronę i daje co minutę:
  bogata kopalnia — 8 ruda żelaza; kamieniołom w polu — 10 kamień; wieś — 15 złoto, 6 zboże.
  Punkt zostaje przy właścicielu, aż zajmie go przeciwnik; dwie strony naraz — nikt nie zyskuje.

## 3. Miasto (skrót; szczegóły w ECONOMY.md i BUILDINGS.md)

- Każdy towar ktoś niesie: tragarze noszą surowce do warsztatów i na budowy, wyroby do zamku (i składów), jedzenie
  do chat. Przy zamku oddają towar na 10 stanowiskach wokół murów; taczki i wozy trzymają odstęp
  (2.6 m / 5.5 m), czekając najwyżej 4 s.
- Budynek stoi w zasięgu zamku (280 m na poziomie 1, dalej na wyższych), na suchym, równym
  terenie, nie bliżej niż 90 m od zamku wroga. Drwal przy lesie, kamieniołom i kopalnia przy
  złożu, rybak nad wodą, zagroda i winnica z ziemią za sobą (rezerwowaną od razu pod wszystkie poziomy).
- Zamek: poziomy 1–3 (60 s rozbudowy): zasięg budowy 280 / 330 / 380 m, wytrzymałość
  1800 / 2600 / 3600, koszary do poziomu 1 / 2 / 3.
- Głód (brak racji): produkcja zwalnia, podatki ustają, a górna granica morale wojska spada o
  25. Żołnierz zjada 0.25 racji na minutę.

## 4. Wojsko: werbunek i utrzymanie

- Limit: 100 żołnierzy na stronę (w kampanii 200); liczą się żołnierze w polu, w wieżach i w
  kolejce. Kolejka szkolenia: najwyżej 3 oddziały.
- Werbunek zabiera wolnych mieszkańców; złoto i sprzęt schodzą z zamku od razu. Koszary poziomu N szkolą jednostki
  do poziomu N; milicja szkoli się przy zamku, działa w ludwisarni.
- **Milicja** to straż domowa: słucha rozkazów tylko do 115 m od własnego zamku i nie atakuje budynków;
  przezbrojona staje się zwykłym wojskiem.
- **Żołd:** 0.2 złota na żołnierza na minutę, pobierany ze skarbca. Gdy zaległość przekroczy minutowy żołd
  (co najmniej 3), wojsko jest nieopłacone: górna granica morale spada o 15, dopóki zaległość nie
  zostanie spłacona.
- **Łup:** za każdego zabitego wroga do skarbca wpada jego „cena głowy” (kolumna w UNITS.md).
- **Uzupełnianie:** oddział stojący do 40 m od koszar (milicja — od zamku), 5 s bez walki, dostaje brakujących
  ludzi za złoto i sprzęt; nowi rozwadniają doświadczenie, a poległego kapitana zastępuje jeden z nich.
- **Przezbrajanie:** do 40 m od koszar, 20 s; płaci się różnicę sprzętu. Drogi: milicja z tarczami → pikinierzy, łucznicy, miecznicy, halabardnicy, kusznicy; pikinierzy → halabardnicy, miecznicy; łucznicy → kusznicy; miecznicy → halabardnicy; halabardnicy → miecznicy; lekka jazda → ciężka jazda.
- **Łączenie** (kampania): dwa oddziały tego samego rodzaju, do 30 m od siebie, 5 s bez walki; ludzie
  przechodzą do liczniejszego, do 20; doświadczenie i morale — średnia ważona.

## 5. Ruch

- Oddział ma „kotwicę” (czoło) i miejsca w szyku; żołnierze idą do swoich miejsc nieco szybciej niż oddział
  (×1.3). Gdy ludzie zostają w tyle średnio o ponad 2.5 m, oddział zwalnia do 35 % tempa.
- Marsz i bieg: tempo jednostki (UNITS.md); bieg męczy (§8). Do ataku podchodzi się biegiem w ostatnich 55 m.
- Woda, skała, cudze mury: oddział sam szuka drogi (bród, grobla, brama własnej strony) i idzie kolumną po
  3, trzymając się śladu czoła; rozwija się po przejściu ostatniego szeregu. Przez jedną przeprawę idzie naraz
  jeden oddział strony; najdłuższe czekanie 30 s.
- Żołnierz walczy z wrogiem w promieniu 5 m od siebie (przy rozkazie ataku 7 m), ale nie odchodzi dalej
  niż 8 m od swojego miejsca. W marszu i strzelcy w trakcie ostrzału bronią się tylko przed wrogiem bliżej niż
  2.5 m.

## 6. Walka wręcz

Każdy żołnierz zadaje cios co tyle sekund, ile podaje jednostka (±15 %), gdy przeciwnik jest w zasięgu jego broni.

**Szansa trafienia** = 0.22 + 0.025 × (atak − obrona) + premia kierunku, ograniczona do
10 %–90 %.

- **Atak** = atak jednostki − 3 × zmęczenie (0–1) + 1 za każdy stopień doświadczenia
  − 1 bez kapitana; przeciw jeździe + premia przeciw jeździe (×2 w ścianie pik); w szarży + premia
  szarży; za tarczami (postawa) − 3; cios pod górę − 1.
- **Obrona** = obrona jednostki − 3 × zmęczenie + 1 za stopień; szyk luźny − 2, klin
  − 1.5; ściana pik od przodu + 3; mała tarcza od przodu (milicja z tarczami +1, pikinierzy +1.5);
  oddział uciekający broni się ×0.5.
- **Kierunek ciosu** względem frontu celu: z przodu — bez premii; z boku + 0.15 do szansy (i −0.5
  morale celu za trafienie); od tyłu + 0.3 (−1 morale); w uciekającego + 0.2.
- **Obrażenia** = obrażenia jednostki × (1 − pancerz celu) × losowo 80 %–120 %; w szarży
  ×1.5. Żołnierz ginie, gdy jego życie spadnie do zera.

**Szarża** (milicja z tarczami, pikinierzy, miecznicy, halabardnicy, lekka jazda, ciężka jazda): pierwszy cios oddziału, który w ostatnich 1.5 s biegł z co najmniej
70 % prędkości biegu (i od 2 s nie zadał ciosu). Przez 4 s ciosy mają premię szarży do ataku i
obrażenia ×1.5, a cel traci morale o „wstrząs szarży” jednostki. Klin jazdy: ×1.6. Szarża w czoło
**ściany pik** nie działa wcale; w czoło stojących włóczni (pikinierzy, halabardnicy, w miejscu, przodem) — tylko 25 %.

## 7. Ostrzał

- Strzelcy (łucznicy, kusznicy, armaty, moździerze, załogi wież, łucznicy zamku) strzelają z miejsca w zasięgu
  (UNITS.md), co swój czas przeładowania. Pocisk leci torem balistycznym; rozrzut celowania 2.2 m na pełnym
  zasięgu (moździerz ×3), do jednej trzeciej z bliska; trafia człowieka stojącego do 0.9 m od miejsca upadku.
- **Szansa trafienia** = 0.75 × (szyk luźny ×0.5) × (1 + 0.12 za stopień strzelca) × (las
  ×0.5) × (1 − blok tarczą).
- **Blok tarczą:** jednostki z tarczą zatrzymują część pocisków (milicja z tarczami 20 %, pikinierzy 35 %, miecznicy 35 %, kusznicy 30 %); w postawie „Tarcze”
  dwa razy więcej, najwyżej 85 %, ale oddział idzie ×0.55 i bije słabiej.
- **Obrażenia** = obrażenia pocisku × (1 − pancerz × (1 − przebicie)); przebicie zależy od broni (kusza i działa
  przebijają lepiej). Każde trafienie strzałą: −0.6 morale.
- **Kula armatnia** toczy się 12 m przez szeregi: trafia 75 % ludzi na swojej drodze, najwyżej
  4, z obrażeniami malejącymi do połowy; każdy trafiony oddział −1.8 morale.
- **Moździerz** strzela stromo nad murami (najmniej 40 m), bardzo niecelnie; kula rani wszystkich w promieniu
  3.5 m (słabiej dalej od środka), a każdy oddział, w który spadnie, traci 6 morale.

## 8. Zmęczenie

- Rośnie od biegu (piechota wyczerpuje się po 70 s, jazda po 110 s) i od walki (150 s); spada w
  marszu (pełny odpoczynek 180 s) i na postoju (50 s).
- Wyczerpany oddział: atak i obrona −3, bieg wolniejszy o 30 % (proporcjonalnie przy częściowym
  zmęczeniu). Widać to na cienkim pasku pod morale.

## 9. Morale, ucieczka, zbiórka

- **Górna granica morale** = morale jednostki + 8 za stopień − 10 bez kapitana − 25 przy głodzie −
  15 bez żołdu + 6 z kaplicą.
- **Spada:** za każdego poległego 8.5 (dla oddziału 12 ludzi, proporcjonalnie dla innych), cios z boku
  0.5, od tyłu 1, strzała 0.6, kula armatnia 1.8, moździerz 6, szarża (wstrząs
  jednostki), śmierć kapitana 12, ucieczka sąsiedniego oddziału własnej strony w promieniu 35 m
  6.
- **Rośnie:** 1.5/s poza walką (bez kapitana o połowę wolniej), 0.5 za każdego zabitego wroga, 5 gdy
  ucieka wróg w promieniu 35 m.
- **Ucieczka:** morale 0 — oddział ucieka do zamku (zatrzymuje się w promieniu 56 m od niego), nie słucha
  rozkazów, broni się słabo. Gdy w promieniu 22 m nie ma wroga, odzyskuje 4 morale/s i przy 30
  **zbiera się** do szyku.
- **Rozbicie:** oddział, który ma mniej niż 25 % początkowego składu albo ucieka trzeci raz, już się nie zbiera;
  ocaleli wracają do miasta jako mieszkańcy.

## 10. Doświadczenie i kapitan

- Doświadczenie = zabici wrogowie na człowieka. Stopnie: zaprawieni od 0.6, weterani od 1.5. Każdy stopień:
  +1 atak, +1 obrona, +8 górna granica morale, strzelcy +12 % trafień.
- Kapitan to pierwszy człowiek oddziału (machiny go nie mają). Gdy padnie: −12 morale od razu, a do uzupełnienia
  atak −1, górna granica morale −10, odzyskiwanie morale ×0.5.

## 11. Szyki i postawy

| | Działanie |
|---|---|
| Szeregi 2 / 3 / 4 / 6 | piechota: płytszy szyk — szerszy front, więcej ludzi walczy naraz; głębszy — wytrzymalszy, węższy |
| Szyk luźny | odstępy ×1.9: pociski trafiają ×0.5, obrona wręcz −2 |
| Klin (jazda) | szarża ×1.6, obrona −1.5 |
| Tarcze | blok pocisków ×2 (najwyżej 85 %), marsz ×0.55, atak −3 |
| Ściana pik | oddział stoi; od przodu obrona +3, premia przeciw jeździe ×2, szarża w czoło nie działa |
| Strzelanie dowolne / na rozkaz | strzelcy sami wybierają cel w zasięgu / strzelają tylko w wyznaczony |

Komputer sam stawia ścianę pik, gdy wroga jazda podejdzie na 55 m, i podnosi tarcze na 4 s po trafieniu strzałą.

## 12. Mury, bramy, wieże, oblężenie

- **Mur:** 3 kamienia na każde 2 m; komórka muru wytrzymuje 260 (w twierdzy misji 5 ×2). Zatrzymuje
  wszystkich; wróg bije w niego wręcz (60 % obrażeń ciosu) albo z machin. Pocisk o sile oblężniczej co najmniej
  10 rozbija mur w promieniu 2.5 m od upadku. Rozbita komórka to gruz, przez który się przechodzi (wyłom).
- **Brama:** 10 m, 20 drewna i 12 kamienia, wytrzymałość 400; własna strona przechodzi (skrzydła otwierają się,
  gdy ktoś swój jest do 12 m), dla wroga to mur.
- **Wieża:** do 4 łuczników albo kuszników jednego rodzaju; strzelają z góry 12 m dalej. Gdy wieża padnie, załoga
  ginie razem z nią.
- **Budynki** wróg niszczy wręcz (50 % obrażeń ciosu) albo z machin; zburzony budynek znika (z załogą wieży).
- Machiny (armata, moździerz) strzelają z miejsca; rozkaz ostrzału muru (prawy klik w mur) trwa, aż powstanie wyłom.

## 13. Komputer (potyczka)

- Buduje miasto planistą (kwartały na siatce), werbuje, przezbraja milicję (najwyżej 2 oddziały straży), obsadza wieże,
  stawia mur na podejściu, sprzedaje nadwyżki na targu poniżej 120 złota, zajmuje punkty co 20 s.
- Atakuje falami: pierwsza fala 36 / 24 / 48 ludzi (łatwy / normalny / trudny), każda kolejna
  o 8 / 12 / 16 więcej; czeka na nią najwyżej 420 / 330 / 260 s. Fala, która straciła 70 %
  ludzi, wraca. Tempo pracy jego miasta ×0.7 / ×1 / ×1.35.
- Charakter: budowniczy — fale ×1.5 ludzi, ×1.35 czasu; najeźdźca — ×0.75 ludzi, ×0.85 czasu i co
  150 s oddział palący budynki na skraju miasta.
- Na wszystko, co podejdzie do jego zamku na 95 m, rzuca całe wojsko.

## 14. Kampania

- Limit 200 żołnierzy, oddziały dopełniane do 20 przy koszarach i łączenie (§4).
- Do następnej misji idzie najwyżej 8 najsilniejszych oddziałów (z doświadczeniem) i 50 % złota, najwyżej 800.
- Misja 1: trybut (600 złoto, 200 chleb, 40 broń) w 30 min; po terminie atak najeźdźcy; wygrana także, gdy
  wszystkie jego oddziały uciekają 3 min bez przerwy.
- Misja 3: osada jak punkt (§2); odsiecz po 12 min, a gdy zastanie osadę wroga, po 3 min wszyscy idą na miasto.
- Misja 4: 160 ludzi w 10 oddziałach i zamek 3; zagony w 8 min, 16 min, 24 min; ruiny odbudowywane za pół ceny.
- Misja 5: wypad, gdy działo gracza podejdzie na 230 m do bramy (najwyżej co 4 min, wraca po 150 s); koszary
  twierdzy wystawiają oddział co 5 min, dopóki stoją; odsiecz po 15 min; przegrana także po 60 s
  bez żadnego oddziału; gwiazdka za wyłom w 10 min bez straty dział.

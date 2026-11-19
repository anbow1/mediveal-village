# Marchland — plan rozgrywki

Dokument decyzyjny: co gra ma robić, w jakiej kolejności to budujemy i po czym
poznamy, że działa. Stan dzisiejszy opisuje `../README.md`; tu jest cel.
Liczby są punktem wyjścia do strojenia w testach (`tests/`), nie obietnicą.

Wzorce, z których biorę **zasady, nie zasoby**: strategie gospodarcze, w
których każdy towar ktoś niesie; budowniczowie osad, w których wojsko to ci
sami ludzie, co pracują w polu; gry bitewne, w których rozstrzyga morale i
flanka, a nie liczba kliknięć.

## 1. Cztery filary

1. **Gospodarkę widać.** Każdy towar leży pod budynkiem albo ktoś go niesie.
   Zator widać na mapie, zanim pokaże go liczba.
2. **Ludzie są jedni.** Ten sam mieszkaniec jest pracownikiem, tragarzem albo
   żołnierzem. Powołanie regimentu zabiera dwunastu ludzi z pracy.
3. **Bitwa szyków.** Kilka–kilkanaście oddziałów na stronę; rozkaz dostaje
   oddział, rozstrzyga morale, kierunek ataku i teren.
4. **Jedna sesja.** Mapa 400 × 400 m, 25–35 minut, bez prowadzenia pojedynczej
   postaci za rękę. Aktywna pauza zamiast szybkich palców.

Czego gra **nie** ma mieć: mgły wojny (mapa jest mała i ma być czytelna),
drzewka technologii, mikrotransakcji, krwi.

**Zmiany z 2026-11-13** (prośby gracza):

- **Łańcuchy dłuższe o jeden krok**: zboże mieli **młyn** na mąkę dla piekarni;
  rudę wytapia **huta** (z drewnem) na żelazo dla kuźni i płatnerza.
- **Wino**: **winnica** sadzi krzewy raz i zbiera winogrona co sezon, rzędy
  winorośli zajmują teren jak pola; **winiarnia** tłoczy wino; chata z winem
  płaci więcej i szybciej się zaludnia.
- **Milicja jako jednostka startowa i straż domowa**: włócznia i drewniana
  tarcza (1 drewno na człowieka), bez zbroi, werbowana w zamku, zanim staną
  koszary. **Tylko do obrony**: rozkazy w promieniu 115 m od własnego zamku, bez
  ataku na budynki. Do ataku idzie dopiero po przezbrojeniu przy koszarach.
- **Przezbrojenie**: oddział przy własnych koszarach zmienia rodzaj (np.
  milicja → pikinierzy), zachowując ludzi; płaci tylko za brakujący
  ekwipunek. Szczegóły: `UNITS.md` §5.
- **Budynki rozpoznawalne po wyglądzie**: każdy fach ma swoją sylwetkę i pracę
  widoczną na zewnątrz (drwal rąbie przy pieńku, skrzydła młyna kręcą się, gdy
  miele). Modele z Blendera: `BLENDER.md`, lista z gałęziami: `BUILDINGS.md` §2.

- **Obrona**: **wieża strażnicza** (kamień) na najwyżej 4 łuczników albo
  kuszników jednego rodzaju — strzelają z góry o 12 m dalej; zaznacz strzelców
  i kliknij wieżę prawym przyciskiem. **Mur** rysowany jak droga, 3 kamienie za
  2 m: zatrzymuje wszystkich, także własnych; wróg go rozbija (machiny szybciej).
  **Brama** (20 drewna, 12 kamienia) wstawiana kliknięciem we własny mur: zastępuje
  6 m prostego odcinka; twoi ludzie i żołnierze przez nią przechodzą (skrzydła
  otwierają się, gdy ktoś swój jest blisko), dla wroga to mur — mocniejszy niż
  zwykły (400 ciosów zamiast 260).
- **Zasięgi**: drwal, kamieniołom, kopalnia i wieża — w dowolnym miejscu mapy
  (nie przy wrogim zamku); zagrody i winnice do 300 m od zamku; reszta 230 m.
- **Mapa 560 m**, bez drogi między zamkami. **Miejsce zamku** wybiera się w menu
  spośród trzech: 1. róg (zamki 600 m od siebie), 2. zachodni skraj, 3. południowy
  skraj (po 495 m); komputer stoi zawsze w miejscu lustrzanym (obrót o pół koła),
  więc mapa jest uczciwa. Jezioro, wychodnie, pole bitwy, kopce i skalne grzędy
  układają się względem linii między zamkami; góry stoją w rogach bez zmian.
- **Wycinka lasu**: drwal ścina najbliższe dorosłe drzewo w promieniu 48 m od chaty
  (8 drewna z drzewa), przy pniu sadzi sadzonkę — jedną za każde ścięte drzewo — i
  dopiero wtedy niesie drewno do zagrody. Sadzonka rośnie 10 minut i znów jest drzewem
  do ścięcia. Wokół drwala robi się widoczna przecinka; gdy w zasięgu nie ma dorosłych
  drzew, drwal czeka na sadzonki albo trzeba postawić nowego. Przecinka (ponad połowa
  drzew w kratce 12 m) przestaje być lasem: nie spowalnia, nie osłania, można na niej budować.
- **Góry i skały**: dwa szare masywy na flankach (w rogach bez zamków) i cztery
  skalne grzędy po bokach pola. Podnóża gór są do przejścia, rdzeń i grzędy —
  nie: nie da się tam wejść, budować ani prowadzić drogi; armie muszą je obejść.
- **Sterowanie myszą**: środkowy przycisk przesuwa mapę, prawy przeciągnięty
  obraca, prawy klik to rozkaz, Ctrl + przeciągnięcie prawym ustawia front.

Wcześniej tego dnia: działki zniknęły. Budynki stawia się
dowolnie w promieniu własnych ziem, z obrotem; ludzie chodzą po drogach, które
gracz rysuje. Szczegóły i liczby: `ECONOMY.md` §6 i `BUILDINGS.md`.

## 2. Przebieg sesji

| Minuty | Faza | Co robi gracz | Co musi być gotowe, żeby faza działała |
|---|---|---|---|
| 0–5 | Osada | drwal, pole, chaty; pierwsi tragarze | ludność, tragarze, budowa z dostawą |
| 5–12 | Łańcuchy | piekarnia, chlewnia, garbarnia, kopalnia, kuźnia; poziom 2 zamku | magazyny budynków, zatory, alarmy |
| 10–18 | Pierwsza krew | milicja i pikinierzy; obrona pola przed zagonem; zajęcie wsi na środku | działki za murami, punkty na mapie, zagony komputera |
| 15–28 | Wojna | armia mieszana, bitwa w polu, uzupełnienia | szyki, postawy, weterani, kapitan |
| 25–35 | Oblężenie | machiny, szturm zamku albo odparcie ostatniej fali | brama, palisada, garnizon |

Miary tempa (testy symulacji bez gracza, jak dziś `tests/game.test.ts`):
pierwszy regiment między 5. a 8. minutą; pierwsza bitwa 3 na 3 przed 15.
minutą; partia komputer–komputer kończy się zwycięstwem jednej strony w 25–40
minut (dziś na normalnym poziomie nie kończy się wcale — obrona jest za mocna).

## 3. Ludność

- Chata daje rodziny: poziom 1 — 6 osób, poziom 2 — 10, poziom 3 — 14. Ludzie
  przybywają po jednym co 40 s, dopóki chata jest najedzona; z głodnej
  odchodzą.
- Każdy człowiek ma jedną rolę: **pracownik** (przypisany do budynku),
  **tragarz**, **budowniczy** albo **żołnierz**. Przydział jest automatyczny:
  najpierw obsada budynków w kolejności ich budowy, reszta dzieli się na
  tragarzy i budowniczych 3 : 1. Gracz widzi licznik („wolni: 4, tragarze: 9,
  budowniczowie: 3”) i może wyłączyć budynek, żeby zwolnić pracownika.
- Budynek rzemieślniczy potrzebuje 1 pracownika (poziom 3: 2). Pracownik idzie
  z chaty do warsztatu; bez niego budynek stoi.
- **Werbunek zabiera ludzi**: regiment to 12 (jazda 8, balisty 6, trebusz 8)
  mieszkańców, którzy idą do koszar po ekwipunek i dopiero wtedy stają w szyku.
  Limit armii to nadal 100, ale realnym ograniczeniem jest ludność.
- Rozwiązany oddział wraca do pracy; ekwipunek wraca do magazynu.
- Podatek: 1 złota na osobę na 50 s, tylko od najedzonych.

Cel projektowy: pełne miasto to około 110–130 osób, z czego 25–35 trzyma
gospodarkę. Armia stu ludzi jest możliwa, ale kosztem produkcji — to ma boleć.

## 4. Logistyka

- Budynek ma **skład wyjściowy** (do 8 sztuk każdego wyrobu) i **wejściowy**
  (do 6 sztuk każdego surowca). Pełny skład wyjściowy zatrzymuje produkcję.
- **Spichlerz** to zamek (później osobny budynek „Skład”). Tu trafia nadwyżka i
  stąd bierze się towar na budowę i dla wojska.
- Tragarz bierze najstarsze zlecenie: brak w składzie wejściowym → przynieś z
  najbliższego źródła (skład wyjściowy producenta albo spichlerz). Niesie do 3
  sztuk jednego towaru; idzie ścieżkami miasta z prędkością 1,4 m/s, poza
  ścieżką 1,0 m/s.
- **Budowa**: plac budowy zamawia drewno i kamień; każda dostawa to część
  postępu, resztę dokładają budowniczowie na miejscu (czas dzielony przez ich
  liczbę, najwyżej 3). Budynek rośnie etapami: fundament → szkielet → ściany →
  dach.
- **Jedzenie** trafia do chat (skład wejściowy: chleb, kiełbasy). Głodna chata
  = jej ludzie pracują o połowę wolniej i nie płacą podatku. Wojsko w polu je
  ze spichlerza; brak racji obniża morale jak dziś.
- Cykle produkcji wydłużają się około dwukrotnie względem dzisiejszych, bo
  dochodzi czas przenoszenia; strojenie w teście „łańcuch chlewnia → garbarnia
  daje 12 zbroi w 6 minut przy 3 tragarzach”.
- **Zagrożenie**: gdy wrogi oddział jest bliżej niż 30 m, pracownicy i tragarze
  uciekają do zamku i praca staje. Zabity mieszkaniec to strata ludności.

Etap pośredni (żeby nie czekać na całość): najpierw sami tragarze i składy przy
budynkach jako **obraz** dzisiejszej ekonomii (towar znika z magazynu i pojawia
się u odbiorcy tak jak teraz, a postacie tylko to pokazują), potem przełączenie
na prawdziwe czasy dostaw. Przełącznik w `config.ts`, oba tryby pod testami.

## 5. Miasto i mapa

- **Dowolne stawianie** (zrobione): budynek idzie w dowolne miejsce do
  230 m od własnego zamku, na suchym i dość płaskim terenie, z odstępem od
  innych budynków i pól. Gracz wybiera budynek z listy, widzi „ducha”
  (zielony — można, czerwony — nie, z powodem w podpowiedzi), obraca go klawiszem
  R i stawia lewym przyciskiem; Shift stawia kolejne tego samego rodzaju.
- **Teren decyduje o rzemiośle** (zrobione): drwal stoi przy lesie, rybak nad
  jeziorem, kamieniołom przy wychodni kamienia, kopalnia przy rudzie. Zagroda
  potrzebuje wolnej ziemi za plecami: jej pasy pola leżą za nią i rosną z
  poziomem, więc rolnictwo zajmuje teren i naturalnie tworzy wieś obok miasta.
  Rzemiosło i chaty stawia się przy zamku.
- **Drogi** (zrobione): rysowane od punktu do punktu (klawisz G albo przycisk
  w menu budowy), kosztują kamień. Ludzie sami wybierają najszybszą trasę:
  drogą idą 1,4× szybciej, w lesie wolniej, budynki i wodę omijają. Gdzie drogi
  nie ma, wydeptują ścieżki (na razie tylko pod budynkami i przy drzwiach).
- **Zamek ma trzy poziomy** (zrobione): kliknij zamek, w panelu „Rozbuduj zamek”.
  1 — start: zasięg budowy 230 m (pola 300 m), koszary do poziomu 1, 1800 wytrzymałości,
  strzała co 1 s; 2 — 250 złota, 60 drewna, 120 kamienia: zasięg 260 m (330), koszary do 2,
  2600, strzała co 0,75 s; 3 — 500 / 100 / 240: zasięg 290 m (360), koszary do 3, 3600,
  strzała co 0,5 s. Rozbudowa trwa minutę; zamek rośnie z poziomem. Komputer rozbudowuje
  zamek, zanim podniesie koszary.
- **Budynki za miastem** (wieś, kamieniołom, kopalnia, drwal) są celem
  zagonów: to tam lekka jazda ma co robić.
- **Punkty na środku mapy** (zrobione): na linii w połowie drogi między zamkami — bogata
  kopalnia na jednym wzgórzu (8 rudy/min), kamieniołom w polu na drugim (10 kamienia/min),
  wieś na środku pola (15 złota i 6 zboża/min). Zajmuje je oddział, który stoi przy punkcie
  20 s bez wroga w promieniu 30 m; dwie strony naraz — nikt. Dochód idzie do zamku
  właściciela, dopóki wróg nie zajmie punktu. Komputer wysyła wolny oddział po punkt.
  Widać: maszt z chorągwią w barwie właściciela, pierścień na ziemi, zabudowa, romb na
  minimapie, postęp zajmowania pod kursorem, komunikat z „pokaż”.
- **Trzy układy mapy** (zrobione, wybór w menu „Mapa”): *Otwarte pole* (dotychczasowa);
  *Przeprawa* — rzeka przez środek, nie do przejścia poza groblą z kamiennymi balustradami
  na środku i dwoma brodami na wysokości wzgórz (tam stoją kopalnia i kamieniołom; wieś na
  grobli); *Bór* — las prawie wszędzie, polany wokół miast (105 m), wąski trakt między
  nimi (24 m) i polany punktów; jazda w lesie słabnie, strzały grzęzną w drzewach.
  Komputer burzy biernego gracza po 32–36 min na polu i w borze, 38 min na przeprawie.
- **Wzniesienia liczą się** (plan): strzelcy z góry mają +15 % zasięgu,
  szarża w dół +25 % premii, walka pod górę −1 do ataku.
- **Wygląd terenu** (zrobione): pagórki z fałdami, dwa wzgórza po bokach pola
  bitwy, dwa szare masywy górskie (do 80 m, z rumowiskami) i cztery skalne grzędy
  jako przeszkody naturalne, po jeziorze na stronę, wychodnie kamienia i rudy z głazami, luźne
  kamienie i kępy krzaków. Łąka ma kolor zdjęcia lotniczego prawdziwej łąki
  (90 m bez powtórzeń), a skany z bliska dodają tylko źdźbła; każda tekstura
  jest czytana dwa razy pod różnym kątem, więc nie widać siatki powtórzeń.
  Drogi, podwórza, zaorane pasy i zboże (zielone → złote) są rysowane na
  ziemi na bieżąco; drzewa i krzaki znikają tam, gdzie stanie budynek.

## 6. Wojsko

Skład zostaje (milicja, pikinierzy, łucznicy, miecznicy, halabardnicy,
kusznicy, lekka i ciężka jazda, balisty, trebusz). Dochodzi:

| Element | Zasada |
|---|---|
| **Szyki** | linia (domyślna); kolumna (marsz +20 %, front węższy); jeż pikinierów (stoi, kontra na jazdę z każdej strony, −50 % ruchu); klin ciężkiej jazdy (+30 % premii szarży, słabsze boki); luźny szyk strzelców (−40 % strat od pocisków, −morale w zwarciu) |
| **Szerokość szyku** | przeciągnięcie prawym przyciskiem ustawia front i liczbę ludzi w szeregu (4–12) |
| **Postawy** | trzymaj pozycję / pilnuj (domyślna: odpowiada na atak w promieniu 12 m) / harcuj (strzelcy cofają się przed piechotą); osobno „wstrzymaj ogień” |
| **Rozkazy** | marsz, bieg, atak, szarża (bieg od razu), cofaj się frontem do wroga, stój, odwrót do zamku, obsadź zamek |
| **Weterani** | *zrobione:* dwa stopnie (zaprawieni od 0,6 zabitego na człowieka, weterani od 1,5), zabici wręcz i strzałami: każdy stopień +1 atak, +1 obrona, +8 górnego morale, strzelcy +12 % trafień; uzupełnienie rozcieńcza doświadczenie |
| **Kapitan** | *zrobione:* w każdym oddziale (bez machin) kapitan stoi za szeregami; jego śmierć to −12 morale; bez niego atak −1, górne morale −10, morale wraca o połowę wolniej; nowy przychodzi z uzupełnieniem. (Kapitan całej armii — później.) |
| **Uzupełnienia** | *zrobione:* oddział do 40 m od koszar (milicja: od zamku), 5 s poza walką; płaci złoto i broń za każdego brakującego, ludzie odchodzą z pracy, idą do koszar i po krótkim szkoleniu dołączają od tyłu; komputer też uzupełnia |
| **Żołd** | *zrobione:* 0,2 zł na człowieka na minutę, z zamku co sekundę; zaległość ponad minutę żołdu = wojsko nieopłacone (−15 górnego morale) aż do spłaty. Fale trybu Obrona bez żołdu |
| **Oblężenie** | palisada i brama od 2. poziomu zamku: bramę rozbija piechota (wolno), balista (średnio), trebusz (szybko); garnizon strzela z murów |

Aktywna pauza (spacja): gra stoi, rozkazy można wydawać i układać w kolejkę
(Shift). To jest główny sposób grania bitew na telefonie.

Miary bitwy (test macierzy pojedynków, 30 ziaren na parę, jak w sesji z
2026-11-11): równy pojedynek 45–75 s kontaktu; szarża w bok kończy starcie w
10–15 s; strzały zabierają 15–25 % nieopancerzonych w drodze z 80 m; żadna
jednostka nie wygrywa z każdą inną; każda ma kontrę tańszą od siebie.

## 7. Przeciwnik

- Gra tymi samymi komendami i tą samą ekonomią (już jest). Dochodzą **trzy
  charaktery**: *Gospodarz* (rozbudowa, późna duża armia), *Zagończyk* (wczesna
  lekka jazda na pola i drwali), *Rycerz* (szybki 3. poziom zamku, ciężka
  jazda i machiny). Charakter losuje ziarno; trudność go nie zmienia.
- **Kontry**: co minutę liczy klasy wojska gracza i przesuwa werbunek (dużo
  jazdy → piki i halabardy; dużo kolczug → kusze i balisty; dużo strzelców →
  jazda).
- **Taktyka w polu**: linia piechoty, strzelcy za nią, jazda na skrzydle, odwód
  z jednego oddziału; jazda czeka na związanie linii i uderza w bok; machiny
  stają za linią i celują w strzelców i machiny gracza; oddział poniżej 40 %
  morale jest luzowany przez odwód.
- **Trudność** to mnożnik produkcji, opóźnienie reakcji (łatwy 6 s, trudny 1 s)
  i to, czy używa flanki i luzowania. Nigdy dodatkowe wojsko z niczego.
- Fale z rosnącym progiem zostają jako rytm sesji; między falami zagony.

## 8. Tryby

1. **Potyczka** — to, co jest, na trzech układach mapy, z wyborem trudności i
   charakteru przeciwnika (albo losowo).
2. **Obrona** — dziesięć fal na jedno miasto, coraz cięższych, z przerwami na
   rozbudowę; wynik w gwiazdkach (czas, straty, ocalone budynki). Najtańszy do
   zbudowania drugi tryb: korzysta z gotowych fal komputera.
3. **Samouczek** — pierwsze 8 minut potyczki z podpowiedziami wyzwalanymi
   stanem gry („zboże leży pod polem — brakuje tragarzy”).
4. **Kampania** pięciu misji z przenoszeniem wojska — propozycja do decyzji: `CAMPAIGN.md`.

## 9. Interfejs

Zrobione (2026-11-13):

- Kamera: kółko oddala aż do widoku całej mapy (z góry, bez mgły);
  obrót klawiszami Q/E, przeciąganiem środkowym przyciskiem, dwoma palcami
  na dotyku i przyciskami ⟲ ⟳ na górnym pasku.
- Menu budowy (zakładka „Buduj”) i werbunku (zakładka „Werbunek”, gdy są
  koszary); ceny z zaznaczeniem braków.
- Panel budynku: stan pracy (pracuje / brak pracownika / czeka na surowiec /
  podwórze pełne), skład wejściowy i podwórze, mieszkańcy chaty, pola zagrody,
  postęp budowy z dostarczonymi materiałami.
- Górny pasek: ludność (i ilu wolnych), racje w zamku i chatach wobec
  zjadanych na minutę, wojsko.

Zrobione: **zakładka Produkcja** — każdy towar: w zamku, wytwarza /min, bilans /min (z ostatnich
dwóch minut); obok zatory warsztatów (brak surowca — którego, pełne podwórze, brak pracownika,
wstrzymany) z „pokaż”. **Alarmy z „pokaż”**: wróg w osadzie, wróg przy zamku, głód, oddział
ucieka lub rozbity, budynek stracony, mur przebity, podwórze pełne od minuty.
**Grupy i widoki**: Ctrl+1…9 zapamiętuje zaznaczone oddziały, 1…9 je zaznacza (dwa razy szybko:
kamera do nich), dwuklik oddziału zaznacza wszystkie tego rodzaju na ekranie, Ctrl+F5…F8
zapamiętuje widok kamery, F5…F8 do niego wraca. **Kontry** w podpowiedzi przy werbunku
(„Dobrzy na: jazdę. Słabi na: łuczników…”).

**Tryby** (menu „Tryb”): *Potyczka* z komputerem, który gra *z umiarem*, *jak budowniczy*
(fale później, większe) albo *jak najeźdźca* (mniejsze fale wcześniej i co 2,5 min zagon
szybkiego oddziału na zabudowania za miastem); *Obrona* — bez miasta wroga, fale spod jego
zamku od 7. minuty co 4 min, większe co drugą, wygrana po 30 minutach; *Samouczek* — siedem
kroków (drwal, zagroda i chata, młyn i piekarnia, kamieniołom, milicja, ruch oddziałem,
koszary) z plakietką u góry, każdy zaliczany sam, gdy miasto go pokazuje.

**Zapis gry** (menu pauzy) i **wczytanie** (menu startowe), **ustawienia** (głośność, krawędź
ekranu) — zrobione.

Do zrobienia:

- Dolny pasek kart oddziałów (jak dziś nad wojskiem, ale stały): siła, morale,
  stopień, postawa; klik zaznacza, dwuklik centruje kamerę.
- Kształt, nie tylko kolor: chorągwie stron różnią się krojem, stan oddziału
  ikoną.

## 10. Kamienie milowe

Kolejność od największego wpływu na grę. „Silny model” to praca wymagająca
projektu albo nowej techniki; „rutyna” jest rozpisana w `ROUTINE.md`; „Blender”
w `BLENDER.md`.

| # | Kamień | Zakres | Kto | Kryterium |
|---|---|---|---|---|
| M1c | **Wieża i mur** ✔ | wieża z załogą strzelców, mur rysowany i rozbijany, dym, wszystkie budynki z Blendera | silny model | testy w `tests/economy.test.ts` („walls and watchtowers”) |
| M1b | **Fachy, wino, straż domowa** ✔ | młyn, huta, winnica z rzędami winorośli, winiarnia, wino w chatach; milicja z zamku; przezbrojenie; drwal rąbie w obejściu; 10 budynków z Blendera rozpoznawalnych z daleka | silny model | zrobione 2026-11-13: testy młyna, huty, wina, milicji i przezbrojenia w `tests/economy.test.ts` |
| M1 | **Żywe miasto** ✔ | ludność, role, tragarze, składy budynków, budowa z dostawą, głód per chata, ucieczka przed wrogiem, pola, drwale i rybacy w terenie, dowolne stawianie, drogi i szukanie drogi | silny model | zrobione 2026-11-13: testy w `tests/economy.test.ts` (miejsce budowy, dostawa materiałów, żniwa, piekarnia, drwal i rybak, chata i głód, drogi, werbunek z ludności); komputer wygrywa z bezczynnym graczem w 30 min; komputer–komputer: pierwsze starcia ok. 20. minuty, bez zwycięzcy w 40 min |
| M2 | **Bitwa v2** | szyki, szerokość frontu, postawy, cofanie, weterani, kapitan, uzupełnienia, żołd, wzniesienia, aktywna pauza z kolejką | silny model (symulacja), rutyna (HUD) | macierz pojedynków spełnia miary z §6; test na każdy szyk i postawę |
| M3 | **Mapa ma znaczenie** | rodzaje działek, działki za miastem, punkty do zajęcia, poziomy zamku, trzy układy mapy, rzeka i brody | silny model (generator, zasady), rutyna (panele) | komputer–komputer kończy partię w 25–40 min na każdym układzie; zagon na pole zatrzymuje jego produkcję |
| M4 | **Obraz** | żołnierze i robotnicy z modeli (animacja wypalona do tekstur), konie, las z impostorów, trawa przy kamerze, okluzja, pył i dym, budynki z modeli, etapy budowy | silny model (technika), Blender (modele) | zrzuty z ustalonych widoków obok wzorców; budżety z `BRIEF.md` §8 dotrzymane |
| M5 | **Przeciwnik v2 i tryby** | charaktery, kontry, taktyka linii i flanki, tryb Obrona, samouczek | silny model (taktyka), rutyna (tryby, samouczek) | każdy charakter wygrywa z dzisiejszym komputerem w ≥ 60 % z 20 ziaren |
| M6 | **Telefon i wydanie** | KTX2, przycisk Benchmark, ustawienia, zapis gry, wariant Android | rutyna | pomiar na telefonie w `RESULTS.md`; APK w wydaniu |

M1 i M2 nie zależą od modeli z Blendera i idą pierwsze. M4 startuje, gdy
przyjdą pliki z `BLENDER.md`; do tego czasu postacie zostają z kodu.

## 11. Ryzyka i jak je rozstrzygamy

| Ryzyko | Sygnał | Decyzja |
|---|---|---|
| Logistyka robi z gry układankę zatorów | w teście bez gracza komputer głoduje albo stoi | tragarz niesie 3 sztuki, nie 1; spichlerz przyjmuje wszystko; tryb „obraz” zostaje jako ułatwienie na poziomie łatwym |
| Ludność blokuje armię | pierwsza bitwa po 15. minucie | więcej osób na chatę, nie tańsze wojsko |
| Za dużo rozkazów na telefon | gracz nie nadąża bez pauzy | aktywna pauza z kolejką jest w M2, nie później |
| 200 animowanych postaci i 60 robotników nie mieści się w klatce | pomiar na telefonie | animacja w teksturze i jeden instancjonowany mesh na rodzaj; dalsze poziomy szczegółów; robotnicy bez cieni na Low |
| Obrona silniejsza od ataku (dziś) | komputer–komputer bez zwycięzcy w 60 min | trebusz i brama w M2/M3, słabszy ostrzał zamku, żołd |

# Marchland — podręcznik gry

Wszystko, co gracz widzi i czym steruje: menu i ustawienia, ekran gry z każdą liczbą na nim, panele, sterowanie
myszą, klawiaturą i dotykiem, prowadzenie wojska, gospodarka w skrócie, animacje pracy i walki, kampania.
Wszystkie zasady (walka, morale, ostrzał, oblężenie, ruch, komputer, kampania) z liczbami: [RULES.md](RULES.md).
Liczby reguł (ceny, siła jednostek, produkcja) są w dokumentach generowanych z `src/config.ts`:
[UNITS.md](UNITS.md), [BUILDINGS.md](BUILDINGS.md), [ECONOMY.md](ECONOMY.md); jak gra jest zrobiona
(techniki) — w [PLAYBOOK.md](PLAYBOOK.md); misje — w [CAMPAIGN.md](CAMPAIGN.md). Napisy w nawiasach
„tak” są dokładnie tymi z polskiej wersji gry.

---

## 1. Menu główne

Ekran tytułowy („Marchland”) ustawia grę przed startem. Wybór jest zapamiętany do następnej gry na tym
urządzeniu (grafika) albo przez adres strony (mapa, zamek).

| Wiersz | Wybory | Co zmienia |
|---|---|---|
| **Poziom** | Łatwy · Normalny · Trudny | tempo pracy miasta komputera (×0,7 / ×1 / ×1,35) i wielkość jego fal ataku |
| **Grafika** | Wysoka · Niska · Bardzo niska | patrz niżej; wybór z menu wygrywa z `q=` w adresie i jest zapamiętany |
| **Tryb** | Potyczka · Obrona · Samouczek · Kampania | rodzaj gry (§1.1) |
| **Przeciwnik gra** | z umiarem · jak budowniczy · jak najeźdźca | charakter komputera: budowniczy atakuje później większymi falami (×1,5 ludzi, ×1,35 czasu), najeźdźca wcześniej mniejszymi i co 150 s wysyła oddział palić budynki na skraju miasta |
| **Mapa** | Otwarte pole · Przeprawa · Bór · Dolina | układ mapy (§1.2); *Twierdza* jest tylko w kampanii |
| **Zamek** | 1. Róg · 2. Zachód · 3. Południe | miejsce zamku gracza; zamek komputera stoi zawsze naprzeciw (ten sam układ obrócony o pół koła); obok mała mapka z oboma zamkami, górami i skałami |

Wiersze *Przeciwnik gra*, *Mapa* i *Zamek* znikają w kampanii; w ich miejscu jest **lista misji** (§10).
Pod spodem: **Graj**, **Wczytaj grę** (gdy jest zapis: z jego mapą i czasem gry), skrót **Sterowanie**
i numer wersji.

**Grafika — co robi każdy poziom:**

| | Wysoka | Niska | Bardzo niska |
|---|---|---|---|
| gęstość pikseli | do 2 × | do 1,5 × | 1 × |
| cienie | tak (mapa 2048) | tak (1024) | nie |
| trawa przy kamerze | gęsta | rzadsza | nie |
| wygładzanie | czasowe (TRAA, tylko WebGPU) | zwykłe | nie |
| las i drobiazgi | pełne | ok. połowa | ok. połowa |
| teren | pełne powierzchnie | pełne | lekki shader (słabe tablety) |

Niezależnie od wyboru „regulator klatek” obniża rozdzielczość, gdy klatki się spóźniają. Gdy WebGPU nie
ruszy, gra sama przechodzi na WebGL2 i pokazuje okno z raportem grafiki do wysłania.

### 1.1 Tryby

- **Potyczka** — miasto przeciw miastu komputera; wygrywa ten, kto zburzy zamek przeciwnika.
- **Obrona** — 30 minut przeciw falom (pierwsza po 7 min, potem co 4 min, coraz większe); komputer nie
  buduje. Pasek u góry: „Obrona: do końca mm:ss · fal N · następna za N s”.
- **Samouczek** — 7 kroków od drwala do koszar; pasek u góry pokazuje bieżący krok i odhacza go sam.
- **Kampania** — 5 misji jednej wojny (§10).

### 1.2 Mapy

| Mapa | Co na niej jest |
|---|---|
| Otwarte pole | pagórki, dwa wzgórki po bokach pola, masywy w wolnych rogach, skały |
| Przeprawa | rzeka przez środek: grobla w środku i dwa brody po bokach |
| Bór | las prawie wszędzie, polana przy każdym zamku i wąska droga między nimi |
| Dolina | dwa grzbiety gór wzdłuż drogi między zamkami, przełęcz przy drugim końcu |
| Twierdza (kampania) | zamek wroga na płaskowyżu, bez jeziora, złóż i lasu wokół |

Na każdej mapie są trzy **punkty do zajęcia** w środku: bogata kopalnia (ruda), kamieniołom w polu (kamień),
wieś (złoto i zboże). Oddział postawiony przy punkcie na 20 s, bez wroga w promieniu 30 m, zajmuje go; punkt
daje towary co minutę, dopóki nie zajmie go przeciwnik. Maszt nad punktem ma barwę właściciela.

### 1.3 Adres strony (dla zaawansowanych)

`?map=field|river|forest|valley|fortress`, `&start=0|1|2`, `&mode=campaign&mission=N`, `&q=high|low|minimal`,
`&lang=pl|en`, `&gl` (wymusza WebGL2), `&seed=N` (te same losowania), `&autostart` (bez menu), `&debug`
(okno `window.__debug` do pomiarów), `&scene=battle|town` (gotowa sytuacja do zrzutów).

## 2. Menu w czasie gry (przycisk „Menu” albo Esc bez zaznaczenia)

Gra staje. **Wznów**, **Zapisz grę** (jeden zapis w przeglądarce; napis „Zapisano” albo „Przeglądarka nie
przyjęła zapisu”), **Od nowa**, a w ustawieniach:

| Ustawienie | Wybory |
|---|---|
| **Głośność** | 0 · 30% · 60% · 100% |
| **Krawędź ekranu** | przesuwa · nie (czy mapa jedzie, gdy mysz dotknie brzegu ekranu; na dotyku zawsze wyłączone) |

Na dole: wersja, czas wczytania i bieżąca grafika. Ustawienia zostają w przeglądarce.

**Koniec gry:** „Zwycięstwo” albo „Porażka”, czas, pokonani wrogowie, straty własne, „Od nowa”.
**Koniec misji:** „Misja wygrana/przegrana”, gwiazdki (misja 1: do 3, pozostałe do 2), czas, pokonani, straty,
„Następna misja” / „Spróbuj jeszcze raz” / „Lista misji” i notka o tym, co idzie do następnej misji.

---

## 3. Ekran gry

### 3.1 Pasek u góry

**Zasoby** (lewa część): 21 towarów w trzech grupach — budulec i złoto (złoto, drewno, deski, kamień), żywność
(zboże, mąka, chleb, ryby, mięso, kiełbasy, winogrona, wino, piwo), rzemiosło i wojsko (skóry, zbroje skórzane,
ruda, żelazo, broń, kolczugi, łuki, konie). Każdy to ikona, nazwa i liczba w zamku (i składach). Przycisk
**Aa** przełącza „same ikony” albo „ikony z nazwami” (na wąskim ekranie pasek zawija się w dwa rzędy).

**Prawa część:**

| Pole | Znaczenie |
|---|---|
| `Ludzie N (wolni M)` | wszyscy mieszkańcy; wolni = tragarze i budowniczowie bez zadania, z których można powołać wojsko |
| `R / P racji/min` | racje jedzenia w zamku / ile miasto zjada na minutę; na czerwono, gdy jest głód |
| `Wojsko n/limit` | żołnierze w polu i w wieżach / największa armia strony (100, w kampanii 200) |
| `mm:ss` | czas gry |
| ⏸ | aktywna pauza (Spacja): bitwa staje, rozkazy można wydawać |
| 1× 2× 3× | tempo gry |
| ⟲ ⟳ | obrót mapy (Q, E) |
| Menu | menu w czasie gry |

### 3.2 Paski i komunikaty

- **Pasek trybu** pod paskiem zasobów: pauza („Pauza · wydawaj rozkazy (Shift + prawy: do kolejki) · Spacja
  wznawia”), obrona, samouczek albo misja (np. trybut z towarami i odliczaniem, „gwardia: 2 (40 ludzi) · mury
  całe · odsiecz za 14:59”). Każdy da się zamknąć krzyżykiem.
- **Komunikaty** po prawej, zielone (dobre) i czerwone (złe): budowa ukończona, nowy oddział, nasz oddział
  ucieka / zebrał się / rozbity, wróg ucieka, głód, brak żołdu, mur przebity, punkt zajęty, alarmy (pełne
  podwórze, drwal bez drzew, wróg w osadzie). Przy wielu jest przycisk **pokaż** — kamera jedzie na miejsce.
- **Podpowiedź** na dole panelu: co robią przyciski myszy w tej chwili (inna na dotyku).
- **Dymek** po najechaniu na mapę: budynek (nazwa, poziom, właściciel), oddział (rodzaj, ludzie, czyj), punkt
  (kto trzyma, kto zajmuje i ile %), złoże kamienia/rudy, las, jezioro, góry, skała.

### 3.3 Karty nad oddziałami

Nad chorągwią każdego oddziału (swojego i wroga) wisi karta:

- **znak rodzaju** na tle barwy strony (ramka też w barwie strony): ⛨ milicja, ↟ pikinierzy, ➶ łucznicy,
  ⚔ miecznicy, ⚒ halabardnicy, ⌖ kusznicy, ♞ lekka jazda, ♛ ciężka jazda, ⇶ armata, ☄ moździerz;
- **gwiazdki** doświadczenia (★ zaprawieni, ★★ weterani);
- **pasek siły** (żywi / skład początkowy) w kolorze morale: zielony — dobrze, żółty — słabnie, czerwony —
  bliski ucieczki; karta oddziału, który ucieka, jest przygaszona, a pasek szary;
- **zaznaczenie**: jasna poświata; zaznaczona karta leży nad innymi;
- **■** pod kartą zaznaczonego oddziału w ruchu: zatrzymuje go w miejscu.

Lewy klik w kartę zaznacza oddział (z Shift dodaje), prawy klik w kartę wroga — atak na niego.

### 3.4 Minimapa

Lewy dolny róg: teren, zamki, oddziały w barwach stron (zaznaczone jaśniej), punkty, ślad tego, co widzi
kamera. Klik przenosi kamerę.

### 3.5 Na mapie

Zaznaczony oddział ma pod sobą obrys; podgląd budynku w ręce jest zielony (można) albo czerwony (z powodem
w podpowiedzi); przy przeciąganiu frontu widać belkę każdego oddziału i znacznik kierunku; zaznaczony punkt ma
żółty okrąg; kolejka rozkazów (Shift) pokazuje kolejne miejsca. Wyłom w murze to sterta gruzu.

---

## 4. Panel dolny

Bez zaznaczenia panel ma cztery zakładki.

### 4.1 Buduj

Grupy: **Osada** (chata, skład, targ, karczma, kaplica, studnia), **Żywność**, **Surowce**, **Broń i wojsko**,
**Obrona i drogi** (wieża, droga, mur, brama). Każdy przycisk: nazwa i koszt (ikony towarów; brakujący na
czerwono). Dymek: do czego służy i co z czego robi. **Siatka (T)**: budynki przyciągają się do siatki co 16 m
równoległej do dróg, drzwiami w jednym z czterech kierunków.

**Zagroda i winnica** zajmują od razu ziemię na wszystkie trzy poziomy (paski za budynkiem, aż do wody, lasu,
skały albo innego budynku; co najmniej 4). Podgląd pokazuje paski w kolorach poziomów: zielone — uprawiane od
poziomu 1, bursztynowe — od poziomu 2, jasne — od poziomu 3. Na mapie ziemia czekająca na wyższy poziom ma
wydeptaną miedzę dookoła: jest zajęta, nic na niej nie stanie, a ulepszenie zawsze ma gdzie urosnąć.

**Stawianie:** wybierz, wskaż miejsce, lewy klik stawia (z Shift — kolejne), R obraca (z siatką o 90°), prawy
klik albo Esc anuluje. Na dotyku: stuknięcie stawia, ten sam budynek w menu anuluje; podgląd stoi na środku
mapy, przesuwanej palcem.

**Droga (G) i mur:** odcinek od punktu do punktu: klik — początek, klik — koniec. Z Shift koniec jest
początkiem następnego odcinka (ciąg). Prawy klik / Esc / ponowny wybór narzędzia anuluje początek, drugi raz
kończy budowę. Koszt: kamień za każde 10 m (w przycisku). **Brama:** klik we własny mur; 10 m.

### 4.2 Werbunek

Każda jednostka: znak, nazwa, koszt (złoto i ekwipunek). Wyszarzona z powodem: „(koszary poz. N)”,
„(ludwisarnia poz. N)”, „(w zamku, bez koszar)” dla milicji, brak ludzi, pełna armia. Dymek: opis i „Dobrzy
na: … Słabi na: …”.

**Zamów uzbrojenie** ×1 / ×2 / ×5: warsztaty zrobią sprzęt na tyle oddziałów i staną (§7.1).
**W szkoleniu:** kolejka (do 3 oddziałów) i ilu rekrutów jeszcze idzie do koszar albo ile sekund zostało (§7.2).

### 4.3 Produkcja

Na górze **Transport**: poziom (na plecach / wózki ręczne / wozy konne), ładunek tragarza, szybkość,
przycisk ulepszenia z kosztem (wozy wymagają zamku poziomu 2).

Tabela towarów:

| Kolumna | Znaczenie |
|---|---|
| w zamku | zapas w zamku i składach |
| na podwórzach | gotowe towary czekające przy warsztatach na tragarzy |
| wytwarza /min | produkcja z ostatnich 2 minut |
| bilans /min | zmiana zapasu na minutę (czerwony, gdy ubywa) |
| priorytet | ▲ tragarze noszą ten towar najpierw · zwykły · ▼ na końcu |
| zamówione | − ∞ +: ile jeszcze zrobić; ∞ bez limitu, 0 wstrzymane. Warsztaty broni zaczynają od zera |

**Zatory:** warsztaty, które stoją, zebrane po rodzaju i powodzie („Kuźnia: Czeka na surowiec (brak:
żelazo)”, „Podwórze pełne — czeka na tragarzy”, „Brak pracownika”…), każdy z **pokaż**.

### 4.4 Budynki

Lista rodzajów: liczba, poziomy (np. „2×1 1×2”), ile w budowie, ile stoi (na czerwono), towary na podwórzach,
zużycie na minutę przy pełnej pracy, priorytet rodzaju ▲·▼ (który warsztat pierwszy dostaje surowiec). Klik
w wiersz: kamera do następnego budynku tego rodzaju i jego panel.

### 4.5 Panel budynku (klik w budynek)

- **Nagłówek:** nazwa · poziom N/3 · stan: *Pracuje*, *Budowa: x% · drewno/kamień dostarczone/potrzebne*,
  *Wstrzymany*, *Brak pracownika*, *Czeka na surowiec*, *Podwórze pełne — czeka na tragarzy*, *Brak dorosłych
  drzew w zasięgu*, *Zamówienie wykonane — czeka na następne*; chata: mieszkańcy x/y i głód; koszary: szkoli poziom N.
- Opis z recepturą (co z czego, ile na cykl).
- **Skład** (surowce w warsztacie) i **Podwórze** (gotowe towary); chata: zapasy jedzenia.
- Wieża: **Załoga** x/4 (rodzaj), **Wyprowadź załogę**. Zagroda: **Pola** obrabiane/wszystkie.
- Przyciski: **Ulepsz** (koszt następnego poziomu), **Obróć (R)** (tylko w pierwszej budowie),
  **Wstrzymaj/Wznów**, **Rozbierz**. Koszary i ludwisarnia mają pod spodem werbunek, targ — **Sprzedaj /
  Kup** po 10 każdego towaru (60% / 160% wartości).
- **Ruina** (kampania): „ruina”, opis, **Odbuduj (½ ceny)**, **Rozbierz**.

### 4.6 Panel zamku (klik w zamek)

„Zamek · poziom N/3”, wytrzymałość, **zasięg budowy** (m), **koszary do poziomu**, **żołd /min** (w nawiasie
zaległy), postęp rozbudowy. **Rozbuduj zamek**: koszt; wyższy poziom daje dalszy zasięg, mocniejsze mury,
szybsze strzały łuczników z murów i wyższe koszary (60 s budowy).

### 4.7 Panel wojska (gdy zaznaczone są oddziały)

- **Stój (H)** · **Całe wojsko (Ctrl+A)** · **Odznacz (Esc)**.
- Karta każdego zaznaczonego oddziału: znak i gwiazdki, nazwa, **ludzie x/skład**, **stan** (stoi, maszeruje,
  biegnie, atakuje, szturmuje, walczy, ucieka, przezbraja się → rodzaj (s), czeka na uzupełnienie), stopień
  (zieloni/zaprawieni/weterani), „bez kapitana”, **pasek morale** (kolor jak wyżej), **cienki pasek zmęczenia**,
  **×** — odznacz ten oddział. Klik w kartę: zaznacz tylko ten.
- **Połącz** (kampania): przy dwóch lub więcej oddziałach tego samego rodzaju.
- **Tempo:** Marsz · Bieg. **Szeregi:** 2 · 3 · 4 · 6 (piechota). **Szyk:** Prostokąt · Klin (jazda) ·
  Luźny (piechota). **Postawa:** Zwykła · Tarcze (milicja, pikinierzy, miecznicy, kusznicy) · Ściana pik
  (pikinierzy, halabardnicy). **Strzelanie:** Dowolne · Na rozkaz (strzelcy i działa).
- Jeden zaznaczony oddział: **Uzupełnij** (koszt i ilu brakuje) i **Przezbrój** (na co, koszt; tylko przy
  koszarach).
- Działa: notka, jak nimi strzelać.

---

## 5. Sterowanie

### 5.1 Klawiatura

| Klawisz | Działanie |
|---|---|
| W A S D / strzałki | przesuwanie mapy |
| Q / E | obrót mapy |
| + / − | przybliżenie, oddalenie |
| Spacja | aktywna pauza |
| H | stój (zaznaczone oddziały) |
| B | marsz albo bieg dla rozkazów |
| Ctrl+A | całe wojsko |
| Esc | anuluj narzędzie / odznacz / menu |
| R | obróć budynek (w ręce albo w pierwszej budowie) |
| G | droga |
| T | siatka |
| Shift | dodaj do zaznaczenia; rozkaz do kolejki; stawiaj kolejne budynki; ciąg odcinków drogi/muru |
| Ctrl | odznacz kliknięciem lub ramką; z prawym przeciągnięciem: front |
| 1–9 | zaznacz grupę (dwa razy szybko: kamera do niej) |
| Ctrl+1–9 | zapamiętaj grupę (i jej szyk, gdy oddziałów jest kilka) |
| F5–F8 / Ctrl+F5–F8 | wróć do widoku / zapamiętaj widok kamery |
| F3 | pomiar wydajności |

### 5.2 Mysz

| | Działanie |
|---|---|
| lewy klik | zaznacz oddział / budynek / zamek; dwuklik w oddział: wszystkie tego rodzaju na ekranie |
| lewy przeciągnięty | ramka zaznaczenia |
| prawy klik | marsz; na wroga — atak; na wrogi budynek — szturm; na własną wieżę (strzelcy) — załoga; na wrogi mur (działa) — ostrzał; dwa kliknięcia — bieg |
| prawy przeciągnięty (z zaznaczeniem) | front i kierunek nowej linii (§6.2) |
| prawy przeciągnięty (bez zaznaczenia) | obrót i pochylenie kamery |
| środkowy | przesuwanie mapy |
| kółko | zoom do kursora, aż do widoku całej mapy |

### 5.3 Dotyk (tablet, telefon)

| Gest | Działanie |
|---|---|
| jeden palec | przesuwa mapę |
| dwa palce | przybliżają (szczypanie) i obracają (skręt) |
| stuknięcie | zaznacza; z zaznaczonym wojskiem — marsz tam (dwa stuknięcia — bieg); na wroga — atak |
| stuknięcie w zaznaczony oddział | odznacza go |
| przytrzymanie palca (⅓ s, krótka wibracja) i przeciągnięcie | front i kierunek, jak prawym przyciskiem |
| × na karcie / ■ pod kartą | odznacz / stój |

---

## 6. Wojsko

### 6.1 Skąd się bierze

Żołnierze to mieszkańcy: werbunek zabiera wolnych ludzi z miasta (zawsze kilku zostaje). Rekruci idą do
koszar (milicja — do zamku, załogi dział — do ludwisarni), biorą sprzęt z zamku i formują oddział.
Oddział: 12 pieszych albo 8 jeźdźców (w kampanii dopełniany do 20). Wyższe jednostki wymagają koszar
wyższego poziomu, a te — zamku. Siła, ceny i kto kogo bije: [UNITS.md](UNITS.md).

### 6.2 Rozkazy

- **Marsz / bieg** — prawy klik w teren (dwa — bieg, albo B przełącza tempo). Bieg szybszy, ale męczy.
- **Front przeciągnięciem** — prawy przycisk przeciągnięty z zaznaczonymi: przeciągnięcie wyznacza front,
  oddział patrzy w lewo od kierunku przeciągnięcia (w prawo przeciągasz → patrzy od kamery). Pełne koło obraca
  szyk płynnie przez 360°. Kilka oddziałów staje w jednej linii obok siebie (albo w zapamiętanym szyku).
- **Atak** — prawy klik w oddział wroga (podchodzą biegiem; strzelcy stają w zasięgu i strzelają).
- **Szturm budynku** — prawy klik w budynek albo zamek wroga.
- **Ostrzał muru** — działa i moździerze: prawy klik w mur wroga; strzelają, aż powstanie wyłom.
- **Załoga wieży** — łucznicy albo kusznicy: prawy klik we własną wieżę (do 4 ludzi, strzelają dalej).
- **Kolejka** — z Shift rozkaz trafia na koniec kolejki; kolejne punkty widać na mapie.
- **Stój** — H, „Stój (H)” w panelu albo ■ pod kartą.
- **Aktywna pauza** — Spacja: wszystko staje, rozkazy można wydawać.

### 6.3 Zaznaczanie

Klik, ramka, Shift (dodaj), dwuklik (wszystkie tego rodzaju na ekranie), Ctrl+A, grupy 1–9. Odznaczanie:
Esc lub „Odznacz” (wszystkie), × na karcie, Ctrl + klik, Ctrl + ramka; na dotyku stuknięcie w zaznaczony.

### 6.4 Szyk, postawa, tempo

Szeregi 2–6 (głębszy szyk wytrzymuje więcej, płytszy więcej ludzi walczy naraz); klin dla jazdy (szarża
mocniejsza o 60%, obrona słabsza); luźny (strzały trafiają rzadziej o połowę, wręcz słabiej); tarcze (dwa razy
mniej trafień strzał, wolniejszy marsz); ściana pik (oddział stoi, szarża z przodu nie działa, jazda obrywa
podwójnie). Strzelanie dowolne albo na rozkaz.

### 6.5 Ruch: kolumna, przeprawy, kolejka

Gdy na drodze jest woda, skała albo mur, oddział sam szuka drogi (bród, grobla, brama) i idzie **kolumną po
trzech**, która trzyma się śladu czoła; rozwija się w szyk, gdy przejdzie ostatni szereg. Linia za szeroka na
bramę przechodzi kolumną. **Przez jedną przeprawę (bród, grobla, brama) idzie naraz jeden oddział strony**;
reszta czeka 12 m przed nią, najbliższy następny; nikt nie czeka dłużej niż 30 s.

### 6.6 Morale, zmęczenie, doświadczenie, żołd

- **Morale** spada od strat, ostrzału, ataku z flanki i z tyłu, utraty kapitana, głodu i braku żołdu; kaplica
  podnosi morale wszystkich oddziałów strony, a weterani trzymają się dłużej. Złamany oddział **ucieka** do zamku, może się **zebrać** i wrócić; rozbity
  znika.
- **Zmęczenie** rośnie od biegu i walki, spada w marszu i na postoju; zmęczeni walczą słabiej.
- **Doświadczenie**: każdy zabity wróg. ★ zaprawieni i ★★ weterani biją mocniej, celniej strzelają, trudniej
  ich złamać. **Kapitan** (pierwszy człowiek oddziału) trzyma morale; gdy padnie — komunikat.
- **Żołd**: co minutę złoto za każdego żołnierza z zamku; bez złota wojsko traci ducha („Brak złota na żołd”).

### 6.7 Uzupełnianie, przezbrajanie, łączenie

- **Uzupełnij** — przerzedzony oddział dostaje ludzi z miasta przy koszarach (milicja przy zamku): złoto i broń
  za każdego, nowi rozwadniają doświadczenie.
- **Przezbrój** — przy koszarach oddział zmienia rodzaj (np. milicja → miecznicy), płacąc różnicę sprzętu.
- **Połącz** (kampania) — dwa oddziały tego samego rodzaju, do 30 m od siebie, 5 s bez walki: ludzie
  przechodzą do liczniejszego (do 20); doświadczenie i morale — średnia ważona; nadmiar zostaje z kapitanem.

### 6.8 Mury, bramy, wieże, działa

Mur zatrzymuje wszystkich; swoi przechodzą bramami (skrzydła otwierają się, gdy podchodzą). Wróg bije w mur
wręcz albo z dział; wyłom zostaje gruzem, przez który się przechodzi. Wieża mieści 4 strzelców, którzy z góry
sięgają dalej. Armata bije prosto (kula toczy się i powala kilku), moździerz stromo nad murami (zabójczy, ale
niecelny); oba strzelają z miejsca.

---

## 7. Gospodarka w skrócie

- **Ludzie** rodzą się w chatach (zamek mieści kilku). Każdy jest tragarzem, budowniczym, pracownikiem albo
  rekrutem. Głód: produkcja zwalnia, podatki ustają, morale spada.
- **Tragarze** noszą wszystko: surowce do warsztatów i na budowy, towary do zamku, jedzenie do chat.
  Przy zamku oddają i biorą towar na **10 stanowiskach wokół murów** (od strony, z której przychodzą);
  bezczynni czekają rozproszeni na placu. Transport: na plecach → **taczka** → **wóz konny**. Taczki trzymają
  odstęp jedna za drugą.
- **Drogi** przyspieszają ludzi; ludzie sami je wybierają. **Skład** to drugi magazyn — tragarze idą do
  najbliższego.
- **Zamówienia i priorytety** sterują, co się robi i co się nosi najpierw (§7.1–7.3).
- **Pola**: zagroda obsiewa 4/8/12 pasków (poziomy 1–3) jeden po drugim, więc stoją w różnych fazach. Winnica
  podobnie. **Leśnik** sadzi przy pniach; drwal tnie tylko dorosłe drzewa.
- **Targ** ratuje zatkany łańcuch, ale po złym kursie.
- Pełne liczby: [ECONOMY.md](ECONOMY.md), [BUILDINGS.md](BUILDINGS.md).

### 7.1 Zamówienia towarów i uzbrojenia

- **Warsztaty uzbrojenia gracza stoją, dopóki czegoś nie zamówisz.** Dotyczy to broni, łuków, zbroi
  skórzanych, kolczug i koni: w zakładce Produkcja mają zamówienie 0. Komputer pracuje bez limitu.
- **Zamówienie towaru** (Produkcja, kolumna „zamówione”): **−** i **+** zmieniają je o 12 sztuk (konie o 4),
  środkowy przycisk przełącza na **∞** (bez limitu). Warsztat robi, aż zamówienie spadnie do zera, i staje ze stanem
  „Zamówienie wykonane — czeka na następne”. Każda zrobiona sztuka zmniejsza zamówienie.
- **Zamówienie pociąga za sobą łańcuch.** Zamówione 36 kolczug „chce” 72 sztuk żelaza, więc huta pracuje
  dalej, choć samo żelazo ma zamówienie 0; podobnie ruda dla huty. Łańcuch rusza sam od zamówionego wyrobu.
- **Zamów uzbrojenie** (Werbunek) ×1 / ×2 / ×5 przy każdym rodzaju: dodaje do zamówień dokładnie tyle sprzętu,
  ile potrzeba na tyle oddziałów (np. pikinierzy: 12 broni i 12 zbroi skórzanych na oddział). Dymek pokazuje
  listę. Towar ustawiony na ∞ zostaje bez limitu. Drewno i złoto nie są zamawiane (drewno się ścina).
- **Wstrzymaj / Wznów** w panelu budynku zatrzymuje jeden warsztat niezależnie od zamówień.

### 7.2 Werbunek i kolejka szkolenia

1. Klik w jednostkę (Werbunek, panel koszar albo ludwisarni). Złoto i cały sprzęt oddziału (np. 12 broni)
   **schodzą z zamku od razu**; bez nich przycisk jest wyszarzony.
2. Rozkaz trafia do **kolejki szkolenia**: najwyżej **3 oddziały naraz**. Kolejka liczy się do limitu wojska
   (żołnierze w polu, w wieżach i w kolejce nie mogą przekroczyć 100, w kampanii 200).
3. **Rekruci idą z miasta** (wolni tragarze i budowniczowie; kilku zawsze zostaje) do koszar, milicja do
   zamku, załogi dział do ludwisarni. W panelu: „W szkoleniu: Pikinierzy, Łucznicy — 5 rekrutów w drodze”.
4. Gdy wszyscy doszli, oddział **szkoli się kilka–kilkanaście sekund** („(8 s)”) i staje przy budynku.
   Kolejka idzie po kolei.
5. Przycisk jest wyszarzony z powodem: za niski poziom koszar lub ludwisarni, za mało wolnych ludzi, pełna
   armia, pełna kolejka, brak złota albo sprzętu.

**Uzupełnij** działa tak samo, tylko dla ludzi brakujących w oddziale: koszt za każdego nowego, ludzie idą
z miasta, oddział czeka przy koszarach („czeka na uzupełnienie”). **Przezbrój**: oddział przy koszarach płaci
różnicę sprzętu i po kilku sekundach zmienia rodzaj („przezbraja się → Miecznicy (6 s)”).

### 7.3 Priorytety

- **Priorytet towaru** (Produkcja, kolumna „priorytet”, ▲ · ▼): mówi **tragarzom**, co nosić najpierw.
  ▲ to towar wybierany przed innymi zadaniami, ▼ — gdy nie ma nic pilniejszego. Kliknięcie przełącza
  · → ▲ → ▼ → ·. Przydaje się, gdy np. budowa czeka na kamień albo armia na broń leżącą przy kuźni.
- **Priorytet rodzaju warsztatu** (Budynki, ▲ · ▼): mówi, **który warsztat pierwszy dostaje surowiec**, gdy
  kilka chce tego samego (np. żelazo: kuźnia przed płatnerzem).
- Bez ustawienia tragarze kierują się pilnością: najpierw jedzenie dla głodnych chat i warsztat, któremu
  surowca brakuje zupełnie, potem budowy, potem odbiór pełnych podwórzy.

### 7.4 Inne kolejki

- **Kolejka rozkazów oddziału** (Shift + prawy przycisk): do 12 rozkazów (marsze, ataki, szturmy)
  wykonywanych po kolei; zwykły rozkaz bez Shift kasuje kolejkę. Kolejne miejsca widać na mapie.
- **Kolejka na przeprawie** (bród, grobla, brama): jeden oddział strony naraz, najbliższy następny, najwyżej
  30 s czekania (§6.5).
- **Taczki i wozy** trzymają odstęp na drodze; przy zamku rozkładają się na 10 stanowisk.
- **Budowy**: budowniczowie idą tam, gdzie leży dostarczony materiał; budowa rośnie tylko tak, jak pozwala
  drewno i kamień na placu („Budowa: 40% · drewno/kamień 12/30”).

### 7.5 Ulepszanie budynków

- **Jak:** klik w budynek → **Ulepsz** (w przycisku koszt następnego poziomu; brakujące towary na czerwono).
  Każdy budynek ma 3 poziomy; na trzecim zamiast przycisku jest napis „Najwyższy poziom”. Na dotyku tak samo.
- **Koszt:** poziom 2 kosztuje 1,5 ×, poziom 3 — 2,5 × ceny budowy (każdy towar). Od poziomu 2 połowa drewna
  przychodzi jako **deski**, więc do ulepszeń potrzebny jest tartak.
- **Przebieg:** złoto schodzi od razu, a drewno, deski i kamień tragarze niosą na plac jak na nową budowę.
  Budowniczowie pracują około 15 s, gdy materiał jest na miejscu; panel pokazuje „Budowa: x% · materiał
  dostarczony/potrzebny”, a budynek ma rusztowanie. **W tym czasie budynek nie pracuje.** Koszary i ludwisarnia
  szkolą wtedy dalej na starym poziomie. Nowy poziom widać od razu w nagłówku, działa po ukończeniu.
- **Warunki:** koszary nie mogą być wyżej niż pozwala zamek (zamek poziomu N → koszary do poziomu N); inne
  budynki tylko 3 poziomy.

**Co daje poziom:**

| Budynek | Poziom 1 | Poziom 2 | Poziom 3 |
|---|---|---|---|
| warsztaty i zbieracze (tempo cyklu) | × 1 | × 1,6 | × 2,3 |
| chata (mieszkańców) | 8 | 12 | 16 |
| zagroda, winnica (obrabianych pasków pola) | 4 | 8 | 12 |
| koszary (milicja szkoli się przy zamku, bez koszar) | pikinierzy, łucznicy | + miecznicy, halabardnicy, kusznicy, lekka jazda | + ciężka jazda |
| ludwisarnia | armata | + moździerz | — |
| każdy budynek (wytrzymałość) | × 1 | × 2 | × 3 |

Wyższy poziom ma też własny model (większy, z dodatkowymi detalami). Zagroda i winnica dostają więcej pasków tylko wtedy, gdy za budynkiem jest na nie miejsce (panel
pokazuje „Pola: obrabiane/wszystkie”). Dokładne receptury i ile czego daje każdy poziom: [BUILDINGS.md](BUILDINGS.md).

**Inne ulepszenia** (w panelu zamku i w zakładce Produkcja): **zamek** (poziom 2 i 3: zasięg budowy,
wytrzymałość, szybsze strzały, wyższe koszary; 60 s, §4.6) i **transport** (wózki ręczne, potem wozy konne,
§4.3).

**Rozbierz** oddaje połowę ceny budowy. Komputer też ulepsza swoje budynki, tym wyżej, im dłużej trwa wojna.

---

## 8. Animacje

### 8.1 Mieszkańcy (czterech mężczyzn i trzy kobiety, te same ruchy; Mixamo)

| Co robi | Ruch |
|---|---|
| idzie | marsz |
| idzie z towarem / z taczką / z wozem | marsz ze skrzynią (ręce przed sobą); taczka przechylona w dłoniach, ładunek w skrzyni; przy wozie idzie animowany koń |
| stoi | postój; z towarem — postój ze skrzynią |
| buduje | uderzenia młotem |
| rybak | połów |
| drwal | rąbanie |
| zagroda, winnica | żniwa |
| kamieniołom, kopalnia | kopanie |
| pozostałe warsztaty | podnoszenie i odkładanie na zmianę |
| huta, kuźnia, płatnerz | kowal z własną animacją pracy, każdy w innej fazie |

Każda osoba jest w innej fazie ruchu, więc tłum nie porusza się jak jeden. Świnie w chlewie, konie przy stajni
i przy wozach chodzą i skubią trawę.

### 8.2 Żołnierze

Postój (każdy w innej fazie), marsz i bieg (dopasowane do prędkości, bez ślizgania stóp), cios (miecz:
cięcie; pika i milicja: pchnięcie; halabarda: trzy różne ciosy rozdane po szeregach), zastawa tarczą (postawa
„Tarcze”), broń wysunięta (ściana pik, gotowość do walki), trafienie, dwie różne śmierci. Łucznik: naciąganie
przed strzałem i łuk w spoczynku; kusznik: podniesienie do strzału i opuszczenie. Jazda: koń (postój, stęp,
galop, skubanie trawy, upadek) z jeźdźcem w siodle. Strzały i bełty lecą łukiem i wbijają się w ziemię.

### 8.3 Machiny, budynki, świat

Armata i moździerz: odrzut, dym, huk z opóźnieniem dźwięku z odległości. Budynki rosną etapami (fundament,
ściany warstwami w rusztowaniu, dach); młyn obraca skrzydłami przy pracy; z kominów idzie dym; bramy otwierają
skrzydła. Ruiny mają ułamane, okopcone mury; wyłom w murze to gruz. Pola zmieniają się od świeżego wysiewu do
złotego zboża; ryby wiszą u rybaka.

### 8.4 Dźwięk

Z nagrań (Kenney, CC0): szczęk broni, uderzenia w zbroję, ciosy i upadki, pękający kamień (kula, kruszony mur),
świst strzały, budowa, kliknięcia, odmowa. Z kodu: huk działa pod nagranym trzaskiem, rogi (wypad, zagon,
odsiecz, ucieczka) i fanfara jak instrument dęty w pogłosie sali. Każdy dźwięk ma głośność i opóźnienie
zależne od odległości od kamery.

---

## 9. Komputer

W potyczce komputer buduje miasto według tego samego planisty co gracz (kwartały na siatce 16 m, drogi do
zamku), werbuje, przezbraja milicję, obsadza wieże, handluje na targu, gdy brakuje złota, i atakuje falami
(wielkość i czas zależą od poziomu i charakteru). W walce dobiera cele (kontry), stawia ścianę pik na jazdę
i tarcze pod ostrzałem.

## 10. Kampania

Lista misji w menu: numer, tytuł, gwiazdki (☆ puste), „najpierw wygraj poprzednią” albo „wkrótce”; pod spodem
odprawa wybranej misji. Do następnej misji idzie najwyżej 8 najsilniejszych oddziałów (z doświadczeniem)
i połowa złota (do 800); postęp zapisuje się na urządzeniu.

| Misja | Mapa | Cel | Druga gwiazdka |
|---|---|---|---|
| 1. Trybut | Przeprawa | zapłać trybut w 30 min (albo odeprzyj 200 najeźdźców) | 4 oddziały przy zapłacie (obrona: do 3 gwiazdek za ocalałych) |
| 2. Obóz za rzeką | Przeprawa | nie zostaje żaden oddział wroga | straty poniżej 30% |
| 3. Odbicie osady | Dolina | 20 s na rynku wsi bez wroga w 30 m | przed odsieczą (12. min) |
| 4. Odbudowa i wielka armia | Dolina | 160 ludzi w 10 oddziałach i zamek 3; 6 ruin do odbudowy za pół ceny | wróg nie zburzy budynku |
| 5. Twierdza | Twierdza | rozbić gwardię na dziedzińcu | wyłom w 10 min, żadne działo nie stracone |

Szczegóły i pomiary: [CAMPAIGN.md](CAMPAIGN.md).

## 11. Zapis, offline, urządzenia

Jeden zapis gry w przeglądarce (menu → Zapisz grę; w menu głównym → Wczytaj grę). Gra działa offline po
pierwszym uruchomieniu (zainstaluj z przeglądarki albo „Do ekranu początkowego” na iPadzie); nowa wersja
pobiera się w tle i włącza przy następnym uruchomieniu albo od razu z paska „Uruchom teraz”. Na słabym
tablecie wybierz grafikę „Bardzo niska”. Gdy coś pójdzie źle, przy następnym uruchomieniu pojawia się przycisk
„Błędy z poprzedniego uruchomienia” z tekstem do skopiowania.

## 12. Zastosowane techniki — gdzie są opisane

| Temat | PLAYBOOK |
|---|---|
| architektura (symulacja deterministyczna, widok, polecenia) | §1 |
| renderer WebGPU/WebGL2, światło, cienie, presety, regulator klatek | §2 |
| teren z funkcji, powierzchnie ze skanów, las, trawa, woda | §3 |
| postacie z Mixamo, wypiekanie ruchu, skinning setek postaci na GPU | §4.1–4.4 |
| mieszkańcy, taczka, kowale | §4.5 |
| ruch wojska: trasy, kolumna po śladzie, kolejka na przeprawach, front przeciągnięciem, gesty dotyku | §4.6 |
| kampania: scenariusze, osada, ruiny, twierdza, stanowiska przy zamku, dźwięk | §4.7 |
| budynki z Blendera, etapy budowy, mury pod dowolnym kątem | §5 |
| skąd assety i na jakich licencjach | §6 i [ASSETS.md](ASSETS.md) |
| pomiary, testy, zrzuty | §7 |
| wydanie: przeglądarka, iPad, Windows, offline | §8 |
| pułapki, na które wpadliśmy | §9 |

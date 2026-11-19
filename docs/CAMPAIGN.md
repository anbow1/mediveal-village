# Marchland — kampania (propozycja do decyzji)

Pięć misji jednej opowieści: księstwo na pograniczu kupuje czas trybutem, rozbija obóz najeźdźcy,
odbija swoją osadę, odbudowuje ją w pełną armię i zdobywa twierdzę wroga. Kolejność i treść misji
pochodzą od właściciela projektu; tu jest to, jak je zrobić **z tego, co gra już ma**, i krótka lista
nowych rzeczy, bez których się nie da.

Zasada: kampania nie dokłada nowych jednostek, budynków ani grafiki. Dokłada **scenariusze**
(mapa, start, cele, wyzwalacze) i pięć małych mechanik (§3). Każda misja to 20–40 minut.

## 1. Misje

### Misja 1 — Trybut

*Najeźdźca stanął obozem po drugiej stronie rzeki. Zażądał trybutu: zapłać, a odejdzie.*

- **Mapa:** *Przeprawa* (rzeka, grobla i dwa brody — jest). Twoje miasto na zachodnim brzegu: zamek
  poziomu 1, kilka chat, zagroda, drwal. Obóz najeźdźcy na wschodnim brzegu, **w zasięgu wzroku**
  zza rzeki: 5–6 dużych oddziałów (ciężka jazda, miecznicy, kusznicy, razem ok. 70 ludzi), bez miasta.
- **Żądanie:** 600 złota, 200 chleba i 40 sztuk broni w ciągu 30 minut, pasek odliczania u góry.
  Trybut wpłaca się przyciskiem w panelu zamku, gdy wszystko leży w magazynie.
- **Wygrana:** trybut zapłacony. **Gdy czas minie:** obóz (200 ludzi: 2 ciężka jazda, 3 miecznicy,
  2 halabardnicy, 3 kusznicy) rusza na miasto. Misję można wtedy jeszcze wygrać: gdy wszystkie jego
  oddziały uciekają przez 3 minuty (`CAMPAIGN.routWinS`) albo giną; przegrana, gdy padnie zamek.
- **Obrona (pomiar, tests/campaign.test.ts):** mniejsza armia (1 konnica, 3 piechoty, 3 kusznicy,
  2 moździerze, 1 działo) za murem z 3 wieżami obsadzonymi kusznikami wygrywa (6/6 w pomiarze, 4/4 w teście),
  tracąc 40–80% ludzi; ta sama armia bez murów zwykle przegrywa (2/6); pełna armia ok. 210 ludzi w polu
  wygrywa pewnie (6/6, straty 7–22%).
- **Cel dodatkowy (gwiazdka):** w chwili zapłaty masz co najmniej 4 oddziały. Przydadzą się w misji 2.
- **Uczy:** gospodarki pod presją czasu. Wróg stoi i patrzy, ale nie atakuje, dopóki nie minie czas.

### Misja 2 — Obóz za rzeką

*Najeźdźca wziął złoto i nie odszedł. Część jego ludzi rozjechała się po wsiach. Uderz, póki obóz jest słaby.*

- **Mapa:** ta sama *Przeprawa*, ten sam układ. Startujesz z miastem jak na końcu misji 1 i z wojskiem
  przeniesionym z misji 1 (§2).
- **Wróg:** obóz za palisadą z bramą (mur i brama — są), 3 oddziały w obozie i 2 zagony we wsiach na
  flankach. Co kilka minut zagon wraca do obozu, więc zwłoka wzmacnia obóz.
- **Wygrana:** w obozie nie ma żywego oddziału wroga. **Przegrana:** pada zamek.
- **Gwiazdka:** straty poniżej 30 % ludzi.
- **Uczy:** przeprawy przez bród, szturmu na palisadę i rozbijania wroga po kawałku.

### Misja 3 — Odbicie osady

> **Stan (19.11):** grywalna na *Dolinie* (`MARCHLAND_MAP=valley`, zamek w drugim miejscu): dwa grzbiety gór wzdłuż
> drogi między zamkami (szczyt co 52 m, 175 m od osi), przełęcz przy drugim końcu, skąd idzie odsiecz. Osada to
> wieś w środku mapy (trzy domy, 274 m od zamku), trzymana przez 5 pełnych oddziałów (miecznicy, pikinierzy,
> halabardnicy, kusznicy, łucznicy) i wieżę z 4 kusznikami. Odsiecz (ciężka jazda, miecznicy, kusznicy) w 12.
> minucie; jeśli zastanie osadę w rękach wroga, po 3 minutach wszystko rusza na miasto. Pomiar: 6 pełnych
> oddziałów (112 ludzi) wygrywa 4/4 w 3–6 minut, tracąc 50–75 ludzi; 4 oddziały po 15 przegrywają 4/4.

*W czasie wojny wróg zajął Twoją osadę w dolinie. Zbierz wojsko i odbij ją.*

- **Mapa:** nowa, *Dolina* (§4): Twój zamek przy jednym końcu, osada 250 m dalej (zabudowania, mała
  wieża strażnicza) w posiadaniu wroga, z załogą 3–4 oddziałów.
- **Start:** wojsko przeniesione z misji 2, miasto do rozbudowy.
- **Wygrana:** oddział stoi 20 s na rynku osady bez wroga w promieniu 30 m (jak dziś punkty na mapie).
  Wtedy osada przechodzi na Ciebie: ocalałe budynki stają się Twoje, spalone zostają ruinami.
- **Utrudnienie:** w 12. minucie od skraju mapy nadchodzi odsiecz wroga (2–3 oddziały).
- **Gwiazdka:** osada odbita przed nadejściem odsieczy.

### Misja 4 — Odbudowa i wielka armia

> **Stan (19.11):** grywalna na tej samej mapie: osada jest Twoja (jej targ płaci), cel 160 ludzi w 10
> oddziałach i zamek poziomu 3; zagony 2, 3 i 4 pełnych oddziałów w 8., 16. i 24. minucie idą na zamek.
> Druga gwiazdka: wróg nie zburzy żadnego budynku. Wokół rynku osady stoi 6 ruin (3 chaty, piekarnia, młyn, targ):
> nic nie robią, a przycisk „Odbuduj (½ ceny)” robi z nich plac budowy za połowę ceny i materiału.

*Osada jest Twoja, ale w ruinach. Odbuduj ją i wystaw armię, jakiej marchia jeszcze nie widziała.*

- **Mapa:** ta sama *Dolina*. Ruiny z misji 3 stoją na swoich miejscach i odbudowuje się je za połowę
  materiału.
- **Cel:** armia co najmniej 160 ludzi w co najmniej 10 oddziałach i zamek na poziomie 3, przy trzech
  zagonach wroga po drodze (z rosnącym progiem, jak w trybie Obrona).
- **Nowe zasady armii** (§3.4): limit 200 żołnierzy na stronę, oddział do 20 ludzi, dobieranie
  oddziału ponad stan przy koszarach i łączenie dwóch oddziałów tego samego rodzaju.
- **Gwiazdka:** ani jeden budynek odbudowanej osady nie padł w zagonach.

### Misja 5 — Twierdza

> **Stan (19.11):** grywalna na nowym układzie *Twierdza* (`MARCHLAND_MAP=fortress`). Zamek wroga stoi na
> płaskowyżu (płasko do 100 m, 7 m nad równiną, bez jeziora, złóż i lasu na nim). Mury i wieże to mury gry, więc
> da się zrobić w nich wyłom:
> - pierścień zewnętrzny 124 × 112 m: 8 wież, brama od strony gracza;
> - pierścień wewnętrzny 84 × 70 m: 4 wieże, brama w lewym murze (bez prostej drogi od bramy zewnętrznej);
> - mury i bramy 2 × twardsze od zwykłych; na każdej wieży 2 kuszników.
>
> Donżon to środek modelu „Medieval Castle” (wycięty w kodzie, `cutOut` w `townView.ts`).
>
> Załoga i odsiecz:
> - między murami: kusznicy, miecznicy, pikinierzy, halabardnicy;
> - przy bramie wypad (ciężka jazda, miecznicy): wychodzi, gdy działo lub moździerz gracza podejdzie na 230 m,
>   bije w działa i po 150 s wraca;
> - na dziedzińcu gwardia: 2 oddziały ciężkiej jazdy;
> - odsiecz w 15. minucie zza obozu gracza: ciężka jazda, miecznicy, kusznicy.
>
> Za murami pracuje miasto wroga (4 chaty, piekarnia, kuźnia, koszary, spichlerz, mieszkańcy): koszary co 5
> minut wystawiają oddział (miecznicy, kusznicy, pikinierzy na zmianę), dopóki stoją; moździerz może je zburzyć.
> Zamek wroga to donżon: zbyt mocny, żeby go burzyć, bo wojna rozstrzyga się na dziedzińcu.
>
> Gracz zaczyna z armią z misji 4, 2 działami i 2 moździerzami, z miastem z koszarami i ludwisarnią.
> Wygrana: gwardia rozbita; przegrana: obóz padnie albo przez minutę nie ma żadnego oddziału. Druga gwiazdka:
> wyłom w 10 minut i żadne działo nie stracone.
>
> Pomiar (bot: moździerze w mur, jeden moździerz w koszary, armaty w bramę, piechota rozbija wypad i odsiecz
> przed murami, nie wchodząc pod wieże, potem szturmuje): pełna armia 8 × 20 wygrywa 2 z 3, tracąc 80–88 ludzi;
> trzecia próba kończy się prawie remisem; wyłom po ok. 9 minutach.

*Czas zakończyć tę wojnę pod murami jego zamku.*

- **Mapa:** nowa, *Twierdza* (§4): na wzgórzu **twierdza większa i bardziej obronna niż zwykły zamek**
  (życzenie właściciela projektu, 17.11), za murami jego miasto, które pracuje i werbuje:
  - **donżon** poziomu 3 powiększony (ok. 1,4 × zwykłego) i z trzykrotną wytrzymałością; jeśli znajdzie się
    model dużego zamku (CC0/CC BY, do ok. 30 tys. trójkątów), zastąpi on donżon;
  - **dwa pierścienie murów**: zewnętrzny (ok. 90 m od donżonu) z 8 wieżami i wewnętrzny (ok. 45 m) z 4
    wieżami, w każdej wieży 4 kuszników; mur twierdzy dwa razy wytrzymalszy od zwykłego, więc na niego
    trzeba moździerzy, armaty biorą bramy;
  - **brama główna jako wieża bramna** (model „Medieval Gatehouse”, CC0, leży w zapasie) w murze
    zewnętrznym, druga, zwykła brama w wewnętrznym, bez prostej drogi między nimi;
  - stromy stok wzgórza tylko od strony bramy łagodny: podejście prowadzi pod ostrzałem wież. Ty startujesz w obozie na
  skraju mapy z armią przeniesioną z misji 4 (do 200 ludzi), z koszarami i ludwisarnią, ale bez miasta.
  Uzupełnienia kosztują złoto ze skarbca.
- **Działa** łamią mury i bramy (to już działa: armata i moździerz mają obrażenia oblężnicze).
- **Wróg też atakuje:** wypady z bramy na Twoje działa, a w 15. minucie odsiecz od tyłu, dowodzona
  przez charakter *Rycerz*. Są więc obie wersje naraz: Ty szturmujesz, a komputer atakuje Ciebie.
- **Przebieg (17.11, według właściciela projektu)**, na modelu zamku z dużym dziedzińcem, który dostarczy:
  1. *Podejście*: armia z obozu pod mury, pod ostrzałem wież.
  2. *Wypad*: gdy działa staną w zasięgu, z bramy wychodzi wypad na nie (i odsiecz od tyłu w 15. minucie).
  3. *Zdobycie zamku*: wyłom albo rozbita brama, wejście na dziedziniec.
  4. *Ostatni bój na dziedzińcu*: tam czeka gwardia pana zamku, ciężka jazda (2–3 pełne oddziały).
- **Wygrana:** gwardia na dziedzińcu rozbita (nie trzeba burzyć donżonu). **Przegrana:** cała armia rozbita
  albo stracony obóz z koszarami.
- **Gwiazdka:** wyłom zrobiony w mniej niż 10 minut, bez utraty dział.

## 2. Ciągłość między misjami

- **Wojsko przechodzi dalej:** do 8 oddziałów (rodzaj, liczba ludzi, stopień weteranów) z końca misji
  stoi na starcie następnej. Weterani z misji 1 mogą dojść do misji 5.
- **Skarbiec:** połowa złota z końca misji, najwyżej 800.
- Postęp zapisuje się sam po każdej misji (jak dziś zapis gry). Misję można powtórzyć, a ukończone
  pokazują gwiazdki.
- Przed misją jest **odprawa**: krótki tekst, mapa z celem i przycisk „Do boju”. Po misji
  **podsumowanie**: czas, straty, gwiazdki.

## 3. Nowe mechaniki (wszystko, co trzeba dopisać)

| # | Mechanika | Potrzebna w | Opis i co wykorzystuje |
|---|---|---|---|
| 3.1 | **Scenariusz misji** | wszystkie | Plik danych na misję: mapa, miejsca startu, budynki i oddziały na starcie obu stron, cele (wygrana, przegrana, gwiazdki), wyzwalacze (czas, utrata budynku, wejście w strefę) i komunikaty. Do tego odprawa i podsumowanie. Silnik wyzwalaczy jest wspólny dla wszystkich misji. |
| 3.2 | **Trybut** | 1 | Żądanie (towary i termin), pasek odliczania, przycisk wpłaty w panelu zamku. Po terminie zwykły atak komputera, tak jak dziś fala w trybie Obrona. |
| 3.3 | **Obóz wroga bez miasta** | 1, 2, 5 | Oddziały stoją przy punkcie i ruszają na sygnał wyzwalacza. To fale trybu Obrona z opóźnionym startem. Namioty z kodu (proste bryły w barwach wroga), bez nowych modeli. |
| 3.4 | **Większa armia** | 4, 5 (i potyczka) | Limit 200 na stronę zamiast 100; oddział werbowany jak dziś (12 pieszych, 8 jeźdźców), dobierany przy koszarach do 20; **łączenie** dwóch oddziałów tego samego rodzaju (stopień weteranów: średnia ważona ludźmi, nadmiar ponad 20 zostaje w drugim). Zmienia też potyczkę. Proponuję jedną zasadę dla całej gry, sprawdzoną pomiarem 2 × 200 żołnierzy. |
| 3.5 | **Przejęcie osady i ruiny** | 3, 4 | Rynek osady działa jak punkt na mapie; budynki zmieniają właściciela. Ruina to budynek w stanie „po pożarze”, odbudowywany jak plac budowy za połowę materiału (etapy budowy już są). |
| 3.6 | **Mury i wieże ustawione scenariuszem** | 2, 5 | Palisada obozu i mury twierdzy stawiane przez scenariusz tymi samymi poleceniami co mur, brama i wieża gracza; załogi wież z kuszników. |

Bez zmian: ekonomia, rodzaje wojska, budynki, walka, grafika, sterowanie.

## 4. Mapy i miejsca startu

Dziś są trzy układy (*Otwarte pole*, *Przeprawa*, *Bór*) i trzy miejsca zamku na każdym. Kampania dokłada
**dwa układy** i **miejsca startu z pliku scenariusza** (dowolny punkt, nie tylko trzy stałe):

- ***Dolina*** (misje 3–4): długa dolina między dwoma masywami (góry już są), Twój zamek przy jednym
  końcu, osada w połowie, przełęcz na drugim końcu, skąd przychodzą odsiecz i zagony. Jezioro i las
  po bokach.
- ***Twierdza*** (misja 5): szerokie wzgórze w środku z zamkiem i miastem wroga, rzeka u jednej ściany
  wzgórza (bród jak na *Przeprawie*), pole przed bramą głównej, las z boku do podejścia pod osłoną.

Oba układy przydadzą się też w potyczce, więc menu „Mapa” urośnie z trzech pozycji do pięciu.

## 5. Kolejność pracy

1. 3.1 scenariusz, odprawa, podsumowanie i przenoszenie wojska, sprawdzone na misji 1 bez trybutu.
2. 3.2 trybut i 3.3 obóz: misja 1 i misja 2 grywalne.
3. Układ *Dolina*, 3.5 przejęcie osady i ruiny: misje 3–4 bez nowych zasad armii.
4. 3.4 większa armia (z pomiarem 2 × 200 na WebGPU) i misja 4 pełna.
5. Układ *Twierdza*, 3.6 mury scenariuszem, odsiecz: misja 5.
6. Strojenie: każda misja przechodzona przez bota-testera (jak dziś testy całych gier bez gracza), a
   czasy i straty zapisane w `RESULTS.md`.

## 6. Decyzje (17.11)

1. **Limit 200 i oddziały do 20 w całej kampanii** (w potyczce bez zmian: 100 i 12/8).
2. **Misja 1 po terminie:** najeźdźca uderza, a szansa obrony to **najwyżej 10 %** (test: 8 oddziałów
   obrońców przy zamku przegrywa we wszystkich 6 partiach; najeźdźca traci 21–34 ze 200 ludzi).
3. **Misja 5:** obie wersje naraz (szturm, wypady z bramy, odsiecz od tyłu).
4. **Przenoszenie:** do 8 oddziałów i połowa złota (do 800).

## 7. Stan

| Element | Stan |
|---|---|
| Tryb „Kampania” w menu: lista misji z gwiazdkami, blokada do wygrania poprzedniej, odprawa | ✔ |
| Scenariusz misji (`src/sim/campaign.ts`): mapa i zamki z adresu, gotowe miasto na start, wróg, cele, gwiazdki | ✔ |
| Armia 200, oddział uzupełniany do 20 przy koszarach, łączenie oddziałów (przycisk „Połącz”) | ✔ |
| Przenoszenie wojska i złota, postęp na urządzeniu (`src/ui/campaignStore.ts`), ekran końca misji | ✔ |
| Misja 1 (trybut, pasek z odliczaniem i przyciskiem zapłaty, najeźdźca 10 × 20 za rzeką) | ✔ grywalna |
| Misja 2 (obóz: 3 oddziały, 2 zagony wracające co 5 min) | ✔ grywalna; palisada i namioty obozu — później |
| Misja 3 (osada: wieś w środku *Doliny*, 5 oddziałów i wieża z kusznikami, odsiecz w 12. minucie) | ✔ grywalna |
| Misja 4 (osada Twoja, 6 ruin do odbudowy za pół ceny, cel: 160 ludzi w 10 oddziałach i zamek 3, trzy zagony) | ✔ grywalna |
| Misja 5 (układ *Twierdza*, mury scenariuszem, wypady, odsiecz) | ✔ grywalna: płaskowyż, dwa pierścienie murów gry (12 wież, 2 bramy), donżon wycięty z `fortress_1.glb` |

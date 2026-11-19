# Marchland — ekonomia

*Plik generowany przez `npm run docs` z `src/config.ts`. Nie poprawiaj ręcznie:
zmień konfigurację (albo tekst w `tools/docs.ts`) i wygeneruj ponownie.*

## 1. Zasada

Miasto to ludzie, towary i drogi między nimi. Nic nie pojawia się w magazynie
samo: zboże trzeba zebrać z pola, przynieść do piekarni, upiec i roznieść po
domach. Im dłuższa droga, tym wolniej działa cały łańcuch — dlatego układ miasta
i drogi są decyzją gracza, a nie ozdobą.

## 2. Ludzie

- Zamek ma własną załogę: 8 osób na start. Chata mieści 8 / 12 / 16 osób (poziomy 1–3).
- Najedzona chata z wolnym miejscem przyjmuje nowego mieszkańca co 30 s.
- Każdy człowiek ma jedną rolę naraz, przydzielaną automatycznie co sekundę:
  1. **pracownik** — po jednym na każdy czynny budynek produkcyjny (najbliższy wolny człowiek),
  2. **budowniczy** — 30 % wolnych rąk, gdy cokolwiek się buduje (najwyżej 3 na budowę),
  3. **tragarz** — wszyscy pozostali; miasto zawsze zostawia co najmniej 4 tragarzy (a gdy coś się buduje,
     jeszcze jednego człowieka na budowniczego) — warsztat ponad to czeka na pracownika, aż przybędzie ludzi,
  4. **rekrut** — wezwany do koszar; po dojściu staje się żołnierzem.
- **Wspólna ludność**: regiment zabiera z miasta tylu ludzi, ilu ma żołnierzy (machiny: obsługa).
  Żołnierze mieszkają w obozie, więc chaty z czasem zapełniają się na nowo — armia kosztuje
  miasto czas i ręce do pracy, nie miejsce w domach. Miasto zawsze zostawia co najmniej
  4 wolnych ludzi; bez nich werbunek jest odrzucany („brak ludzi”).
- Rozwiązany oddział wraca do miasta jako mieszkańcy.
- Podatek: 1.2 złota na minutę od każdej najedzonej osoby; zamek daje stałe 24 złota na minutę.
- Gdy wrogi oddział w szyku zbliży się na 32 m, ludzie rzucają pracę i biegną do zamku;
  wracają 6 s po odejściu wroga.
- Człowiek idzie 2 m/s; po drodze 1.4× szybciej, w lesie 0.7×.

## 3. Logistyka

- **Zamek jest magazynem**, a każdy ukończony **skład** — drugim: towary miasta są wspólne, a tragarz
  odnosi gotowe towary do najbliższego magazynu i stamtąd pobiera (przy oddalonej wsi oszczędza to drogę).
- Każdy budynek ma własne składy: wejściowy (tragarze uzupełniają
  do 8 sztuk) i wyjściowy na podwórzu (do 24 sztuk; pełny zatrzymuje pracę).
- Tragarz niesie do 8 sztuk jednego towaru; podniesienie i odłożenie trwa 1 s.
- Wolny tragarz bierze najpilniejsze zlecenie, a przy równej pilności najbliższe:
  1. jedzenie do chaty z pustą spiżarnią,
  2. drewno i kamień na plac budowy,
  3. jedzenie do chaty poniżej 5 racji,
  4. towar z podwórza do zamku, gdy zamek ma go mało,
  5. surowiec do warsztatu (pusty skład przed niepełnym; nie nosi się do warsztatu z pełnym podwórzem),
  6. pozostały towar z podwórzy do zamku (gdy leży tam co najmniej 4 sztuk).
- Towar bierze się stamtąd, skąd wychodzi najkrótsza trasa: z podwórza producenta albo z zamku.
- Towar znika z ksiąg źródła w chwili przyjęcia zlecenia i pojawia się u celu, gdy tragarz dojdzie;
  po drodze jest na jego plecach (i widać go).
- **Budowa**: złoto płaci się od razu, drewno i kamień czekają w zamku na tragarzy. Budowniczowie
  wznoszą budynek tylko do takiej części, jaka odpowiada dostarczonym materiałom.

## 4. Jedzenie

- Mieszkaniec zjada 0.3 racji na minutę, żołnierz 0.25.
  Chleb to 1 racja, ryba 1, kiełbasa 2 (dlatego opłaca się rzeźnik).
- Chaty jedzą ze swoich spiżarni (cel: 5 racji), załoga zamku i wojsko — z magazynu zamku.
- Głodny dom: jego ludzie pracują o połowę wolniej, nie płacą podatku i nikt nowy się nie wprowadza.
  Pusty magazyn zamku: wojsko traci 25 punktów morale.
- Rachunek dla orientacji: 30 mieszkańców zjada 9 racji/min, 60 — 18;
  armia 100 ludzi — 25 racji/min.

## 5. Wino

- **Winnica**: winiarz sadzi krzewy na pasie ziemi (15 s, raz). Potem pas sam rodzi co 110 s,
  bez ponownego siewu; zbiór trwa 7 s i daje 3 winogron. Rzędy winorośli zajmują
  teren za winnicą tak jak pola zagrody (4 / 8 / 12 pasów na poziomach 1–3).
- **Winiarnia** tłoczy wino z winogron. Tragarze niosą wino do chat (do 3 beczułek), gdy mają
  zapas — po chlebie, przed surowcami warsztatów.
- Chata z winem: mieszkaniec wypija 0.05 wina na minutę; podatek ×1.8,
  nowi mieszkańcy przychodzą w 60 % zwykłego czasu. Wino nie jest jedzeniem.

## 6. Pola, las, jezioro, skała

- **Pole**: rolnik karczuje pas ziemi (7 s, raz), sieje (5 s), zboże rośnie 60 s,
  potem żniwa (6 s) i 6 zboża wraca do zagrody. Pas ma 12 × 3 m;
  zagroda uprawia 4 / 8 / 12 pasów na poziomach 1–3. Pasy leżą za zagrodą, w stronę przeciwną
  do drzwi, i nic nie można na nich postawić — rolnictwo zużywa teren, więc zagrody buduje się
  jako wieś na otwartej przestrzeni, a rzemiosło przy zamku.
- **Drwal** musi stać do 26 m od lasu: kurs to 8 s rąbania i 8 drewna.
- **Rybak** musi stać do 16 m od jeziora: kurs to 10 s łowienia i 3 ryby.
- **Kamieniołom i kopalnia** muszą stać do 15 m od wychodni kamienia albo rudy. Każda strona
  ma po jednej za miastem; druga, bogatsza, leży na flance bliżej środka mapy.

## 7. Stawianie budynków i drogi

- Budynek stawia się **w dowolnym miejscu** w promieniu 280 m od własnego zamku (zagrody i winnice do
  340 m; drwal, kamieniołom, kopalnia i wieża — w dowolnym miejscu mapy), ale nie bliżej niż
  90 m od wrogiego): teren pod nim może się wznosić najwyżej o 2.2 m, nie może to być woda,
  a od innych budynków i pól dzieli go co najmniej 1.5 m. Poza kołem zamku można budować do
  70 m od każdego własnego budynku (także rozpoczętego) — przy stawianiu żółta przerywana linia pokazuje
  granicę. Budynek można obrócić przed postawieniem i **w trakcie budowy** (R albo przycisk w panelu);
  drzwi wyznaczają, gdzie podchodzą ludzie. Limit: 64 budynków na stronę.
- **Droga** to linia od punktu do punktu na siatce 2 m; kosztuje 1.7 kamienia za 10 m.
  Ludzie sami wybierają najszybszą trasę (drogą idą 1.4× szybciej) i omijają budynki oraz wodę.
- Komputer stawia według tych samych reguł: rzemiosło i chaty w pierścieniach wokół zamku, zagrody
  w wiosce z polami za plecami, drwala przy najbliższej ścianie lasu, rybaka nad jeziorem,
  kamieniołom i kopalnię przy skale; od każdych drzwi kładzie drogę do bramy zamku.

## 8. Poziomy budynków

- Poziom kosztuje ×1 / ×1.5 / ×2.5 ceny podstawowej i daje ×1 / ×1.6 / ×2.3 tempa pracy.
- Rozbudowa to 15 sekund pracy budowniczych po dostarczeniu materiałów; budynek w tym czasie stoi.
- Rozbiórka zwraca 50 % ceny podstawowej.

## 9. Start partii

Każda strona zaczyna z zamkiem, 8 ludźmi i zapasem: 340 złoto, 90 drewno, 40 kamień, 40 chleb.
Na początek miasto może wystawić milicję w zamku (włócznia i tarcza z drewna, bez zbroi), zanim
staną koszary. Sensowna kolejność: drwal → zagroda → chata → młyn → piekarnia → drugi drwal → chaty, kamieniołom, rybak →
chlewnia, kopalnia, koszary → garbarnia, huta, kuźnia → rzeźnik, łuczarz → stajnia, płatnerz →
winnica, winiarnia.

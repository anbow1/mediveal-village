// Complete Bilingual UI Strings (Polish & English) for Stage 6 Marchland.
// The Strings interface enforces 100% completeness in both languages.

import type {
  BuildingBranch,
  BuildingTypeId,
  GoodId,
  LangCode,
  LightingPresetId,
  QualityPreset,
  UnitTypeId,
} from '../config.ts';
import type { MapLayoutId } from '../sim/terrain.ts';
import type {
  AiPersonality,
  CampaignMissionId,
  Difficulty,
  FormationKind,
  GameMode,
  PlacementRejectionReason,
  StanceKind,
} from '../sim/types.ts';

export interface MissionText {
  readonly title: string;
  readonly objective: string;
  readonly briefing: string;
}

export interface Strings {
  readonly title: string;
  readonly subtitle: string;
  readonly loading: string;
  readonly play: string;
  readonly resume: string;
  readonly restart: string;
  readonly benchmark: string;
  readonly benchmarkRunning: string;
  readonly copy: string;
  readonly copied: string;
  readonly close: string;
  readonly pausedBadge: string;
  readonly pauseBtn: string;
  readonly playBtn: string;
  readonly menuBtn: string;
  readonly qualityLabel: string;
  readonly qualityHigh: string;
  readonly qualityLow: string;
  readonly qualityMinimal: string;
  readonly offlineDownload: (mb: number) => string;
  readonly offlineProgress: (pct: number, doneMb: number, totalMb: number) => string;
  readonly offlineReady: (mb: number) => string;
  readonly offlineQuota: (doneMb: number, totalMb: number) => string;
  readonly offlineRetry: string;
  readonly difficultyLabel: string;
  readonly langLabel: string;
  readonly lightingLabel: string;
  readonly governorLabel: string;
  readonly volumeLabel: string;
  readonly on: string;
  readonly off: string;
  readonly loadedIn: (seconds: number) => string;
  readonly lightingNames: Record<LightingPresetId, string>;
  readonly mapNames: Record<MapLayoutId, string>;
  readonly modeNames: Record<GameMode, string>;
  readonly difficultyNames: Record<Difficulty, string>;
  readonly personalityNames: Record<AiPersonality, string>;
  readonly controlsHint: string;

  // Tabs & panels
  readonly tabBuild: string;
  readonly tabRecruit: string;
  readonly tabProduction: string;
  readonly branchNames: Record<BuildingBranch, string>;
  readonly toolRoad: string;
  readonly toolWall: string;
  readonly toolGate: string;
  readonly cancelTool: string;
  readonly rotateBtn: string;
  readonly rotateHint: string;
  readonly lineToolHint: string;
  readonly poseToolHint: string;
  readonly multiSelectBtn: string;
  readonly selectAllBtn: string;

  // Economy & HUD labels
  readonly popLabel: string;
  readonly freeCarriersLabel: string;
  readonly armyLabel: string;
  readonly upkeepUnpaid: string;
  readonly armyStarving: string;
  readonly bottlenecksTitle: string;
  readonly noBottlenecks: string;
  readonly prodHeaderGood: string;
  readonly prodHeaderStock: string;
  readonly prodHeaderRate: string;
  readonly prodHeaderNet: string;

  // Building inspector
  readonly levelLabel: string;
  readonly hpLabel: string;
  readonly residentsLabel: string;
  readonly upgradeBtn: string;
  readonly upgradeMaxLevel: (lvl: number) => string;
  readonly upgradeNeedsKeep: (lvl: number) => string;
  readonly upgradeMissing: (missingList: string) => string;
  readonly upgradeWaitBuild: (pct: number) => string;
  readonly upgradeInProgress: (targetLvl: number, pct: number) => string;
  readonly sawmillHint: string;
  readonly demolishBtn: string;
  readonly rebuildRuinBtn: string;
  readonly pauseShopBtn: string;
  readonly resumeShopBtn: string;
  readonly marketSell: string;
  readonly marketBuy: string;
  readonly ordersLabel: string;
  readonly orderEquipTitle: string;
  readonly clearOrdersBtn: string;
  readonly transportLabel: string;
  readonly transportLevels: readonly [string, string, string];
  readonly transportUpgradeBtn: string;
  readonly transportUpgrading: (targetName: string, pct: number) => string;
  readonly statusLabels: Record<string, string>;

  // Regiment inspector
  readonly moraleLabel: string;
  readonly fatigueLabel: string;
  readonly captainAlive: string;
  readonly captainFallen: string;
  readonly veteranLabel: string;
  readonly routingLabel: string;
  readonly formations: Record<FormationKind, string>;
  readonly stances: Record<StanceKind, string>;
  readonly ranksLabel: string;
  readonly setPoseBtn: string;
  readonly setPoseHint: string;
  readonly saveFormationBtn: string;
  readonly savedFormationsLabel: string;
  readonly holdFireLabel: string;
  readonly fallbackBtn: string;
  readonly reinforceBtn: string;
  readonly refitBtn: string;
  readonly mergeBtn: string;
  readonly disbandBtn: string;
  readonly priorityHeader: string;
  readonly unitCounterHint: Record<UnitTypeId, string>;

  // Dictionaries
  readonly buildings: Record<BuildingTypeId, string>;
  readonly units: Record<UnitTypeId, string>;
  readonly goods: Record<GoodId, string>;
  readonly placementReasons: Record<PlacementRejectionReason, string>;

  // Modes, Campaign, Save/Load & End Screen
  readonly startCampaignBtn: string;
  readonly startSkirmishBtn: string;
  readonly startDefenceBtn: string;
  readonly startTutorialBtn: string;
  readonly launchMatchBtn: string;
  readonly backBtn: string;
  readonly payTributeBtn: string;
  readonly saveLoadTitle: string;
  readonly saveSlotBtn: string;
  readonly loadSlotBtn: string;
  readonly emptySlot: string;
  readonly exportJsonBtn: string;
  readonly importJsonBtn: string;
  readonly victoryTitle: string;
  readonly defeatTitle: string;
  readonly nextMissionBtn: string;
  readonly returnMenuBtn: string;
  readonly killsLabel: string;
  readonly lossesLabel: string;
  readonly timeLabel: string;
  readonly missions: Record<CampaignMissionId, MissionText>;
  readonly tutorialSteps: Record<string, string>;
  readonly waveLabel: (n: number) => string;
  readonly tributeCountdown: (sec: number) => string;
}

const EN: Strings = {
  title: 'Marchland',
  subtitle: 'Medieval Town-Builder & Tactical Regiment RTS',
  loading: 'Loading…',
  play: 'Play Skirmish',
  resume: 'Resume',
  restart: 'Restart',
  benchmark: 'Benchmark',
  benchmarkRunning: 'Running benchmark…',
  copy: 'Copy Table',
  copied: 'Copied',
  close: 'Close',
  pausedBadge: 'ACTIVE PAUSE',
  pauseBtn: 'Pause',
  playBtn: 'Play',
  menuBtn: 'Menu',
  qualityLabel: 'Graphics',
  qualityHigh: 'High',
  qualityLow: 'Low',
  qualityMinimal: 'Minimal',
  offlineDownload: (mb) => `Save offline (~${mb} MB)`,
  offlineProgress: (pct, doneMb, totalMb) => `Saving offline: ${pct}% (${doneMb}/${totalMb} MB)`,
  offlineReady: (mb) => `Ready offline (${mb} MB)`,
  offlineQuota: (doneMb, totalMb) => `Storage limit (${doneMb}/${totalMb} MB)`,
  offlineRetry: 'Offline save incomplete — tap to retry',
  difficultyLabel: 'Difficulty',
  langLabel: 'Language',
  lightingLabel: 'Lighting',
  governorLabel: 'Frame governor',
  volumeLabel: 'Volume',
  on: 'On',
  off: 'Off',
  loadedIn: (s) => `Loaded in ${s.toFixed(2)} s`,
  lightingNames: {
    clearNoon: 'Clear Noon (100k lx)',
    lateAutumn: 'Late Autumn (30°)',
    goldenHour: 'Golden Hour (12°)',
    overcast: 'Overcast (8k lx)',
  },
  mapNames: {
    crossing: 'River Crossing (M1)',
    openField: 'Open Field',
    forest: 'Ancient Forest (M2)',
    valley: 'Mountain Valley (M3–M4)',
    fortress: 'Citadel Fortress (M5)',
  },
  modeNames: {
    skirmish: 'Skirmish',
    defence: 'Defence (25m + 10 Waves)',
    tutorial: 'Tutorial (7 Steps)',
    campaign: 'Campaign (5 Missions)',
  },
  difficultyNames: {
    easy: 'Easy',
    normal: 'Medium',
    hard: 'Hard',
  },
  personalityNames: {
    builder: 'Builder (Town Economy)',
    raider: 'Raider (Fast Flanking)',
    knight: 'Knight (Heavy Cavalry & Siege)',
  },
  controlsHint: 'L-drag: select · R-click: order · R-hold+drag / Ctrl: position & facing · Shift: queue · Space: Active Pause · G: road · R: rotate · Ctrl+1–9: groups',

  tabBuild: 'Build',
  tabRecruit: 'Recruit',
  tabProduction: 'Economy',
  branchNames: {
    town: 'Town',
    materials: 'Materials',
    food: 'Food',
    craft: 'Craft',
    military: 'Military',
  },
  toolRoad: 'Cobbled Road',
  toolWall: 'Stone Wall',
  toolGate: 'Gatehouse',
  cancelTool: 'Cancel',
  rotateBtn: '↻ Rotate',
  rotateHint: 'R: Rotate · Right-click: Cancel',
  lineToolHint: 'Tap start point → tap end point',
  poseToolHint: 'Touch spot & drag finger to set facing',
  multiSelectBtn: '+ Multi',
  selectAllBtn: 'All',

  popLabel: 'Pop',
  freeCarriersLabel: 'Free',
  armyLabel: 'Army',
  upkeepUnpaid: 'UNPAID UPKEEP (-15 Morale)',
  armyStarving: 'NO FOOD (-25 Morale)',
  bottlenecksTitle: 'Bottlenecks (click to jump)',
  noBottlenecks: 'All workshops flowing smoothly.',
  prodHeaderGood: 'Good',
  prodHeaderStock: 'Stock',
  prodHeaderRate: '/min',
  prodHeaderNet: 'Net',

  levelLabel: 'Lvl',
  hpLabel: 'HP',
  residentsLabel: 'Residents',
  upgradeBtn: 'Upgrade',
  upgradeMaxLevel: (lvl) => `Max level reached (L${lvl})`,
  upgradeNeedsKeep: (lvl) => `Cannot upgrade: requires Keep L${lvl} first`,
  upgradeMissing: (list) => `Missing resources: ${list}`,
  upgradeWaitBuild: (pct) => `Finish construction (${pct}%) to upgrade`,
  upgradeInProgress: (lvl, pct) => `Upgrading → L${lvl} (${pct}%)`,
  transportLabel: 'Transport',
  transportLevels: ['On Foot (8)', 'Handcarts (14)', 'Horse & Wagon (20, +35%)'],
  transportUpgradeBtn: 'Upgrade Transport',
  transportUpgrading: (nextName, pct) => `Upgrading transport → ${nextName} (${pct}%)`,
  sawmillHint: 'Sawmill',
  demolishBtn: 'Demolish (50%)',
  rebuildRuinBtn: 'Rebuild (50%)',
  pauseShopBtn: 'Pause',
  resumeShopBtn: 'Resume',
  marketSell: 'Sell 10',
  marketBuy: 'Buy 10',
  ordersLabel: 'Orders',
  orderEquipTitle: 'Order equipment for unit (click icon):',
  clearOrdersBtn: 'Zero orders',
  statusLabels: {
    constructing: 'Constructing',
    upgrading: 'Upgrading',
    working: 'Working',
    paused: 'Paused',
    noWorker: 'No Worker',
    noInput: 'Needs Input',
    yardFull: 'Yard Full',
    idle: 'Idle',
    ruin: 'Ruin',
  },

  moraleLabel: 'Morale',
  fatigueLabel: 'Fatigue',
  captainAlive: 'Captain alive',
  captainFallen: 'Captain fallen (-1 Atk, -10 Morale)',
  veteranLabel: 'Veteran',
  routingLabel: 'ROUTING',
  formations: {
    line: 'Line',
    column: 'Column',
    schiltron: 'Schiltron',
    wedge: 'Wedge',
    loose: 'Loose',
  },
  stances: {
    hold: 'Hold',
    guard: 'Guard',
    skirmish: 'Skirmish',
    shieldWall: 'Shield Wall',
    pikeWall: 'Pike Wall',
  },
  ranksLabel: 'Ranks',
  setPoseBtn: '⌖ Set Position (Ctrl)',
  setPoseHint: 'Hold RMB + rotate mouse (or press Ctrl) to set target spot & facing direction',
  saveFormationBtn: '⚑ Save Formation',
  savedFormationsLabel: 'Formations',
  holdFireLabel: 'Hold Fire',
  fallbackBtn: 'Fall Back',
  reinforceBtn: 'Reinforce',
  refitBtn: 'Refit',
  mergeBtn: 'Merge',
  disbandBtn: 'Disband',
  priorityHeader: 'Pri.',
  unitCounterHint: {
    militia: 'Cheap home defence (115 m keep limit). Refit at Barracks later.',
    pikemen: 'Counters Light & Heavy Cavalry cleanly; weak to Swordsmen.',
    archers: '80 m indirect volleys shred Militia & unshielded foes; weak to Cavalry.',
    swordsmen: 'Counters Pikemen, Halberdiers & Militia; vulnerable to Heavy Cavalry.',
    halberdiers: 'Anti-armour & anti-cavalry polearms; no shield (weak to Crossbows).',
    crossbowmen: '60% armour-piercing bolts counter Halberdiers & heavy armour; weak to Cavalry.',
    lightCav: 'Fast flanker countering Archers, Crossbows & Siege; weak to Pikemen.',
    heavyCav: 'Devastating flank shock vs Swordsmen & Ranged; countered by Pikemen.',
    cannon: '88 m flat trajectory breaches walls & towers; protect from Cavalry.',
    mortar: '112 m high-arc siege shells over walls; minimum range 35 m.',
  },

  buildings: {
    keep: 'Keep',
    house: 'House',
    storehouse: 'Storehouse',
    market: 'Market',
    tavern: 'Tavern',
    chapel: 'Chapel',
    well: 'Well',
    woodcutter: 'Woodcutter',
    sawmill: 'Sawmill',
    forester: 'Forester',
    hunter: 'Hunter',
    quarry: 'Quarry',
    farm: 'Farm',
    fisher: 'Fisher',
    windmill: 'Windmill',
    bakery: 'Bakery',
    brewery: 'Brewery',
    pigFarm: 'Pig Farm',
    butcher: 'Butcher',
    vineyard: 'Vineyard',
    winery: 'Winery',
    tannery: 'Tannery',
    ironMine: 'Iron Mine',
    smelter: 'Smelter',
    smithy: 'Smithy',
    armourer: 'Armourer',
    fletcher: 'Fletcher',
    stable: 'Stable',
    barracks: 'Barracks',
    gunFoundry: 'Gun Foundry',
    watchtower: 'Watchtower',
    gate: 'Gatehouse',
    ruin: 'Ruined House',
    campTent: 'Bandit Camp',
  },
  units: {
    militia: 'Militia',
    pikemen: 'Pikemen',
    archers: 'Archers',
    swordsmen: 'Swordsmen',
    halberdiers: 'Halberdiers',
    crossbowmen: 'Crossbowmen',
    lightCav: 'Light Cavalry',
    heavyCav: 'Heavy Cavalry',
    cannon: 'Field Cannon',
    mortar: 'Siege Mortar',
  },
  goods: {
    gold: 'Gold',
    timber: 'Timber',
    planks: 'Planks',
    stone: 'Stone',
    grain: 'Grain',
    flour: 'Flour',
    bread: 'Bread',
    fish: 'Fish',
    meat: 'Meat',
    sausages: 'Sausages',
    hides: 'Hides',
    grapes: 'Grapes',
    wine: 'Wine',
    ale: 'Ale',
    ironOre: 'Iron Ore',
    iron: 'Iron',
    weapons: 'Weapons',
    leatherArmour: 'Leather',
    mail: 'Mail',
    bows: 'Bows',
    horses: 'Horses',
  },
  placementReasons: {
    ok: 'Valid placement',
    outOfBounds: 'Outside map border',
    water: 'Cannot build in water',
    mountain: 'Impassable mountain slope',
    tooSteep: 'Ground too steep (> 2.2 m rise)',
    outOfReach: 'Outside Keep build reach',
    tooCloseEnemyKeep: 'Too close to enemy Keep (< 90 m)',
    blocked: 'Blocked by existing structure',
    needsForest: 'Must be <= 26 m from forest',
    needsLake: 'Must be <= 16 m from water',
    needsStone: 'Must be <= 15 m from stone outcrop',
    needsOre: 'Must be <= 15 m from iron ore',
    maxBuildings: 'Building cap (64) reached',
    insufficientResources: 'Not enough gold',
  },

  startCampaignBtn: 'Campaign (5 Missions)',
  startSkirmishBtn: 'Skirmish',
  startDefenceBtn: 'Defence',
  startTutorialBtn: 'Tutorial',
  launchMatchBtn: 'Start Match',
  backBtn: 'Back',
  payTributeBtn: 'Pay Tribute (600g / 200 Bread / 40 Wpn)',
  saveLoadTitle: 'Save & Load Game',
  saveSlotBtn: 'Save',
  loadSlotBtn: 'Load',
  emptySlot: 'Empty slot',
  exportJsonBtn: 'Export JSON',
  importJsonBtn: 'Import JSON',
  victoryTitle: 'VICTORY',
  defeatTitle: 'DEFEAT',
  nextMissionBtn: 'Next Mission',
  returnMenuBtn: 'Main Menu',
  killsLabel: 'Enemy Defeated',
  lossesLabel: 'Own Losses',
  timeLabel: 'Time',
  missions: {
    1: {
      title: 'I. The Border Tribute',
      objective: 'Pay tribute (600g, 200 bread, 40 weapons) before 30:00 — or repel the invader host.',
      briefing: 'An imperial envoy demands heavy tribute across the river crossing. Build a living village economy and either deliver the tribute in time or prepare your militia and pikes at the ford.',
    },
    2: {
      title: 'II. The Dark Wood',
      objective: 'Clear the bandit camp in the eastern forest clearing.',
      briefing: 'Raiders strike our woodcutters from a fortified clearing in the ancient woods. Scout the flanks before advancing — raiding parties return to reinforce at 5 and 10 minutes.',
    },
    3: {
      title: 'III. The Valley Village',
      objective: 'Capture and hold the central valley village for 20 seconds.',
      briefing: 'Between twin rocky ridges lies the breadbasket village. Seize it before the enemy relief host marches through the eastern pass at minute 12.',
    },
    4: {
      title: 'IV. Raising the Great Host',
      objective: 'Upgrade Keep to Level 3 and muster 160 soldiers across 10 regiments.',
      briefing: 'Starting from your newly conquered central town and Keep, rebuild the ruins, expand your economy, repel small raids after minute 25, and muster an army worthy of storming the citadel.',
    },
    5: {
      title: 'V. The Citadel Donżon',
      objective: 'Breach the fortress walls and defeat the inner courtyard guard.',
      briefing: 'Your army and siege train await at the southern settlement across the river. Build up your supply base first, then cross the ford with cannons and mortars to breach the twin stone rings.',
    },
  },
  tutorialSteps: {
    buildWoodcutter: '1. Place a Woodcutter near forest trees',
    buildFarmAndHouse: '2. Build a Farm and a House for townsfolk',
    buildMillAndBakery: '3. Build a Windmill and Bakery for bread',
    buildQuarry: '4. Build a Quarry beside a pale grey Stone Outcrop (◇ on minimap)',
    recruitMilitia: '5. Recruit a Militia regiment from the Keep',
    moveRegiment: '6. Select your regiment and right-click to march',
    buildBarracks: '7. Construct a Barracks to unlock trained troops',
  },
  waveLabel: (n) => `Wave ${n} / 10`,
  tributeCountdown: (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
};

const PL: Strings = {
  title: 'Marchland',
  subtitle: 'Średniowieczna gra osadnicza i taktyczny RTS',
  loading: 'Wczytywanie…',
  play: 'Potyczka',
  resume: 'Wznów',
  restart: 'Od nowa',
  benchmark: 'Benchmark',
  benchmarkRunning: 'Trwa pomiar…',
  copy: 'Kopiuj tabelę',
  copied: 'Skopiowano',
  close: 'Zamknij',
  pausedBadge: 'AKTYWNA PAUZA',
  pauseBtn: 'Pauza',
  playBtn: 'Start',
  menuBtn: 'Menu',
  qualityLabel: 'Grafika',
  qualityHigh: 'Wysoka',
  qualityLow: 'Niska',
  qualityMinimal: 'Minimalna',
  offlineDownload: (mb) => `Zapisz offline (~${mb} MB)`,
  offlineProgress: (pct, doneMb, totalMb) => `Zapisywanie offline: ${pct}% (${doneMb}/${totalMb} MB)`,
  offlineReady: (mb) => `Gotowe offline (${mb} MB)`,
  offlineQuota: (doneMb, totalMb) => `Limit pamięci (${doneMb}/${totalMb} MB)`,
  offlineRetry: 'Niepełny zapis offline — ponów',
  difficultyLabel: 'Poziom trudności',
  langLabel: 'Język',
  lightingLabel: 'Światło',
  governorLabel: 'Regulator klatek',
  volumeLabel: 'Głośność',
  on: 'Wł.',
  off: 'Wył.',
  loadedIn: (s) => `Wczytano w ${s.toFixed(2)} s`,
  lightingNames: {
    clearNoon: 'Południe (100 tys. lx)',
    lateAutumn: 'Późne popołudnie (30°)',
    goldenHour: 'Złota godzina (12°)',
    overcast: 'Pochmurno (8 tys. lx)',
  },
  mapNames: {
    crossing: 'Przeprawa (M1)',
    openField: 'Otwarte pole',
    forest: 'Bór (M2)',
    valley: 'Dolina (M3–M4)',
    fortress: 'Twierdza (M5)',
  },
  modeNames: {
    skirmish: 'Potyczka',
    defence: 'Obrona (25 min + 10 fal)',
    tutorial: 'Samouczek (7 kroków)',
    campaign: 'Kampania (5 misji)',
  },
  difficultyNames: {
    easy: 'Łatwy',
    normal: 'Średni',
    hard: 'Trudny',
  },
  personalityNames: {
    builder: 'Gospodarz (Rozwój osady)',
    raider: 'Zagończyk (Szybkie najazdy)',
    knight: 'Rycerz (Ciężka jazda i oblężenie)',
  },
  controlsHint: 'LPM: zaznacz · PPM: rozkaz · Przytrzymaj PPM+obrót / Ctrl: pozycja i kierunek · Shift: kolejka · Spacja: Pauza · G: droga · R: obrót · Ctrl+1–9: grupy',

  tabBuild: 'Budowa',
  tabRecruit: 'Rekrutacja',
  tabProduction: 'Produkcja',
  branchNames: {
    town: 'Osada',
    materials: 'Surowce',
    food: 'Żywność',
    craft: 'Rzemiosło',
    military: 'Wojsko',
  },
  toolRoad: 'Droga brukowana',
  toolWall: 'Mur kamienny',
  toolGate: 'Brama',
  cancelTool: 'Anuluj',
  rotateBtn: '↻ Obróć',
  rotateHint: 'R: Obrót · PPM: Anuluj',
  lineToolHint: 'Stuknij start → stuknij koniec',
  poseToolHint: 'Dotknij miejsca i przeciągnij kierunek',
  multiSelectBtn: '+ Wiele',
  selectAllBtn: 'Wszystkie',

  popLabel: 'Ludność',
  freeCarriersLabel: 'Wolni',
  armyLabel: 'Wojsko',
  upkeepUnpaid: 'BRAK ŻOŁDU (-15 Morale)',
  armyStarving: 'GŁÓD WOJSKA (-25 Morale)',
  bottlenecksTitle: 'Wąskie gardła (kliknij, aby skoczyć)',
  noBottlenecks: 'Wszystkie warsztaty pracują płynnie.',
  prodHeaderGood: 'Towar',
  prodHeaderStock: 'Stan',
  prodHeaderRate: '/min',
  prodHeaderNet: 'Netto',

  levelLabel: 'Poz.',
  hpLabel: 'PZ',
  residentsLabel: 'Mieszkańcy',
  upgradeBtn: 'Ulepsz',
  upgradeMaxLevel: (lvl) => `Maksymalny poziom (P${lvl})`,
  upgradeNeedsKeep: (lvl) => `Nie można ulepszyć: wymaga Grodu Poz. ${lvl}`,
  upgradeMissing: (list) => `Brakuje surowców: ${list}`,
  upgradeWaitBuild: (pct) => `Dokończ budowę (${pct}%), aby ulepszyć`,
  upgradeInProgress: (lvl, pct) => `Trwa ulepszanie → P${lvl} (${pct}%)`,
  sawmillHint: 'Tartak',
  demolishBtn: 'Wyburz (50%)',
  rebuildRuinBtn: 'Odbuduj (50%)',
  pauseShopBtn: 'Wstrzymaj',
  resumeShopBtn: 'Wznów',
  marketSell: 'Sprzedaj 10',
  marketBuy: 'Kup 10',
  ordersLabel: 'Zamówienia',
  orderEquipTitle: 'Zamów wyposażenie dla jednostki (kliknij ikonę):',
  clearOrdersBtn: 'Zeruj zamówienia',
  transportLabel: 'Transport',
  transportLevels: ['Pieszo (8)', 'Taczki (14)', 'Wozy konne (20, +35% pr.)'],
  transportUpgradeBtn: 'Ulepsz transport',
  transportUpgrading: (name, pct) => `Ulepszanie transportu → ${name} (${pct}%)`,
  statusLabels: {
    constructing: 'W budowie',
    upgrading: 'Ulepszanie',
    working: 'Pracuje',
    paused: 'Wstrzymany',
    noWorker: 'Brak pracownika',
    noInput: 'Brak surowców',
    yardFull: 'Pełny plac',
    idle: 'Bezczynny',
    ruin: 'Ruina',
  },

  moraleLabel: 'Morale',
  fatigueLabel: 'Zmęczenie',
  captainAlive: 'Kapitan żywy',
  captainFallen: 'Kapitan poległ (-1 Atak, -10 Morale)',
  veteranLabel: 'Weteran',
  routingLabel: 'UCIEKA',
  formations: {
    line: 'Linia',
    column: 'Kolumna',
    schiltron: 'Jeż',
    wedge: 'Klin',
    loose: 'Luźny',
  },
  stances: {
    hold: 'Stój',
    guard: 'Warta',
    skirmish: 'Harcownik',
    shieldWall: 'Mur tarcz',
    pikeWall: 'Ściana pik',
  },
  ranksLabel: 'Szeregi',
  setPoseBtn: '⌖ Ustaw pozycję (Ctrl)',
  setPoseHint: 'Przytrzymaj PPM i obróć mysz (lub naciśnij Ctrl), aby ustawić miejsce i kierunek oddziału',
  saveFormationBtn: '⚑ Zapisz formację',
  savedFormationsLabel: 'Formacje',
  holdFireLabel: 'Wstrzymaj ogień',
  fallbackBtn: 'Odwrót',
  reinforceBtn: 'Uzupełnij',
  refitBtn: 'Przezbrój',
  mergeBtn: 'Połącz',
  disbandBtn: 'Rozwiąż',
  priorityHeader: 'Prio.',
  unitCounterHint: {
    militia: 'Milicja z dzidą i tarczą (limit 115 m od grodu). Przezbrój później w koszarach.',
    pikemen: 'Skórznie, pika i mniejsza tarcza — kontrują lekką i ciężką jazdę.',
    archers: 'Skórznie i długi łuk — salwy na 80 m niszczą milicję i nieosłoniętych.',
    swordsmen: 'Pełna zbroja, miecz i tarcza — dominują w walce piechoty; słabi na rycerzy.',
    halberdiers: 'Lancknechci w pełnej zbroi z długą piką i dużą tarczą — przeciw zbroi i jeździe.',
    crossbowmen: 'Skórznie i kusza — bełty przebijają 60% pancerza ciężkozbrojnych.',
    lightCav: 'Skórznie, piki, miecze i tarcze — szybkie oskrzydlenie strzelców i dział.',
    heavyCav: 'Rycerze ciężkozbrojni z kopią, mieczem i tarczą — miażdżąca szarża.',
    cannon: 'Płaski ogień 88 m burzy mury i baszty; chroń przed jazdą.',
    mortar: 'Stromy ostrzał 112 m ponad murami; minimalny zasięg 35 m.',
  },

  buildings: {
    keep: 'Gród',
    house: 'Dom',
    storehouse: 'Magazyn',
    market: 'Targ',
    tavern: 'Karczma',
    chapel: 'Kaplica',
    well: 'Studnia',
    woodcutter: 'Drwal',
    sawmill: 'Tartak',
    forester: 'Leśniczówka',
    hunter: 'Łowczy',
    quarry: 'Kamieniołom',
    farm: 'Gospodarstwo',
    fisher: 'Chata rybaka',
    windmill: 'Młyn',
    bakery: 'Piekarnia',
    brewery: 'Browar',
    pigFarm: 'Chlewnia',
    butcher: 'Rzeźnik',
    vineyard: 'Winnica',
    winery: 'Winiarnia',
    tannery: 'Garbarnia',
    ironMine: 'Kopalnia żelaza',
    smelter: 'Huta',
    smithy: 'Kuźnia',
    armourer: 'Płatnerz',
    fletcher: 'Łuczarz',
    stable: 'Stajnia',
    barracks: 'Koszary',
    gunFoundry: 'Ludwisarnia',
    watchtower: 'Baszta',
    gate: 'Brama',
    ruin: 'Ruiny domu',
    campTent: 'Obóz rozbójników',
  },
  units: {
    militia: 'Milicja',
    pikemen: 'Pikinierzy',
    archers: 'Łucznicy',
    swordsmen: 'Miecznicy',
    halberdiers: 'Halabardnicy',
    crossbowmen: 'Kusznicy',
    lightCav: 'Lekka jazda',
    heavyCav: 'Rycerze ciężkozbrojni',
    cannon: 'Działo polowe',
    mortar: 'Moździerz',
  },
  goods: {
    gold: 'Złoto',
    timber: 'Drewno',
    planks: 'Deski',
    stone: 'Kamień',
    grain: 'Zboże',
    flour: 'Mąka',
    bread: 'Chleb',
    fish: 'Ryby',
    meat: 'Mięso',
    sausages: 'Kiełbasy',
    hides: 'Skóry',
    grapes: 'Winogrona',
    wine: 'Wino',
    ale: 'Piwo',
    ironOre: 'Ruda żelaza',
    iron: 'Żelazo',
    weapons: 'Broń',
    leatherArmour: 'Skórznie',
    mail: 'Kolczugi',
    bows: 'Łuki',
    horses: 'Konie',
  },
  placementReasons: {
    ok: 'Miejsce prawidłowe',
    outOfBounds: 'Poza granicą mapy',
    water: 'Nie można budować na wodzie',
    mountain: 'Niedostępny stok górski',
    tooSteep: 'Zbyt stromy teren (> 2,2 m różnicy)',
    outOfReach: 'Poza zasięgiem grodu',
    tooCloseEnemyKeep: 'Zbyt blisko grodu wroga (< 90 m)',
    blocked: 'Miejsce zajęte przez inny obiekt',
    needsForest: 'Wymaga lasu w promieniu 26 m',
    needsLake: 'Wymaga wody w promieniu 16 m',
    needsStone: 'Wymaga skał w promieniu 15 m',
    needsOre: 'Wymaga rudy żelaza w promieniu 15 m',
    maxBuildings: 'Osiągnięto limit 64 budynków',
    insufficientResources: 'Za mało złota',
  },

  startCampaignBtn: 'Kampania (5 misji)',
  startSkirmishBtn: 'Potyczka',
  startDefenceBtn: 'Obrona',
  startTutorialBtn: 'Samouczek',
  launchMatchBtn: 'Rozpocznij grę',
  backBtn: 'Wstecz',
  payTributeBtn: 'Zapłać daninę (600 zł / 200 chleba / 40 broni)',
  saveLoadTitle: 'Zapis i wczytanie gry',
  saveSlotBtn: 'Zapisz',
  loadSlotBtn: 'Wczytaj',
  emptySlot: 'Pusty slot',
  exportJsonBtn: 'Eksport JSON',
  importJsonBtn: 'Import JSON',
  victoryTitle: 'ZWYCIĘSTWO',
  defeatTitle: 'PORAŻKA',
  nextMissionBtn: 'Następna misja',
  returnMenuBtn: 'Menu główne',
  killsLabel: 'Pokonani wrogowie',
  lossesLabel: 'Straty własne',
  timeLabel: 'Czas',
  missions: {
    1: {
      title: 'I. Danina pograniczna',
      objective: 'Zapłać daninę (600 zł, 200 chleba, 40 broni) przed 30:00 — lub odeprzyj najazd.',
      briefing: 'Wysłannik sąsiedniego pana żąda ciężkiej daniny za przeprawą. Rozbuduj żywą osadę i albo spłać daninę na czas, albo zablokuj bród pikinierami.',
    },
    2: {
      title: 'II. Mroczny Bór',
      objective: 'Zniszcz obóz rozbójników na wschodniej polanie.',
      briefing: 'Rozbójnicy nękają drwali z ufortyfikowanej polany w głębi boru. Pilnuj skrzydeł — patrole wracają na odsiecz w 5. i 10. minucie.',
    },
    3: {
      title: 'III. Osada w Dolinie',
      objective: 'Zdobądź i utrzymaj środkową osadę przez 20 sekund.',
      briefing: 'Między dwoma grzbietami leży spichlerz doliny. Zajmij osadę zanim z przełęczy wschodniej nadciągnie odsiecz w 12. minucie.',
    },
    4: {
      title: 'IV. Wielki Zaciąg',
      objective: 'Ulepsz Gród do poziomu 3 i wystaw 160 żołnierzy w 10 oddziałach.',
      briefing: 'Zaczynasz w zdobytym środkowym mieście z własnym Grodem i zapasami. Odbuduj ruiny, rozwiń gospodarkę, odeprzyj drobne najazdy po 25. minucie i wystaw wielką armię.',
    },
    5: {
      title: 'V. Donżon Twierdzy',
      objective: 'Wyłom mur twierdzy i pokonaj gwardię na wewnętrznym dziedzińcu.',
      briefing: 'Twoje oddziały i artyleria czekają przy południowej osadzie po Twojej stronie rzeki. Najpierw rozbuduj zaplecze, potem przepraw działa i moździerze i zdobądź twierdzę.',
    },
  },
  tutorialSteps: {
    buildWoodcutter: '1. Postaw Drwala obok lasu',
    buildFarmAndHouse: '2. Zbuduj Gospodarstwo i Dom dla osadników',
    buildMillAndBakery: '3. Postaw Młyn i Piekarnię do wypieku chleba',
    buildQuarry: '4. Postaw Kamieniołom przy jasnoszarych skałach kamienia (◇ na minimapie)',
    recruitMilitia: '5. Zrekrutuj Pospolite ruszenie w Grodzie',
    moveRegiment: '6. Zaznacz oddział i wyślij go PPM w marsz',
    buildBarracks: '7. Zbuduj Koszary dla wyszkolonego wojska',
  },
  waveLabel: (n) => `Fala ${n} / 10`,
  tributeCountdown: (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
};

export const STRINGS: Record<LangCode, Strings> = { en: EN, pl: PL };

export function qualityLabel(s: Strings, q: QualityPreset): string {
  if (q === 'high') return s.qualityHigh;
  if (q === 'low') return s.qualityLow;
  return s.qualityMinimal;
}

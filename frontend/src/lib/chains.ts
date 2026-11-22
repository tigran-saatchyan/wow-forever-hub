/**
 * Quest chains walked on the map, in the order to do them (stages): the priest's class quests of 50–60 (Blood
 * of Morphaz, the Dire Maul book; the Balance of Light and Shadow sits in the Benediction chain), keys, the Onyxia attunement of each faction,
 * and the original game's Molten Core, Blackwing Lair and Naxxramas chains a priest needs (not announced for
 * Forever yet). The chains added last (Scholomance key on) are marked `unverified` where a source was missing. Quest ids are the original ones, each checked against Forever's own quest data (the
 * names and texts on the pages come from there, in the page's language).
 *
 * Places are where the original game has them (zone map coordinates, 0–100); Forever keeps these zones, but
 * a coordinate can be a few points off, and some NPCs walk about (marked). NPC names the Russian client
 * spells differently from the quest titles are given in English.
 */

import { T05_CHAINS } from "./t05chain";

export type L = { ru: string; en: string };
export interface Place { who: L; map: number; x: number; y: number; note?: L }
export interface ChainStep {
  /** the quest; below zero for a step that is not a quest (a drop, putting pieces together), named by `title` */
  id: number;
  title?: L;
  /** other quest ids that count as this step (the same quest under another id) */
  alt?: number[];
  /** players the step takes, when more than one (5, 10, 20, 40) */
  size?: number;
  /** the quests of a "group" can be done in any order */
  group?: string;
  giver: Place;
  todo: L;
  /** where the work is done, when not at the giver */
  at?: Place[];
  turnin: Place;
  dungeon?: "lbrs" | "ubrs" | "brd";
  /** the lowest character level the quest can be taken at; `sure` when a source says so, else an estimate */
  min?: { level: number; sure: boolean };
}
/** The order to go through the chains in: what is needed first comes first. */
export interface Stage { n: number; name: L; note: L; announced: boolean }
export const STAGES: Stage[] = [
  { n: 1, announced: true, name: { ru: "Классовые задания (50–60)", en: "Class quests (50–60)" },
    note: { ru: "только для своего класса: начинаются с 50 уровня, награды держатся до рейдов", en: "for one's own class: they start at 50, the rewards last until the raids" } },
  { n: 2, announced: true, name: { ru: "Подземелья и ключи", en: "Dungeons and keys" },
    note: { ru: "55–60 уровень: ключи открывают двери подземелий, где одеваются к рейдам", en: "levels 55–60: keys open the dungeon doors where you gear up for the raids" } },
  { n: 3, announced: true, name: { ru: "Ониксия — 9 декабря", en: "Onyxia — 9 December" },
    note: { ru: "открывается 9 декабря вместе с Barrow Deeps и Hyjal Summit (у тех допуска нет)", en: "opens on 9 December with Barrow Deeps and Hyjal Summit (those need no attunement)" } },
  { n: 4, announced: false, name: { ru: "Огненные Недра", en: "Molten Core" },
    note: { ru: "в классике — фаза 1; цепочки из классики, квесты есть в клиенте Forever", en: "phase 1 in the original game; chains from the original game, the quests are in Forever's client" } },
  { n: 5, announced: false, name: { ru: "Логово Крыла Тьмы", en: "Blackwing Lair" },
    note: { ru: "в классике — фаза 3; допуск можно получить заранее, задание есть в клиенте", en: "phase 3 in the original game; the attunement can be done early, the quest is in the client" } },
  { n: 6, announced: false, name: { ru: "Наксрамас", en: "Naxxramas" },
    note: { ru: "в классике — фаза 6, последний рейд; задания есть в клиенте", en: "phase 6 in the original game, the last raid; the quests are in the client" } },
];

export type Category = "attune" | "key" | "rep" | "legendary" | "class" | "set";
/** What has to be in hand before a chain can be finished. `chain`: another chain done; `quest`: one quest done
 * (both checked against the character's completed quests); the rest is only told. */
export interface Need { text: L; chain?: string; quest?: number; level?: number }
export interface Chain {
  key: string; name: L; faction: "HORDE" | "ALLIANCE" | null; level: L; steps: ChainStep[];
  stage: number; category: Category;
  /** class ids the chain is for (5 = Priest); none = every class */
  classes?: number[];
  /** what it is and why do it */
  about: L;
  /** the item it ends with; `choices` when the last quest offers several to choose from (one of them) */
  reward: { item?: number; choices?: number[]; text: L };
  needs: Need[];
  /** the lowest level to start, and what the original game's phase was */
  minLevel?: number; classic?: L;
  /** group size of the hardest part */
  group?: L;
  /** what has not been checked yet (shown on the page) */
  unverified?: L;
}

// maps (UiMap ids, see maps.json)
const BADLANDS = 1418, ORGRIMMAR = 1454, DESOLACE = 1443, WPL = 1422, DUSTWALLOW = 1445, WINTERSPRING = 1452,
  SWAMP = 1435, TANARIS = 1446, WETLANDS = 1437, STEPPES = 1428, REDRIDGE = 1433, STORMWIND = 1453, ELWYNN = 1429;

/** Blackrock Mountain: Lower and Upper Blackrock Spire and Blackrock Depths all open inside it */
const BRM = (note: L): Place => ({ who: { ru: "Черная гора", en: "Blackrock Mountain" }, map: STEPPES, x: 29, y: 38, note });

const GORETOOTH: Place = { who: { ru: "Полководец Клинозуб", en: "Warlord Goretooth" }, map: BADLANDS, x: 5.8, y: 47.6, note: { ru: "Каргат, на башне", en: "Kargath, up the tower" } };
const THRALL: Place = { who: { ru: "Тралл", en: "Thrall" }, map: ORGRIMMAR, x: 31.6, y: 37.8, note: { ru: "Крепость Громмаш", en: "Grommash Hold" } };
const EITRIGG: Place = { who: { ru: "Эйтригг", en: "Eitrigg" }, map: ORGRIMMAR, x: 34.6, y: 38.6, note: { ru: "Крепость Громмаш, рядом с Траллом", en: "Grommash Hold, by Thrall" } };
const REXXAR: Place = { who: { ru: "Рексар", en: "Rexxar" }, map: DESOLACE, x: 46.4, y: 18.2, note: { ru: "ходит по дороге через Пустоши, с севера на юг и обратно; точка — где он начинает", en: "walks the road across Desolace, north to south and back; the point is where he starts" } };
const MYRANDA: Place = { who: { ru: "Myranda the Hag", en: "Myranda the Hag" }, map: WPL, x: 50.8, y: 77.8, note: { ru: "Холм Печали", en: "Sorrow Hill" } };
const EMBERSTRIFE: Place = { who: { ru: "Огнебор", en: "Emberstrife" }, map: DUSTWALLOW, x: 56.7, y: 87.7, note: { ru: "логово в Драконьей топи; войти в обличье дракона", en: "his den in the Wyrmbog; go in disguised" } };

const HELENDIS: Place = { who: { ru: "Хелендис", en: "Helendis Riverhorn" }, map: STEPPES, x: 85.8, y: 68.9, note: { ru: "Застава Моргана", en: "Morgan's Vigil" } };
const SOLOMON: Place = { who: { ru: "Мировой судья Соломон", en: "Magistrate Solomon" }, map: REDRIDGE, x: 24.9, y: 44.5, note: { ru: "Озёрное, ратуша", en: "Lakeshire town hall" } };
const BOLVAR: Place = { who: { ru: "Болвар Фордрагон", en: "Highlord Bolvar Fordragon" }, map: STORMWIND, x: 80.2, y: 38.3, note: { ru: "Крепость Штормграда", en: "Stormwind Keep" } };
const PRESTOR: Place = { who: { ru: "Леди Катрана Престор", en: "Lady Katrana Prestor" }, map: STORMWIND, x: 79.6, y: 38.9, note: { ru: "рядом с Болваром", en: "beside Bolvar" } };
const MAXWELL: Place = { who: { ru: "Маршал Максвелл", en: "Marshal Maxwell" }, map: STEPPES, x: 84.6, y: 68.6, note: { ru: "Застава Моргана", en: "Morgan's Vigil" } };
const WINDSOR = BRM({ ru: "маршал Виндзор — в тюрьме Глубин Черной горы", en: "Marshal Windsor — in the Detention Block of Blackrock Depths" });
const HALEH: Place = { who: { ru: "Haleh", en: "Haleh" }, map: WINTERSPRING, x: 54.5, y: 51.2, note: { ru: "Мазтарил: в пещеру и через портал наверх", en: "Mazthoril: into the cave, up through the portal" } };

const DRAKKISATH = BRM({ ru: "Верхняя часть пика Черной горы, последний босс — генерал Драккисат", en: "Upper Blackrock Spire, the last boss: General Drakkisath" });


const AZSHARA = 1447, EPL = 1423, SILITHUS = 1451, UNGORO = 1449, BLASTED = 1419;
const HYDRAXIS: Place = { who: { ru: "Герцог Гидраксис", en: "Duke Hydraxis" }, map: AZSHARA, x: 79.3, y: 73.7, note: { ru: "островок у юго-восточного берега", en: "a small island off the south-east coast" } };
const LOTHOS: Place = { who: { ru: "Lothos Riftwaker", en: "Lothos Riftwaker" }, map: STEPPES, x: 26.4, y: 24.5, note: { ru: "внутри Черной горы, на скале в лавовом зале, у окна в Огненные Недра", en: "inside Blackrock Mountain, on the rock in the lava hall, by the Molten Core window" } };
const LOTHOS_MC: Place = BRM({ ru: "Огненные Недра — вход через Глубины или от Lothos", en: "Molten Core — in through the Depths or from Lothos" });
const ERIS: Place = { who: { ru: "Эрис Огненный Приют", en: "Eris Havenfire" }, map: EPL, x: 17.2, y: 12.8, note: { ru: "северо-запад, у Терродейла; видна только с надетым Оком Божественности", en: "the north-west, by Terrordale; seen only wearing the Eye of Divinity" } };
const KAZZAK: Place = { who: { ru: "Владыка Каззак", en: "Lord Kazzak" }, map: BLASTED, x: 32, y: 45, note: { ru: "≈ Порченый шрам; мировой босс — рейд", en: "≈ the Tainted Scar; a world boss — a raid" } };
const DERRINGTON: Place = { who: { ru: "High Executor Derrington", en: "High Executor Derrington" }, map: WPL, x: 26.5, y: 56.0, note: { ru: "Бастион, на границе с Тирисфалем", en: "the Bulwark, on the Tirisfal border" } };
const DITHERS: Place = { who: { ru: "Apothecary Dithers", en: "Apothecary Dithers" }, map: WPL, x: 26.7, y: 56.3, note: { ru: "Бастион", en: "the Bulwark" } };
const KRINKLE: Place = { who: { ru: "Krinkle Goodsteel", en: "Krinkle Goodsteel" }, map: TANARIS, x: 51.5, y: 28.8, note: { ru: "Прибамбасск, кузнец", en: "Gadgetzan, the blacksmith" } };
const ANACHRONOS: Place = { who: { ru: "Анахронос", en: "Anachronos" }, map: TANARIS, x: 65, y: 50, note: { ru: "≈ у входа в Пещеры Времени", en: "≈ by the Caverns of Time entrance" } };

const UNDERCITY = 1458, FELWOOD = 1448, FERALAS = 1444;
const AELTHALYSTE: Place = { who: { ru: "Aelthalyste", en: "Aelthalyste" }, map: UNDERCITY, x: 49.2, y: 17.2, note: { ru: "Военный квартал, наставники жрецов; у Альянса — любой главный наставник жрецов в столице", en: "the War Quarter, the priest trainers; for the Alliance, the head priest trainer of any capital" } };
const OGTINC: Place = { who: { ru: "Ogtinc", en: "Ogtinc" }, map: AZSHARA, x: 42.4, y: 42.6, note: { ru: "на скалах к северо-востоку от руин Эльдарата", en: "atop the cliffs north-east of the Ruins of Eldarath" } };
const GRETA: Place = { who: { ru: "Greta Mosshoof", en: "Greta Mosshoof" }, map: FELWOOD, x: 51.2, y: 82.1, note: { ru: "Изумрудное святилище", en: "the Emerald Sanctuary" } };
const SUNKEN: Place = { who: { ru: "Затонувший храм", en: "The Sunken Temple" }, map: SWAMP, x: 69.5, y: 53.5, note: { ru: "вход в храм Атал'Хаккара — на острове посреди озера", en: "the way into the temple of Atal'Hakkar — the island in the middle of the lake" } };
const DIREMAUL: Place = { who: { ru: "Забытый город", en: "Dire Maul" }, map: FERALAS, x: 59, y: 44, note: { ru: "≈ вход в Забытый город, Фералас", en: "≈ the way into Dire Maul, Feralas" } };

export const CHAINS: Chain[] = [
  {
    key: "morphaz", faction: null, classes: [5], stage: 1, category: "class", minLevel: 50,
    name: { ru: "Кровь Морфаза — Благословенные чётки", en: "Blood of Morphaz — Blessed Prayer Beads" },
    about: { ru: "Классовая цепочка жреца на 50–52: от наставника жрецов к Огтинку в Азшару, две добычи по миру и Морфаз в Затонувшем храме. Награда на выбор — Благословенные чётки (аксессуар лекаря: на 20 секунд сильнее исцеление, лучшее до 60), посох Woestave или Круг надежды.", en: "The priest's class chain for 50–52: from the priest trainer to Ogtinc in Azshara, two things to gather and Morphaz in the Sunken Temple. A reward to choose: the Blessed Prayer Beads (a healer's trinket: stronger healing for 20 seconds, among the best until 60), the Woestave or the Circle of Hope." },
    reward: { item: 19990, choices: [19990, 20082, 20006], text: { ru: "на выбор: Благословенные чётки, Woestave или Круг надежды", en: "choose: Blessed Prayer Beads, the Woestave or the Circle of Hope" } },
    needs: [
      { text: { ru: "50 уровень (ForeverDB)", en: "level 50 (ForeverDB)" }, level: 50 },
      { text: { ru: "группа на Затонувший храм", en: "a group for the Sunken Temple" } },
    ],
    level: { ru: "задания 52 уровня, берутся с 50 (ForeverDB)", en: "level 52 quests, taken from 50 (ForeverDB)" },
    classic: { ru: "классика: с начала", en: "original game: from the start" }, group: { ru: "соло, Затонувший храм — 5 человек", en: "solo, the Sunken Temple — 5 players" },
    unverified: { ru: "задания, NPC и места — из ForeverDB и базы классики; где искать курсеров — по месту их появления в классике", en: "the quests, NPCs and places from ForeverDB and the original game's database; where the coursers are is where the original game puts them" },
    steps: [
      { id: 8254, giver: AELTHALYSTE, min: { level: 50, sure: true },
        todo: { ru: "Наставник жрецов отправляет к Огтинку в Азшару.", en: "The priest trainer sends you to Ogtinc in Azshara." }, turnin: OGTINC },
      { id: 8255, group: "ogtinc", giver: OGTINC,
        todo: { ru: "Добыть 4 здоровых железы курсеров: падают с Mosshoof Courser (≈ треть шанса) на севере Азшары.", en: "Get 4 Healthy Courser Glands: Mosshoof Coursers drop them (about a third of the time) in the north of Azshara." },
        at: [{ who: { ru: "Mosshoof Courser", en: "Mosshoof Courser" }, map: AZSHARA, x: 63.3, y: 16.3, note: { ru: "≈ северная Азшара", en: "≈ northern Azshara" } }], turnin: OGTINC },
      { id: 8256, group: "ogtinc", giver: OGTINC,
        todo: { ru: "Добыть Ихор нежити: падает с нежити Чумных земель (призраки, упыри, агенты Отрекшихся — около 10%).", en: "Get an Ichor of Undeath: the Plaguelands' undead drop it (wraiths, ghouls, deathstalker agents — about 10%)." },
        at: [{ who: { ru: "нежить Чумных земель", en: "the Plaguelands' undead" }, map: EPL, x: 50, y: 50, note: { ru: "≈ любая нежить Восточных или Западных Чумных земель", en: "≈ any undead of the Eastern or Western Plaguelands" } }], turnin: OGTINC },
      { id: 8257, giver: OGTINC, size: 5,
        todo: { ru: "Убить Морфаза в Затонувшем храме и отнести его кровь Грете Моховое Копыто в Оскверненный лес. Там — выбор награды.", en: "Kill Morphaz in the Sunken Temple and take his blood to Greta Mosshoof in Felwood. The reward is chosen there." },
        at: [SUNKEN], turnin: GRETA },
    ],
  },
  {
    key: "holy-bologna", faction: null, classes: [5], stage: 1, category: "class", minLevel: 54,
    name: { ru: "Книга жреца в Забытом городе", en: "The priest's book in Dire Maul" },
    about: { ru: "В Забытом городе на полках появляются пыльные тома; один из них — книга жреца «Holy Bologna». Её относят хранителю знаний Джавону в библиотеке Забытого города и получают классовую награду — в классике Королевскую печать Эльдре'Таласа (аксессуар жреца).", en: "Dusty tomes turn up on the shelves of Dire Maul; one of them is the priest's book, Holy Bologna. Bring it to Lorekeeper Javon in Dire Maul's library for a class reward — in the original game the Royal Seal of Eldre'Thalas (a priest trinket)." },
    reward: { item: 18469, text: { ru: "Королевская печать Эльдре'Таласа", en: "Royal Seal of Eldre'Thalas" } },
    needs: [
      { text: { ru: "54 уровень (ForeverDB)", en: "level 54 (ForeverDB)" }, level: 54 },
      { text: { ru: "группа на Забытый город; книга появляется не каждый заход", en: "a group for Dire Maul; the book isn't there every run" } },
    ],
    level: { ru: "задание 60 уровня, берётся с 54 (ForeverDB)", en: "a level 60 quest, taken from 54 (ForeverDB)" },
    classic: { ru: "классика: фаза 2 (Забытый город)", en: "original game: phase 2 (Dire Maul)" }, group: { ru: "5 человек", en: "5 players" },
    unverified: { ru: "награду в Forever не проверял: в классике у книг класса был выбор из нескольких вещей", en: "the reward not checked in Forever: class books gave a choice of several things in the original game" },
    steps: [
      { id: -301, title: { ru: "Найти книгу", en: "Find the book" }, giver: DIREMAUL, size: 5,
        todo: { ru: "Пройти Забытый город и осматривать «Пыльные тома» на полках: книга жреца — один из них, появляется случайно.", en: "Go through Dire Maul and look at the Dusty Tomes on the shelves: the priest's book is one of them, at random." }, turnin: DIREMAUL },
      { id: 7504, giver: DIREMAUL, min: { level: 54, sure: true },
        todo: { ru: "Отдать книгу хранителю знаний Джавону в библиотеке Забытого города.", en: "Give the book to Lorekeeper Javon in Dire Maul's library." }, turnin: DIREMAUL },
    ],
  },
  {
    key: "onyxia-horde", faction: "HORDE", stage: 3, category: "attune", minLevel: 55,
    about: { ru: "Допуск в Логово Ониксии: без Амулета Пламени дракона в сумке в рейд не пустят. Цепочка длинная — Нижняя и Верхняя части пика, четыре дракона по всему миру и Драккисат, — её стоит начать заранее, до 9 декабря.", en: "The attunement to Onyxia's Lair: without the Drakefire Amulet in your bags the raid won't let you in. A long chain — Lower and Upper Blackrock Spire, four dragons around the world and Drakkisath — worth starting well before 9 December." },
    reward: { item: 16309, text: { ru: "Амулет Пламени дракона — вход в Логово Ониксии", en: "Drakefire Amulet — entry to Onyxia's Lair" } },
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "группы на 5–10: пик и драконы", en: "groups of 5–10: the Spire and the dragons" },
    needs: [
      { text: { ru: "Печать Вознесения — ключ Верхней части пика (цепочка «Ключи Черной горы»)", en: "The Seal of Ascension — the Upper Spire key (the Keys of Blackrock Mountain chain)" }, quest: 4743 },
      { text: { ru: "55 уровень", en: "level 55" }, level: 55 },
      { text: { ru: "группа на Нижнюю и Верхнюю части пика и на трёх драконов", en: "a group for the Lower and Upper Spire and three dragons" } },
    ],
    name: { ru: "Амулет Пламени дракона (Орда)", en: "Drakefire Amulet (Horde)" },
    level: { ru: "задания 60 уровня, берутся с 55 (ForeverDB); нужны Нижняя и Верхняя части пика Черной горы", en: "level 60 quests, taken from 55 (ForeverDB); Lower and Upper Blackrock Spire" },
    steps: [
      { id: 4903, giver: GORETOOTH, dungeon: "lbrs",
        todo: { ru: "В Нижней части пика Черной горы убить вождя Омокка, воеводу Вуна и Повелителя Змейталака; доставить найденные при них документы.", en: "In Lower Blackrock Spire kill Highlord Omokk, War Master Voone and Overlord Wyrmthalak; find the Important Blackrock Documents (they lie somewhere in the Lower Spire)." },
        at: [BRM({ ru: "Нижняя часть пика", en: "Lower Blackrock Spire" })], turnin: GORETOOTH },
      { id: 4941, giver: GORETOOTH, todo: { ru: "Отправиться в Оргриммар и выслушать Эйтригга, потом поговорить с Траллом.", en: "Go to Orgrimmar and hear Eitrigg out, then speak to Thrall." }, at: [EITRIGG], turnin: THRALL },
      { id: 4974, giver: THRALL, dungeon: "ubrs",
        todo: { ru: "В Верхней части пика Черной горы убить вождя Ренда Чернорука и принести его голову.", en: "In Upper Blackrock Spire kill Warchief Rend Blackhand and bring his head." },
        at: [BRM({ ru: "Верхняя часть пика", en: "Upper Blackrock Spire" })], turnin: THRALL },
      { id: 6566, giver: THRALL, todo: { ru: "Выслушать Тралла.", en: "Hear Thrall out." }, turnin: THRALL },
      { id: 6567, giver: THRALL, todo: { ru: "Найти Рексара в Пустошах.", en: "Find Rexxar in Desolace." }, turnin: REXXAR },
      { id: 6568, giver: REXXAR, todo: { ru: "Отнести завет Рексара Миранде в Западные Чумные земли.", en: "Take Rexxar's testament to Myranda in the Western Plaguelands." }, turnin: MYRANDA },
      { id: 6569, giver: MYRANDA, dungeon: "ubrs",
        todo: { ru: "Собрать 20 глаз черных драконидов: падают с черных драконидов в пике Черной горы. Миранда даст амулет-обличье.", en: "Gather 20 Black Dragonspawn Eyes from the black dragonspawn in Blackrock Spire. Myranda makes a disguise of them." },
        at: [BRM({ ru: "пик Черной горы, черные дракониды", en: "Blackrock Spire, the black dragonspawn" })], turnin: MYRANDA },
      { id: 6570, giver: MYRANDA, todo: { ru: "С амулетом-обличьем прийти к Огнебору в Пылевые топи и поговорить с ним.", en: "Wear the disguise and speak to Emberstrife in Dustwallow Marsh." }, turnin: EMBERSTRIFE },
      ...[
        { id: 6582, at: { who: { ru: "Провидец", en: "Scryer" }, map: WINTERSPRING, x: 55, y: 53, note: { ru: "в глубине пещеры Мазтарил с синими драконидами, к юго-западу от Круговзора; руна на полу переносит наверх — не наступайте в бою", en: "in the back of the Mazthoril cave of blue dragonkin, south-west of Everlook; a rune on the floor sends you up — keep off it in the fight" } } },
        { id: 6583, at: { who: { ru: "Сомнус", en: "Somnus" }, map: SWAMP, x: 70, y: 50, note: { ru: "бродит вокруг озера Затонувшего храма; усыпляет — самый трудный из трёх", en: "walks around the lake of the Sunken Temple; puts people to sleep — the hardest of the three" } } },
        { id: 6584, at: { who: { ru: "Изменяющий время Хроналис", en: "Chronalis" }, map: TANARIS, x: 64, y: 50, note: { ru: "бронзовый дракон, охраняет Пещеры Времени", en: "a bronze dragon at the Caverns of Time" } } },
        { id: 6585, at: { who: { ru: "Военачальник Акстроз", en: "Axtroz" }, map: WETLANDS, x: 66, y: 70, note: { ru: "вожак красных драконов над горами Грим Батола", en: "a red dragon by Grim Batol" } } },
      ].map((s) => ({
        id: s.id, group: s.id === 6585 ? undefined : "skulls", giver: EMBERSTRIFE, at: [s.at], turnin: EMBERSTRIFE,
        todo: s.id === 6585
          ? { ru: "Огнебор даёт это задание, когда сданы три первых черепа. Убить военачальника Акстроза над горами Грим Батола и принести его череп. Нужна группа.", en: "Emberstrife gives this one once the first three skulls are in. Kill Axtroz above Grim Batol and bring his skull. Take a group." }
          : { ru: `Убить дракона (${s.at.who.ru}) и принести его череп Огнебору. Три черепа берутся вместе. Нужна группа.`, en: `Kill the dragon (${s.at.who.en}) and bring its skull to Emberstrife. The three skulls are taken together. Take a group.` },
      })),
      { id: 6601, giver: EMBERSTRIFE, todo: { ru: "Отнести Тусклый амулет Пламени дракона Рексару.", en: "Take the Dull Drakefire Amulet to Rexxar." }, turnin: REXXAR },
      { id: 6602, giver: REXXAR, dungeon: "ubrs",
        todo: { ru: "Убить генерала Драккисата в Верхней части пика Черной горы и принести Кровь могучего черного дракона. Рексар отдаст Амулет Пламени дракона.", en: "Kill General Drakkisath in Upper Blackrock Spire and bring the Blood of the Black Dragon Champion. Rexxar hands over the Drakefire Amulet." },
        at: [DRAKKISATH], turnin: REXXAR },
    ],
  },
  {
    key: "onyxia-alliance", faction: "ALLIANCE", stage: 3, category: "attune",
    about: { ru: "Допуск в Логово Ониксии: без Амулета Пламени дракона в сумке в рейд не пустят. Цепочка длинная — Нижняя и Верхняя части пика, четыре дракона по всему миру и Драккисат, — её стоит начать заранее, до 9 декабря.", en: "The attunement to Onyxia's Lair: without the Drakefire Amulet in your bags the raid won't let you in. A long chain — Lower and Upper Blackrock Spire, four dragons around the world and Drakkisath — worth starting well before 9 December." },
    reward: { item: 16309, text: { ru: "Амулет Пламени дракона — вход в Логово Ониксии", en: "Drakefire Amulet — entry to Onyxia's Lair" } },
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "группы на 5–10: пик и драконы", en: "groups of 5–10: the Spire and the dragons" },
    needs: [
      { text: { ru: "Печать Вознесения — ключ Верхней части пика", en: "The Seal of Ascension — the Upper Spire key" }, quest: 4743 },
      { text: { ru: "группа на Глубины и Верхнюю часть пика", en: "a group for the Depths and the Upper Spire" } },
    ],
    name: { ru: "Амулет Пламени дракона (Альянс)", en: "Drakefire Amulet (Alliance)" },
    level: { ru: "задания 60 уровня; с какого уровня берётся первое — источника нет; нужны Глубины и Верхняя часть пика Черной горы", en: "level 60 quests; no source gives the level the first one is taken at; Blackrock Depths and Upper Blackrock Spire" },
    steps: [
      { id: 4182, giver: HELENDIS, todo: { ru: "В Пылающих степях убить 15 черных драконидов, 10 черных змеевиков и 4 черных дракона.", en: "In the Burning Steppes kill 15 Black Dragonspawn, 10 Black Wyrmkin and 4 Black Drakes." },
        at: [{ who: { ru: "черные дракониды", en: "black dragonkin" }, map: STEPPES, x: 70, y: 50, note: { ru: "по всей восточной половине степей", en: "all over the eastern Steppes" } }], turnin: HELENDIS },
      { id: 4183, giver: HELENDIS, todo: { ru: "Отнести донесение мировому судье Соломону в Озёрное.", en: "Take the report to Magistrate Solomon in Lakeshire." }, turnin: SOLOMON },
      { id: 4184, giver: SOLOMON, todo: { ru: "Отнести письмо Болвару Фордрагону в Штормград.", en: "Take the letter to Bolvar Fordragon in Stormwind." }, turnin: BOLVAR },
      { id: 4185, giver: BOLVAR, todo: { ru: "Поговорить с леди Катраной Престор и вернуться к Болвару.", en: "Speak to Lady Katrana Prestor and go back to Bolvar." }, at: [PRESTOR], turnin: BOLVAR },
      { id: 4186, giver: BOLVAR, todo: { ru: "Вернуться к мировому судье Соломону.", en: "Go back to Magistrate Solomon." }, turnin: SOLOMON },
      { id: 4223, giver: SOLOMON, todo: { ru: "Отнести письмо маршалу Максвеллу на заставу Моргана.", en: "Take the letter to Marshal Maxwell at Morgan's Vigil." }, turnin: MAXWELL },
      { id: 4224, giver: MAXWELL, todo: { ru: "Найти Джона-Оборванца в пещере к северу от заставы и выслушать его.", en: "Find Ragged John in the north of the Burning Steppes and hear his story." },
        at: [{ who: { ru: "Джон-Оборванец", en: "Ragged John" }, map: STEPPES, x: 65, y: 23.6 }], turnin: MAXWELL },
      { id: 4241, giver: MAXWELL, todo: { ru: "Джон-Оборванец говорит, что Виндзор жив: найти его в Глубинах Черной горы.", en: "Ragged John says Windsor lives: find him in Blackrock Depths." }, dungeon: "brd", turnin: WINDSOR },
      { id: 4242, giver: WINDSOR, todo: { ru: "Вернуться к маршалу Максвеллу.", en: "Go back to Marshal Maxwell." }, turnin: MAXWELL },
      { id: 4264, giver: { who: { ru: "записка из Глубин", en: "a note from the Depths" }, map: STEPPES, x: 29, y: 38, note: { ru: "падает с Черного Железа в Глубинах Черной горы", en: "dropped by Dark Iron dwarves in Blackrock Depths" } },
        dungeon: "brd", todo: { ru: "Измятая записка падает в Глубинах Черной горы; отнести её Виндзору.", en: "The Crumpled Up Note drops in Blackrock Depths; take it to Windsor." }, turnin: WINDSOR },
      { id: 4282, giver: WINDSOR, dungeon: "brd",
        todo: { ru: "В Глубинах Черной горы убить генерала Кузню Гнева и повелителя големов Аргелмаха и вернуть Виндзору утерянную информацию.", en: "In Blackrock Depths take Windsor's lost information from General Angerforge and Golem Lord Argelmach." },
        at: [BRM({ ru: "Глубины Черной горы", en: "Blackrock Depths" })], turnin: WINDSOR },
      { id: 4322, giver: WINDSOR, dungeon: "brd",
        todo: { ru: "Вызволить маршала Виндзора из тюрьмы Глубин Черной горы и провести его к выходу.", en: "Free Marshal Windsor from the Detention Block of Blackrock Depths and lead him out." },
        at: [BRM({ ru: "Глубины Черной горы, тюрьма", en: "Blackrock Depths, the Detention Block" })], turnin: MAXWELL },
      { id: 6402, giver: MAXWELL, todo: { ru: "Встретиться с Виндзором у ворот Штормграда (оруженосец Роу ждёт там же). Возьмите группу.", en: "Meet Windsor at the gates of Stormwind (Squire Rowe waits there). Bring a group." },
        turnin: { who: { ru: "Squire Rowe", en: "Squire Rowe" }, map: ELWYNN, x: 32, y: 49, note: { ru: "у моста к воротам Штормграда", en: "by the bridge to Stormwind's gates" } } },
      { id: 6403, giver: { who: { ru: "Squire Rowe", en: "Squire Rowe" }, map: ELWYNN, x: 32, y: 49 },
        todo: { ru: "Пройти с Реджинальдом Виндзором в крепость и увидеть, кто такая леди Престор на самом деле.", en: "Walk with Reginald Windsor into the Keep and see who Lady Prestor really is." }, at: [BOLVAR], turnin: BOLVAR },
      { id: 6501, giver: BOLVAR, todo: { ru: "Отнести Око дракона Хейле в Мазтарил, Зимние Ключи.", en: "Take the Dragon's Eye to Haleh in Mazthoril, Winterspring." }, turnin: HALEH },
      { id: 6502, giver: HALEH, dungeon: "ubrs",
        todo: { ru: "Убить генерала Драккисата в Верхней части пика Черной горы и принести Кровь могучего черного дракона. Хейла отдаст Амулет Пламени дракона.", en: "Kill General Drakkisath in Upper Blackrock Spire and bring the Blood of the Black Dragon Champion. Haleh hands over the Drakefire Amulet." },
        at: [DRAKKISATH], turnin: HALEH },
    ],
  },
  {
    key: "keys", faction: null, stage: 2, category: "key", minLevel: 55,
    about: { ru: "Два ключа Черной горы. Печать Вознесения открывает Верхнюю часть пика — без неё не пройти цепочку на Ониксию. Ключ Тенегорна открывает двери Глубин Черной горы: быстрее проходить подземелье и собирать вещи.", en: "The two keys of Blackrock Mountain. The Seal of Ascension opens Upper Blackrock Spire — the Onyxia chain can't be done without it. The Shadowforge Key opens the doors of Blackrock Depths: faster runs and gear." },
    reward: { item: 12344, text: { ru: "Печать Вознесения и Ключ Тенегорна", en: "Seal of Ascension and Shadowforge Key" } },
    needs: [{ text: { ru: "группа на Нижнюю часть пика и Глубины", en: "a group for the Lower Spire and the Depths" } }],
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "5 человек", en: "5 players" },
    name: { ru: "Ключи Черной горы", en: "Keys of Blackrock Mountain" },
    level: { ru: "с 55–58 уровня, внутри Нижней части пика и Глубин", en: "from level 55–58, inside the Lower Spire and the Depths" },
    steps: [
      { id: 4743, giver: BRM({ ru: "Vaelan, у входа в Нижнюю часть пика", en: "Vaelan, at the entrance of the Lower Spire" }), dungeon: "lbrs",
        todo: { ru: "Последний шаг цепочки Ваэлана (самоцветы у боссов Нижней части пика): у Огнебора в Пылевых топях сломить его волю сферой и успеть закалить печать в его дыхании. Печать Вознесения открывает Верхнюю часть пика.", en: "The last step of Vaelan's chain (gemstones from Lower Spire bosses): at Emberstrife in Dustwallow break his will with the orb and temper the seal in his breath. The Seal of Ascension opens Upper Blackrock Spire." },
        at: [EMBERSTRIFE], turnin: BRM({ ru: "Vaelan", en: "Vaelan" }) },
      { id: 3802, giver: BRM({ ru: "дух Franclorn Forgewright — виден призраком у моста над лавой", en: "the ghost of Franclorn Forgewright — seen as a spirit by the bridge above the lava" }), dungeon: "brd",
        todo: { ru: "В Глубинах Черной горы убить Точня Темностроя (за Кольцом Закона, в Зале Ремесла), забрать Железного Друга и вложить его в руки статуи в святилище Тауриссана: в тайнике — Ключ Тенегорна, он открывает двери Глубин.", en: "In Blackrock Depths kill Pyromancer Loregrain (past the Ring of Law, in the Hall of Crafting), take Ironfel and place it in the statue's hands in the Shrine of Thaurissan: the hidden compartment holds the Shadowforge Key, which opens the Depths' doors." },
        at: [BRM({ ru: "Глубины Черной горы", en: "Blackrock Depths" })], turnin: BRM({ ru: "святилище Тауриссана", en: "the Shrine of Thaurissan" }) },
    ],
  },
  {
    key: "scholo-key", faction: "HORDE", stage: 2, category: "key", minLevel: 55,
    name: { ru: "Ключ от Некроситета (Орда)", en: "The Key to Scholomance (Horde)" },
    about: { ru: "Скелетный ключ открывает дверь Некроситета без разбойника и сефориевых зарядов. Некроситет — одно из лучших подземелий для претир-вещей жреца (часть комплекта Хранителя Тайн и не только). Цепочка у Бастиона на границе Тирисфаля: лагеря Алого ордена и башни в Западных Чумных землях, слепок в Прибамбасске, ковка на Огненном Венце в Ун'Горо и Арадж Призыватель в Андорале.", en: "The Skeleton Key opens Scholomance's door without a rogue or Seaforium charges. Scholomance is one of the best dungeons for a priest's pre-raid gear. The chain starts at the Bulwark on the Tirisfal border: Scarlet camps and towers in the Western Plaguelands, a mold in Gadgetzan, forging at Fire Plume Ridge in Un'Goro, and Araj the Summoner in Andorhal." },
    reward: { item: 13704, text: { ru: "Скелетный ключ — вход в Некроситет", en: "Skeleton Key — entry to Scholomance" } },
    needs: [
      { text: { ru: "Арканитовый слиток и 15 золотых для слепка", en: "an Arcanite Bar and 15 gold for the mold" } },
      { text: { ru: "ториевые слитки для ковки (сколько — не проверено)", en: "Thorium Bars for the forging (how many — not checked)" } },
      { text: { ru: "группа на 5 для Араджа Призывателя", en: "a group of 5 for Araj the Summoner" } },
    ],
    level: { ru: "задания 53–60 уровня; с какого уровня берутся — источники не сходятся", en: "quests of level 53–60; the sources disagree on the level they open at" },
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "соло, Арадж — 5 человек", en: "solo, Araj — 5 players" },
    unverified: { ru: "номера, порядок и кто выдаёт — сверены с ForeverDB; места лагерей, башен и скелетов — примерные", en: "ids, order and who gives them are checked against ForeverDB; the camps', towers' and skeletons' spots are approximate" },
    steps: [
      { id: 5096, giver: DERRINGTON, todo: { ru: "Сжечь командный шатёр Алого ордена и поставить знамя Орды в их лагере в Западных Чумных землях.", en: "Burn a Scarlet Crusade command tent and plant the Horde standard at their camp in the Western Plaguelands." },
        at: [{ who: { ru: "лагерь Алого ордена", en: "the Scarlet camp" }, map: WPL, x: 40, y: 52, note: { ru: "≈ место по памяти", en: "≈ the spot is from memory" } }], turnin: DERRINGTON },
      { id: 5098, giver: DERRINGTON, todo: { ru: "Пометить факелом четыре сторожевые башни Плети вокруг Андорала.", en: "Mark the four Scourge watchtowers around Andorhal with a Beacon Torch." },
        at: [{ who: { ru: "башни вокруг Андорала", en: "the towers around Andorhal" }, map: WPL, x: 44, y: 66, note: { ru: "≈", en: "≈" } }], turnin: DERRINGTON },
      { id: 838, giver: DERRINGTON, todo: { ru: "Поговорить с аптекарем Dithers в двух шагах.", en: "Speak to Apothecary Dithers a few steps away." }, turnin: DITHERS },
      { id: 964, giver: DITHERS, todo: { ru: "Собрать 15 фрагментов скелетов с нежити-скелетов в Западных Чумных землях.", en: "Collect 15 Skeletal Fragments from skeletal undead in the Western Plaguelands." },
        at: [{ who: { ru: "скелеты", en: "skeletons" }, map: WPL, x: 50, y: 60, note: { ru: "≈ где именно падают — не сверено", en: "≈ where exactly they drop — not checked" } }], turnin: DITHERS },
      { id: 5514, giver: DITHERS, todo: { ru: "Отнести заряженные фрагменты, арканитовый слиток и 15 золотых Krinkle Goodsteel в Прибамбасск: он сделает слепок ключа.", en: "Take the Imbued Skeletal Fragments, an Arcanite Bar and 15 gold to Krinkle Goodsteel in Gadgetzan for a key mold." }, turnin: KRINKLE },
      { id: 5802, giver: KRINKLE, todo: { ru: "Со слепком и ториевыми слитками подняться к лавовому озеру на вершине Огненного Венца в Ун'Горо, выковать заготовку и отнести её Dithers.", en: "Take the mold and Thorium Bars to the lava lake atop Fire Plume Ridge in Un'Goro, forge the key blank and bring it to Dithers." },
        at: [{ who: { ru: "Огненный Венец, лавовое озеро на вершине", en: "Fire Plume Ridge, the lava lake on top" }, map: UNGORO, x: 50, y: 47 }], turnin: DITHERS },
      { id: 5804, giver: DITHERS, size: 5, todo: { ru: "Убить Араджа Призывателя в центре Андорала и принести Скарабея Араджа.", en: "Kill Araj the Summoner in the middle of Andorhal and bring Araj's Scarab." },
        at: [{ who: { ru: "Арадж Призыватель", en: "Araj the Summoner" }, map: WPL, x: 45, y: 69, note: { ru: "центр Андорала, элитный — нужна группа", en: "the middle of Andorhal, elite — take a group" } }], turnin: DITHERS },
      { id: 5511, giver: DERRINGTON, todo: { ru: "Вернуться к верховному палачу Деррингтону: Скелетный ключ готов.", en: "Go back to High Executor Derrington: the Skeleton Key is ready." }, turnin: DERRINGTON },
    ],
  },
  {
    key: "mc-attune", faction: null, stage: 4, category: "attune", minLevel: 55,
    name: { ru: "Допуск к Огненным Недрам", en: "Attunement to the Core" },
    about: { ru: "Одно задание: осколок ядра из глубины Глубин Черной горы. После него Lothos Riftwaker в Черной горе переносит прямо ко входу в Огненные Недра — не надо каждый раз идти через все Глубины. В классике нужен каждому рейдеру ОН; без него цепочки Гидраксиса и Благословения теряют смысл.", en: "One quest: a Core Fragment from deep inside Blackrock Depths. Afterwards Lothos Riftwaker in Blackrock Mountain teleports you straight to the Molten Core entrance, no walk through the Depths each time. Every Molten Core raider needed it in the original game." },
    reward: { text: { ru: "Допуск к Огненным Недрам: телепорт от Lothos Riftwaker", en: "Attunement to Molten Core: Lothos Riftwaker's teleport" } },
    needs: [{ text: { ru: "группа на 5 в Глубины Черной горы, до самого входа в Недра", en: "a group of 5 into Blackrock Depths, all the way to the Core's entrance" } }],
    level: { ru: "задание 60 уровня, берётся с 55", en: "a level 60 quest, taken from 55" },
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "5 человек", en: "5 players" },
    unverified: { ru: "сверено с ForeverDB (данные классики, задание есть в Forever)", en: "checked against ForeverDB (the original game's data; the quest is in Forever)" },
    steps: [
      { id: 7848, giver: LOTHOS, dungeon: "brd", size: 5, todo: { ru: "Пройти Глубины Черной горы до входа в Огненные Недра и взять осколок ядра; вернуться к Lothos.", en: "Go through Blackrock Depths to the Molten Core entrance and take a Core Fragment; go back to Lothos." },
        at: [BRM({ ru: "Глубины Черной горы, у входа в Огненные Недра", en: "Blackrock Depths, by the Molten Core entrance" })], turnin: LOTHOS, min: { level: 55, sure: false } },
    ],
  },
  {
    key: "hydraxis", faction: null, stage: 4, category: "rep", minLevel: 55,
    name: { ru: "Гидраксианские Повелители Вод", en: "Hydraxian Waterlords" },
    about: { ru: "Герцог Гидраксис на острове у Азшары воюет с Рагнаросом. Его цепочка ведёт в Чумные земли, Силитус, Верхнюю часть пика и в сами Огненные Недра. Главное — Акватическая квинтэссенция (с «Уважения»): ей тушат семь огненных рун в ОН, и только когда потушены все семь, появляется Мажордом Экзекутус. Без этого рейд не дойдёт до Рагнароса. На «Почтении» герцог даёт многоразовую Вечную квинтэссенцию. Работа для одного-двух человек рейда — жрецу по силам.", en: "Duke Hydraxis on an island off Azshara is at war with Ragnaros. His chain goes to the Plaguelands, Silithus, Upper Blackrock Spire and Molten Core itself. The point is the Aqual Quintessence (from Honored): it douses the seven fire runes in Molten Core, and only when all seven are out does Majordomo Executus appear. At Revered the Duke gives the reusable Eternal Quintessence." },
    reward: { item: 17333, text: { ru: "Акватическая квинтэссенция (с «Уважения»), Вечная (с «Почтения»), кольцо", en: "Aqual Quintessence (Honored), Eternal Quintessence (Revered), a ring" } },
    needs: [
      { text: { ru: "Допуск к Огненным Недрам", en: "Attunement to the Core" }, chain: "mc-attune" },
      { text: { ru: "доступ в Верхнюю часть пика (Печать Вознесения у кого-то в группе)", en: "access to Upper Blackrock Spire (someone in the group with the Seal of Ascension)" } },
      { text: { ru: "«Уважение» у Гидраксианских Повелителей Вод: убийства в Огненных Недрах", en: "Honored with the Hydraxian Waterlords: kills in Molten Core" } },
    ],
    level: { ru: "задания 60 уровня, первые — с 55", en: "level 60 quests, the first from 55" },
    classic: { ru: "классика: фаза 1", en: "original game: phase 1" }, group: { ru: "соло, ВЧС 10, рейд 40", en: "solo, UBRS 10, raid 40" },
    unverified: { ru: "номера и порядок сверены с ForeverDB; сколько кого убить, награды и места элементалей — по памяти", en: "ids and order checked against ForeverDB; the kill counts, rewards and the elementals' spots are from memory" },
    steps: [
      { id: 6804, group: "hydra-start", giver: HYDRAXIS, todo: { ru: "Убить испорченных водных элементалей и чумных тварей в Восточных Чумных землях.", en: "Kill corrupted water elementals and plague beasts in the Eastern Plaguelands." },
        at: [{ who: { ru: "испорченные элементали", en: "corrupted elementals" }, map: EPL, x: 50, y: 50, note: { ru: "≈ место не сверено", en: "≈ the spot is not checked" } }], turnin: HYDRAXIS, min: { level: 55, sure: true } },
      { id: 6805, group: "hydra-start", giver: HYDRAXIS, todo: { ru: "Убить пылевых буревестников и пустынных громыхателей в Силитусе.", en: "Kill Dust Stormers and Desert Rumblers in Silithus." },
        at: [{ who: { ru: "элементали пустыни", en: "desert elementals" }, map: SILITHUS, x: 40, y: 40, note: { ru: "бродят по открытой пустыне", en: "roam the open desert" } }], turnin: HYDRAXIS, min: { level: 57, sure: false } },
      { id: 6821, giver: HYDRAXIS, dungeon: "ubrs", size: 10, todo: { ru: "Убить Пиростража Огнеглаза в Верхней части пика и принести его глаз.", en: "Kill Pyroguard Emberseer in Upper Blackrock Spire and bring his eye." },
        at: [BRM({ ru: "Верхняя часть пика, первый босс", en: "Upper Blackrock Spire, the first boss" })], turnin: HYDRAXIS },
      { id: 6822, giver: HYDRAXIS, size: 40, todo: { ru: "В Огненных Недрах убить повелителя огня, огненного великана, древнюю гончую Недр и лавового волнореза.", en: "In Molten Core kill a Fire Lord, a Molten Giant, an Ancient Core Hound and a Lava Surger." },
        at: [LOTHOS_MC], turnin: HYDRAXIS },
      { id: 6823, giver: HYDRAXIS, todo: { ru: "Заработать «Уважение» у Гидраксианских Повелителей Вод (убийства в Огненных Недрах) и поговорить с герцогом.", en: "Reach Honored with the Hydraxian Waterlords (kills in Molten Core) and speak to the Duke." }, turnin: HYDRAXIS, min: { level: 60, sure: false } },
      { id: 6824, giver: HYDRAXIS, size: 40, todo: { ru: "Снять руки Люцифрона, Предвестника Сульфурона, Гееннаса и Шаззраха в Огненных Недрах.", en: "Take the hands of Lucifron, Sulfuron Harbinger, Gehennas and Shazzrah in Molten Core." },
        at: [LOTHOS_MC], turnin: HYDRAXIS },
      { id: 7486, giver: HYDRAXIS, todo: { ru: "Поговорить с герцогом; награда — в сундуке Гидраксиса рядом с ним.", en: "Speak to the Duke; the reward is in Hydraxis' Coffer beside him." },
        turnin: { who: { ru: "сундук Гидраксиса", en: "Hydraxis' Coffer" }, map: AZSHARA, x: 79.2, y: 74.9 } },
      { id: -101, title: { ru: "Акватическая квинтэссенция", en: "Aqual Quintessence" }, giver: HYDRAXIS, size: 40,
        todo: { ru: "С «Уважения» попросить у герцога квинтэссенцию и потушить ей руну у босса в Огненных Недрах. Одноразовая, при себе только одна — за следующей снова к герцогу. На «Почтении» — многоразовая Вечная.", en: "From Honored ask the Duke for a quintessence and douse a boss rune with it in Molten Core. Single use, one at a time — back to the Duke for the next. At Revered: the reusable Eternal one." },
        at: [LOTHOS_MC], turnin: HYDRAXIS },
    ],
  },
  {
    key: "benediction", faction: null, classes: [5], stage: 4, category: "legendary", minLevel: 60,
    name: { ru: "Благословение / Анафема", en: "Benediction / Anathema" },
    about: { ru: "Эпический посох жреца: Благословение лечит, а в Анафему (посох Тьмы) превращается одним щелчком (раз в 30 минут). Нужны три части: Око Божественности из Тайника Повелителя Огня после Мажордома в Огненных Недрах (только для жрецов), Око Тени с Владыки Каззака или элитных демонов (продаётся) и Щепка Нордрассила — награда Эрис Огненный Приют за испытание в Восточных Чумных землях: спасти 50 крестьян, пока не погибнут 15. Испытание — в одиночку.", en: "The priest's epic staff: Benediction heals and turns into Anathema (a shadow staff) with a click (every 30 minutes). Three pieces: the Eye of Divinity from Majordomo's Cache of the Firelord in Molten Core (priests only), the Eye of Shadow from Lord Kazzak or elite demons (tradeable) and the Splinter of Nordrassil — Eris Havenfire's reward for her trial in the Eastern Plaguelands: save 50 peasants before 15 die. The trial is solo." },
    reward: { item: 18608, text: { ru: "Благословение / Анафема", en: "Benediction / Anathema" } },
    needs: [
      { text: { ru: "Допуск к Огненным Недрам", en: "Attunement to the Core" }, chain: "mc-attune" },
      { text: { ru: "рейд, который тушит руны и убивает Мажордома (Гидраксианы)", en: "a raid that douses the runes and kills Majordomo (the Hydraxians)" }, chain: "hydraxis" },
      { text: { ru: "Око Тени — с Каззака или купить на аукционе", en: "the Eye of Shadow — from Kazzak or the auction house" } },
      { text: { ru: "60 уровень", en: "level 60" }, level: 60 },
    ],
    level: { ru: "60 уровень", en: "level 60" },
    classic: { ru: "классика: фаза 1 (Каззак — фаза 2)", en: "original game: phase 1 (Kazzak — phase 2)" }, group: { ru: "рейд 40, испытание — соло", en: "raid 40, the trial — solo" },
    unverified: { ru: "задания и место Эрис сверены с ForeverDB; где падает Око Тени — по памяти", en: "the quests and Eris's spot checked against ForeverDB; where the Eye of Shadow drops is from memory" },
    steps: [
      { id: -201, title: { ru: "Око Божественности", en: "The Eye of Divinity" }, giver: LOTHOS_MC, size: 40,
        todo: { ru: "Убить Мажордома Экзекутуса в Огненных Недрах: в Тайнике Повелителя Огня жрецу может выпасть Око Божественности. Надеть его (аксессуар) — тогда видна Эрис.", en: "Kill Majordomo Executus in Molten Core: a priest may get the Eye of Divinity from the Cache of the Firelord. Wear it (a trinket) to see Eris." }, turnin: LOTHOS_MC },
      { id: 7621, giver: ERIS, todo: { ru: "С надетым Оком найти Эрис Огненный Приют и выслушать её.", en: "Wearing the Eye, find Eris Havenfire and hear her out." }, turnin: ERIS },
      { id: 7622, giver: ERIS, todo: { ru: "Защитить бегущих крестьян от Плети: спасти 50, пока не погибнут 15. Только в одиночку. Награда — Щепка Нордрассила.", en: "Protect the fleeing peasants from the Scourge: save 50 before 15 die. Alone only. Reward: the Splinter of Nordrassil." }, turnin: ERIS },
      { id: -202, title: { ru: "Око Тени", en: "The Eye of Shadow" }, giver: KAZZAK, size: 40,
        todo: { ru: "Око Тени падает с Владыки Каззака и, редко, с элитных демонов высокого уровня; его можно купить на аукционе.", en: "The Eye of Shadow drops from Lord Kazzak and, rarely, high-level elite demons; it can be bought on the auction house." }, turnin: KAZZAK },
      { id: -203, title: { ru: "Собрать посох", en: "Put the staff together" }, giver: ERIS,
        todo: { ru: "Соединить Щепку Нордрассила, Око Божественности и Око Тени — получится Благословение. Щелчок по нему превращает его в Анафему и обратно.", en: "Combine the Splinter of Nordrassil, the Eye of Divinity and the Eye of Shadow into Benediction. Clicking it turns it into Anathema and back." }, turnin: ERIS },
    ],
  },
  {
    key: "bwl-attune", faction: null, stage: 5, category: "attune", minLevel: 55,
    name: { ru: "Приказ Чернорука", en: "Blackhand's Command" },
    about: { ru: "Допуск в Логово Крыла Тьмы. Записку «Приказ Чернорука» роняет интендант Щитоносцев снаружи пика в самой Черной горе; она начинает задание. Нужно пройти Верхнюю часть пика, убить генерала Драккисата и коснуться Клейма Драккисата за ним. После этого Сфера Повиновения в Черной горе переносит прямо в Логово.", en: "The attunement to Blackwing Lair. The Scarshield Quartermaster outside the Spire in Blackrock Mountain drops Blackhand's Command, which starts the quest. Clear Upper Blackrock Spire, kill General Drakkisath and touch Drakkisath's Brand behind him. Afterwards the Orb of Command in the mountain takes you straight into the Lair." },
    reward: { text: { ru: "Допуск в Логово Крыла Тьмы (Сфера Повиновения)", en: "Attunement to Blackwing Lair (the Orb of Command)" } },
    needs: [
      { text: { ru: "Печать Вознесения (или у кого-то в группе)", en: "the Seal of Ascension (or someone in the group)" }, quest: 4743 },
      { text: { ru: "группа на 10 в Верхнюю часть пика", en: "a group of 10 for Upper Blackrock Spire" } },
    ],
    level: { ru: "задание 60 уровня, с 55", en: "a level 60 quest, from 55" },
    classic: { ru: "классика: фаза 3 (задание есть с начала, Логово — с фазы 3)", en: "original game: phase 3 (the quest exists from the start, the Lair from phase 3)" }, group: { ru: "10 человек", en: "10 players" },
    unverified: { ru: "задание сверено с ForeverDB (начинается с предмета, сдаётся Клейму Драккисата); место интенданта — по описанию", en: "the quest checked against ForeverDB (starts from an item, handed to Drakkisath's Brand); the Quartermaster's spot is from descriptions" },
    steps: [
      { id: -301, title: { ru: "Записка «Приказ Чернорука»", en: "Blackhand's Command (the note)" },
        giver: BRM({ ru: "интендант Щитоносцев — снаружи пика, к востоку от входа", en: "the Scarshield Quartermaster — outside the Spire, east of the entrance" }),
        todo: { ru: "Убить интенданта Щитоносцев и взять записку; щелчок по ней начинает задание.", en: "Kill the Scarshield Quartermaster and take the note; right-click it to start the quest." },
        turnin: BRM({ ru: "интендант Щитоносцев", en: "the Scarshield Quartermaster" }) },
      { id: 7761, giver: BRM({ ru: "записка «Приказ Чернорука»", en: "the note, Blackhand's Command" }), dungeon: "ubrs", size: 10,
        todo: { ru: "Пройти Верхнюю часть пика, убить генерала Драккисата и коснуться Клейма Драккисата за ним.", en: "Clear Upper Blackrock Spire, kill General Drakkisath and touch Drakkisath's Brand behind him." },
        at: [DRAKKISATH], turnin: DRAKKISATH },
    ],
  },
  {
    key: "atiesh", faction: null, classes: [5, 8, 9, 11], stage: 6, category: "legendary", minLevel: 60,
    name: { ru: "Атиеш, большой посох Стража", en: "Atiesh, Greatstaff of the Guardian" },
    about: { ru: "Легендарный посох заклинателей (у жреца, мага, чернокнижника и друида — свои версии). 40 Осколков Атиеша из Наксрамаса складываются в Каркас; Анахронос у Пещер Времени просит Навершие (с Кел'Тузада) и Основание (с К'Туна в Ан'Кираже); потом посох очищают в Стратхольме, убив вырвавшегося из него демона. Посох даёт ауру группе и портал в Каражан. Очень долго и только с поддержкой гильдии.", en: "The casters' legendary staff (priest, mage, warlock and druid have their own versions). 40 Splinters of Atiesh from Naxxramas make the Frame; Anachronos at the Caverns of Time wants the Staff Head (Kel'Thuzad) and the Base (C'Thun in Ahn'Qiraj); then the staff is cleansed in Stratholme by killing the demon that comes out of it. It gives the party an aura and a portal to Karazhan. Very long, needs a guild behind you." },
    reward: { item: 22631, text: { ru: "Атиеш, большой посох Стража (жреческий)", en: "Atiesh, Greatstaff of the Guardian (priest)" } },
    needs: [
      { text: { ru: "доступ в Наксрамас (в классике — допуск Серебряного Рассвета)", en: "access to Naxxramas (in the original game the Argent Dawn attunement)" } },
      { text: { ru: "рейд в Храм Ан'Киража ради К'Туна", en: "a Temple of Ahn'Qiraj raid for C'Thun" } },
      { text: { ru: "40 Осколков Атиеша", en: "40 Splinters of Atiesh" } },
    ],
    level: { ru: "60 уровень", en: "level 60" },
    classic: { ru: "классика: фаза 6 (и К'Тун — фаза 5)", en: "original game: phase 6 (and C'Thun — phase 5)" }, group: { ru: "рейд 40", en: "raid 40" },
    unverified: { ru: "какой из номеров последнего задания (9257, 9269, 9270, 9271) жреческий — не сверено; засчитывается любой", en: "which of the last quest's ids (9257, 9269, 9270, 9271) is the priest's is not checked; any counts" },
    steps: [
      { id: -501, title: { ru: "Каркас Атиеша", en: "Frame of Atiesh" }, giver: ANACHRONOS, size: 40,
        todo: { ru: "Собрать 40 Осколков Атиеша в Наксрамасе и соединить их в Каркас; щелчок по Каркасу начинает задание.", en: "Collect 40 Splinters of Atiesh in Naxxramas and combine them into the Frame; clicking the Frame starts the quest." }, turnin: ANACHRONOS },
      { id: 9250, giver: ANACHRONOS, todo: { ru: "Отнести Каркас Атиеша Анахроносу у Пещер Времени.", en: "Bring the Frame of Atiesh to Anachronos at the Caverns of Time." }, turnin: ANACHRONOS },
      { id: 9251, giver: ANACHRONOS, size: 40, todo: { ru: "Добыть Навершие Атиеша с Кел'Тузада (Наксрамас) и Основание Атиеша с К'Туна (Храм Ан'Киража).", en: "Get the Staff Head of Atiesh from Kel'Thuzad (Naxxramas) and the Base of Atiesh from C'Thun (Temple of Ahn'Qiraj)." }, turnin: ANACHRONOS },
      { id: 9270, alt: [9257, 9269, 9271], giver: ANACHRONOS, size: 5, todo: { ru: "В Стратхольме применить посох на Освящённой земле и убить вырвавшегося демона Атиеша; вернуться к Анахроносу.", en: "In Stratholme use the staff on the Consecrated Earth and kill the demon Atiesh that comes out; go back to Anachronos." },
        at: [{ who: { ru: "Стратхольм, Освящённая земля", en: "Stratholme, the Consecrated Earth" }, map: EPL, x: 31, y: 14, note: { ru: "вход в Стратхольм", en: "the Stratholme entrance" } }], turnin: ANACHRONOS },
    ],
  },
];

/*
 * The lowest level each quest is taken at: ForeverDB's requiredLevel (Forever's quests; where Forever's own value
 * isn't known it gives the original game's, CMaNGOS). Steps that are not quests keep what they say.
 */
const REQ: Record<number, number> = { 838: 55, 964: 55, 3802: 48, 4182: 48, 4183: 48, 4184: 48, 4185: 48, 4186: 48, 4223: 48, 4224: 48, 4241: 48, 4242: 48, 4264: 50, 4282: 50, 4322: 50, 4743: 57, 4903: 55, 4941: 55, 4974: 55, 5096: 50, 5098: 50, 5511: 55, 5514: 55, 5802: 55, 5804: 55, 6402: 50, 6403: 50, 6501: 50, 6502: 50, 6566: 55, 6567: 55, 6568: 55, 6569: 55, 6570: 55, 6582: 55, 6583: 55, 6584: 55, 6585: 55, 6601: 55, 6602: 55, 6804: 55, 6805: 55, 6821: 56, 6822: 57, 6823: 60, 6824: 60, 7486: 60, 7621: 60, 7622: 60, 7761: 55, 7848: 55, 9250: 60, 9251: 60, 9257: 60, 9269: 60, 9270: 60, 9271: 60 };
for (const c of CHAINS) for (const st of c.steps) if (st.id > 0 && REQ[st.id]) st.min ??= { level: REQ[st.id], sure: true };

export const chainFor = (faction: string | null | undefined) => CHAINS.find((c) => c.faction === (faction === "ALLIANCE" ? "ALLIANCE" : "HORDE"))!;

/** Important places drawn on the continents: capitals, Blackrock Mountain, the raids. */
export const PLACES: { name: L; map: number; x: number; y: number; kind: "city" | "dungeon" | "raid" | "hub" }[] = [
  { name: { ru: "Оргриммар", en: "Orgrimmar" }, map: 1411, x: 45.5, y: 12, kind: "city" },
  { name: { ru: "Громовой Утес", en: "Thunder Bluff" }, map: 1412, x: 37, y: 30, kind: "city" },
  { name: { ru: "Подгород", en: "Undercity" }, map: 1420, x: 61.8, y: 72, kind: "city" },
  { name: { ru: "Штормград", en: "Stormwind" }, map: 1429, x: 32, y: 48, kind: "city" },
  { name: { ru: "Стальгорн", en: "Ironforge" }, map: 1426, x: 53, y: 35, kind: "city" },
  { name: { ru: "Дарнасс", en: "Darnassus" }, map: 1438, x: 32, y: 50, kind: "city" },
  { name: { ru: "Черная гора: пик и Глубины", en: "Blackrock Mountain: Spire and Depths" }, map: 1428, x: 29, y: 38, kind: "dungeon" },
  { name: { ru: "Логово Ониксии", en: "Onyxia's Lair" }, map: 1445, x: 52.5, y: 76.8, kind: "raid" },
  { name: { ru: "Каргат", en: "Kargath" }, map: 1418, x: 5.8, y: 47.6, kind: "hub" },
  { name: { ru: "Застава Моргана", en: "Morgan's Vigil" }, map: 1428, x: 85, y: 68.7, kind: "hub" },
  { name: { ru: "Прибамбасск", en: "Gadgetzan" }, map: 1446, x: 51, y: 28, kind: "hub" },
  { name: { ru: "Пиратская Бухта", en: "Booty Bay" }, map: 1434, x: 27, y: 77, kind: "hub" },
  { name: { ru: "Круговзор", en: "Everlook" }, map: 1452, x: 61, y: 38, kind: "hub" },
];

/** Whether a chain is for this character at all (faction, class). */
export function fits(c: Chain, faction: string | null | undefined, classId: number | null | undefined): boolean {
  if (c.faction && faction && c.faction !== faction) return false;
  if (c.classes && classId != null && !c.classes.includes(classId)) return false;
  return true;
}

/** Whether a step is done: a quest the character completed (null for a step that is not a quest). */
export function stepDone(s: ChainStep, ids: Set<number>): boolean | null {
  if (s.id < 0) return null;
  return ids.has(s.id) || !!s.alt?.some((a) => ids.has(a));
}

/** How far a character has come in a chain, counted in its quests: done when the last quest is. */
export function progress(c: Chain, ids: Set<number>) {
  const qs = c.steps.filter((s) => s.id > 0);
  const done = qs.filter((s) => stepDone(s, ids)).length;
  const complete = !!qs.length && !!stepDone(qs[qs.length - 1], ids);
  return { done: complete ? qs.length : done, total: qs.length, complete, next: complete ? undefined : qs.find((s) => !stepDone(s, ids)) };
}

/** Whether a requirement is met, when it can be told from the character (null: only the player knows). */
export function needMet(n: Need, ids: Set<number>, level: number | null | undefined): boolean | null {
  if (n.quest) return ids.has(n.quest);
  if (n.chain) {
    const c = CHAINS.find((x) => x.key === n.chain);
    return c ? progress(c, ids).complete : null;
  }
  if (n.level) return level == null ? null : level >= n.level;
  return null;
}

// the Dungeon Set 2 chain, built from its data file (lib/t05chain.ts)
CHAINS.push(...T05_CHAINS);

/** The chains in the order to do them: stage by stage, as listed. */
export const ORDERED = [...CHAINS].sort((a, b) => a.stage - b.stage);

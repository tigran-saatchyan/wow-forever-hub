/**
 * Quest chains walked on the map: the Onyxia attunement (Drakefire Amulet) of each faction and the keys to
 * Blackrock Mountain. Quest ids are the original ones, each checked against Forever's own quest data (the
 * names and texts on the pages come from there, in the page's language).
 *
 * Places are where the original game has them (zone map coordinates, 0–100); Forever keeps these zones, but
 * a coordinate can be a few points off, and some NPCs walk about (marked). NPC names the Russian client
 * spells differently from the quest titles are given in English.
 */

export type L = { ru: string; en: string };
export interface Place { who: L; map: number; x: number; y: number; note?: L }
export interface ChainStep {
  id: number;
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
export interface Chain { key: string; name: L; faction: "HORDE" | "ALLIANCE" | null; level: L; steps: ChainStep[] }

// maps (UiMap ids, see maps.json)
const BADLANDS = 1418, ORGRIMMAR = 1454, DESOLACE = 1443, WPL = 1422, DUSTWALLOW = 1445, WINTERSPRING = 1452,
  SWAMP = 1435, TANARIS = 1446, WETLANDS = 1437, STEPPES = 1428, REDRIDGE = 1433, STORMWIND = 1453, ELWYNN = 1429;

/** Blackrock Mountain: Lower and Upper Blackrock Spire and Blackrock Depths all open inside it */
const BRM = (note: L): Place => ({ who: { ru: "Черная гора", en: "Blackrock Mountain" }, map: STEPPES, x: 29, y: 38, note });

const GORETOOTH: Place = { who: { ru: "Полководец Клинозуб", en: "Warlord Goretooth" }, map: BADLANDS, x: 5.8, y: 47.6, note: { ru: "Каргат, на башне", en: "Kargath, up the tower" } };
const THRALL: Place = { who: { ru: "Тралл", en: "Thrall" }, map: ORGRIMMAR, x: 31.6, y: 37.8, note: { ru: "Крепость Громмаш", en: "Grommash Hold" } };
const EITRIGG: Place = { who: { ru: "Эйтригг", en: "Eitrigg" }, map: ORGRIMMAR, x: 34.6, y: 38.6, note: { ru: "Крепость Громмаш, рядом с Траллом", en: "Grommash Hold, by Thrall" } };
const REXXAR: Place = { who: { ru: "Рексар", en: "Rexxar" }, map: DESOLACE, x: 26, y: 70, note: { ru: "ходит по дороге через Пустоши, с юга на север и обратно", en: "walks the road across Desolace, south to north and back" } };
const MYRANDA: Place = { who: { ru: "Myranda the Hag", en: "Myranda the Hag" }, map: WPL, x: 50.8, y: 77.8, note: { ru: "Холм Печали", en: "Sorrow Hill" } };
const EMBERSTRIFE: Place = { who: { ru: "Огнебор", en: "Emberstrife" }, map: DUSTWALLOW, x: 58, y: 76, note: { ru: "логово в Драконьей топи; войти в обличье дракона", en: "his den in the Wyrmbog; go in disguised" } };

const HELENDIS: Place = { who: { ru: "Хелендис", en: "Helendis Riverhorn" }, map: STEPPES, x: 85.8, y: 68.9, note: { ru: "Застава Моргана", en: "Morgan's Vigil" } };
const SOLOMON: Place = { who: { ru: "Мировой судья Соломон", en: "Magistrate Solomon" }, map: REDRIDGE, x: 29.8, y: 44.4, note: { ru: "Озёрное, ратуша", en: "Lakeshire town hall" } };
const BOLVAR: Place = { who: { ru: "Болвар Фордрагон", en: "Highlord Bolvar Fordragon" }, map: STORMWIND, x: 78.2, y: 17.6, note: { ru: "Крепость Штормграда", en: "Stormwind Keep" } };
const PRESTOR: Place = { who: { ru: "Леди Катрана Престор", en: "Lady Katrana Prestor" }, map: STORMWIND, x: 78.0, y: 18.4, note: { ru: "рядом с Болваром", en: "beside Bolvar" } };
const MAXWELL: Place = { who: { ru: "Маршал Максвелл", en: "Marshal Maxwell" }, map: STEPPES, x: 84.6, y: 68.6, note: { ru: "Застава Моргана", en: "Morgan's Vigil" } };
const WINDSOR = BRM({ ru: "маршал Виндзор — в тюрьме Глубин Черной горы", en: "Marshal Windsor — in the Detention Block of Blackrock Depths" });
const HALEH: Place = { who: { ru: "Haleh", en: "Haleh" }, map: WINTERSPRING, x: 54.8, y: 51.4, note: { ru: "Мазтарил: в пещеру и через портал наверх", en: "Mazthoril: into the cave, up through the portal" } };

const DRAKKISATH = BRM({ ru: "Верхняя часть пика Черной горы, последний босс — генерал Драккисат", en: "Upper Blackrock Spire, the last boss: General Drakkisath" });

export const CHAINS: Chain[] = [
  {
    key: "onyxia-horde", faction: "HORDE",
    name: { ru: "Амулет Пламени дракона (Орда)", en: "Drakefire Amulet (Horde)" },
    level: { ru: "задания 60 уровня; первое — с 58 по Warcraft Wiki для классики (там же сказано «с 55»; в Forever не проверено); нужны Нижняя и Верхняя части пика Черной горы", en: "level 60 quests; the first from 58 per the Warcraft Wiki for the original game (the same Wiki also says 55; not checked in Forever); Lower and Upper Blackrock Spire" },
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
    key: "onyxia-alliance", faction: "ALLIANCE",
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
    key: "keys", faction: null,
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
];

/*
 * Lowest levels. The Warcraft Wiki (via Everloot) gives Warlord's Command, the Horde chain's first step,
 * as "the lowest level that you can attempt this quest is Level 58"; no step can be taken before it, so the
 * whole Horde chain opens at 58. For the other chains no source here gives the original requirement: these
 * are estimates from the zones and dungeons involved, marked as such on the page.
 */
const MIN: Record<string, { level: number; sure: boolean }> = {
  // the Wiki's line for the original game, not checked in Forever; the same Wiki's chain page says "begins at 55"
  "onyxia-horde": { level: 58, sure: true },
  // no source: left blank rather than guessed, so the two factions are not compared on a guess
};
const KEY_MIN: Record<number, { level: number; sure: boolean }> = { 4743: { level: 55, sure: false }, 3802: { level: 50, sure: false } };
for (const c of CHAINS) for (const st of c.steps) st.min = MIN[c.key] ?? KEY_MIN[st.id];

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

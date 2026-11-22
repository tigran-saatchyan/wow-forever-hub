/**
 * The Dungeon Set 2 (Tier 0.5) chain as a map chain, built from lib/t05.json (tools/build_t05.py: the CMaNGOS
 * classic database, quest ids as WoW Forever uses them): one chain per side; the steps a class does its own way
 * (the four set quests) and the steps with variants to choose (which boss to summon) count any of their quests.
 */
import T05 from "./t05.json";
import type { Chain, ChainStep, L, Place } from "./chains";

interface Npc { id: number; who: L; map?: number; x?: number; y?: number; inside?: number }
interface Need { id: number; count: number; name: L; cls: number | null; bind: number | null }
interface Kill { id: number; name: L; count: number; at: { map: number; x: number; y: number; inside?: number } | null; summon: boolean }
interface Q { id: number; title: string; level: number; giver: Npc[]; turnin: Npc[]; need: Need[]; kill: Kill[]; gold: number; given: number | null }
const D = T05 as unknown as { quests: Record<string, Q>; chains: Record<string, number[][]> };

// the instances the chain's NPCs and summoned bosses are inside (by their area): the place is the entrance
const INSIDE: Record<number, L> = {
  2017: { ru: "Стратхольм", en: "Stratholme" }, 2057: { ru: "Некроситет", en: "Scholomance" },
  2557: { ru: "Забытый город", en: "Dire Maul" }, 1583: { ru: "Вершина Черной горы", en: "Upper Blackrock Spire" },
  1584: { ru: "Глубины Черной горы", en: "Blackrock Depths" },
};

function place(n: { who: L; map?: number; x?: number; y?: number; inside?: number }): Place {
  const inside = n.inside ? INSIDE[n.inside] : undefined;
  return { who: n.who, map: n.map ?? 0, x: n.x ?? 50, y: n.y ?? 50,
    note: inside ? { ru: `внутри: ${inside.ru}`, en: `inside ${inside.en}` } : undefined };
}

const gold = (c: number) => `${Math.round(c / 10000)}`;

/** What a step asks, in both languages: items and counts, gold, creatures (summoned or not); one of several. */
function todo(qs: Q[]): L {
  const one = (q: Q, lg: "ru" | "en") => {
    const parts: string[] = [];
    if (q.need.length) parts.push((lg === "ru" ? "принести: " : "bring: ") + q.need.map((n) => `${n.count > 1 ? `${n.count} × ` : ""}${n.name[lg]}`).join(", "));
    if (q.gold) parts.push(lg === "ru" ? `${gold(q.gold)} з` : `${gold(q.gold)}g`);
    if (q.kill.length) parts.push((lg === "ru" ? "убить: " : "kill: ") + q.kill.map((k) => `${k.name[lg]}${k.summon ? (lg === "ru" ? " (вызвать жаровней)" : " (summoned with the brazier)") : ""}`).join(", "));
    return parts.join("; ") || (lg === "ru" ? "поговорить" : "talk");
  };
  if (qs.length === 1) return { ru: one(qs[0], "ru"), en: one(qs[0], "en") };
  return {
    ru: `одно на выбор: ${qs.map((q) => one(q, "ru")).join(" — или ")}`,
    en: `one of: ${qs.map((q) => one(q, "en")).join(" — or ")}`,
  };
}

function chain(side: "HORDE" | "ALLIANCE"): Chain | null {
  const base = D.chains[`5:${side}`] ?? Object.entries(D.chains).find(([k]) => k.endsWith(side))?.[1];
  if (!base) return null;
  const others = Object.entries(D.chains).filter(([k]) => k.endsWith(`:${side}`)).map(([, v]) => v);
  const steps: ChainStep[] = base.map((st, i) => {
    const qs = st.map((e) => D.quests[String(e)]).filter(Boolean);
    const q = qs[0];
    const alt = [...new Set(others.flatMap((o) => o[i] || []).concat(st))].filter((e) => e !== q.id);
    const kills = qs.flatMap((x) => x.kill).filter((k) => k.at);
    const seen = new Set<string>();
    const at = kills.filter((k) => !seen.has(k.name.en) && !!seen.add(k.name.en)).map((k) => place({ who: k.name, ...k.at! }));
    return {
      id: q.id, alt: alt.length ? alt : undefined, giver: place(q.giver[0] ?? { who: { ru: "?", en: "?" } }),
      turnin: place(q.turnin[0] ?? q.giver[0] ?? { who: { ru: "?", en: "?" } }), todo: todo(qs), at: at.length ? at : undefined,
      min: { level: q.level, sure: true },
    };
  });
  return {
    key: `t05-${side.toLowerCase()}`, faction: side, stage: 2, category: "set", minLevel: 58, steps,
    name: { ru: "Сет подземелий 2 (Т0.5)", en: "Dungeon Set 2 (Tier 0.5)" },
    level: { ru: "58+", en: "58+" },
    about: {
      ru: "Обмен вещей Т0 на Т0.5 своего класса: наручи в начале, пояс и перчатки, затем сапоги, поножи и наплечники, шлем и роба в конце. По пути — Стратхольм, Забытый город, Некроситет и Пик Черной горы, призыв Лорда Валталака.",
      en: "Trading one's class Tier 0 pieces for Tier 0.5: the bracers first, the belt and gloves, then boots, legs and shoulders, the helm and chest last. On the way: Stratholme, Dire Maul, Scholomance and Blackrock Spire, and summoning Lord Valthalak.",
    },
    reward: { text: { ru: "комплект Т0.5 своего класса (в Forever — на выбор, вариант для исцеления или для урона)", en: "one's class Tier 0.5 set (in Forever a choice of a healing or a damage version)" } },
    needs: [
      { text: { ru: "все 8 вещей Т0 своего класса — не продавать", en: "all 8 Tier 0 pieces of one's class — keep them" } },
      { text: { ru: "около 60 золотых на задания и ремесленные материалы (список — на странице «Рейды»)", en: "about 60 gold for the quests, and crafting materials (the list is on the Raids page)" } },
      { level: 58, text: { ru: "58 уровень", en: "level 58" } },
    ],
    group: { ru: "5 игроков", en: "5 players" },
    classic: { ru: "в классике — с обновления 1.10", en: "the original game's patch 1.10" },
    unverified: { ru: "шаги, места и требования — по классической базе CMaNGOS; в Forever проверьте текст заданий", en: "steps, places and requirements from the CMaNGOS classic database; check the quest texts in Forever" },
  };
}

export const T05_CHAINS: Chain[] = [chain("HORDE"), chain("ALLIANCE")].filter((c): c is Chain => !!c);

/** Test helpers: load real collector data from ../data and the prototype's original functions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixGates } from "./rules";
import type { TalentDataset } from "./types";

const ROOT = resolve(__dirname, "../../..");

export function loadDataset(build = "1.60.1.70755", lang = "en"): TalentDataset {
  const raw = readFileSync(resolve(ROOT, `data/talents/${build}/${lang}.json`), "utf8");
  return fixGates(JSON.parse(raw));
}

export function readJSON<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

/** Source of `function name(...) {...}` from legacy/web/index.html, found by brace matching. */
function extract(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("no function " + name);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + name);
}

const LEGACY_FNS = [
  "allTalents", "rk", "talented", "startLevel", "pointsAt", "totalPoints", "spent", "byId",
  "gateOk", "reqOk", "canAdd", "validAll", "canRemove", "pointOk", "rowOrder", "normOrder",
  "orderProblem", "runsOf", "encodeOrder", "decodeOrder", "encode", "decode", "pruneRanks",
  "fixGates", "isMilestone",
];

/**
 * The prototype's functions evaluated against a fake global state S, so the port can be compared
 * with the original on the same inputs. `t` returns the key; `ds()` returns the given dataset.
 */
export function loadLegacy(dataset: TalentDataset) {
  const src = readFileSync(resolve(ROOT, "legacy/web/index.html"), "utf8");
  const body = LEGACY_FNS.map((n) => extract(src, n)).join("\n");
  const S: Record<string, unknown> = { ranks: {}, order: [], level: 60, legacy: 0, preview: null, previewRanks: null };
  const factory = new Function(
    "S", "ds", "t",
    `${body}\nreturn { ${LEGACY_FNS.join(", ")} };`,
  );
  const fns = factory(S, () => dataset, (k: string) => k);
  return { S, ...fns } as Record<string, any> & { S: Record<string, any> };
}

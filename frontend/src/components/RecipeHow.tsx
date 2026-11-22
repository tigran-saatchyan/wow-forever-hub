/**
 * Where to get a recipe (the server's app/recipe_sources.py), every way with its place: a line naming the first
 * one (a trainer, a vendor, a drop or a quest, and where), the rest on hover — trainers (or the profession's
 * trainers, the capitals first), vendors with their price or a limited stock, the creatures that drop it with the
 * level it takes, the quests that give it.
 */
import type { ReactNode } from "react";
import { useI18n, type Key } from "../lib/i18n";
import { EdgeTip, useEdgeTip } from "./EdgeTip";
import { LevelTag } from "./LevelTag";
import { ItemIcon, Money } from "./Wow";

interface Place { name: string; title?: string | null; zone?: string | null; x?: number | null; y?: number | null }
export interface RecipeHowData {
  trainers: (Place & { cost?: number | null })[];
  vendors: (Place & { price?: number | null; limited?: boolean; seen?: boolean | null })[];
  drops: { id: number; name: string; instance: string | null; zone: string | null; chance: number | null; levels?: number[] | null }[];
  quests: { id: number; name: string; area?: string | null }[];
  byProfession: boolean;
  /** how ForeverDB says it is learned (trainer, vendor, drop, quest, item), when it has no more */
  ways?: string[];
}

const at = (p: Place) => `${p.zone ?? ""}${p.x != null ? ` (${p.x.toFixed(0)}, ${p.y?.toFixed(0)})` : ""}`;
const pct = (c: number | null) => (c == null ? "" : ` ${c >= 1 ? Math.round(c) : c.toFixed(2)}%`);

export function RecipeHow({ how, recipe, item, skill, me }:
  { how: RecipeHowData; recipe: string; item?: { id: number; name: string } | null; skill?: string; me?: number | null }) {
  const { t } = useI18n();
  const tip = useEdgeTip();
  const v = how.vendors[0], tr = how.trainers[0], dr = how.drops[0], q = how.quests[0];
  let line: ReactNode = t("rh_none");
  if (v) line = <>{t("rh_vendor")} · {v.name}, {v.zone}</>;
  else if (tr) line = <>{t(how.byProfession ? "rh_prof_trainer" : "rh_trainer")} · {tr.name}, {tr.zone}</>;
  else if (dr) line = <>{t("rh_drop")} · {dr.name}, {dr.instance || dr.zone} <LevelTag lv={dr.levels} me={me} dungeon={!!dr.instance} />{pct(dr.chance)}</>;
  else if (q) line = <>{t("rh_quest")} · {q.name}</>;
  else if (how.ways?.length) line = <>{how.ways.map((w) => t(`cr_way_${w}` as Key)).join(", ")} · {t("rh_no_detail")}</>;
  const head = (k: string) => <span className="mt-1.5 block text-muted">{k}</span>;
  return (
    <span {...tip.bind} tabIndex={0} className="mt-0.5 block cursor-help text-[11px] text-[#9fd0ff]">
      📜 {line}
      <EdgeTip anchor={tip.anchor} open={tip.open}>
        <span className="block max-w-[24rem] text-[13px]">
          <span className="block text-[#ffd100]">{recipe}</span>
          {skill && <span className="block">{skill}</span>}
          {item && <span className="mt-1 flex items-center gap-1.5"><ItemIcon itemId={item.id} size={16} />{item.name}</span>}
          {how.vendors.length > 0 && head(t("rh_vendors"))}
          {how.vendors.map((x, i) => (
            <span key={`v${i}`} className="block text-xs">
              {x.name}{x.title ? ` <${x.title}>` : ""} — {at(x)}
              {x.price ? <> · <Money c={x.price} /></> : null}{x.limited ? ` · ${t("rh_limited")}` : ""}
              {x.seen ? <span className="text-good"> · {t("so_seen_forever")}</span> : null}
            </span>
          ))}
          {how.trainers.length > 0 && head(t(how.byProfession ? "rh_prof_trainers" : "rh_trainers"))}
          {how.trainers.map((x, i) => (
            <span key={`t${i}`} className="block text-xs">{x.name}{x.title ? ` <${x.title}>` : ""} — {at(x)}{x.cost ? <> · <Money c={x.cost} /></> : null}</span>
          ))}
          {how.drops.length > 0 && head(t("rc_drops"))}
          {how.drops.map((c) => (
            <span key={`d${c.id}`} className="block text-xs">{c.name} — {c.instance || c.zone} <LevelTag lv={c.levels} me={me} dungeon={!!c.instance} />{pct(c.chance)}</span>
          ))}
          {how.quests.length > 0 && head(t("rh_quests"))}
          {how.quests.map((x) => <span key={`q${x.id}`} className="block text-xs">{x.name}{x.area ? ` — ${x.area}` : ""}</span>)}
          {!how.vendors.length && !how.trainers.length && !how.drops.length && !how.quests.length && (
            <span className="mt-1 block text-muted">{how.ways?.length ? t("rh_ways_only", { w: how.ways.map((w) => t(`cr_way_${w}` as Key)).join(", ") }) : t("rh_none_h")}</span>
          )}
        </span>
      </EdgeTip>
    </span>
  );
}

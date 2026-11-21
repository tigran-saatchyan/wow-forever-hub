/**
 * A profession's gear for one character (the server's app/routers/profgear.py): for fishing the poles, lures,
 * clothes and extras with the fishing each adds and the skill and level each needs; what the character has (worn,
 * or marked by hand: bags are not in Blizzard's API) in colour, the rest dim with its auction price; a click on a
 * name says where to get it. On top, the fishing the character reaches with the best of what they have.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AhChip } from "../../components/AhChip";
import { ItemHover, ItemIcon } from "../../components/Wow";
import { useActiveCharId } from "../../lib/activeChar";
import { req } from "../../lib/api";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { fullName, qColor, useCharacters, type AhState, type RefItem } from "../../lib/wowApi";

const Q = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const KINDS = ["pole", "lure", "clothes", "extra"] as const;

interface GearItem {
  id: number; kind: (typeof KINDS)[number]; name: string; q: number; req: number; skill: number; bonus: number | null;
  minutes: number | null; lure: boolean; worn: boolean; marked: boolean; owned: boolean; ah: AhState | null;
}
interface Gear { prof: string; level: number | null; skill: number | null; max: number | null; market: boolean; items: GearItem[] }

/** The fishing with the best of what one has: the best pole, the best lure one can use, every piece of clothing
 * (one per slot: hats do not stack) and the extras. */
function reach(d: Gear): { total: number; parts: { name: string; n: number }[] } | null {
  if (d.skill == null) return null;
  const have = d.items.filter((x) => x.owned && x.bonus);
  const best = (xs: GearItem[]) => xs.sort((a, b) => (b.bonus ?? 0) - (a.bonus ?? 0))[0];
  const parts: { name: string; n: number }[] = [];
  const pole = best(have.filter((x) => x.kind === "pole"));
  if (pole) parts.push({ name: pole.name, n: pole.bonus! });
  const lure = best(have.filter((x) => (x.kind === "lure" || x.lure) && x.skill <= d.skill!));
  if (lure) parts.push({ name: lure.name, n: lure.bonus! });
  const clothes = have.filter((x) => x.kind === "clothes" && !x.lure);
  for (const x of clothes) parts.push({ name: x.name, n: x.bonus! });
  for (const x of have.filter((x) => x.kind === "extra")) parts.push({ name: x.name, n: x.bonus! });
  return { total: d.skill + parts.reduce((a, p) => a + p.n, 0), parts };
}

export function ProfGear({ onOpen }: { onOpen: (x: RefItem) => void }) {
  const { t, lang } = useI18n();
  const all = (useCharacters().data || []).filter((c) => !c.error && (c.profs?.[lang] || []).some((p) => p.id === 356));
  const active = useActiveCharId();
  const [sel, setSel] = useState<number | null>(() => store.get<number | null>("crGearChar", null));
  const cid = (all.find((c) => c.id === sel) ?? all.find((c) => c.id === active) ?? all[0])?.id ?? null;
  const q = useQuery({ queryKey: ["profgear", cid, "fishing", lang], enabled: cid != null,
    queryFn: () => req<Gear>(`/api/profgear/${cid}/fishing?lang=${lang}`), staleTime: 5 * 60e3 });
  if (!all.length) return <p className="text-sm text-muted">{t("pg_none")}</p>;
  const d = q.data;
  const r = d ? reach(d) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="chip border-gold/60 text-gold">{t("pg_fishing")}</span>
        {all.length > 1 ? (
          <select className="input w-auto py-1 text-sm" value={cid ?? ""} onChange={(e) => (store.set("crGearChar", +e.target.value), setSel(+e.target.value))}>
            {all.map((c) => <option key={c.id} value={c.id}>{fullName(c, lang)}</option>)}
          </select>
        ) : <span className="text-sm text-muted">{fullName(all[0], lang)}</span>}
        {d?.skill != null && <span className="text-sm">{t("pg_skill", { n: d.skill, m: d.max ?? "?" })}</span>}
        {r && r.parts.length > 0 && (
          <span className="text-sm text-good" title={r.parts.map((p) => `${p.name} +${p.n}`).join(", ")}>
            {t("pg_reach", { n: r.total })}
          </span>
        )}
      </div>
      {!d ? <p className="text-sm text-muted">…</p> : (
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
          {KINDS.map((k) => {
            const xs = d.items.filter((x) => x.kind === k);
            if (!xs.length) return null;
            return (
              <section key={k}>
                <div className="pg-head">{t(`pg_k_${k}` as Key)}</div>
                <ul className="space-y-1">{xs.map((x) => <Row key={x.id} x={x} d={d} cid={cid!} onOpen={onOpen} />)}</ul>
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">{t("pg_note")}</p>
    </div>
  );
}

function Row({ x, d, cid, onOpen }: { x: GearItem; d: Gear; cid: number; onOpen: (x: RefItem) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: () => req(`/api/profgear/${cid}/owned`, { method: "PUT", body: JSON.stringify({ item_id: x.id, owned: !x.marked }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profgear", cid, "fishing", lang] }),
  });
  const lowSkill = x.skill > 0 && (d.skill ?? 0) < x.skill;
  const lowLevel = x.req > 0 && (d.level ?? 0) < x.req;
  return (
    <li className={`pg-row ${x.owned ? "owned" : ""}`}>
      <ItemHover id={x.id}><span className="shrink-0"><ItemIcon itemId={x.id} quality={Q[x.q]} size={26} /></span></ItemHover>
      <span className="grid min-w-0 flex-1 leading-tight">
        <button type="button" className="truncate text-left hover:underline" style={{ color: x.owned ? qColor(Q[x.q]) : undefined }}
          onClick={() => onOpen({ id: x.id, name: x.name, q: x.q })} title={t("pg_where")}>{x.name}</button>
        <span className="text-[11px] text-muted">
          {x.skill > 0 && <span className={lowSkill ? "text-bad" : ""}>{t("pg_need_skill", { n: x.skill })}</span>}
          {x.skill > 0 && x.req > 0 && " · "}
          {x.req > 0 && <span className={lowLevel ? "text-bad" : ""}>{t("pg_need_level", { n: x.req })}</span>}
          {x.minutes ? `${x.skill > 0 || x.req > 0 ? " · " : ""}${t("pg_minutes", { n: x.minutes })}` : ""}
          {x.lure && x.kind === "clothes" ? ` · ${t("pg_with_lure")}` : ""}
        </span>
      </span>
      <span className={`w-12 shrink-0 text-right tabular-nums ${x.owned ? "text-good" : "text-muted"}`}>{x.bonus != null ? `+${x.bonus}` : "+?"}</span>
      {d.market && x.ah && !x.owned && <AhChip id={x.id} ah={x.ah} />}
      {x.worn ? <span className="shrink-0 text-xs text-good">✓ {t("bis_worn_tag")}</span> : (
        <button className={`prebis-mark shrink-0 ${x.marked ? "on" : ""}`} disabled={mark.isPending} onClick={() => mark.mutate()}>
          {x.marked ? `✓ ${t("pr_have_it")}` : t("pr_have_q")}
        </button>
      )}
    </li>
  );
}

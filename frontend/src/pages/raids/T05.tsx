/**
 * Dungeon Set 2 (Tier 0.5) for the picked character (the server's app/routers/t05.py): the set slot by slot — the
 * Tier 0 piece to keep and hand in, the quest that trades it, the Tier 0.5 piece given (and Forever's Shadow
 * version when known); what the character has of them; and the chain's materials — what can be bought or gathered
 * ahead, ticked when collected, and the quest items that drop only while their quest is taken.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AhChip } from "../../components/AhChip";
import { SourcePanel } from "../../components/SourcePanel";
import { ItemHover, ItemIcon } from "../../components/Wow";
import { req } from "../../lib/api";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { qColor, wowApi, type AhState, type Character, type QuestInfo } from "../../lib/wowApi";
import { ChainLink } from "../map/ChainPanel";

const Q = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
interface Piece { id: number; name: string; q?: number | null; worn: boolean; marked: boolean; owned: boolean }
interface Slot { slot: string; quest: number; t0: Piece; t05: Piece | null; shadow: Piece | null }
interface Mat { id: number; name: string; count: number; quest: number; have?: boolean; ah?: AhState | null }
interface T05 { available: boolean; key?: string; level?: number; slots: Slot[]; market: boolean; materials: Mat[]; questItems: Mat[]; gold: number }

function QuestName({ id }: { id: number }) {
  const { lang } = useI18n();
  const q = useQuery<QuestInfo>({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  return <>{q.data?.title || `#${id}`}</>;
}

export function T05({ char }: { char: Character | null }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => store.get("raidsT05Open", true));
  const [panel, setPanel] = useState<{ id: number; name?: string } | null>(null);
  const q = useQuery({ queryKey: ["t05", char?.id, lang], enabled: !!char, staleTime: 5 * 60e3, retry: 3,
    queryFn: () => req<T05>(`/api/t05/${char!.id}?lang=${lang}`) });
  const mark = useMutation({
    mutationFn: (b: { item_id: number; on: boolean; kind?: string }) => req(`/api/t05/${char!.id}/mark`, { method: "PUT", body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["t05", char?.id] }),
  });
  const d = q.data;
  if (!char || !d?.available) return null;
  const t0 = d.slots.filter((s) => s.t0.owned).length;
  const t5 = d.slots.filter((s) => s.t05?.owned || s.shadow?.owned).length;
  const got = d.materials.filter((m) => m.have).length;
  const toggle = () => (store.set("raidsT05Open", !open), setOpen(!open));
  const chain = `t05-${(d.key || "").split(":")[1]?.toLowerCase() || "horde"}`;

  const piece = (p: Piece | null, label: string) => p && (
    <div className={`t5-piece ${p.owned ? "owned" : ""}`}>
      <ItemHover id={p.id}><span className="shrink-0"><ItemIcon itemId={p.id} quality={p.q != null ? Q[p.q] : undefined} size={30} /></span></ItemHover>
      <span className="grid min-w-0 flex-1 leading-tight">
        <button type="button" className="truncate text-left text-sm hover:underline" style={{ color: p.owned && p.q != null ? qColor(Q[p.q]) : undefined }}
          onClick={() => setPanel({ id: p.id, name: p.name })} title={t("pg_where")}>{p.name}</button>
        <span className="text-[11px] text-muted">{label}</span>
      </span>
      {p.worn ? <span className="shrink-0 text-xs text-good">✓ {t("bis_worn_tag")}</span> : (
        <button className={`prebis-mark shrink-0 ${p.marked ? "on" : ""}`} onClick={() => mark.mutate({ item_id: p.id, on: !p.marked })}>
          {p.marked ? `✓ ${t("pr_have_it")}` : t("pr_have_q")}
        </button>
      )}
    </div>
  );

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="cr-toggle min-w-0 flex-1" aria-expanded={open} onClick={toggle}>
          <h2 className="panel-title">{t("t5_title")}</h2>
          <span className="cr-chev" aria-hidden>▾</span>
        </button>
        <span className="prebis-fold-chip text-sm">{t("t5_t0", { n: t0 })}</span>
        <span className="prebis-fold-chip text-sm">{t("t5_t05", { n: t5 })}</span>
        <span className="prebis-fold-chip text-sm">{t("t5_mats", { n: got, t: d.materials.length })}</span>
        <ChainLink chain={chain} char={char.id}><span className="btn py-1 text-sm">{t("t5_on_map")}</span></ChainLink>
      </div>
      {open && (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted">{t("t5_hint")}</p>
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
            {d.slots.map((s) => (
              <div key={s.slot} className="t5-slot">
                <div className="flex items-baseline gap-2">
                  <b className="text-sm">{t(`slot_${s.slot}` as Key)}</b>
                  <span className="truncate text-[11px] text-muted" title={t("t5_quest_h")}>↳ <QuestName id={s.quest} /></span>
                </div>
                {piece(s.t0, t("t5_t0_label"))}
                {piece(s.t05, s.shadow ? t("t5_heal") : t("t5_t05_label"))}
                {piece(s.shadow, t("t5_shadow"))}
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div>
              <div className="prebis-glabel flex flex-wrap items-center gap-2">
                {t("t5_collect")} <span className={got === d.materials.length ? "text-good" : "text-muted"}>{got}/{d.materials.length}</span>
                <span className="ml-auto normal-case tracking-normal text-muted">{t("t5_gold", { n: Math.round(d.gold / 10000) })}</span>
              </div>
              <ul className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 22rem), 1fr))" }}>
                {d.materials.map((m) => (
                  <li key={m.id} className={`cn-row ${m.have ? "rp-done" : ""}`}>
                    <input type="checkbox" className="shrink-0 cursor-pointer" checked={!!m.have} aria-label={m.name}
                      onChange={() => mark.mutate({ item_id: m.id, on: !m.have, kind: "have" })} />
                    <ItemHover id={m.id}><span className="shrink-0"><ItemIcon itemId={m.id} size={26} /></span></ItemHover>
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <button type="button" className="truncate text-left text-sm hover:underline" onClick={() => setPanel({ id: m.id, name: m.name })}>
                        {m.count > 1 ? `${m.count} × ` : ""}{m.name}
                      </button>
                      <span className="truncate text-[11px] text-muted"><QuestName id={m.quest} /></span>
                    </span>
                    {d.market && m.ah && <AhChip id={m.id} ah={m.ah} />}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="prebis-glabel">{t("t5_quest_items")}</div>
              <p className="mb-1.5 text-[11px] text-muted">{t("t5_quest_items_h")}</p>
              <ul className="space-y-0.5 text-sm">
                {d.questItems.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <ItemHover id={m.id}><span className="shrink-0"><ItemIcon itemId={m.id} size={20} /></span></ItemHover>
                    <span className="truncate">{m.count > 1 ? `${m.count} × ` : ""}{m.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-[11px] text-muted">{t("t5_note")}</p>
        </div>
      )}
      <SourcePanel item={panel} onClose={() => setPanel(null)} />
    </section>
  );
}

import { gateOk, isMilestone, levelsOf, reqOk, type ClassData, type PlacedTalent, type Ranks, type TalentIndex } from "../../engine";
import { useI18n } from "../../lib/i18n";

/** Strip client color codes and mark [[conditional]] text, as the prototype's fmtDesc does. */
function Desc({ s }: { s: string }) {
  const clean = String(s).replace(/\|c[0-9A-Fa-f]{8}|\|r/g, "");
  return (
    <>
      {clean.split(/(\[\[[\s\S]*?\]\])/).map((p, i) =>
        p.startsWith("[[") ? <span key={i} className="text-muted italic">{p.slice(2, -2)}</span> : p,
      )}
    </>
  );
}

interface Props {
  x: PlacedTalent;
  el: HTMLElement;
  c: ClassData;
  M: TalentIndex;
  ranks: Ranks;
  order: number[];
  start: number;
}

export function Tooltip({ x, el, c, M, ranks, order, start }: Props) {
  const { t } = useI18n();
  const r = ranks[x.id] || 0;
  const b = el.getBoundingClientRect();
  const W = 320;
  const right = b.right + 12 + W < innerWidth;
  const style = {
    top: Math.min(b.top, innerHeight - 260),
    left: right ? b.right + 12 : Math.max(8, b.left - W - 12),
    width: W,
  };
  const lv = levelsOf(order, x.id, start);
  const missingGate = !gateOk(x, ranks) && x.gate;
  const missingReq = !reqOk(x, M, ranks) ? (x.requires || []).map((id) => M[id]).filter((p) => p && (ranks[p.id] || 0) < p.max) : [];
  const m = x.meta;

  return (
    <div className="panel pointer-events-none fixed z-50 space-y-1.5 p-3 text-sm shadow-2xl" style={style}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="font-display text-gold">{x.name}</b>
        <span className="text-xs text-muted">{t("rank", { r, m: x.max })}</span>
      </div>
      {(m.passive || isMilestone(x)) && (
        <div className="text-xs text-muted">{[m.passive && t("passive"), isMilestone(x) && t("key_talent")].filter(Boolean).join(" · ")}</div>
      )}
      {(m.cost || m.range || m.cast || m.cd) && (
        <div className="grid grid-cols-2 text-xs text-ink/90">
          {[m.cost, m.range, m.cast, m.cd].filter(Boolean).map((v) => <span key={v}>{v}</span>)}
        </div>
      )}
      {missingGate && <div className="text-xs text-bad">{t("req_points", { p: missingGate.points, t: c.tabs[x.tab].name })}</div>}
      {missingReq.map((p) => <div key={p.id} className="text-xs text-bad">{t("req_parent", { n: p.name, m: p.max })}</div>)}
      <p className="text-ink/90"><Desc s={x.ranks[Math.max(0, r - 1)]} /></p>
      {r > 0 && r < x.max && (
        <p className="text-ink/70"><span className="eyebrow">{t("next_rank")}</span> <Desc s={x.ranks[r]} /></p>
      )}
      {lv.length > 0 && <div className="text-xs text-accent2">{t("learn_at", { l: lv.join(", ") })}</div>}
    </div>
  );
}

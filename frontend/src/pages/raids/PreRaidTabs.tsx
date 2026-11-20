/** The pre-raid section's other tabs: the talent build against the character's, the stat priority and the
 *  rotation, the consumables, and the enchantments the character's gear still lacks. */
import { AhChip } from "../../components/AhChip";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ItemHover, ItemIcon } from "../../components/Wow";
import { byId, makeLink, normOrder, type ClassData, type PlacedTalent, type Ranks } from "../../engine";
import { mapTalents } from "../../lib/charTalents";
import { iconStyle, useIcons, useIndex, useTalents } from "../../lib/gameData";
import { useI18n, type Key } from "../../lib/i18n";
import { useCharacter, type PreBis } from "../../lib/wowApi";
import { TalentTree, type TreeMarks } from "../talents/TalentTree";
import { TalentTip, TipBox } from "../talents/Tooltip";

const noop = () => {};

/** The build's three trees. From the level the character takes the specialization (40), its own talents are laid
 *  over them: what the build has and it lacks shows as the planned rank, what it has beyond the build is marked. */
export function TalentsPane({ d, cid }: { d: PreBis; cid: number }) {
  const { t, lang } = useI18n();
  const icons = useIcons();
  const idx = useIndex();
  const nav = useNavigate();
  const T = useTalents(lang);
  const c = useCharacter(cid).data;
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: PlacedTalent; el: HTMLElement } | null>(null);
  const k: ClassData | undefined = T.data?.classes.find((x) => x.id === d.class);
  const M = useMemo(() => (k ? byId(k) : {}), [k]);
  if (!k || !d.talents) return <p className="text-sm text-muted">…</p>;
  const build: Ranks = Object.fromEntries(Object.entries(d.talents.ranks).map(([id, r]) => [+id, r]));
  const swap = d.talents.swap;
  const level = d.level ?? 1;
  const compare = level >= d.talents.fromLevel && !!c?.talents;
  const mine: Ranks = compare ? mapTalents(k, c!.talents!).ranks : build;
  const missing = Object.entries(build).filter(([id, r]) => (mine[+id] || 0) < r && !(+id === swap.from && (mine[swap.to] || 0) >= r));
  const extra = Object.entries(mine).filter(([id, r]) => r > (build[+id] || 0) && !(+id === swap.to && (mine[swap.from] || 0) === 0));
  const matched = Object.entries(build).reduce((a, [id, r]) => a + Math.min(r, (mine[+id] || 0) + (+id === swap.from ? mine[swap.to] || 0 : 0)), 0);
  const total = Object.values(build).reduce((a, b) => a + b, 0);
  const build60 = idx.data ? makeLink(k, { level: 60, legacy: 0, ranks: build, order: normOrder(k, build, []), build: +idx.data.latest.split(".").pop()! }) : null;
  const marks: TreeMarks = { levels: new Map(), changed: new Set(extra.map(([id]) => +id)), pending: new Set(), flags: null, hl: null, flash: null, aff: new Set() };
  const name = (id: number) => M[id]?.name ?? `#${id}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl text-gold">{d.talents.split.join(" / ")}</span>
        <span className="text-sm text-muted">{compare ? t("pr_tal_match", { n: matched, t: total }) : t("pr_tal_before", { n: d.talents.fromLevel })}</span>
        {build60 && <button className="btn-primary ml-auto" onClick={() => nav(`/talents#${build60.replace(/^#/, "")}`)}>{t("pr_tal_calc")}</button>}
      </div>
      {compare && (missing.length > 0 || extra.length > 0) && (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {missing.length > 0 && <div className="prebis-group hit"><div className="prebis-glabel">{t("pr_tal_missing")}</div>
            {missing.map(([id, r]) => <div key={id}>{name(+id)}: {mine[+id] || 0}/{r}</div>)}</div>}
          {extra.length > 0 && <div className="prebis-group dmg"><div className="prebis-glabel">{t("pr_tal_extra")}</div>
            {extra.map(([id, r]) => <div key={id}>{name(+id)}: {r} → {build[+id] || 0}</div>)}</div>}
        </div>
      )}
      <p className="text-xs text-muted">{t("pr_tal_swap", { a: name(swap.from), b: name(swap.to) })}</p>
      <div ref={box} className="grid gap-3 md:grid-cols-3">
        {k.tabs.map((_, i) => (
          <TalentTree key={i} c={k} ti={i} M={M} ranks={compare ? mine : build} full={build} preview={compare} total={total}
            icons={icons.data} marks={marks} touch={false} readOnly onAdd={noop} onRemove={noop} onReset={noop}
            onTap={(x) => setTip({ x, el: document.body })} onHover={(x, el) => setTip(x && el ? { x, el } : null)} />
        ))}
      </div>
      {tip && createPortal(
        <TipBox el={tip.el} zone={box.current}>
          <TalentTip x={tip.x} c={k} M={M} ranks={compare ? mine : build} order={[]} start={10} planner={false} pending={[]} links={[]} hint={false} />
        </TipBox>, document.body)}
    </div>
  );
}

/** The stat priority (hit with the character's own numbers) and the rotation. */
export function GuidePane({ d }: { d: PreBis }) {
  const { t } = useI18n();
  const icons = useIcons();
  const h = d.hit;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="prebis-glabel">{t("pr_stats")}</div>
        <ol className="space-y-1.5">
          {(d.stats || []).map((s, i) => (
            <li key={s} className={`prebis-stat ${s === "hit" ? (h.planned >= h.cap ? "done" : "now") : ""}`}>
              <span className="n">{i + 1}</span>
              <span className="grid">
                <b>{t(`pr_stat_${s}` as Key)}{s === "hit" ? ` — ${h.planned}% / ${h.cap}%` : ""}</b>
                <span className="text-xs text-muted">{t(`pr_stat_${s}_h` as Key)}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="prebis-glabel">{t("pr_rotation")}</div>
        <div className="flex flex-wrap gap-3">
          {(d.rotation || []).map((r) => (
            <div key={r.spell} className="prebis-rot">
              <span className="ico" style={iconStyle(icons.data, r.icon)} />
              <b>{t(`pr_rot_${r.do}` as Key)}</b>
              <span className="text-xs">{t(`pr_spell_${r.spell}` as Key)}</span>
            </div>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{t("pr_rot_1")}</li><li>{t("pr_rot_2")}</li><li>{t("pr_rot_3")}</li>
        </ul>
      </div>
    </div>
  );
}

/** Consumables: what each gives and from which level; their tooltips from the game. */
export function ConsumablesPane({ d, level }: { d: PreBis; level?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <ul className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 26rem), 1fr))" }}>
        {(d.consumables || []).map((x) => (
          <li key={x.id} className="prebis-item">
            <ItemHover id={x.id}>
              <span tabIndex={0} className="inline-flex min-w-0 items-center gap-2.5">
                <ItemIcon itemId={x.id} size={34} />
                <span className="grid min-w-0 leading-tight">
                  <span className="truncate text-[15px]">{t(`pr_c_${x.id}` as Key)}</span>
                  <span className="truncate text-xs text-muted">{t(`pr_c_${x.id}_h` as Key)}</span>
                </span>
              </span>
            </ItemHover>
            <span className={`ml-auto shrink-0 text-xs ${level != null && x.req > level ? "text-[#ffb070]" : "text-muted"}`}>
              {x.req ? t("pr_from_lvl", { n: x.req }) : ""}
            </span>
            {d.market && x.ah && <AhChip id={x.id} ah={x.ah} />}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t("pr_c_note")}</p>
    </div>
  );
}

/** The enchantments the guide puts on each slot, against what the character's gear carries. */
export function EnchantsPane({ d }: { d: PreBis }) {
  const { t } = useI18n();
  const xs = d.enchants || [];
  if (!xs.length) return <p className="text-sm text-muted">{t("pr_en_nogear")}</p>;
  const missing = xs.filter((x) => x.state !== "ok" && !x.alt && !x.covered).length;
  return (
    <div className="space-y-3">
      <p className={`text-sm ${missing ? "text-[#ffb070]" : "text-good"}`}>{missing ? t("pr_en_missing", { n: missing }) : t("pr_en_all")}</p>
      <ul className="space-y-1.5">
        {xs.map((x) => (
          <li key={`${x.key}-${x.slot}`} className={`prebis-item ${x.state === "ok" ? "owned" : !x.alt && !x.covered ? "focus" : "alt"}`}>
            <span className="w-28 shrink-0 text-sm text-muted">{t(`slot_${x.slot}` as Key)}</span>
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="text-[15px]">{t(`pr_en_${x.key}` as Key)}{x.alt ? ` · ${t("pr_en_alt")}` : ""}</span>
              <span className="truncate text-xs text-muted">{t(`pr_en_${x.key}_h` as Key)} · {t(`pr_maker_${x.maker}` as Key)}</span>
            </span>
            <span className={`shrink-0 text-sm ${x.state === "ok" ? "text-good" : "text-muted"}`}>
              {x.state === "ok" ? `✓ ${t("pr_en_ok")}` : x.state === "other" ? `${t("pr_en_other")}: ${x.have.join(", ")}` : t("pr_en_none")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

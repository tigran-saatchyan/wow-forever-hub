/**
 * The chain side of the map page: which chain to show (stage by stage, in the order to do them), what the
 * chosen one is and why, what it needs first, and how far every character has come in it.
 */
import { Link } from "react-router-dom";
import { ItemHover, ItemIcon } from "../../components/Wow";
import { CHAINS, STAGES, fits, needMet, progress, type Chain } from "../../lib/chains";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { fullName, type Character } from "../../lib/wowApi";
import { ClassIcon } from "../Characters";
import { useTab } from "../characters/ArmoryTabs";

type Who = { faction?: string | null; classId?: number | null; level?: number | null };

/** Every chain, stage by stage; the current character's progress on each. */
export function ChainPicker({ current, ids, who, pick }: { current: string; ids: Set<number>; who: Who; pick: (k: string) => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="cn-stages">
      {STAGES.map((st) => {
        const list = CHAINS.filter((c) => c.stage === st.n && (!c.faction || !who.faction || c.faction === who.faction));
        if (!list.length) return null;
        return (
          <div key={st.n} className={`cn-stage ${st.announced ? "" : "later"}`}>
            <div className="cn-stage-head">
              <span className="cn-stage-n">{st.n}</span>
              <span className="font-display text-sm text-gold">{st.name[lang]}</span>
              {!st.announced && <span className="cn-tag">{t("cn_not_announced")}</span>}
            </div>
            <div className="text-[11px] text-muted">{st.note[lang]}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {list.map((c) => {
                const ok = fits(c, who.faction, who.classId);
                const p = progress(c, ids);
                return (
                  <button key={c.key} className={`chip cn-chip ${c.key === current ? "border-gold/60 text-gold" : ""} ${ok ? "" : "opacity-50"}`} onClick={() => pick(c.key)}
                    title={ok ? undefined : t("cn_not_for")}>
                    {c.name[lang]}
                    <span className={`cn-prog ${p.complete ? "text-good" : ""}`}>{!ok ? "—" : p.complete ? "✓" : `${p.done}/${p.total}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the chain is, why do it, what it gives and what it needs first. */
export function ChainInfo({ c, ids, who }: { c: Chain; ids: Set<number>; who: Who }) {
  const { t, lang } = useI18n();
  const st = STAGES.find((s) => s.n === c.stage)!;
  return (
    <div className="char-stats space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-lg text-gold">{c.name[lang]}</span>
        <span className="cn-tag">{t("cn_stage", { n: st.n })}: {st.name[lang]}</span>
        <span className="cn-tag">{t(`cn_cat_${c.category}` as Key)}</span>
        {c.minLevel && <span className="cn-tag">{t("cn_from_level", { l: c.minLevel })}</span>}
        {c.group && <span className="cn-tag">{c.group[lang]}</span>}
        {c.classic && <span className="text-[11px] text-muted">{c.classic[lang]}</span>}
      </div>
      {!fits(c, who.faction, who.classId) && <p className="text-sm text-[#ffb070]">{t("cn_not_for")}</p>}
      <p className="text-sm">{c.about[lang]}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className="eyebrow">{t("cn_reward")}</span>
        {c.reward.item ? (
          <ItemHover id={c.reward.item}><span className="inline-flex items-center gap-1.5"><ItemIcon itemId={c.reward.item} size={22} /><span className="text-gold">{c.reward.text[lang]}</span></span></ItemHover>
        ) : <span className="text-gold">{c.reward.text[lang]}</span>}
      </div>
      {c.needs.length > 0 && (
        <div>
          <div className="eyebrow mb-1">{t("cn_needs")}</div>
          <ul className="space-y-0.5 text-sm">
            {c.needs.map((n, i) => {
              const met = needMet(n, ids, who.level);
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className={met === true ? "text-good" : met === false ? "text-bad" : "text-muted"}>{met === true ? "✓" : met === false ? "✗" : "•"}</span>
                  <span className={met === true ? "text-muted" : ""}>{n.text[lang]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted">{c.level[lang]}</p>
    </div>
  );
}

/** Every character's status in the chain; a row makes that character the one the map follows. */
export function ChainChars({ c, chars, current, choose }: { c: Chain; chars: Character[]; current?: number; choose: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="char-stats">
      <div className="eyebrow mb-1.5">{t("cn_chars")}</div>
      <table className="w-full text-sm">
        <tbody>{chars.map((ch) => <CharRow key={ch.id} c={c} ch={ch} on={ch.id === current} choose={choose} />)}</tbody>
      </table>
    </div>
  );
}

function CharRow({ c, ch, on, choose }: { c: Chain; ch: Character; on: boolean; choose: (id: number) => void }) {
  const { t, lang } = useI18n();
  const s = ch.summary?.[lang];
  const done = useTab<{ ids?: number[] }>(ch.id, "quests");
  const ids = new Set(done.data?.data?.ids || []);
  const ok = fits(c, s?.faction, s?.classId);
  const p = progress(c, ids);
  return (
    <tr className={`cursor-pointer border-t border-edge/30 hover:bg-gold/5 ${on ? "bg-gold/10" : ""}`} onClick={() => choose(ch.id)}>
      <td className="py-1 pr-2"><span className="flex items-center gap-2"><ClassIcon classId={s?.classId ?? null} size={20} /><span className="truncate">{fullName(ch, lang)}</span></span></td>
      <td className="py-1 pr-2 text-xs text-muted">{t("ch_level", { l: s?.level ?? "?" })}</td>
      <td className="py-1 text-right">
        {!ok ? <span className="text-xs text-muted">{t("cn_not_for_short")}</span>
          : done.isLoading ? "…"
          : p.complete ? <span className="text-good">✓ {t("cn_finished")}</span>
          : <span className={p.done ? "text-gold" : "text-muted"}>{p.done}/{p.total}</span>}
      </td>
    </tr>
  );
}

/** A link to a chain on the map, following one character. */
export function ChainLink({ chain, char, children }: { chain: string; char?: number; children: React.ReactNode }) {
  return <Link to={`/map?chain=${chain}`} onClick={() => char && store.set("mapChar", char)} className="hover:underline">{children}</Link>;
}

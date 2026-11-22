/**
 * The recipe behind a consumable, for a character with the profession: a short line (profession and skill, theirs,
 * known or not) and, on hover, the recipe, where to learn it for their side (trainer, vendor with place and price)
 * and its reagents. Nothing for a consumable no profession makes.
 */
import { ProfIcon } from "../../components/CharProfPicker";
import { EdgeTip, useEdgeTip } from "../../components/EdgeTip";
import { RecipeHow } from "../../components/RecipeHow";
import { ItemIcon } from "../../components/Wow";
import { useI18n, type Key } from "../../lib/i18n";
import type { ConsRecipe } from "../../lib/wowApi";

export function RecipeBadge({ r }: { r: ConsRecipe }) {
  const { t } = useI18n();
  const tip = useEdgeTip();
  const has = r.have != null;
  const low = has && r.have! < r.skill;
  const state = r.known ? "known" : !has ? "noprof" : low ? "low" : "learn";
  const color = state === "known" ? "text-good" : state === "noprof" ? "text-muted" : "text-[#ffb070]";
  return (
    <>
    <span {...tip.bind} className="rc-badge" tabIndex={0}>
      <ProfIcon id={r.profession.id} size={14} />
      <span className={color}>
        {r.profession.name} {r.skill}
        {has && !r.known ? <span className="text-muted"> · {t("rc_have", { n: r.have! })}</span> : null}
        {" · "}{t(`rc_${state}` as Key)}
      </span>
      <EdgeTip anchor={tip.anchor} open={tip.open}><span className="block max-w-[22rem] text-[13px]">
        <span className="block text-[#ffd100]">{r.name}</span>
        <span className="block">{t("rc_needs", { p: r.profession.name, n: r.skill })}{has ? ` · ${t("rc_have", { n: r.have! })}` : ` · ${t("rc_noprof")}`}</span>
        <span className={`block ${color}`}>{t(`rc_${state}_h` as Key, { n: Math.max(0, r.skill - (r.have ?? 0)) })}</span>
        {r.reagents.length > 0 && (
          <span className="mt-1.5 block">
            <span className="block text-muted">{t("rc_reagents")}:</span>
            {r.reagents.map((x) => (
              <span key={x.id} className="flex items-center gap-1.5 text-xs"><ItemIcon itemId={x.id} size={16} />{x.name ?? `#${x.id}`} ×{x.count}</span>
            ))}
          </span>
        )}
      </span></EdgeTip>
    </span>
    {!r.known && r.how && <RecipeHow how={r.how} recipe={r.name} item={r.recipeItem} skill={t("rc_needs", { p: r.profession.name, n: r.skill })} />}
    </>
  );
}

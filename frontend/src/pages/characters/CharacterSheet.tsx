/** The character window as in the game: slots down both sides, weapons below, the model in the middle. */
import { ItemHover, ItemIcon } from "../../components/Wow";
import type { ClassData } from "../../engine";
import { useI18n, type Key } from "../../lib/i18n";
import { fullName, media, qColor, type Character, type EquipItem } from "../../lib/wowApi";

const LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];

function Slot({ slot, x }: { slot: string; x?: EquipItem }) {
  const { t } = useI18n();
  const name = t(`slot_${slot}` as Key);
  if (!x)
    return (
      <span className="slot-empty" title={name} aria-label={name}>
        <span>{name.slice(0, 1)}</span>
      </span>
    );
  return (
    <ItemHover
      id={x.id}
      extra={(x.enchants || []).filter((e) => typeof e === "string").map((e) => <div key={e} className="text-[#1eff00]">{e}</div>)}
      fallback={{ id: x.id, name: x.name, quality: x.quality, level: x.ilvl, slot: x.slotName, stats: x.stats || [], spells: [] }}
    >
      <span tabIndex={0} className="relative block outline-none" aria-label={`${name}: ${x.name}`}>
        <ItemIcon src={x.icon} quality={x.quality} size={44} />
        {x.ilvl ? <span className="slot-ilvl" style={{ color: qColor(x.quality) }}>{x.ilvl}</span> : null}
      </span>
    </ItemHover>
  );
}

// the game's order: primary stats, then melee / ranged / spell, then defence
const GROUPS: { title: Key; keys: string[] }[] = [
  { title: "st_base", keys: ["strength", "agility", "stamina", "intellect", "spirit", "armor"] },
  { title: "st_attack", keys: ["attack_power", "melee_crit", "ranged_crit", "melee_haste"] },
  { title: "st_spell", keys: ["spell_power", "spell_crit", "spell_haste", "mana_regen"] },
  { title: "st_defense", keys: ["defense", "dodge", "parry", "block"] },
];
const PCT = new Set(["melee_crit", "ranged_crit", "spell_crit", "dodge", "parry", "block", "melee_haste", "spell_haste", "mastery"]);

export function CharacterSheet({ c, k }: { c: Character; k?: ClassData }) {
  const { t, lang } = useI18n();
  const s = c.summary?.[lang];
  const eq = new Map((c.equipment?.[lang] || []).map((x) => [x.slot, x]));
  const st = c.stats?.[lang] as Record<string, number | string> | undefined;
  const model = media(c.model);
  return (
    <div className="char-sheet">
      <div className="char-doll">
        <div className="flex flex-col gap-1.5">{LEFT.map((sl) => <Slot key={sl} slot={sl} x={eq.get(sl)} />)}</div>
        <div className="char-model">
          <div className="text-center leading-tight">
            <div className="font-display text-xl" style={{ color: k?.color }}>{fullName(c, lang)}</div>
            <div className="text-xs text-muted">{t("ch_level", { l: s?.level ?? "?" })} {s?.race} {s?.className}</div>
            {s?.guild?.name && <div className="text-xs text-ink">&lt;{s.guild.name}&gt;</div>}
          </div>
          {model ? <div className="char-render-box"><img src={model} alt="" className="char-render" /></div> : <div className="char-render-empty" />}
          {s?.ilvl ? <div className="text-center text-xs text-muted">{t("ch_ilvl", { i: s.ilvl })}</div> : null}
        </div>
        <div className="flex flex-col gap-1.5">{RIGHT.map((sl) => <Slot key={sl} slot={sl} x={eq.get(sl)} />)}</div>
        <div className="col-span-3 flex justify-center gap-1.5 pt-1">{BOTTOM.map((sl) => <Slot key={sl} slot={sl} x={eq.get(sl)} />)}</div>
      </div>

      <div className="space-y-3">
        {st ? (
          <>
            <div className="char-bars">
              {typeof st.health === "number" && <div className="bar hp"><span>{t("st_health")}</span><b>{st.health}</b></div>}
              {typeof st.power === "number" && <div className="bar mp"><span>{st.powerName ?? t("st_power")}</span><b>{st.power}</b></div>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {GROUPS.map((g) => {
                const rows = g.keys.filter((key) => typeof st[key] === "number");
                if (!rows.length) return null;
                return (
                  <div key={g.title} className="char-stats">
                    <div className="eyebrow mb-1">{t(g.title)}</div>
                    {rows.map((key) => (
                      <div key={key} className="flex justify-between gap-3 text-sm">
                        <span className="text-[#ffd100]">{t(`st_${key}` as Key)}</span>
                        <span className="font-mono tabular-nums">{st[key]}{PCT.has(key) ? "%" : ""}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{t("ch_no_stats")}</p>
        )}
        <Professions c={c} />
      </div>
    </div>
  );
}

export function Professions({ c }: { c: Character }) {
  const { t, lang } = useI18n();
  const xs = c.professions?.[lang];
  if (!xs) return c.missing?.includes("professions") ? <p className="text-sm text-muted">{t("ch_no_prof")}</p> : null;
  if (!xs.length) return <p className="text-sm text-muted">{t("ch_prof_none")}</p>;
  return (
    <div className="char-stats">
      <div className="eyebrow mb-1.5">{t("ch_prof")}</div>
      <ul className="space-y-1.5">
        {xs.map((p) => (
          <li key={p.name}>
            <div className="flex justify-between text-sm">
              <span className={p.kind === "primary" ? "text-ink" : "text-muted"}>{p.name}</span>
              <span className="font-mono text-xs tabular-nums">{p.skill ?? "?"}{p.max ? ` / ${p.max}` : ""}</span>
            </div>
            {p.skill != null && p.max ? (
              <div className="prof-bar"><span style={{ width: `${Math.min(100, (p.skill / p.max) * 100)}%` }} /></div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

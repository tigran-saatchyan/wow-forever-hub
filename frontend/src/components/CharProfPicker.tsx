/**
 * Pick one character's profession (or all of them): grouped by character, the class icon on the left and the
 * profession's icon on the right, as a native select cannot draw.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { media, useCharacters } from "../lib/wowApi";
import { ClassIcon } from "../pages/Characters";

export interface ProfOption { cid: number; char: string; prof: number; profName: string; skill: number | null }

// the classic profession icons, by skill line
const PROF_ICON: Record<number, string> = {
  164: "trade_blacksmithing", 165: "trade_leatherworking", 171: "trade_alchemy", 182: "trade_herbalism",
  185: "inv_misc_food_15", 186: "trade_mining", 197: "trade_tailoring", 202: "trade_engineering",
  333: "trade_engraving", 356: "trade_fishing", 393: "inv_misc_pelt_wolf_01", 129: "spell_holy_sealofsacrifice",
  755: "inv_misc_gem_01", 773: "inv_inscription_tradeskill01",
};

export function ProfIcon({ id, size = 20 }: { id: number; size?: number }) {
  const n = PROF_ICON[id];
  return n ? (
    <img className="flex-none rounded-sm border border-black" width={size} height={size} alt=""
      src={media(`https://wow.zamimg.com/images/wow/icons/medium/${n}.jpg`)} />
  ) : <span className="flex-none rounded-sm bg-edge" style={{ width: size, height: size }} />;
}

export const profKey = (o: { cid: number; prof: number }) => `${o.cid}:${o.prof}`;

export function CharProfPicker({ options, value, onChange, all }:
  { options: ProfOption[]; value: string; onChange: (k: string) => void; all?: string }) {
  const { lang } = useI18n();
  const chars = useCharacters().data || [];
  const cls = (cid: number) => chars.find((c) => c.id === cid)?.summary?.[lang]?.classId ?? null;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const groups = useMemo(() => {
    const g = new Map<number, ProfOption[]>();
    for (const o of options) g.set(o.cid, [...(g.get(o.cid) || []), o]);
    return [...g.values()];
  }, [options]);
  const cur = options.find((o) => profKey(o) === value);
  const pick = (k: string) => { onChange(k); setOpen(false); };
  const Line = ({ o }: { o: ProfOption }) => (
    <>
      <ClassIcon classId={cls(o.cid)} size={20} />
      <span className="truncate">{o.char}</span>
      <span className="text-muted">·</span>
      <span className="truncate">{o.profName}{o.skill != null ? <span className="text-muted"> {o.skill}</span> : null}</span>
      <span className="ml-auto pl-2"><ProfIcon id={o.prof} /></span>
    </>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className="input flex min-w-[260px] items-center gap-2 py-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {cur ? <Line o={cur} /> : <span className="truncate">{all}</span>}
        <span className="ml-1 text-muted">▾</span>
      </button>
      {open && (
        <div className="cp-menu" role="listbox">
          {all && <button type="button" className={`cp-opt ${!cur ? "on" : ""}`} onClick={() => pick("all")}>{all}</button>}
          {groups.map((g) => (
            <div key={g[0].cid} className="cp-group">
              <div className="cp-head"><ClassIcon classId={cls(g[0].cid)} size={22} /><span>{g[0].char}</span></div>
              {g.map((o) => (
                <button type="button" key={profKey(o)} className={`cp-opt ${profKey(o) === value ? "on" : ""}`} style={{ paddingLeft: 38 }} onClick={() => pick(profKey(o))}>
                  <span className="truncate">{o.profName}</span>
                  {o.skill != null && <span className="text-xs text-muted">{o.skill}</span>}
                  <span className="ml-auto"><ProfIcon id={o.prof} /></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

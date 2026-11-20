/** The character picker in the top menu: one choice for every page (Crafting keeps its own). Favorites first. */
import { useEffect, useRef, useState } from "react";
import { useActiveChar } from "../lib/activeChar";
import { useI18n } from "../lib/i18n";
import { fullName, media, type Character } from "../lib/wowApi";
import { ClassIcon } from "../pages/Characters";

function Face({ c, size }: { c: Character; size: number }) {
  const { lang } = useI18n();
  const url = media(c.avatar);
  return url
    ? <img src={url} alt="" width={size} height={size} className="flex-none rounded border border-black object-cover" style={{ width: size, height: size }} />
    : <ClassIcon classId={c.summary?.[lang]?.classId ?? null} size={size} />;
}

export function ActiveCharPicker() {
  const { t, lang } = useI18n();
  const { chars, char, set } = useActiveChar();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!char) return null;
  const line = (c: Character) => {
    const s = c.summary?.[lang];
    return s ? `${t("ch_level", { l: s.level ?? "?" })} · ${s.className}` : "";
  };
  const favs = chars.filter((c) => c.favorite), rest = chars.filter((c) => !c.favorite);
  const item = (c: Character) => (
    <li key={c.id}>
      <button type="button" role="option" aria-selected={c.id === char.id}
        className={`acp-item ${c.id === char.id ? "on" : ""}`} onClick={() => (set(c.id), setOpen(false))}>
        <Face c={c} size={28} />
        <span className="grid min-w-0 text-left leading-tight">
          <span className="truncate">{c.favorite && <span className="text-[#ffd100]">★ </span>}{fullName(c, lang)}</span>
          <span className="truncate text-xs text-muted">{line(c)}</span>
        </span>
      </button>
    </li>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className="acp-btn" aria-haspopup="listbox" aria-expanded={open} title={t("acp_title")}
        onClick={() => setOpen(!open)}>
        <Face c={char} size={26} />
        <span className="grid min-w-0 text-left leading-tight">
          <span className="max-w-[11rem] truncate">{fullName(char, lang)}</span>
          <span className="hidden text-[11px] text-muted min-[1600px]:block">{line(char)}</span>
        </span>
        <span className="text-muted" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="acp-list" role="listbox">
          {favs.map(item)}
          {favs.length > 0 && rest.length > 0 && <li className="acp-sep" aria-hidden />}
          {rest.map(item)}
        </ul>
      )}
    </div>
  );
}

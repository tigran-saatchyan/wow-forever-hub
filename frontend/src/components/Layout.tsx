import { useNewSignals } from "../lib/signals";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ActiveCharPicker } from "./ActiveCharPicker";
import { useLogout, useMe } from "../lib/auth";
import { useIndex } from "../lib/gameData";
import { LANGS, useI18n, type Key } from "../lib/i18n";
import { Ambient } from "../theme/Ambient";
import { Lamenters } from "../theme/Lamenters";
import { MusicPlayer } from "./MusicPlayer";
import { THEMES } from "../theme/themes";
import { useTheme } from "../theme/ThemeProvider";

/** Six sections; two of them hold two pages each, shown as tabs under the menu. */
const GROUPS: { key: Key; tabs: { to: string; label: Key }[] }[] = [
  { key: "nav_throne", tabs: [{ to: "/", label: "nav_throne" }, { to: "/news", label: "nav_news" }] },
  { key: "nav_chars", tabs: [{ to: "/characters", label: "nav_chars" }] },
  { key: "nav_talents", tabs: [{ to: "/talents", label: "nav_talents" }] },
  { key: "nav_raids", tabs: [{ to: "/raids", label: "nav_raids" }] },
  { key: "nav_trade", tabs: [{ to: "/market", label: "nav_market" }, { to: "/craft", label: "nav_craft" }] },
  { key: "nav_map", tabs: [{ to: "/map", label: "nav_map" }] },
];
const inGroup = (g: (typeof GROUPS)[number], path: string) => g.tabs.some((x) => (x.to === "/" ? path === "/" : path.startsWith(x.to)));

/** Theme, sound, language, the client build and signing out: rarely touched, kept behind one gear. */
function Settings() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme, sound, setSound, sfx } = useTheme();
  const me = useMe();
  const logout = useLogout();
  const idx = useIndex();
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
  return (
    <div ref={box} className="relative">
      <button className="btn px-2.5 text-base" aria-expanded={open} aria-label={t("set_title")} title={t("set_title")} onClick={() => setOpen(!open)}>⚙</button>
      {open && (
        <div className="set-pop">
          <label className="set-row"><span>{t("theme")}</span>
            <select className="input py-1" value={theme.id} onChange={(e) => (setTheme(e.target.value), sfx("open"))}>
              {THEMES.map((th) => <option key={th.id} value={th.id}>{th.name[lang]}</option>)}
            </select>
          </label>
          <div className="set-row"><span>{t("set_sound")}</span>
            <button className="btn px-2" onClick={() => setSound(!sound)} title={sound ? t("sound_on") : t("sound_off")}>{sound ? "🔊" : "🔇"}</button>
          </div>
          <div className="set-row"><span>{t("set_lang")}</span>
            <div className="flex overflow-hidden rounded-md border border-edge">
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)} className={`px-2 py-1 text-xs uppercase ${l === lang ? "bg-accent/25 text-gold" : "text-muted"}`}>{l}</button>
              ))}
            </div>
          </div>
          {idx.data && <div className="set-row"><span>{t("set_build")}</span><span className="chip">{idx.data.latest}</span></div>}
          {me.data && (
            <div className="set-row border-t border-edge/60 pt-2">
              <span className="truncate text-xs text-muted">{me.data.email}</span>
              <button className="btn" onClick={() => logout.mutate()}>{t("nav_logout")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { theme, sfx } = useTheme();
  const me = useMe();
  const loc = useLocation();
  const group = GROUPS.find((g) => inGroup(g, loc.pathname));

  const link = ({ isActive }: { isActive: boolean }) =>
    `font-display tracking-wider px-2 min-[1600px]:px-3 py-1.5 rounded-md transition ${
      isActive ? "text-gold bg-accent/15 shadow-[0_0_14px_-4px_var(--glow)]" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="min-h-screen">
      <Ambient />
      {theme.id === "undercity" && <Lamenters />}
      <header className="site-header sticky top-0 z-30 border-b border-edge/60 bg-bg/80 backdrop-blur">
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 lg:px-6">
          <NavLink to="/" className="flex items-center gap-2.5" onClick={() => sfx("nav")}>
            {theme.id === "undercity"
              ? <img src="/undercity/crest-96.webp" alt="" className="brand-crest h-10 w-10" />
              : <img src="/favicon.svg" alt="" className="h-7 w-7 drop-shadow-[0_0_8px_var(--glow)]" />}
            <span className="grid leading-none">
              <span className="font-display text-lg font-bold tracking-widest text-gold">FOREVER HUB</span>
              {theme.id === "undercity" && <span className="brand-sub mt-1">{t("uc_sub")}</span>}
            </span>
          </NavLink>
          {me.data && (
            <nav className="flex flex-wrap gap-0.5 text-sm">
              {GROUPS.map((g) => (
                <NavLink key={g.key} to={g.tabs[0].to} end={g.tabs[0].to === "/"} onClick={() => sfx("nav")}
                  className={() => link({ isActive: inGroup(g, loc.pathname) })}>
                  {t(g.key)}{g.key === "nav_trade" && <SignalBadge />}
                </NavLink>
              ))}
            </nav>
          )}
          {me.data && group && group.tabs.length > 1 && (
            <div className="sub-nav">
              {group.tabs.map((x) => (
                <NavLink key={x.to} to={x.to} end onClick={() => sfx("nav")} className={({ isActive }) => (isActive ? "on" : "")}>
                  {t(x.label)}{x.to === "/craft" && <SignalBadge />}
                </NavLink>
              ))}
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            {me.data && !loc.pathname.startsWith("/craft") && <ActiveCharPicker />}
            {theme.id === "undercity" && <MusicPlayer />}
            <Settings />
          </div>
        </div>
      </header>
      <main className="w-full px-4 py-6 lg:px-6">{children}</main>
      {/* ForeverDB's terms: a visible link wherever its data is shown (the site shows it on many pages) */}
      <footer className="px-4 pb-6 text-center text-xs text-muted lg:px-6">
        <a className="hover:text-gold" href="https://foreverdb.net" target="_blank" rel="noopener noreferrer">{t("fdb_credit")}</a>
        <span className="mx-2">·</span>{t("fdb_blizzard")}
      </footer>
    </div>
  );
}

/** New crafting signals since the Crafting page was last open. */
function SignalBadge() {
  const n = useNewSignals();
  return n > 0 ? <span className="nav-badge" aria-label={String(n)}>{n > 99 ? "99+" : n}</span> : null;
}

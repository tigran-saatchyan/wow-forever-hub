import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";
import { useIndex } from "../lib/gameData";
import { LANGS, useI18n } from "../lib/i18n";
import { Ambient } from "../theme/Ambient";
import { Lamenters } from "../theme/Lamenters";
import { MusicPlayer } from "./MusicPlayer";
import { THEMES } from "../theme/themes";
import { useTheme } from "../theme/ThemeProvider";

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme, sound, setSound, sfx } = useTheme();
  const me = useMe();
  const logout = useLogout();
  const idx = useIndex();

  const link = ({ isActive }: { isActive: boolean }) =>
    `font-display tracking-wider px-3 py-1.5 rounded-md transition ${
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
            <nav className="flex flex-wrap gap-1 text-sm">
              <NavLink to="/" end className={link} onClick={() => sfx("nav")}>{t("nav_throne")}</NavLink>
              <NavLink to="/news" className={link} onClick={() => sfx("nav")}>{t("nav_news")}</NavLink>
              <NavLink to="/talents" className={link} onClick={() => sfx("nav")}>{t("nav_talents")}</NavLink>
              <NavLink to="/characters" className={link} onClick={() => sfx("nav")}>{t("nav_chars")}</NavLink>
              <NavLink to="/market" className={link} onClick={() => sfx("nav")}>{t("nav_market")}</NavLink>
            </nav>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            {idx.data && <span className="chip hidden sm:inline">{idx.data.latest}</span>}
            <select
              aria-label={t("theme")}
              className="input py-1"
              value={theme.id}
              onChange={(e) => (setTheme(e.target.value), sfx("open"))}
            >
              {THEMES.map((th) => (
                <option key={th.id} value={th.id}>{th.name[lang]}</option>
              ))}
            </select>
            <button className="btn px-2" onClick={() => setSound(!sound)} title={sound ? t("sound_on") : t("sound_off")}>
              {sound ? "🔊" : "🔇"}
            </button>
            {theme.id === "undercity" && <MusicPlayer />}
            <div className="flex overflow-hidden rounded-md border border-edge">
              {LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-2 py-1 text-xs uppercase ${l === lang ? "bg-accent/25 text-gold" : "text-muted"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {me.data && (
              <button className="btn" onClick={() => logout.mutate()} title={me.data.email}>
                {t("nav_logout")}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="w-full px-4 py-6 lg:px-6">{children}</main>
    </div>
  );
}


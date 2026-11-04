import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { store } from "../lib/store";
import { play, type Cue } from "./sound";
import { themeById, type Theme } from "./themes";

interface Ctx {
  theme: Theme;
  setTheme: (id: string) => void;
  sound: boolean;
  setSound: (on: boolean) => void;
  sfx: (cue: Cue) => void;
}
const ThemeCtx = createContext<Ctx>(null!);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState(() => store.get("theme", "undead"));
  const [sound, setSoundState] = useState(() => store.get("sound", false)); // off until the user turns it on
  const theme = themeById(id);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.colors)) root.style.setProperty(`--${k}`, v);
    root.style.setProperty("--glow", theme.glow);
    root.style.setProperty("--backdrop", theme.backdrop);
    root.dataset.theme = theme.id;
    root.dataset.faction = theme.faction;
  }, [theme]);

  const sfx = useCallback((cue: Cue) => play(theme.id, theme.voice, cue, sound), [theme.id, theme.voice, sound]);
  const value = useMemo<Ctx>(
    () => ({
      theme,
      sound,
      sfx,
      setTheme: (t) => (store.set("theme", t), setId(t)),
      setSound: (on) => (store.set("sound", on), setSoundState(on)),
    }),
    [theme, sound, sfx],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

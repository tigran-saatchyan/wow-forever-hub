/**
 * Themes by faction and race. Colors are "R G B" triplets so Tailwind can add alpha.
 * To add a race: copy an entry, change palette, ambient effect and sound voice.
 */
export type Ambient = "embers" | "mist";
export type Voice = "drums" | "ghost";

export interface Theme {
  id: string;
  faction: "horde" | "alliance";
  name: { ru: string; en: string };
  colors: Record<"bg" | "panel" | "edge" | "ink" | "muted" | "accent" | "accent2" | "gold" | "good" | "bad", string>;
  glow: string; // css color for glows
  backdrop: string; // css background for the page
  ambient: Ambient;
  voice: Voice;
}

export const THEMES: Theme[] = [
  {
    id: "horde",
    faction: "horde",
    name: { ru: "Орда", en: "Horde" },
    colors: {
      bg: "14 9 8", panel: "29 18 15", edge: "92 52 33", ink: "240 228 210", muted: "170 148 128",
      accent: "196 38 28", accent2: "232 120 40", gold: "226 182 92", good: "120 200 90", bad: "230 70 60",
    },
    glow: "rgba(220, 70, 30, .55)",
    backdrop:
      "radial-gradient(1200px 600px at 50% -10%, rgba(160,30,20,.35), transparent 60%)," +
      "radial-gradient(800px 500px at 100% 100%, rgba(120,50,10,.25), transparent 60%), #0e0908",
    ambient: "embers",
    voice: "drums",
  },
  {
    id: "undead",
    faction: "horde",
    name: { ru: "Нежить", en: "Undead" },
    colors: {
      bg: "8 10 12", panel: "18 22 24", edge: "58 72 66", ink: "222 230 220", muted: "136 152 142",
      accent: "122 196 96", accent2: "150 110 200", gold: "200 190 140", good: "140 220 110", bad: "220 80 110",
    },
    glow: "rgba(130, 210, 100, .45)",
    backdrop:
      "radial-gradient(1000px 600px at 20% -10%, rgba(80,140,70,.22), transparent 60%)," +
      "radial-gradient(900px 600px at 90% 110%, rgba(100,60,150,.25), transparent 60%), #080a0c",
    ambient: "mist",
    voice: "ghost",
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

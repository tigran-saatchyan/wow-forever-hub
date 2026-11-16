/**
 * Themes by faction and race. Colors are "R G B" triplets so Tailwind can add alpha.
 * To add a race: copy an entry, change palette, ambient effect and sound voice.
 */
export type Ambient = "embers" | "mist" | "plague";
export type Voice = "drums" | "ghost";

export interface Theme {
  id: string;
  faction: "horde" | "alliance";
  name: { ru: string; en: string };
  colors: Record<"bg" | "panel" | "edge" | "ink" | "muted" | "accent" | "accent2" | "gold" | "good" | "bad", string>;
  glow: string; // css color for glows
  backdrop: string; // css background for the page
  /** full-screen art behind everything (with parallax), when the theme has one */
  art?: string;
  ambient: Ambient;
  voice: Voice;
}

export const THEMES: Theme[] = [
  {
    // The Undercity: bronze and black stone, the green light of the plague, the violet haze of the banshees.
    id: "undercity",
    faction: "horde",
    name: { ru: "Подгород", en: "Undercity" },
    colors: {
      bg: "5 9 9", panel: "12 18 18", edge: "62 84 72", ink: "222 234 222", muted: "134 156 144",
      accent: "116 214 84", accent2: "168 108 232", gold: "205 176 112", good: "126 226 96", bad: "232 84 120",
    },
    glow: "rgba(116, 214, 84, .5)",
    backdrop:
      "radial-gradient(1200px 700px at 50% 120%, rgba(90,190,70,.16), transparent 60%)," +
      "radial-gradient(900px 600px at 0% 0%, rgba(140,90,210,.14), transparent 60%), #050909",
    art: "/undercity/lordaeron.webp",
    ambient: "plague",
    voice: "ghost",
  },
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
];

/** "undead" was the old name of the Forsaken theme: it opens the Undercity now. */
export const themeById = (id: string) => THEMES.find((t) => t.id === (id === "undead" ? "undercity" : id)) ?? THEMES[0];

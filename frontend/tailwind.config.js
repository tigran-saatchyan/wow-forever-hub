/** Colors come from CSS variables set per theme (src/theme/themes.ts), so one class works in every theme. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), panel: v("panel"), edge: v("edge"), ink: v("ink"), muted: v("muted"),
        accent: v("accent"), accent2: v("accent2"), gold: v("gold"), good: v("good"), bad: v("bad"),
      },
      fontFamily: { display: ["Cinzel", "serif"], body: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};

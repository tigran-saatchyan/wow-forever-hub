import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

/** Background particles: rising embers for the Horde, drifting green mist motes for the Undead. */
export function Ambient() {
  const { theme } = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d");
    if (!g || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let w = 0;
    let h = 0;
    const resize = () => {
      w = cv.width = innerWidth;
      h = cv.height = innerHeight;
    };
    resize();
    addEventListener("resize", resize);
    const embers = theme.ambient === "embers";
    const N = embers ? 60 : 40;
    const P = Array.from({ length: N }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: embers ? 1 + Math.random() * 2 : 20 + Math.random() * 60,
      vx: (Math.random() - 0.5) * (embers ? 0.4 : 0.2), vy: embers ? -0.3 - Math.random() * 0.8 : -0.05 - Math.random() * 0.15,
      a: Math.random(), t: Math.random() * 6,
    }));
    let raf = 0;
    const tick = () => {
      g.clearRect(0, 0, w, h);
      for (const p of P) {
        p.x += p.vx + Math.sin((p.t += 0.01)) * 0.2;
        p.y += p.vy;
        if (p.y < -80) { p.y = h + 40; p.x = Math.random() * w; }
        const alpha = embers ? 0.35 + 0.35 * Math.sin(p.t * 3 + p.a * 6) : 0.05 + 0.04 * Math.sin(p.t + p.a * 6);
        const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * (embers ? 3 : 1));
        grd.addColorStop(0, embers ? `rgba(255,150,60,${alpha})` : `rgba(140,220,110,${alpha})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(p.x, p.y, p.r * (embers ? 3 : 1), 0, Math.PI * 2);
        g.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => (cancelAnimationFrame(raf), removeEventListener("resize", resize));
  }, [theme.ambient]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10" />;
}

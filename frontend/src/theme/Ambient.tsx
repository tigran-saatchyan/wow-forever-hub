import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

/**
 * Living background.
 * - Horde: rising embers. Undead (old): drifting green motes.
 * - Undercity: the theme's art behind everything with a slow parallax; banks of green plague fog rolling
 *   along the bottom, motes rising from the canals, bats crossing now and then, and a violet banshee wisp
 *   that drifts by rarely. All of it stops when the system asks for reduced motion.
 */
export function Ambient() {
  const { theme } = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // parallax: the art moves a little slower than the page
  useEffect(() => {
    const el = art.current;
    if (!el || still) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = scrollY;
        el.style.transform = `translate3d(0, ${-y * 0.06}px, 0) scale(1.12)`;
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => (cancelAnimationFrame(raf), removeEventListener("scroll", onScroll));
  }, [theme.art, still]);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d");
    if (!g || still) return;
    let w = 0;
    let h = 0;
    const resize = () => {
      w = cv.width = innerWidth;
      h = cv.height = innerHeight;
    };
    resize();
    addEventListener("resize", resize);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    let raf = 0;
    let tick: () => void;

    if (theme.ambient === "plague") {
      const fog = Array.from({ length: 9 }, (_, i) => ({
        x: rnd(-200, w), y: h * rnd(0.62, 1.02), r: rnd(220, 420), vx: rnd(0.08, 0.25) * (i % 2 ? 1 : -1), t: rnd(0, 6),
      }));
      const motes = Array.from({ length: 70 }, () => ({
        x: rnd(0, w), y: rnd(0, h), r: rnd(0.6, 2.2), vy: -rnd(0.15, 0.6), t: rnd(0, 6), a: rnd(0.3, 1),
      }));
      type Bat = { x: number; y: number; vx: number; s: number; t: number };
      let bats: Bat[] = [];
      let wisp: { x: number; y: number; vx: number; t: number; trail: { x: number; y: number }[] } | null = null;
      let frame = 0;

      const drawBat = (b: Bat) => {
        const flap = Math.sin(b.t * 18) * 0.55;
        g.save();
        g.translate(b.x, b.y);
        g.scale(b.s * Math.sign(b.vx), b.s);
        g.fillStyle = "rgba(4,8,6,.85)";
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(-6, -6 - flap * 8, -14, -2 - flap * 10);
        g.quadraticCurveTo(-10, 0, -12, 3);
        g.quadraticCurveTo(-6, 1, -2, 4);
        g.lineTo(0, 2);
        g.lineTo(2, 4);
        g.quadraticCurveTo(6, 1, 12, 3);
        g.quadraticCurveTo(10, 0, 14, -2 - flap * 10);
        g.quadraticCurveTo(6, -6 - flap * 8, 0, 0);
        g.fill();
        g.restore();
      };

      tick = () => {
        frame++;
        g.clearRect(0, 0, w, h);
        // fog banks along the bottom
        for (const f of fog) {
          f.x += f.vx;
          f.t += 0.004;
          if (f.x - f.r > w + 50) f.x = -f.r;
          if (f.x + f.r < -50) f.x = w + f.r;
          const a = 0.07 + 0.035 * Math.sin(f.t * 2);
          const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
          gr.addColorStop(0, `rgba(110,200,90,${a})`);
          gr.addColorStop(0.55, `rgba(70,140,70,${a * 0.45})`);
          gr.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = gr;
          g.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
        }
        // motes rising from the canals
        for (const m of motes) {
          m.y += m.vy;
          m.t += 0.02;
          m.x += Math.sin(m.t) * 0.25;
          if (m.y < -10) (m.y = h + 10, m.x = rnd(0, w));
          const a = m.a * (0.35 + 0.35 * Math.sin(m.t * 2.3));
          g.fillStyle = `rgba(150,240,110,${a})`;
          g.shadowColor = "rgba(120,230,90,.9)";
          g.shadowBlur = 8;
          g.beginPath();
          g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
          g.fill();
        }
        g.shadowBlur = 0;
        // a few bats now and then
        if (frame % 600 === 0 && Math.random() < 0.6) {
          const left = Math.random() < 0.5;
          const n = 2 + Math.floor(Math.random() * 4);
          for (let i = 0; i < n; i++)
            bats.push({ x: left ? -40 - i * 30 : w + 40 + i * 30, y: rnd(h * 0.08, h * 0.45), vx: (left ? 1 : -1) * rnd(2.2, 3.6), s: rnd(0.8, 1.6), t: rnd(0, 6) });
        }
        bats = bats.filter((b) => b.x > -80 && b.x < w + 80);
        for (const b of bats) {
          b.x += b.vx;
          b.t += 0.016;
          b.y += Math.sin(b.t * 5) * 0.8;
          drawBat(b);
        }
        // a banshee wisp, rarely
        if (!wisp && frame % 1500 === 0) wisp = { x: -60, y: rnd(h * 0.2, h * 0.7), vx: rnd(1.4, 2.2), t: 0, trail: [] };
        if (wisp) {
          wisp.x += wisp.vx;
          wisp.t += 0.03;
          wisp.y += Math.sin(wisp.t * 2) * 1.2;
          wisp.trail.unshift({ x: wisp.x, y: wisp.y });
          wisp.trail = wisp.trail.slice(0, 40);
          wisp.trail.forEach((p, i) => {
            const a = (1 - i / 40) * 0.35;
            const r = 18 * (1 - i / 50);
            const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            gr.addColorStop(0, `rgba(200,160,255,${a})`);
            gr.addColorStop(1, "rgba(120,60,200,0)");
            g.fillStyle = gr;
            g.beginPath();
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            g.fill();
          });
          if (wisp.x > w + 100) wisp = null;
        }
        raf = requestAnimationFrame(tick);
      };
    } else {
      const embers = theme.ambient === "embers";
      const N = embers ? 60 : 40;
      const P = Array.from({ length: N }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: embers ? 1 + Math.random() * 2 : 20 + Math.random() * 60,
        vx: (Math.random() - 0.5) * (embers ? 0.4 : 0.2), vy: embers ? -0.3 - Math.random() * 0.8 : -0.05 - Math.random() * 0.15,
        a: Math.random(), t: Math.random() * 6,
      }));
      tick = () => {
        g.clearRect(0, 0, w, h);
        for (const p of P) {
          p.x += p.vx + Math.sin((p.t += 0.01)) * 0.2;
          p.y += p.vy;
          if (p.y < -80) (p.y = h + 40, p.x = Math.random() * w);
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
    }
    // pause while the tab is hidden: no burning battery for nobody
    const vis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", vis);
    tick();
    return () => (cancelAnimationFrame(raf), removeEventListener("resize", resize), document.removeEventListener("visibilitychange", vis));
  }, [theme.ambient, still]);

  return (
    <>
      {theme.art && (
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <div ref={art} className="theme-art" style={{ backgroundImage: `url(${theme.art})` }} />
          <div className="theme-art-veil" />
        </div>
      )}
      <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10" />
    </>
  );
}

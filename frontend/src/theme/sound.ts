/**
 * UI sounds per theme.
 *
 * Horde: war drums, leather and steel hits, a war horn when a talent is maxed.
 * Undead: a cracked funeral bell, whispers (filtered noise), a hollow ghostly drone.
 *
 * Synthesized with Web Audio, so nothing has to be shipped. To use recorded sounds instead
 * (for example ones you extracted from your own game client), put files in
 * `frontend/public/sounds/<theme>/` and list them in `manifest.json` there:
 *   { "add": "add.ogg", "max": "max.ogg", "remove": "remove.ogg", "click": "click.ogg", "error": "error.ogg", "open": "open.ogg" }
 * Any cue with a file plays the file; the others stay synthesized.
 */
import type { Voice } from "./themes";

export type Cue = "click" | "add" | "remove" | "max" | "error" | "open";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const ac = () => {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};
const out = () => (ac(), master!);

let noiseBuf: AudioBuffer | null = null;
function noise() {
  const a = ac();
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(g: GainNode, t0: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/** Oscillator with pitch slide and envelope, optionally through a filter. */
function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slide = 1, filter?: BiquadFilterNode) {
  const a = ac();
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  env(g, t0, gain, 0.008, dur);
  o.connect(g);
  (filter ? g.connect(filter) : g).connect(out());
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** Band of noise: drum skin, whisper, breath. */
function hiss(dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, when = 0, sweep = 1) {
  const a = ac();
  const t0 = a.currentTime + when;
  const n = noise();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t0 + dur);
  f.Q.value = q;
  env(g, t0, gain, 0.005, dur);
  n.connect(f).connect(g).connect(out());
  n.start(t0, Math.random());
  n.stop(t0 + dur + 0.05);
}

/** War drum: a low thump falling in pitch plus the slap of the skin. */
function drum(when = 0, pitch = 1, gain = 0.6) {
  tone(120 * pitch, 0.35, "sine", gain, when, 0.4);
  tone(62 * pitch, 0.45, "sine", gain * 0.6, when, 0.7);
  hiss(0.09, gain * 0.35, "lowpass", 900, 0.7, when);
}

/** Lowpassed sawtooth chord: a war horn. */
function horn(freqs: number[], dur: number, when = 0, gain = 0.09) {
  const a = ac();
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(500, a.currentTime + when);
  f.frequency.linearRampToValueAtTime(1500, a.currentTime + when + dur * 0.4);
  f.frequency.linearRampToValueAtTime(700, a.currentTime + when + dur);
  f.connect(out());
  for (const fr of freqs) {
    tone(fr, dur, "sawtooth", gain, when, 1.01, f);
    tone(fr * 1.005, dur, "sawtooth", gain * 0.7, when, 1, f);
  }
}

/** Bell: inharmonic partials with a long tail, slightly out of tune (a cracked funeral bell). */
function bell(freq: number, when = 0, gain = 0.12, dur = 1.4) {
  for (const [ratio, g] of [[1, 1], [2.01, 0.5], [2.76, 0.4], [5.4, 0.25], [8.93, 0.12]] as const)
    tone(freq * ratio, dur / Math.sqrt(ratio), "sine", gain * g, when);
}

/** A sound per cue for each voice. */
const VOICES: Record<Voice, Record<Cue, () => void>> = {
  drums: {
    click: () => (hiss(0.05, 0.25, "bandpass", 2200, 2), tone(180, 0.06, "triangle", 0.12, 0, 0.6)),
    add: () => drum(0, 1, 0.55),
    remove: () => (drum(0, 0.75, 0.4), hiss(0.18, 0.12, "lowpass", 600, 0.7, 0.02, 0.5)),
    max: () => (drum(0, 1, 0.6), drum(0.14, 1.12, 0.5), horn([98, 147], 0.9, 0.16)),
    error: () => (tone(70, 0.28, "square", 0.08, 0, 0.8), hiss(0.15, 0.18, "lowpass", 400)),
    open: () => (drum(0, 0.9, 0.45), drum(0.18, 0.9, 0.35), drum(0.32, 1.05, 0.5)),
  },
  ghost: {
    click: () => (hiss(0.12, 0.08, "bandpass", 3200, 6, 0, 0.6), tone(880, 0.08, "sine", 0.04, 0, 0.9)),
    add: () => (bell(392, 0, 0.09, 1.1), hiss(0.35, 0.05, "bandpass", 1800, 4, 0.02, 0.5)),
    remove: () => (tone(330, 0.5, "sine", 0.07, 0, 0.6), hiss(0.4, 0.06, "bandpass", 1200, 3, 0, 0.4)),
    max: () => (bell(262, 0, 0.12, 2), bell(311, 0.18, 0.08, 1.8), tone(131, 1.4, "triangle", 0.05, 0.05, 0.98)),
    error: () => (tone(110, 0.45, "sawtooth", 0.035, 0, 0.7), hiss(0.4, 0.07, "bandpass", 500, 2, 0, 0.6)),
    open: () => (hiss(0.9, 0.08, "bandpass", 900, 3, 0, 2.4), tone(196, 1.1, "sine", 0.06, 0.05, 1.5), tone(147, 1.2, "sine", 0.04, 0.1, 1.35)),
  },
};

// ----- optional recorded sounds -----
type Bank = Partial<Record<Cue, AudioBuffer>>;
const banks = new Map<string, Promise<Bank>>();
function bank(theme: string): Promise<Bank> {
  let p = banks.get(theme);
  if (!p) {
    p = (async () => {
      const base = `/sounds/${theme}/`;
      const r = await fetch(base + "manifest.json");
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return {};
      const files: Partial<Record<Cue, string>> = await r.json();
      const out: Bank = {};
      await Promise.all(Object.entries(files).map(async ([cue, f]) => {
        try {
          const buf = await (await fetch(base + f)).arrayBuffer();
          out[cue as Cue] = await ac().decodeAudioData(buf);
        } catch { /* keep the synthesized one */ }
      }));
      return out;
    })().catch(() => ({}));
    banks.set(theme, p);
  }
  return p;
}

export function play(theme: string, voice: Voice, cue: Cue, enabled: boolean) {
  if (!enabled) return;
  try {
    const p = banks.get(theme);
    if (!p) {
      void bank(theme); // first sound of this theme: synthesized while the files (if any) load
      VOICES[voice][cue]();
      return;
    }
    void p.then((b) => {
      const buf = b[cue];
      if (!buf) return VOICES[voice][cue]();
      const s = ac().createBufferSource();
      s.buffer = buf;
      s.connect(out());
      s.start();
    });
  } catch {
    /* audio not available */
  }
}

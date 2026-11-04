/**
 * UI sounds synthesized with Web Audio, voiced per theme (horde: war drums, undead: ghostly tones).
 * No audio files to ship; swapping in recorded samples later only touches this module.
 */
import type { Voice } from "./themes";

export type Cue = "click" | "add" | "remove" | "max" | "error" | "open";

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slide = 0) {
  const a = ac();
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const VOICES: Record<Voice, Record<Cue, () => void>> = {
  drums: {
    click: () => tone(140, 0.08, "triangle", 0.18, 0, 0.5),
    add: () => (tone(110, 0.14, "sine", 0.35, 0, 0.45), tone(330, 0.1, "triangle", 0.08, 0.02)),
    remove: () => tone(90, 0.12, "sine", 0.25, 0, 0.6),
    max: () => (tone(110, 0.2, "sine", 0.35, 0, 0.5), tone(392, 0.25, "sawtooth", 0.06, 0.05), tone(523, 0.3, "triangle", 0.08, 0.12)),
    error: () => tone(70, 0.22, "square", 0.12, 0, 0.7),
    open: () => (tone(98, 0.18, "sine", 0.3, 0, 0.5), tone(98, 0.18, "sine", 0.22, 0.16, 0.5)),
  },
  ghost: {
    click: () => tone(660, 0.09, "sine", 0.07, 0, 0.8),
    add: () => (tone(523, 0.25, "sine", 0.08, 0, 1.06), tone(530, 0.25, "sine", 0.06, 0)),
    remove: () => tone(440, 0.22, "sine", 0.07, 0, 0.7),
    max: () => (tone(392, 0.4, "sine", 0.08), tone(494, 0.4, "sine", 0.06, 0.08), tone(622, 0.5, "triangle", 0.05, 0.16)),
    error: () => tone(180, 0.3, "sawtooth", 0.05, 0, 0.6),
    open: () => tone(300, 0.5, "sine", 0.07, 0, 1.6),
  },
};

export function play(voice: Voice, cue: Cue, enabled: boolean) {
  if (!enabled) return;
  try {
    VOICES[voice][cue]();
  } catch {
    /* audio not available */
  }
}

/**
 * The Undercity in sound: a small music player over the city's music from the client files (Forever's own
 * Undercity themes, the classic ones, and Sylvanas' "Lament of the Highborne" from her music box), plus the
 * Dark Lady's voice lines. One audio element for the whole app, so the music goes on across pages.
 * Only the user starts it (browsers block sound before a click).
 */
import { useSyncExternalStore } from "react";
import { store } from "../lib/store";

const GAME = (id: number) => `/api/media/game/${id}`;
const SYLVANAS = [561230, 561256, 561225, 561242, 561241, 561268, 561231]; // quest turn-in lines

export interface Track { id: number; ru: string; en: string; group: "forever" | "classic" | "sylvanas" }
export const PLAYLIST: Track[] = [
  { id: 8181009, ru: "Подгород: вступление", en: "Undercity: intro", group: "forever" },
  { id: 8181003, ru: "Подгород I", en: "Undercity I", group: "forever" },
  { id: 8181005, ru: "Подгород II", en: "Undercity II", group: "forever" },
  { id: 8181007, ru: "Подгород III", en: "Undercity III", group: "forever" },
  { id: 53221, ru: "Плач высокорождённых", en: "Lament of the Highborne", group: "sylvanas" },
  { id: 53219, ru: "Подгород: вступление (классика)", en: "Undercity: intro (classic)", group: "classic" },
  { id: 53216, ru: "Подгород I (классика)", en: "Undercity I (classic)", group: "classic" },
  { id: 53217, ru: "Подгород II (классика)", en: "Undercity II (classic)", group: "classic" },
  { id: 53218, ru: "Подгород III (классика)", en: "Undercity III (classic)", group: "classic" },
];

export type Repeat = "all" | "one" | "shuffle";
export interface PlayerState { index: number; playing: boolean; repeat: Repeat; volume: number; time: number; duration: number }

let state: PlayerState = {
  index: Math.min(store.get<number>("musicIndex", 0), PLAYLIST.length - 1),
  playing: false,
  repeat: store.get<Repeat>("musicRepeat", "all"),
  volume: store.get<number>("musicVolume", 0.35),
  time: 0,
  duration: 0,
};
const subs = new Set<() => void>();
const emit = (patch: Partial<PlayerState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};

let audio: HTMLAudioElement | null = null;
let fade = 0;

function fadeTo(to: number, ms: number, then?: () => void) {
  const el = audio;
  if (!el) return;
  cancelAnimationFrame(fade);
  const from = el.volume;
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.volume = from + (to - from) * k;
    if (k < 1) fade = requestAnimationFrame(step);
    else then?.();
  };
  fade = requestAnimationFrame(step);
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => emit({ time: audio!.currentTime, duration: audio!.duration || 0 }));
  audio.addEventListener("play", () => emit({ playing: true }));
  audio.addEventListener("pause", () => emit({ playing: false }));
  audio.addEventListener("ended", () => {
    if (state.repeat === "one") {
      audio!.currentTime = 0;
      void audio!.play();
    } else next();
  });
  return audio;
}

function load(index: number, autoplay: boolean) {
  const a = el();
  emit({ index, time: 0, duration: 0 });
  store.set("musicIndex", index);
  a.src = GAME(PLAYLIST[index].id);
  if (autoplay) {
    a.volume = 0;
    void a.play().then(() => fadeTo(state.volume, 1500)).catch(() => {});
  }
}

let resumeOnUnmute = false;

/** The sound switch in the header: off pauses the music (and remembers it was playing), on resumes it. */
export function muteMusic(muted: boolean) {
  if (muted) {
    resumeOnUnmute = state.playing;
    if (state.playing) player.pause();
  } else if (resumeOnUnmute) {
    resumeOnUnmute = false;
    player.play();
  }
}

export const player = {
  play() {
    const a = el();
    if (!a.src) return load(state.index, true);
    a.volume = 0;
    void a.play().then(() => fadeTo(state.volume, 1200)).catch(() => {});
  },
  pause() {
    fadeTo(0, 600, () => audio?.pause());
  },
  toggle() {
    if (state.playing) player.pause();
    else player.play();
  },
  pick(i: number) {
    load(i, true);
  },
  next,
  prev() {
    if (audio && audio.currentTime > 4) audio.currentTime = 0;
    else load((state.index - 1 + PLAYLIST.length) % PLAYLIST.length, true);
  },
  seek(t: number) {
    if (audio && isFinite(t)) audio.currentTime = t;
  },
  setVolume(v: number) {
    emit({ volume: v });
    store.set("musicVolume", v);
    if (audio) (cancelAnimationFrame(fade), (audio.volume = v));
  },
  setRepeat(r: Repeat) {
    emit({ repeat: r });
    store.set("musicRepeat", r);
  },
};

function next() {
  const n = PLAYLIST.length;
  let i = (state.index + 1) % n;
  if (state.repeat === "shuffle" && n > 1) {
    do i = Math.floor(Math.random() * n);
    while (i === state.index);
  }
  load(i, true);
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

/** One of Sylvanas' lines, at random, in the page's language (the Russian client has its own voice). */
export function sylvanasLine(lang: "ru" | "en" = "ru", volume = 0.85) {
  const a = new Audio(`${GAME(SYLVANAS[Math.floor(Math.random() * SYLVANAS.length)])}?lang=${lang}`);
  a.volume = volume;
  void a.play().catch(() => {});
}


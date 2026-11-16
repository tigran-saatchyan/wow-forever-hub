/**
 * The Undercity in sound: WoW: Forever's own Undercity music (from the client files, served by the hub),
 * the Dark Lady's voice lines, and the ambience of the city. Only the user starts the music.
 */
const GAME = (id: number) => `/api/media/game/${id}`;
const TRACKS = [8181009, 8181003, 8181005, 8181007]; // intro moment, then the three city themes
const SYLVANAS = [561230, 561256, 561225, 561242, 561241, 561268, 561231]; // quest turn-in lines

let audio: HTMLAudioElement | null = null;
let index = 0;
let fade = 0;

function fadeTo(el: HTMLAudioElement, to: number, ms: number, then?: () => void) {
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

export function musicPlaying() {
  return !!audio && !audio.paused;
}

export function startMusic(volume = 0.3) {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      index = index + 1 >= TRACKS.length ? 1 : index + 1; // the intro plays once
      audio!.src = GAME(TRACKS[index]);
      void audio!.play().catch(() => {});
    });
    audio.src = GAME(TRACKS[index]);
  }
  audio.volume = 0;
  void audio.play().then(() => fadeTo(audio!, volume, 2500)).catch(() => {});
}

export function stopMusic() {
  if (audio) fadeTo(audio, 0, 900, () => audio?.pause());
}

/** One of Sylvanas' lines, at random (the caller checks that sounds are on). */
export function sylvanasLine(volume = 0.85) {
  const a = new Audio(GAME(SYLVANAS[Math.floor(Math.random() * SYLVANAS.length)]));
  a.volume = volume;
  void a.play().catch(() => {});
}

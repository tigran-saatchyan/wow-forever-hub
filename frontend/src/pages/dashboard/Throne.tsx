/** Pieces of the throne room shared by the pages: the Dark Lady's words and the plague braziers. */

export const WORDS: { ru: string; en: string }[] = [
  { ru: "Победа Отрёкшимся!", en: "Victory for the Forsaken!" },
  { ru: "Мы — Отрёкшиеся. Нас больше никто не поработит.", en: "We are the Forsaken. We will not be enslaved again." },
  { ru: "Смерть живым!", en: "Death to the living!" },
  { ru: "Тёмная госпожа наблюдает.", en: "The Dark Lady watches." },
  { ru: "Во имя Тёмной госпожи.", en: "For the Dark Lady." },
];

/** A bronze brazier with green plague fire and sparks rising from it. */
export function Brazier({ side }: { side: "left" | "right" }) {
  return (
    <div className={`brazier ${side}`} aria-hidden>
      <div className="fire">
        <i /><i /><i />
      </div>
      {Array.from({ length: 7 }, (_, i) => <b key={i} className="ember" style={{ left: `${30 + ((i * 37) % 40)}%`, animationDelay: `${(i * 0.53) % 3}s` }} />)}
      <div className="bowl" />
      <div className="stand" />
    </div>
  );
}

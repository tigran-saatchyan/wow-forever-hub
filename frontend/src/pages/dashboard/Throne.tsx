/** The throne room of the Undercity: the Forsaken crest, a greeting for the favourite servant, the Dark Lady's words. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { fullName, useCharacters } from "../../lib/wowApi";
import { sylvanasLine } from "../../theme/music";

const WORDS: { ru: string; en: string }[] = [
  { ru: "Победа Отрёкшимся!", en: "Victory for the Forsaken!" },
  { ru: "Мы — Отрёкшиеся. Нас больше никто не поработит.", en: "We are the Forsaken. We will not be enslaved again." },
  { ru: "Смерть живым!", en: "Death to the living!" },
  { ru: "Тёмная госпожа наблюдает.", en: "The Dark Lady watches." },
  { ru: "Во имя Тёмной госпожи.", en: "For the Dark Lady." },
];

export function Throne() {
  const { t, lang } = useI18n();
  const chars = useCharacters();
  const [i, setI] = useState(() => Math.floor(Math.random() * WORDS.length));
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % WORDS.length), 9000);
    return () => clearInterval(id);
  }, []);
  const first = (chars.data || [])[0]; // favorites come first
  const hail = first ? t("uc_hail", { n: fullName(first, lang) }) : t("uc_hail_none");
  return (
    <motion.section
      className="throne lg:col-span-3"
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7 }}
    >
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <img src="/undercity/crest.webp" alt="" className="throne-crest h-24 w-24 flex-none sm:h-36 sm:w-36" />
        <div className="min-w-0 flex-1">
          <div className="brand-sub">{t("uc_sub")}</div>
          <h1 className="font-display mt-1 text-3xl sm:text-4xl">{hail}</h1>
          <div className="mt-3 min-h-[1.75rem]">
            <AnimatePresence mode="wait">
              <motion.p
                key={i}
                className="throne-quote text-lg"
                initial={{ opacity: 0, x: -8, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: 8, filter: "blur(4px)" }}
                transition={{ duration: 0.6 }}
              >
                «{WORDS[i][lang]}» <span className="not-italic text-muted">— {t("uc_sylvanas")}</span>
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <button className="btn-primary" onClick={() => sylvanasLine(lang)} title={t("uc_voice")}>
          ☠ {t("uc_voice")}
        </button>
      </div>
    </motion.section>
  );
}

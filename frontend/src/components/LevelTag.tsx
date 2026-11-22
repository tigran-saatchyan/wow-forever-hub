/** A level or level range ("58–60"), red while the character is below it, green once they reach it. */
import { useActiveChar } from "../lib/activeChar";
import { useI18n } from "../lib/i18n";

export function LevelTag({ lv, me, dungeon }: { lv: number[] | null | undefined; me?: number | null; dungeon?: boolean }) {
  const { t, lang } = useI18n();
  const active = useActiveChar().char?.summary?.[lang]?.level ?? null;
  if (!lv || !lv.length || lv[0] == null) return null;
  const level = me ?? active;
  const [a, b] = [lv[0], lv[lv.length - 1] ?? lv[0]];
  const low = level != null && level < a;
  return (
    <span className={`whitespace-nowrap ${low ? "text-bad" : level != null ? "text-good" : "text-muted"}`}
      title={low ? t("lv_low", { n: level! }) : undefined}>
      {dungeon ? "" : `${t("lv_short")} `}{a === b ? a : `${a}–${b}`}
    </span>
  );
}

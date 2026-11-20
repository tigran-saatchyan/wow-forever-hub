/** The auction house beside an item: its price there now; a click puts it into the auction list (the first pinned
 * one, else the first list), a second one opens the auction page where the list is. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { wowApi, type AhState } from "../lib/wowApi";
import { Money } from "./Wow";

export function AhChip({ id, ah }: { id: number; ah: AhState }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const lists = useQuery({ queryKey: ["ah-lists", lang], queryFn: () => wowApi.lists(lang), staleTime: 5 * 60e3 });
  const target = (lists.data || []).find((x) => x.pinned) ?? lists.data?.[0];
  const add = useMutation({
    mutationFn: async () => {
      const l = target ?? (await wowApi.addList(t("ah_default_list")));
      return wowApi.addToList(l.id, { item_id: id, below: null }, lang);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["prebis"] }), qc.invalidateQueries({ queryKey: ["ah-lists"] })),
  });
  const p = ah.price;
  const tracked = ah.tracked || add.isSuccess;
  return (
    <button type="button" className={`ah-chip ${tracked ? "on" : ""}`} disabled={add.isPending}
      onClick={(e) => { e.stopPropagation(); if (tracked) nav("/market"); else add.mutate(); }}
      title={tracked ? t("ah_chip_open") : t("ah_chip_add", { l: target?.name ?? t("ah_default_list") })}>
      <span aria-hidden>{tracked ? "★" : "☆"}</span>
      {p ? <><Money c={p.min} />{p.quantity > 1 && <span className="text-muted">×{p.quantity}</span>}</> : <span className="text-muted">{t("ah_chip_none")}</span>}
    </button>
  );
}

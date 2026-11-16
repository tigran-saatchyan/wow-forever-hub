/** Orders of the day in the throne room: what each favourite servant can do now, and what waits for all. */
import { useQueries, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { iconStyle, useIcons, useTalents } from "../../lib/gameData";
import { useI18n, type Key } from "../../lib/i18n";
import { nextReset } from "../../lib/status";
import { store } from "../../lib/store";
import { fullName, useCharacter, useCharacters, wowApi, type Character } from "../../lib/wowApi";
import { need } from "../characters/ProfessionsTab";

function useLearnable(c?: Character) {
  const { lang } = useI18n();
  const profs = (c?.professions?.[lang] || []).filter((p) => p.id && p.hasKnown && p.skill != null);
  const qs = useQueries({
    queries: profs.map((p) => ({ queryKey: ["profession", p.id, lang], queryFn: () => wowApi.profession(p.id!, lang), staleTime: Infinity })),
  });
  let n = 0;
  profs.forEach((p, i) => {
    const known = new Set(p.known || []);
    for (const r of qs[i].data?.recipes || []) if (!known.has(r.id) && !known.has(r.spell) && need(r).v <= (p.skill ?? 0)) n++;
  });
  return { n, ready: profs.length > 0 && qs.every((q) => q.data) };
}

function Order({ id, delay }: { id: number; delay: number }) {
  const { t, lang } = useI18n();
  const q = useCharacter(id);
  const D = useTalents(lang);
  const icons = useIcons();
  const nav = useNavigate();
  const c = q.data;
  const learn = useLearnable(c);
  const quests = useQuery({
    queryKey: ["tab", id, "quests_active", lang], queryFn: () => wowApi.tab<{ id: number; name: string }[]>(id, "quests_active", lang),
    enabled: !!c && !c.error, staleTime: 10 * 60e3, retry: false,
  });
  if (!c) return null;
  const s = c.summary?.[lang];
  const k = D.data?.classes.find((x) => x.id === s?.classId);
  const go = (tab: string) => (store.set("chSel", id), store.set("chTab", tab), nav("/characters"));
  const nq = quests.data?.data?.length;
  return (
    <motion.div className="order" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.45 }}>
      <button className="flex w-full items-center gap-2.5 text-left" onClick={() => go("overview")}>
        <span className="h-9 w-9 flex-none rounded border border-black" style={k ? iconStyle(icons.data, k.icon) : undefined} />
        <span className="grid min-w-0">
          <b className="truncate font-display" style={{ color: k?.color }}>{fullName(c, lang)}</b>
          <span className="text-xs text-muted">{t("ch_level", { l: s?.level ?? "?" })} · {s?.className}</span>
        </span>
      </button>
      <ul className="mt-2.5 space-y-1 text-sm">
        {learn.ready && (
          <li>
            <button className="order-line" onClick={() => go("professions")}>
              <span className={learn.n ? "text-[#ffb070]" : "text-muted"}>⚗</span>
              {learn.n ? t("or_learn", { n: learn.n }) : t("or_learn_none")}
            </button>
          </li>
        )}
        {nq != null && (
          <li>
            <span className="order-line">
              <span className="text-[#ffd100]">!</span>{nq ? t("or_quests", { n: nq }) : t("or_quests_none")}
            </span>
          </li>
        )}
      </ul>
    </motion.div>
  );
}

export function Orders() {
  const { t } = useI18n();
  const nav = useNavigate();
  const chars = useCharacters();
  const watch = useQuery({ queryKey: ["watch", "orders"], queryFn: () => wowApi.watch("ru"), staleTime: 5 * 60e3, retry: false });
  const servants = (chars.data || []).filter((c) => !c.error).slice(0, 3);
  const alerts = (watch.data || []).filter((w) => w.alert).length;
  const ms = nextReset("eu") - Date.now();
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24;
  const common: { icon: string; text: string; to?: string; hot?: boolean }[] = [
    { icon: "⌛", text: t("or_reset", { d, h }) },
  ];
  if (watch.data) common.unshift({ icon: "⚖", text: alerts ? t("or_alerts", { n: alerts }) : t("or_alerts_none"), to: "/market", hot: alerts > 0 });
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold/40" />
        <h2 className="font-display text-sm uppercase tracking-[0.3em] text-gold">{t("uc_orders")}</h2>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold/40" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {servants.map((c, i) => <Order key={c.id} id={c.id} delay={0.15 + i * 0.1} />)}
        <motion.div className="order" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.45 }}>
          <b className="font-display text-gold">{t("or_all")}</b>
          <ul className="mt-2.5 space-y-1 text-sm">
            {common.map((x) => (
              <li key={x.text}>
                {x.to
                  ? <button className={`order-line ${x.hot ? "text-good" : ""}`} onClick={() => nav(x.to!)}><span>{x.icon}</span>{x.text}</button>
                  : <span className="order-line"><span>{x.icon}</span>{x.text}</span>}
              </li>
            ))}
          </ul>
        </motion.div>
        {!servants.length && (
          <button className="order text-left text-sm text-muted" onClick={() => nav("/characters")}>{t("or_no_chars" as Key)}</button>
        )}
      </div>
    </div>
  );
}

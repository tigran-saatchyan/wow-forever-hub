/** Armory tabs read from the character's profile sub-resources; each says plainly when Blizzard gives nothing. */
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { useRef, useState, type ReactNode } from "react";
import { Compare } from "../throne/Bis";
import { fmtDate, useI18n, type Key } from "../../lib/i18n";
import { Model3D } from "../../components/Model3D";
import { ItemIcon, Money } from "../../components/Wow";
import { media, qColor, useCharacter, wowApi, type InstRow, type StatGroup } from "../../lib/wowApi";

export function useTab<T>(cid: number, name: string) {
  const { lang } = useI18n();
  return useQuery({ queryKey: ["tab", cid, name, lang], queryFn: () => wowApi.tab<T>(cid, name, lang), staleTime: 10 * 60e3, retry: false });
}

/** Loading, "Blizzard does not give this" (with the last good copy if any), or the content. */
function Frame<T>({ q, empty, children }: { q: ReturnType<typeof useTab<T>>; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  const { t, lang } = useI18n();
  if (q.isLoading) return <p className="text-sm text-muted">…</p>;
  if (q.isError) return <p className="text-sm text-bad">{String(q.error)}</p>;
  const r = q.data!;
  const d = r.data;
  return (
    <div className="space-y-3">
      {!r.available && (
        <p className="rounded-md border border-edge/60 bg-bg/50 p-2.5 text-sm text-muted">
          {t("ar_unavailable", { s: r.status ?? "?" })}{d && r.at ? " " + t("ar_cached", { d: fmtDate(lang, r.at) }) : ""}
        </p>
      )}
      {d != null && (empty?.(d) ? <p className="text-sm text-muted">{t("ar_empty")}</p> : children(d))}
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="rounded-md border border-edge/60 bg-bg/50 p-3">
    <div className="eyebrow">{k}</div>
    <div className="mt-1 font-display text-xl text-gold">{v}</div>
  </div>
);

interface Pvp {
  honorable_kills?: number; lifetime_honorable_kills?: number; dishonorable_kills?: number; honor_level?: number;
  pvp_rank?: number; rankName?: string; maps: { name: string; played: number | null; won: number | null; lost: number | null }[];
}
export function PvpTab({ cid }: { cid: number }) {
  const { t } = useI18n();
  const q = useTab<Pvp>(cid, "pvp");
  return (
    <Frame q={q}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.honorable_kills != null && <Stat k={t("pv_hk")} v={d.honorable_kills} />}
            {d.lifetime_honorable_kills != null && <Stat k={t("pv_hk_life")} v={d.lifetime_honorable_kills} />}
            {d.dishonorable_kills != null && <Stat k={t("pv_dk")} v={d.dishonorable_kills} />}
            {d.honor_level != null && <Stat k={t("pv_honor")} v={d.honor_level} />}
            {(d.rankName || d.pvp_rank != null) && <Stat k={t("pv_rank")} v={d.rankName ?? d.pvp_rank} />}
          </div>
          {d.maps.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="p-1.5 font-normal">{t("pv_bg")}</th><th className="p-1.5 text-right font-normal">{t("pv_played")}</th>
                  <th className="p-1.5 text-right font-normal">{t("pv_won")}</th><th className="p-1.5 text-right font-normal">{t("pv_rate")}</th></tr>
              </thead>
              <tbody>
                {d.maps.map((m) => (
                  <tr key={m.name} className="border-t border-edge/40">
                    <td className="p-1.5">{m.name}</td>
                    <td className="p-1.5 text-right font-mono">{m.played ?? "—"}</td>
                    <td className="p-1.5 text-right font-mono text-good">{m.won ?? "—"}</td>
                    <td className="p-1.5 text-right font-mono">{m.played ? Math.round(((m.won ?? 0) / m.played) * 100) + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Frame>
  );
}

export interface Rep { id?: number | null; name: string; standing: string; tier: number | null; value: number | null; max: number | null }
export const REP_COLORS = ["#cc2222", "#ff0000", "#ee6622", "#ffff00", "#00ff88", "#00bb44", "#00a0b4", "#00ccff"];
export function ReputationTab({ cid }: { cid: number }) {
  const { t } = useI18n();
  const q = useTab<Rep[]>(cid, "reputations");
  const [f, setF] = useState("");
  return (
    <Frame q={q} empty={(d) => !d.length}>
      {(d) => (
        <>
          <input className="input w-60" placeholder={t("ar_filter")} value={f} onChange={(e) => setF(e.target.value)} />
          <ul className="grid gap-2 sm:grid-cols-2">
            {d.filter((r) => r.name.toLowerCase().includes(f.toLowerCase())).map((r) => {
              const c = REP_COLORS[Math.min(7, Math.max(0, r.tier ?? 3))];
              return (
                <li key={r.name} className="rounded-md border border-edge/50 bg-bg/40 p-2">
                  <div className="flex justify-between text-sm"><span>{r.name}</span><span style={{ color: c }}>{r.standing}</span></div>
                  {r.max ? (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="prof-bar flex-1"><span style={{ width: `${Math.min(100, ((r.value ?? 0) / r.max) * 100)}%`, background: c }} /></div>
                      <span className="font-mono text-[11px] text-muted">{r.value}/{r.max}</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Frame>
  );
}

interface Ach { points: number | null; count: number; recent: { name: string; id: number; at: number }[]; categories: { name: string; done: number | null; points: number | null }[] }
export function AchievementsTab({ cid }: { cid: number }) {
  const { t, lang } = useI18n();
  const q = useTab<Ach>(cid, "achievements");
  const quests = useTab<{ count: number; recent: string[] }>(cid, "quests");
  const titles = useTab<{ active: string | null; all: string[] }>(cid, "titles");
  return (
    <div className="space-y-4">
      <Frame q={q}>
        {(d) => (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {d.points != null && <Stat k={t("ac_points")} v={d.points} />}
              <Stat k={t("ac_count")} v={d.count} />
              {quests.data?.data && <Stat k={t("ac_quests")} v={quests.data.data.count} />}
              {titles.data?.data?.active && <Stat k={t("ac_title")} v={titles.data.data.active} />}
            </div>
            {d.categories.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {d.categories.map((c) => <li key={c.name} className="chip">{c.name}: {c.done ?? 0}</li>)}
              </ul>
            )}
            {d.recent.length > 0 && (
              <div>
                <div className="eyebrow mb-1">{t("ac_recent")}</div>
                <ul className="divide-y divide-edge/40 text-sm">
                  {d.recent.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 py-1.5">
                      <span>{a.name}</span><span className="text-xs text-muted">{fmtDate(lang, new Date(a.at).toISOString())}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Frame>
      {titles.data?.data && titles.data.data.all.length > 0 && (
        <div>
          <div className="eyebrow mb-1">{t("ac_titles")}</div>
          <ul className="flex flex-wrap gap-1.5 text-xs">{titles.data.data.all.map((x) => <li key={x} className="chip">{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

interface Coll { name: string; id: number; favorite: boolean; level: number | null }
interface CollEntry {
  id: number; name: string; source: string | null; description: string | null; faction: "ALLIANCE" | "HORDE" | null;
  display: number | null; icon: string | null; item: number | null; hidden: boolean;
}
const KINDS = [["mounts", "co_mounts"], ["pets", "co_pets"], ["toys", "co_toys"]] as const;

/** Mounts, pets and toys: what the character has against everything that can be had by their faction. */
export function CollectionsTab({ cid }: { cid: number }) {
  const { lang } = useI18n();
  const faction = useCharacter(cid).data?.summary?.[lang]?.faction ?? null;
  return <div className="space-y-6">{KINDS.map(([k, title]) => <CollectionBlock key={k} cid={cid} kind={k} title={title} faction={faction} />)}</div>;
}

function CollectionBlock({ cid, kind, title, faction }: { cid: number; kind: string; title: "co_mounts" | "co_pets" | "co_toys"; faction: string | null }) {
  const { t, lang } = useI18n();
  const own = useTab<Coll[]>(cid, kind);
  const all = useQuery({ queryKey: ["coll", kind, lang], queryFn: () => wowApi.collection<CollEntry>(kind, lang), staleTime: 3600e3, retry: false });
  const [view, setView] = useState<"have" | "missing">("have");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<CollEntry | null>(null);
  const ownIds = new Set((own.data?.data || []).map((x) => x.id));
  // what can be had: this faction's and both factions', without promotions nobody can get any more
  const reachable = (all.data || []).filter((x) => ownIds.has(x.id) || (!x.hidden && (!x.faction || !faction || x.faction === faction)));
  const have = reachable.filter((x) => ownIds.has(x.id));
  const missing = reachable.filter((x) => !ownIds.has(x.id));
  const shown = (view === "have" ? have : missing).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  const pct = reachable.length ? (have.length / reachable.length) * 100 : 0;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="panel-title">{t(title)}</h3>
        {all.data && <span className="font-display text-gold">{have.length} / {reachable.length}</span>}
        <div className="prof-bar w-40"><span style={{ width: `${pct}%` }} /></div>
        <div className="ml-auto flex gap-1">
          {(["have", "missing"] as const).map((v) => (
            <button key={v} className={`chip ${view === v ? "border-gold/60 text-gold" : ""}`} onClick={() => setView(v)}>
              {t(v === "have" ? "co_have" : "co_missing")} {v === "have" ? have.length : missing.length}
            </button>
          ))}
          <input className="input w-44 py-1 text-sm" placeholder={t("co_find")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {all.isLoading && <p className="mt-2 text-sm text-muted">{t("co_loading")}</p>}
      {all.isError && <p className="mt-2 text-sm text-muted">{t("co_no_index")}</p>}
      <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_320px]">
        <ul className="grid content-start gap-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((x) => (
            <li key={x.id}>
              <button onClick={() => setPick(x)}
                className={`flex w-full items-center gap-2 truncate rounded border px-2 py-1 text-left ${pick?.id === x.id ? "border-gold/60 bg-gold/10" : "border-edge/40 bg-bg/40 hover:border-gold/40"}`}>
                {x.icon ? <img src={media(x.icon)!} alt="" className="h-5 w-5 rounded-sm" /> : x.item ? <ItemIcon itemId={x.item} size={20} /> : null}
                <span className={`truncate ${ownIds.has(x.id) ? "" : "text-muted"}`}>{x.name}</span>
              </button>
            </li>
          ))}
          {all.data && !shown.length && <li className="text-muted">{t("ar_empty")}</li>}
        </ul>
        {pick && (
          <aside className="char-stats self-start">
            {pick.display ? <Model3D key={pick.display} display={pick.display} className="h-64 w-full" /> : null}
            <div className="font-display text-lg text-gold">{pick.name}</div>
            <div className="text-xs text-muted">{ownIds.has(pick.id) ? t("co_have") : t("co_missing")}{pick.faction ? ` · ${pick.faction === "HORDE" ? t("co_horde") : t("co_alliance")}` : ""}</div>
            {pick.source && <p className="mt-2 text-sm"><span className="text-muted">{t("co_source")}:</span> {pick.source}</p>}
            {pick.description && <p className="mt-1 text-sm text-[#e8dcc0]">{pick.description}</p>}
          </aside>
        )}
      </div>
    </section>
  );
}

const Q_NAMES = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

/**
 * Dungeons and raids: Forever's list with levels and bosses (ForeverDB), how often the character killed each
 * one's last boss (Blizzard's statistics: Forever leaves the encounter lists empty), and what each holds that
 * beats what the character wears, for its current specialization.
 */
export function InstancesTab({ cid }: { cid: number }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["instances", cid, lang], queryFn: () => wowApi.instances(cid, lang), staleTime: 10 * 60e3, retry: false });
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (q.isLoading) return <p className="text-sm text-muted">…</p>;
  if (q.isError) return <p className="text-sm text-bad">{String(q.error)}</p>;
  const d = q.data!;
  const lv = d.level;
  const near = (r: InstRow) => r.open && !!r.levels && r.levels[0] <= lv + 3 && r.levels[1] >= lv - 2;
  const shown = d.rows.filter((r) => all || near(r) || r.cleared > 0);
  const part = (kind: string) => shown.filter((r) => r.kind === kind);
  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat k={t("in_visited")} v={d.visited ?? "—"} />
        <Stat k={t("in_deaths")} v={d.deaths ?? "—"} />
        <Stat k={t("in_cleared_n")} v={d.rows.filter((r) => r.cleared).length} />
      </div>
      {!d.available && <p className="text-sm text-muted">{t("ar_unavailable", { s: d.status ?? "?" })}</p>}
      {!d.fdb && <p className="text-xs text-muted">{t("in_no_fdb")}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t("in_for_level", { n: lv })}</span>
        <button className={all ? "btn" : "btn-primary"} onClick={() => setAll(false)}>{t("in_show_near")}</button>
        <button className={all ? "btn-primary" : "btn"} onClick={() => setAll(true)}>{t("in_show_all")} ({d.rows.length})</button>
        <span className="ml-auto flex gap-2">
          <button className="btn" onClick={() => setOpen(new Set(shown.filter((r) => r.open).map((r) => r.id)))}>{t("in_expand_all")}</button>
          <button className="btn" onClick={() => setOpen(new Set())}>{t("in_collapse_all")}</button>
        </span>
      </div>
      {(["dungeon", "raid"] as const).map((k) => part(k).length > 0 && (
        <div key={k}>
          <h3 className="panel-title mb-3">{t(k === "dungeon" ? "in_dungeons" : "in_raids")}</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {part(k).map((r) => <InstTile key={r.id} r={r} level={lv} near={near(r)} open={open.has(r.id)} onToggle={() => toggle(r.id)} />)}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted">
        {t("in_note")} <a className="underline" href="https://foreverdb.net" target="_blank" rel="noopener noreferrer">ForeverDB.net</a>
      </p>
    </div>
  );
}

const bossKey = (x: string | null | undefined) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Upgrades grouped by the listed boss that drops them; the rest (ForeverDB's notable loot) apart. */
function lootByBoss(r: InstRow) {
  const byBoss = new Map<string, InstRow["upgrades"]>();
  const listed = new Set(r.bosses.map((b) => bossKey(b.en)));
  const other: InstRow["upgrades"] = [];
  for (const u of r.upgrades) {
    const k = bossKey(u.bossEn);
    if (k && listed.has(k)) byBoss.set(k, [...(byBoss.get(k) || []), u]);
    else other.push(u);
  }
  return { byBoss, other };
}

/**
 * A dungeon as a tile: name, levels, whether it is cleared, its bosses' faces and how much it holds for the
 * character. A click opens it across the whole row: every boss with its portrait, kills and the upgrades it drops.
 */
function InstTile({ r, level, near, open, onToggle }: { r: InstRow; level: number; near: boolean; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const best = r.upgrades.reduce<number | null>((m, u) => (u.gain == null ? m : Math.max(m ?? 0, u.gain)), null);
  const { byBoss, other } = lootByBoss(r);
  const bis = (r.bis || []).filter((x) => !x.worn);  // BiS for the level that drops here and is not worn yet
  const bisRank = new Map((r.bis || []).map((x) => [x.id, x.rank]));
  const cls = ["inst-tile", r.cleared ? "cleared" : "todo", bis.length ? "has-bis" : "", r.open ? "" : "closed",
    open ? "open sm:col-span-2 xl:col-span-3" : ""].join(" ");
  return (
    <li className={cls}>
      <button type="button" className="inst-head" onClick={onToggle} aria-expanded={open} disabled={!r.open && !r.bosses.length}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl leading-tight text-[#f3e3b5]">{r.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              {r.levels && (
                <span className={`inst-lv ${near ? "on" : ""}`}>{r.levels[0] === r.levels[1] ? r.levels[0] : `${r.levels[0]}–${r.levels[1]}`}</span>
              )}
              {r.kind === "raid" && r.players && <span className="text-muted">{t("in_players", { n: r.players })}</span>}
              {r.new && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">{t("in_new")}</span>}
              {!r.open && <span className="rounded bg-white/5 px-1.5 py-0.5 text-muted">{t("in_closed")}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`inst-pill ${r.cleared ? "done" : "todo"}`}>{r.cleared ? `✓ ${t("in_cleared", { n: r.cleared })}` : t("in_not_cleared")}</span>
            {bis.length > 0 && <span className="inst-pill bis">★ BiS: {bis.length}</span>}
          </div>
        </div>
        {r.bosses.length > 0 && (
          <div className="inst-faces">
            {r.bosses.slice(0, 9).map((b) => <BossFace key={b.en} model={b.model} name={b.name} killed={!!b.kills} size={38} />)}
            {r.bosses.length > 9 && <span className="ml-2 self-center text-xs text-muted">+{r.bosses.length - 9}</span>}
          </div>
        )}
        {bis.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {bis.slice(0, 6).map((x) => (
              <span key={x.id} className="inst-bis-chip" title={`${x.name} · ${t(`slot_${x.slot}` as Key)}${x.boss ? ` · ${x.boss}` : ""}`}>
                <ItemIcon itemId={x.id} quality={Q_NAMES[x.q]} size={26} />
                <b>{x.rank}</b>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          {r.open && (r.upgradeCount > 0
            ? <span className="font-medium text-good">▲ {t("in_up_short", { n: r.upgradeCount })}{best != null ? ` · ${t("in_up_best", { p: Math.round(best) })}` : ""}</span>
            : <span className="text-muted">{r.lootKnown === "none" ? t("in_loot_unknown") : t("in_no_upgrades_short")}</span>)}
          <span className={`inst-chev ml-auto ${open ? "on" : ""}`} aria-hidden>▾</span>
        </div>
      </button>
      {open && (
        <div className="inst-body">
          {(r.bis || []).length > 0 && (
            <div className="inst-boss bis mb-3">
              <div className="mb-2 text-sm font-semibold text-[#c98cff]">★ {t("in_bis_here")}</div>
              <ul className="grid gap-2 md:grid-cols-2">
                {(r.bis || []).map((x) => (
                  <li key={x.id} className="flex items-center gap-2.5 text-[15px]">
                    <span className="bis-rank">{x.rank}</span>
                    <ItemIcon itemId={x.id} quality={Q_NAMES[x.q]} size={34} />
                    <span className="grid min-w-0 leading-tight">
                      <span className="truncate" style={{ color: qColor(Q_NAMES[x.q]) }}>{x.name}</span>
                      <span className="truncate text-xs text-muted">{t(`slot_${x.slot}` as Key)}{x.boss ? ` · ${x.boss}` : ""}</span>
                    </span>
                    {x.worn && <span className="ml-auto text-sm text-good">{t("bis_worn_tag")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.bosses.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {r.bosses.map((b, i) => {
                const ups = byBoss.get(bossKey(b.en)) || [];
                return (
                  <li key={b.en} className={`inst-boss ${b.kills ? "killed" : ""}`}>
                    <div className="flex items-center gap-3">
                      <BossFace model={b.model} name={b.name} killed={!!b.kills} size={64} />
                      <div className="min-w-0">
                        <div className="text-xs text-muted">{t("in_boss_n", { n: i + 1 })}</div>
                        <div className="text-base font-semibold leading-tight text-ink">{b.name}</div>
                        <div className={`text-sm ${b.kills ? "text-good" : "text-muted"}`}>
                          {b.kills ? `✓ ${t("in_killed", { n: b.kills })}` : ups.length ? t("in_up_short", { n: ups.length }) : t("in_nothing_for_you")}
                        </div>
                      </div>
                    </div>
                    {ups.length > 0 && <ul className="mt-3 space-y-2">{ups.map((u) => <UpgradeItem key={u.id} u={u} level={level} bis={bisRank.get(u.id)} />)}</ul>}
                  </li>
                );
              })}
            </ul>
          )}
          {other.length > 0 && (
            <div className="inst-boss mt-3">
              <div className="mb-2 text-sm text-muted">{t("in_other_loot")}</div>
              <ul className="space-y-2">{other.map((u) => <UpgradeItem key={u.id} u={u} level={level} bis={bisRank.get(u.id)} />)}</ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {r.lootKnown === "notable" && <span>{t("in_loot_notable")}</span>}
            {r.url && <a className="underline" href={r.url} target="_blank" rel="noopener noreferrer">ForeverDB</a>}
          </div>
        </div>
      )}
    </li>
  );
}

/** A boss's portrait: Wowhead's still of its model, framed like the game's encounter journal; a skull for the
 *  bosses Forever added, whose models no source here names. */
function BossFace({ model, name, killed, size = 34 }: { model: number | null; name: string; killed: boolean; size?: number }) {
  const [bad, setBad] = useState(false);
  const src = model ? media(`https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/${model & 255}/${model}.webp`) : undefined;
  return (
    <span className={`boss-face ${killed ? "killed" : ""}`} title={name} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <span aria-hidden>☠</span>}
    </span>
  );
}

/** One upgrade: hovering shows the throne room's comparison with what is worn in its slot. */
function UpgradeItem({ u, level, bis }: { u: InstRow["upgrades"][number]; level: number; bis?: number }) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <li>
      {/* the tooltip stands beside the item's own name, not at the far end of the row */}
      <div className="flex items-center gap-2.5 text-[15px]">
        <span ref={anchor} tabIndex={0} className="inline-flex min-w-0 items-center gap-2.5"
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <ItemIcon itemId={u.id} quality={Q_NAMES[u.q]} size={34} />
          <span className="grid min-w-0 leading-tight">
            <span className="truncate" style={{ color: qColor(Q_NAMES[u.q]) }}>{bis ? <span className="mr-1 text-[#c98cff]">★{bis}</span> : null}{u.name}</span>
            <span className="truncate text-xs text-muted">{t(`slot_${u.slot}` as Key)}{u.req > level ? ` · ${t("in_from_level", { n: u.req })}` : ""}
              {u.chance != null ? ` · ${t("in_chance", { p: u.chance < 1 ? u.chance.toFixed(1) : Math.round(u.chance) })}` : ""}</span>
          </span>
        </span>
        <span className="ml-auto font-mono text-base text-good">{u.gain == null ? t("mk_bis_new") : `+${Math.round(u.gain)}%`}</span>
        <AnimatePresence>
          {hover && u.full && anchor.current && <Compare a={u.full} b={u.worn ?? null} side="right" anchor={anchor.current} />}
        </AnimatePresence>
      </div>
    </li>
  );
}

/** The quest log: each quest opens to its zone, the text from the quest giver and the rewards. */
export function QuestsTab({ cid }: { cid: number }) {
  const { t } = useI18n();
  const q = useTab<{ id: number; name: string }[]>(cid, "quests_active");
  const done = useTab<{ count: number; recent: string[] }>(cid, "quests");
  const [open, setOpen] = useState<number | null>(null);
  const { lang } = useI18n();
  const s = useCharacter(cid).data?.summary?.[lang];
  const who = { name: s?.name ?? "", cls: s?.className ?? "", race: s?.race ?? "" };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {q.data?.data && <Stat k={t("qs_log")} v={q.data.data.length} />}
        {done.data?.data && <Stat k={t("ac_quests")} v={done.data.data.count} />}
      </div>
      <Frame q={q} empty={(d) => !d.length}>
        {(d) => (
          <ul className="divide-y divide-edge/40">
            {d.map((x) => (
              <li key={x.id}>
                <button className="flex w-full items-center gap-2 py-2 text-left hover:text-gold" onClick={() => setOpen(open === x.id ? null : x.id)}
                  aria-expanded={open === x.id}>
                  <span className="text-[#ffd100]">!</span><span className="flex-1">{x.name}</span>
                  <span className="text-xs text-muted">{open === x.id ? "▲" : "▼"}</span>
                </button>
                {open === x.id && <QuestDetails id={x.id} who={who} />}
              </li>
            ))}
          </ul>
        )}
      </Frame>
      {done.data?.data && done.data.data.recent.length > 0 && (
        <div>
          <div className="eyebrow mb-1">{t("qs_recent")}</div>
          <ul className="flex flex-wrap gap-1.5 text-xs">{[...done.data.data.recent].reverse().map((x) => <li key={x} className="chip">{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function QuestDetails({ id, who }: { id: number; who: { name: string; cls: string; race: string } }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  if (q.isLoading) return <p className="pb-2 pl-5 text-sm text-muted">…</p>;
  if (!q.data) return <p className="pb-2 pl-5 text-sm text-muted">{t("qs_none")}</p>;
  const d = q.data;
  // the game's placeholders: $N / {name} the character, $C / {class}, $R / {race}
  const sub: Record<string, string> = { n: who.name, name: who.name, c: who.cls, class: who.cls, r: who.race, race: who.race };
  const plain = (s: string) =>
    s.replace(/\$([nNcCrR])/g, (_, k: string) => sub[k.toLowerCase()] || "…").replace(/\{(\w+)\}/g, (_, k: string) => sub[k.toLowerCase()] || "…");
  return (
    <div className="mb-3 ml-5 space-y-2 rounded-md border border-edge/50 bg-bg/40 p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {d.area && <span>{t("qs_area")}: <span className="text-ink">{d.area}</span></span>}
        {d.level ? <span>{t("qs_level", { l: d.level })}</span> : null}
      </div>
      {d.description && <p className="whitespace-pre-line text-[#e8dcc0]">{plain(d.description)}</p>}
      {(d.xp || d.money || d.reputations.length > 0 || d.items.length > 0) && (
        <div>
          <div className="eyebrow mb-1">{t("qs_rewards")}</div>
          <ul className="space-y-0.5">
            {d.xp ? <li>{t("qs_xp", { n: d.xp })}</li> : null}
            {d.money ? <li><Money c={d.money} /></li> : null}
            {d.items.map((x) => <li key={x.id}>{x.choice ? t("qs_choice") + ": " : ""}{x.name}</li>)}
            {d.reputations.map((r) => <li key={r.name} className="text-good">{r.name} +{r.value}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Everything the game counts about the character, by its own groups. */
export function StatisticsTab({ cid }: { cid: number }) {
  const q = useTab<StatGroup[]>(cid, "statistics");
  const nf = (v: number | null) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2));
  return (
    <Frame q={q} empty={(d) => !d.length}>
      {(d) => (
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {d.map((g) => (
            <div key={g.group} className="char-stats mb-4 break-inside-avoid">
              <div className="eyebrow mb-1.5">{g.group}</div>
              {g.rows.map((r) => (
                <div key={`${r.id}-${r.name}`} className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">{r.name}</span><span className="font-mono tabular-nums">{nf(r.value)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

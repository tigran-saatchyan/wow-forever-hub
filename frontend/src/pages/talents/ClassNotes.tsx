import { useState } from "react";
import { notesItems, type ClassData, type NoteItem, type NotesData, type TalentIndex } from "../../engine";
import { iconStyle, type Icons, type NewsTopic } from "../../lib/gameData";
import { fmtDate, useI18n } from "../../lib/i18n";
import { store } from "../../lib/store";

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

/** Official notes newer than two weeks: Blizzard often announces talent changes before they reach the client files. */
export function NotesBar({ news, N, c, build, seen, onSeen, onGo }: {
  news?: NewsTopic[]; N?: NotesData; c: ClassData; build: string; seen: string; onSeen: (k: string) => void; onGo: () => void;
}) {
  const { t, lang } = useI18n();
  const n = (news || []).filter((x) => x.kind === "patch" && Date.now() - Date.parse(x.last) < 14 * 864e5)
    .sort((a, b) => b.last.localeCompare(a.last))[0];
  if (!n || seen === n.url + n.last) return null;
  const cn = N?.classes?.[c.token];
  const pend = cn ? notesItems(cn).filter((x) => x.s === "pending").length : 0;
  return (
    <div className="notesbar">
      <span>
        <b>{t("nb_title", { d: fmtDate(lang, n.last, { day: "numeric", month: "long" }) })}</b>{" "}
        {pend ? t("nb_pending", { n: pend, c: c.name }) : t("nb_text", { b: build })}
      </span>
      {cn ? <button className="btn" onClick={onGo}>{t("nb_go")}</button>
        : <a className="text-gold hover:underline" href={n.url} target="_blank" rel="noopener noreferrer">{trim(n.title, 70)} ↗</a>}
      <button className="btn ml-auto" onClick={() => onSeen(n.url + n.last)}>{t("nb_hide")}</button>
    </div>
  );
}

interface Props {
  N: NotesData;
  c: ClassData;
  M: TalentIndex;
  icons?: Icons;
  build: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  onTalent: (id: number) => void;
}

export function ClassNotes({ N, c, M, icons, build, open, setOpen, onTalent }: Props) {
  const { t, lang } = useI18n();
  const cn = N.classes[c.token];
  const [only, setOnly] = useState(() => store.get("cnOnlyPending", false));
  if (!cn) return null;
  const all = notesItems(cn);
  const cnt = (k: string) => all.filter((x) => x.s === k).length;

  const item = (x: NoteItem, i: number) => {
    if (only && x.s !== "pending") return null;
    const tl = x.id ? M[x.id] : undefined;
    return (
      <li
        key={i}
        className={`cn-item ${tl ? "tal-link" : ""}`}
        onClick={tl ? () => onTalent(tl.id) : undefined}
      >
        <span className={`st ${x.s}`}>{t(("cn_" + x.s) as "cn_done")}</span>
        <span>{tl && <span className="block text-[12.5px] font-semibold text-[#ffd100]">{tl.name}</span>}{x.t}</span>
      </li>
    );
  };
  const list = (arr: NoteItem[]) => {
    const h = arr.map(item).filter(Boolean);
    return h.length ? <ul className="grid gap-1.5">{h}</ul> : <p className="text-[13px] text-muted">{t("cn_none")}</p>;
  };
  const head = (icon: string, name: string) => (
    <h3 className="mb-2 flex items-center gap-2 font-display text-base text-ink">
      <span className="h-[22px] w-[22px] rounded-[3px]" style={iconStyle(icons, icon)} />
      {name}
    </h3>
  );

  return (
    <section id="class-notes" className="panel scroll-mt-24">
      <header
        role="button" tabIndex={0} aria-expanded={open}
        className="flex cursor-pointer flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open))}
      >
        <h2 className="font-display text-xl text-gold">{t("cn_title", { c: c.name })}</h2>
        <span className="flex flex-wrap gap-2">
          <span className="st pending">{t("cn_pending")} {cnt("pending")}</span>
          <span className="st done">{t("cn_done")} {cnt("done")}</span>
          <span className="st unknown">{t("cn_unknown")} {cnt("unknown")}</span>
        </span>
        <span className={`ml-auto text-lg text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
      </header>
      {open && (
        <div className="px-4 pb-4">
          <p className="mb-2.5 text-[12.5px] text-muted">
            {t("cn_src", { d: fmtDate(lang, N.source.posted, { day: "numeric", month: "long" }), b: N.build })}
            {N.build !== build ? " " + t("cn_stale", { b: build }) : ""}{" "}
            <a className="text-gold hover:underline" href={N.source.url} target="_blank" rel="noopener noreferrer">{N.source.title} ↗</a>
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={only} onChange={(e) => (store.set("cnOnlyPending", e.target.checked), setOnly(e.target.checked))} />
              <span>{t("cn_only")}</span>
            </label>
            <span className="text-muted">{t("cn_hint")}</span>
          </div>
          {cn.general.length > 0 && (!only || cn.general.some((x) => x.s === "pending")) && (
            <div className="mb-3.5">{head(c.icon, t("cn_general"))}{list(cn.general)}</div>
          )}
          <div className="grid gap-3.5 md:grid-cols-3">
            {c.tabs.map((tb, i) => <div key={tb.id}>{head(tb.icon, tb.name)}{list(cn.tabs[i] || [])}</div>)}
          </div>
          {cn.other.map((o) => <div key={o.name} className="mt-3.5">{head("inv_misc_questionmark", o.name)}{list(o.items)}</div>)}
        </div>
      )}
    </section>
  );
}

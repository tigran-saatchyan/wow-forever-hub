import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { analyzeSave, snapshot, type ClassData, type Ranks, type SavedBuild, type TalentDataset } from "../../engine";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

interface Props {
  D: TalentDataset;
  c: ClassData;
  level: number;
  legacy: number;
  ranks: Ranks;
  order: number[];
  split: number[];
  onOpen: (sv: SavedBuild) => void;
  toast: (s: string) => void;
}

export function Saves({ D, c, level, legacy, ranks, order, split, onOpen, toast }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [arm, setArm] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["builds"], queryFn: api.builds });

  const save = useMutation({
    mutationFn: () =>
      api.saveBuild({
        name: name.trim() || `${c.name} ${split.join("/")}`,
        cls: c.token, level, legacy, version: D.build, order, talents: snapshot(c, ranks),
      }),
    onSuccess: (b) => (qc.invalidateQueries({ queryKey: ["builds"] }), setName(b.name), toast(t("saved"))),
  });
  const del = useMutation({
    mutationFn: api.deleteBuild,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["builds"] }),
  });

  const remove = (id: string) => {
    if (arm !== id) {
      setArm(id);
      setTimeout(() => setArm((a) => (a === id ? null : a)), 3500);
      return;
    }
    setArm(null);
    del.mutate(id);
  };

  const rows = (list.data || []).map((sv) => {
    const k = D.classes.find((x) => x.token === sv.cls);
    return { sv, k, a: k ? analyzeSave(k, sv) : null };
  }).sort((p, q) => Number(!!q.a?.broken) - Number(!!p.a?.broken));

  return (
    <section className="panel p-4">
      <h2 className="panel-title mb-3">{t("saves_title")}</h2>
      <div className="mb-3 flex gap-2">
        <input className="input flex-1" maxLength={40} placeholder={t("save_name")} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{t("save")}</button>
      </div>
      {!rows.length && <p className="text-sm text-muted">{t("saves_empty")}</p>}
      <ul className="space-y-2">
        {rows.map(({ sv, k, a }) => (
          <li key={sv.id} className={`rounded-md border p-2 ${a?.broken ? "border-bad/60" : "border-edge/60"}`}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: k?.color }} />
              <b className="flex-1 truncate text-sm">{sv.name}</b>
              <span className="text-xs text-muted">{a?.split.join("/")} · L{sv.level}</span>
            </div>
            {a?.broken && <p className="mt-1 text-xs text-bad">{t("broken")}: {a.changed.map((f) => f.name).join(", ")}</p>}
            <div className="mt-2 flex gap-2">
              <button className="btn px-2 py-0.5 text-xs" onClick={() => onOpen(sv)}>{t("open")}</button>
              <button className="btn px-2 py-0.5 text-xs hover:text-bad" onClick={() => remove(sv.id)}>
                {arm === sv.id ? t("confirm_delete") : t("delete")}
              </button>
              <span className="ml-auto self-center text-[11px] text-muted">{sv.version}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

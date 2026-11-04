import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { store } from "./store";

/** Languages: ru and en now; ka (Georgian) is planned — add a dict with the same keys. */
export type Lang = "ru" | "en";
export const LANGS: Lang[] = ["ru", "en"];

const en = {
  nav_dashboard: "Dashboard",
  nav_talents: "Talents",
  nav_login: "Sign in",
  nav_logout: "Sign out",
  tagline: "WoW: Forever hub — status, talents and tools",
  theme: "Theme",
  sound_on: "Sound on",
  sound_off: "Sound off",
  // status
  st_prelaunch: "Before launch",
  st_now: "Maintenance now",
  st_soon: "Maintenance soon",
  st_stale: "Data is stale",
  st_reports: "Players report problems",
  st_online: "Online",
  st_prelaunch_t: "The beta is over; servers open at {l}.",
  st_now_t: "Maintenance started {t}.",
  st_soon_t: "Maintenance planned for {t}.",
  st_stale_t: "No fresh data for {a}: not claiming the servers are up.",
  st_reports_t: "{n} new topics about login problems in the last hour.",
  st_online_t: "No maintenance, no wave of complaints.",
  st_live: "live",
  st_offline: "no live link",
  f_build: "Client build",
  f_launch: "Launch",
  f_since: "Since launch",
  f_cap: "Level cap",
  f_news: "Blue posts this week",
  reset_title: "Weekly reset",
  reset_note: "Usual Classic times; Blizzard has not confirmed Forever's yet.",
  maint_title: "Maintenance",
  maint_empty: "No maintenance announced.",
  news_title: "Blue posts",
  builds_title: "Client builds",
  chars_title: "My characters",
  chars_soon: "Comes with the in-game addon (export → upload). Planned: Priest, Rogue, Paladin/Warrior.",
  days: "d",
  hours: "h",
  minutes: "m",
  // talents
  points_left: "points left",
  level: "Level",
  reset_all: "Reset all",
  reset_tab: "reset",
  copy_link: "Link to build",
  copied: "Link copied",
  legacy_none: "none",
  legacy_tier: "Tier {k}: first point at level {l}",
  legacy_hint: "Legacy: unlocked by 5 points in the second tree and Well Rested 5/5.",
  over_budget: "More points spent than level {l} gives. Remove {n}.",
  rank: "Rank {r}/{m}",
  passive: "Passive",
  next_rank: "Next rank:",
  req_points: "Requires {p} points in {t}",
  req_parent: "Requires {n} ({m}/{m})",
  key_talent: "Key talent",
  learn_at: "Learned at level {l}",
  data_note: "Build {b} data. Values come from the client files; effects scaling with attack/spell power shown without gear.",
  plan_title: "Leveling plan",
  saves_title: "Saved builds",
  save: "Save",
  save_name: "Build name",
  saves_login: "Sign in to keep builds on the server.",
  saves_empty: "No saved builds yet.",
  open: "Open",
  delete: "Delete",
  confirm_delete: "Sure?",
  broken: "Talents changed since the build was saved",
  saved: "Saved",
  // login
  email: "Email",
  password: "Password",
  login_fail: "Wrong email or password",
};

const ru: typeof en = {
  nav_dashboard: "Главная",
  nav_talents: "Таланты",
  nav_login: "Войти",
  nav_logout: "Выйти",
  tagline: "Хаб WoW: Forever — статус, таланты и инструменты",
  theme: "Тема",
  sound_on: "Звук вкл.",
  sound_off: "Звук выкл.",
  st_prelaunch: "До запуска",
  st_now: "Идут работы",
  st_soon: "Скоро работы",
  st_stale: "Данные устарели",
  st_reports: "Игроки жалуются",
  st_online: "Работает",
  st_prelaunch_t: "Бета закрыта; серверы откроются {l}.",
  st_now_t: "Работы начались {t}.",
  st_soon_t: "Работы запланированы на {t}.",
  st_stale_t: "Свежих данных нет уже {a}: не утверждаем, что сервер работает.",
  st_reports_t: "{n} новых тем о проблемах со входом за последний час.",
  st_online_t: "Работ нет, волны жалоб нет.",
  st_live: "онлайн",
  st_offline: "нет живого канала",
  f_build: "Сборка клиента",
  f_launch: "Запуск",
  f_since: "С запуска",
  f_cap: "Кап уровня",
  f_news: "Синих постов за неделю",
  reset_title: "Еженедельный ресет",
  reset_note: "Обычное время Classic; для Forever Blizzard его ещё не подтвердили.",
  maint_title: "Работы",
  maint_empty: "Работы не объявлены.",
  news_title: "Синие посты",
  builds_title: "Сборки клиента",
  chars_title: "Мои персонажи",
  chars_soon: "Появятся с игровым аддоном (экспорт → загрузка). В планах: Жрец, Разбойник, Паладин/Воин.",
  days: "д",
  hours: "ч",
  minutes: "м",
  points_left: "очков осталось",
  level: "Уровень",
  reset_all: "Сбросить всё",
  reset_tab: "сброс",
  copy_link: "Ссылка на билд",
  copied: "Ссылка скопирована",
  legacy_none: "нет",
  legacy_tier: "Ступень {k}: первое очко на {l} уровне",
  legacy_hint: "Legacy: открывается за 5 очков во втором дереве и «Хороший отдых» 5/5.",
  over_budget: "Потрачено больше, чем даёт {l} уровень. Уберите {n}.",
  rank: "Ранг {r}/{m}",
  passive: "Пассивный",
  next_rank: "Следующий ранг:",
  req_points: "Нужно {p} очков в ветке «{t}»",
  req_parent: "Нужно: {n} ({m}/{m})",
  key_talent: "Ключевой талант",
  learn_at: "Берётся на {l} уровне",
  data_note: "Данные сборки {b}. Значения из файлов клиента; эффекты от силы атаки и заклинаний показаны без экипировки.",
  plan_title: "План прокачки",
  saves_title: "Сохранённые билды",
  save: "Сохранить",
  save_name: "Название билда",
  saves_login: "Войдите, чтобы хранить билды на сервере.",
  saves_empty: "Сохранённых билдов пока нет.",
  open: "Открыть",
  delete: "Удалить",
  confirm_delete: "Точно?",
  broken: "Таланты изменились после сохранения",
  saved: "Сохранено",
  email: "Почта",
  password: "Пароль",
  login_fail: "Неверная почта или пароль",
};

export type Key = keyof typeof en;
const DICTS: Record<Lang, typeof en> = { en, ru };

type T = (k: Key, v?: Record<string, string | number>) => string;
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T }>(null!);

function initialLang(): Lang {
  const saved = store.get<Lang | null>("lang", null);
  if (saved && LANGS.includes(saved)) return saved;
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const value = useMemo(() => {
    const t: T = (k, v = {}) => (DICTS[lang][k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ""));
    const setLang = (l: Lang) => {
      store.set("lang", l);
      document.documentElement.lang = l;
      setLangState(l);
    };
    return { lang, setLang, t };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export function fmtDate(lang: Lang, iso: string | number, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", opts ?? {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

# Выкладка на Railway

Пошагово, у каждого шага есть проверка. Если проверка не прошла, дальше идти нет смысла.

Схема: **отдельный проект Railway `forever-hub`**, изолированный от `TInvest-back-front` и
`craftorai3d-*`. **Один сервис**: FastAPI отдаёт API, игровые данные и собранный фронт с одного
домена. Поэтому нет CORS, нет `VITE_API_BASE_URL` и второго сервиса под nginx.

| Что | Где | Стоимость |
|---|---|---|
| `hub`: FastAPI + фронт, Dockerfile в корне | Railway | ~$1–3/мес |
| База: SQLite на Volume | Railway Volume | центы (≈0.25 $/ГБ) |

Почему SQLite, а не Postgres: пользователь один, данных несколько килобайт билдов. Когда дойдём
до гильдии и трекера, достаточно сменить `FH_DATABASE_URL` на Supabase Session pooler
(`postgresql+asyncpg://…`, как в TInvest): драйвер `asyncpg` уже в зависимостях.

---

## Шаг 0. Что подготовить

- **Секрет сессий** (не короче 32 символов):
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```
- **Ваша почта и пароль** (пароль не короче 10 символов).

В проде приложение **не запустится**, если что-то из этого осталось по умолчанию или не задано
`FH_DATABASE_URL`. Без базы на Volume билды пропадали бы при каждом передеплое.

---

## Шаг 1. Проект и сервис

1. Railway → **New** → **Deploy from GitHub repo** → `tigran-saatchyan/wow-forever-hub`.
2. Проект переименовать в `forever-hub`, сервис — в `hub` (Settings → Service Name).
3. Settings → **Source**:
   - **Branch**: `claude/sharp-bardeen-no57jz` (пока это единственная ветка; после слияния в `main` переключить на `main`).
   - **Root Directory**: пусто (корень репозитория). Образу нужны `backend/`, `frontend/` и `data/` сразу.
   - Watch Paths и healthcheck заданы в `railway.json`, руками их не трогать.
4. Builder трогать не нужно: в корне лежит `Dockerfile`, `railway.json` указывает на него.
5. **Не задавайте Custom Start Command.** Команда запуска зашита в образ.

## Шаг 2. Volume под базу

1. На сервисе `hub`: правый клик → **Attach Volume** (или Command Palette → *Volume*).
2. **Mount path**: `/var/lib/foreverhub`.

## Шаг 3. Переменные

Settings → **Variables** → Raw Editor:

```
FH_JWT_SECRET=<из шага 0>
FH_ADMIN_EMAIL=<ваша почта>
FH_ADMIN_PASSWORD=<ваш пароль>
FH_DATABASE_URL=sqlite+aiosqlite:////var/lib/foreverhub/hub.db
```

Четыре слэша в `FH_DATABASE_URL` не опечатка: `sqlite:///` плюс абсолютный путь `/var/…`.

`FH_ENV=production`, `FH_COOKIE_SECURE=true` и пути к данным и фронту уже заданы в `Dockerfile`.

Суперадмин создаётся при старте из `FH_ADMIN_EMAIL` и `FH_ADMIN_PASSWORD`. Чтобы сменить пароль,
поменяйте переменную: при следующем старте пароль обновится. Регистрации нет совсем.

## Шаг 4. Домен

Settings → Networking → **Generate Domain**. Порт Railway подставит сам через `PORT`.

---

## Проверка

1. `https://<домен>/api/health` отдаёт `{"ok":true}`.
2. `https://<домен>/` показывает форму входа; вход работает с почтой и паролем из шага 3.
3. Калькулятор: сохранить билд → **Redeploy** → билд на месте. Значит, база действительно на Volume.
4. На дашборде рядом со временем данных написано **«онлайн»**: живой канал (SSE) проходит через прокси Railway.

---

## Если что-то пошло не так

| Симптом | Причина |
|---|---|
| Деплой падает, в логах `Unsafe production config: …` | в сообщении перечислено, какой переменной не хватает |
| Вход не работает, после входа снова форма | открыто по `http://`, а cookie `Secure`; заходить только по `https://` домена Railway |
| Билды пропадают после деплоя | Volume не подключён или путь в `FH_DATABASE_URL` не совпадает с mount path |
| На дашборде «нет живого канала» | соединение `/api/live` оборвалось; страница всё равно показывает последние данные |
| Изменения не выкатываются | правка не попала в Watch Paths (`backend/`, `frontend/`, `data/`, `Dockerfile`, `railway.json`) |

## Обновление данных

Сейчас `data/` зашита в образ: это снимок сборки 1.60.1.70755. Перенос сборщика в бэкенд с
записью на тот же Volume — этап 2 в [ROADMAP](ROADMAP.md). До тех пор новые данные попадают в
прод коммитом в `data/`.

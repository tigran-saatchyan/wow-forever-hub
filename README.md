# Forever Hub

Личный хаб для **WoW: Forever**: калькулятор талантов, живой статус серверов, синие посты,
позже трекер персонажей, журнал фарма и карта.

- Что строим и зачем: [docs/SPEC.md](docs/SPEC.md)
- План по этапам: [docs/ROADMAP.md](docs/ROADMAP.md)
- Выкладка на Railway: [docs/DEPLOY.md](docs/DEPLOY.md)

## Структура

| Папка | Что внутри |
|---|---|
| `backend/` | FastAPI: вход, билды, живой статус (SSE), раздача `data/` |
| `frontend/` | React + TypeScript + Vite + Tailwind; движок калькулятора в `src/engine` |
| `data/` | Данные сборщика: таланты, способности, диффы, иконки, статус, посты |
| `legacy/` | Прототип как есть (сборщик на Python и `index.html`), источник логики |

## Локальный запуск

Нужны Python 3.12+ с [uv](https://docs.astral.sh/uv/) и Node 20+.

Бэкенд (порт 8000):

```bash
cd backend && cp .env.example .env && uv sync && uv run uvicorn app.main:app --reload --port 8000
```

Фронтенд (порт 5173, проксирует `/api` и `/data` на бэкенд):

```bash
cd frontend && npm install && npm run dev
```

Откройте http://localhost:5173 и войдите с `FH_ADMIN_EMAIL` и `FH_ADMIN_PASSWORD` из `backend/.env`.
Суперадмин создаётся при старте; если сменить пароль в `.env`, он обновится при следующем запуске.

## Проверки

```bash
cd backend && uv run pytest && uv run ruff check .
```

```bash
cd frontend && npm test && npm run typecheck
```

Тесты движка сверяют TypeScript-порт с оригинальными функциями из `legacy/web/index.html`
на случайных билдах всех девяти классов.

## Карты

Карты Forever собираются из файлов клиента одной командой (результат лежит в репозитории):

```bash
python tools/build_maps.py --build 1.60.1.70938
```

## Обновление данных

На сервере данные обновляет сам бэкенд (`app/gamedata.py`, см. docs/DEPLOY.md); в `data/` лежит снимок
(16 ноября 2026, сборка 1.60.1.70938). Вручную сборщик запускается так:

```bash
cd legacy && python -m venv .venv && .venv/bin/pip install -r requirements.txt && FH_WEB_DATA=../data .venv/bin/python -m collector update
```

Когда `data/status.json` или `data/news.json` меняются, открытые страницы получают новое состояние сами.

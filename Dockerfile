# One image, one Railway service: FastAPI serves the API, the game data and the built frontend.

# --- frontend build ---
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# --- runtime ---
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
WORKDIR /app/backend

# dependencies in their own layer: code edits do not reinstall them
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY data/ /app/data/
COPY --from=web /web/dist /app/frontend/dist

ENV FH_ENV=production \
    FH_DATA_DIR=/app/data \
    FH_STATIC_DIR=/app/frontend/dist \
    FH_COOKIE_SECURE=true \
    PATH="/app/backend/.venv/bin:$PATH"

EXPOSE 8000
# Railway sets PORT. One worker: SSE connections are cheap and there is a single user.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

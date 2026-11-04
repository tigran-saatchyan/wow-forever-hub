from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import auth
from .config import get_settings
from .db import init_db
from .routers import builds, live


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await auth.ensure_superadmin()
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Forever Hub API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(builds.router)
    app.include_router(live.router)

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    # Game data produced by the collector: talents, abilities, diffs, icons, status, news, errors.
    app.mount("/data", StaticFiles(directory=s.data_dir), name="data")
    return app


app = create_app()

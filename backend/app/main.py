from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .config import get_settings
from .db import init_db
from .routers import builds, live


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().check_production()
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

    # Production: the built frontend is served from the same origin (one Railway service, no CORS).
    if s.static_dir and (s.static_dir / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=s.static_dir / "assets"), name="assets")
        index = s.static_dir / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            # real files (favicon...) as is; every other route is a client-side page
            f = (s.static_dir / path).resolve()
            if path and f.is_file() and f.is_relative_to(s.static_dir.resolve()):
                return FileResponse(f)
            if path.startswith(("api/", "data/")):
                raise HTTPException(404)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()

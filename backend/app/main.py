import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, bnet
from .config import get_settings
from .db import init_db
from .routers import bnet as bnet_routes
from .routers import builds, characters, collections, items, live, market, media, professions, quests, sources


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().check_production()
    await init_db()
    await auth.ensure_superadmin()
    s = get_settings()
    tasks = []
    if s.ah_poll_minutes > 0 and bnet.client().configured:
        tasks.append(asyncio.create_task(market.poller()))
    if s.everloot_prefetch:
        tasks.append(asyncio.create_task(sources.prefetcher()))
    if s.refresh_hours > 0 and bnet.client().configured:
        tasks.append(asyncio.create_task(characters.refresher()))
    yield
    for task in tasks:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await bnet.client().aclose()
    bnet.set_client(None)


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
    app.include_router(bnet_routes.router)
    app.include_router(characters.router)
    app.include_router(items.router)
    app.include_router(market.router)
    app.include_router(media.router)
    app.include_router(professions.router)
    app.include_router(sources.router)
    app.include_router(quests.router)
    app.include_router(collections.router)

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

"""Settings from environment variables (or backend/.env)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FH_", extra="ignore")

    # SQLite locally, Postgres on Railway: postgresql+asyncpg://user:pass@host/db
    database_url: str = f"sqlite+aiosqlite:///{REPO_ROOT / 'backend' / 'forever_hub.db'}"
    data_dir: Path = REPO_ROOT / "data"

    # The superadmin is created (or has their password reset) at startup.
    admin_email: str = "admin@local"
    admin_password: str = "change-me"

    jwt_secret: str = "dev-secret-change-me-please-32-bytes-min"
    jwt_ttl_hours: int = 24 * 14
    cookie_secure: bool = False  # True behind HTTPS (Railway)

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    live_poll_seconds: float = 5.0


@lru_cache
def get_settings() -> Settings:
    return Settings()

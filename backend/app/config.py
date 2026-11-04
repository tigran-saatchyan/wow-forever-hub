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

    env: str = "development"  # "production" on Railway
    static_dir: Path | None = None  # built frontend (frontend/dist); set in the Docker image

    def check_production(self) -> None:
        """Refuse to start in production with known defaults: a public secret lets anyone forge a session."""
        if self.env != "production":
            return
        problems = []
        if self.jwt_secret == Settings.model_fields["jwt_secret"].default or len(self.jwt_secret) < 32:
            problems.append("FH_JWT_SECRET is the default or shorter than 32 chars")
        if self.admin_password == "change-me" or len(self.admin_password) < 10:
            problems.append("FH_ADMIN_PASSWORD is the default or shorter than 10 chars")
        if self.admin_email == "admin@local":
            problems.append("FH_ADMIN_EMAIL is the default")
        if self.database_url == Settings.model_fields["database_url"].default:
            problems.append("FH_DATABASE_URL is not set: builds would live in the container and vanish on redeploy")
        if not self.cookie_secure:
            problems.append("FH_COOKIE_SECURE must be true behind HTTPS")
        if problems:
            raise RuntimeError("Unsafe production config: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()

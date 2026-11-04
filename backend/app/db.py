from collections.abc import AsyncIterator
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # superadmin | member (guild members later)
    role: Mapped[str] = mapped_column(String(32), default="member")
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Build(Base):
    """A saved talent build. Same shape as the prototype's saves (talents keyed by node id with fp)."""

    __tablename__ = "builds"
    __table_args__ = (UniqueConstraint("user_id", "cls", "name_key"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    name_key: Mapped[str] = mapped_column(String(40))  # lower-cased name: same name + class overwrites
    cls: Mapped[str] = mapped_column(String(16))
    level: Mapped[int] = mapped_column(Integer, default=60)
    legacy: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[str] = mapped_column(String(32))
    order: Mapped[list] = mapped_column(JSON, default=list)
    talents: Mapped[dict] = mapped_column(JSON, default=dict)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


engine = create_async_engine(get_settings().database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # Alembic comes with the first schema change that needs a migration (see docs/ROADMAP.md).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

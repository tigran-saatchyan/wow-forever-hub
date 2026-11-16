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


class Character(Base):
    """A WoW: Forever character followed by a user. Forever has no realms: name-surname is the key."""

    __tablename__ = "characters"
    __table_args__ = (UniqueConstraint("user_id", "region", "slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(4))
    slug: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | bnet (from sign-in)
    profile: Mapped[dict] = mapped_column(JSON, default=dict)  # normalized summary, equipment, talents
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    fetched: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Item(Base):
    """Item data from static-forever, cached forever per language (items do not change within a build)."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lang: Mapped[str] = mapped_column(String(4), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    """Small key/value settings: the market to poll, the Battle.net account linked to the hub."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


class AhLatest(Base):
    """The latest auction snapshot of one house, one row per item (unit prices in copper)."""

    __tablename__ = "ah_latest"

    ruleset: Mapped[int] = mapped_column(Integer, primary_key=True)
    house: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    min_price: Mapped[int] = mapped_column(Integer)
    median_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    auctions: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AhHistory(Base):
    """Price history, kept only for watched items so the database stays small."""

    __tablename__ = "ah_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ruleset: Mapped[int] = mapped_column(Integer, index=True)
    house: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[int] = mapped_column(Integer, index=True)
    min_price: Mapped[int] = mapped_column(Integer)
    median_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AhWatch(Base):
    """An item a user watches on the auction house, with an optional "tell me below" price."""

    __tablename__ = "ah_watch"
    __table_args__ = (UniqueConstraint("user_id", "item_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(Integer)
    below: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


engine = create_async_engine(get_settings().database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # Alembic comes with the first schema change that needs a migration (see docs/ROADMAP.md).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

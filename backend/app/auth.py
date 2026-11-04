from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.requests import Request
from pwdlib import PasswordHash
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import SessionLocal, User, get_session

COOKIE = "fh_session"
hasher = PasswordHash.recommended()
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str


def make_token(user_id: int) -> str:
    s = get_settings()
    exp = datetime.now(UTC) + timedelta(hours=s.jwt_ttl_hours)
    return jwt.encode({"sub": str(user_id), "exp": exp}, s.jwt_secret, algorithm="HS256")


async def current_user(request: Request, session: Annotated[AsyncSession, Depends(get_session)]) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")
    try:
        uid = int(jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad session") from e
    user = await session.get(User, uid)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "no such user")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


@router.post("/login", response_model=UserOut)
async def login(body: LoginIn, response: Response, session: Annotated[AsyncSession, Depends(get_session)]):
    user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if not user or not hasher.verify(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong email or password")
    s = get_settings()
    response.set_cookie(
        COOKIE,
        make_token(user.id),
        httponly=True,
        samesite="lax",
        secure=s.cookie_secure,
        max_age=s.jwt_ttl_hours * 3600,
    )
    return UserOut(id=user.id, email=user.email, role=user.role)


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(COOKIE)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut(id=user.id, email=user.email, role=user.role)


async def ensure_superadmin() -> None:
    """Create the single superadmin from FH_ADMIN_EMAIL / FH_ADMIN_PASSWORD, or refresh their password."""
    s = get_settings()
    async with SessionLocal() as session:
        email = s.admin_email.lower()
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            session.add(User(email=email, password_hash=hasher.hash(s.admin_password), role="superadmin"))
        elif not hasher.verify(s.admin_password, user.password_hash):
            user.password_hash = hasher.hash(s.admin_password)
        await session.commit()

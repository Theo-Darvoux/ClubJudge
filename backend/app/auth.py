import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import as_utc, get_db
from app.models import Role, User, UserSession
from app.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "clubjudge_session"
SESSION_LIFETIME = timedelta(days=30)

_hasher = PasswordHasher()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=get_settings().secure_cookies,
        path="/",
    )


def _open_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            token_hash=_token_hash(token),
            user_id=user.id,
            expires_at=datetime.now(UTC) + SESSION_LIFETIME,
        )
    )
    db.commit()
    _set_session_cookie(response, token)


def get_current_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    session = db.get(UserSession, _token_hash(token))
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    if as_utc(session.expires_at) < datetime.now(UTC):
        db.delete(session)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return session.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_only")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=64)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    role: str


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterPayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    settings = get_settings()
    enforce_rate_limit(
        request,
        "auth.register",
        limit=settings.register_rate_limit_per_hour,
        window_s=3600,
    )
    email = payload.email.lower()
    exists = db.scalar(select(User).where(func.lower(User.email) == email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken")
    user = User(
        email=email,
        password_hash=_hasher.hash(payload.password),
        display_name=payload.display_name.strip(),
    )
    db.add(user)
    db.commit()
    _open_session(db, user, response)
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/login")
def login(
    payload: LoginPayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    settings = get_settings()
    enforce_rate_limit(
        request,
        "auth.login",
        limit=settings.login_rate_limit_per_minute,
        window_s=60,
    )
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad_credentials")
    try:
        _hasher.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad_credentials") from None
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = _hasher.hash(payload.password)
        db.commit()
    _open_session(db, user, response)
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Annotated[Session, Depends(get_db)]) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = db.get(UserSession, _token_hash(token))
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user, from_attributes=True)

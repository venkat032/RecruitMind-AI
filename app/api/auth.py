import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.deps import (
    SESSION_COOKIE,
    client_ip,
    get_current_session,
    user_agent,
    verify_origin,
)
from app.api.schemas import LoginRequest, RegisterRequest
from app.database.crud import DuplicateRecordError
from app.services import auth_service
from app.services.auth_service import AuthError
from app.services.rate_limit import login_limiter, register_limiter


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

PUBLIC_FIELDS = ("id", "email", "full_name", "company", "role", "last_login_at", "created_at")


def public_user(user: dict) -> dict:
    return {k: user.get(k) for k in PUBLIC_FIELDS}


def set_session_cookie(request: Request, response: Response, token: str, expires_at: datetime, remember_me: bool) -> None:

    secure = request.url.scheme == "https" or os.getenv("SESSION_COOKIE_SECURE", "").lower() == "true"

    response.set_cookie(
        SESSION_COOKIE,
        token,
        # Without "remember me" it is a browser-session cookie (gone when the browser closes)
        expires=expires_at if remember_me else None,
        httponly=True,       # JavaScript can never read the session token
        secure=secure,       # HTTPS only in production
        samesite="lax",      # not sent on cross-site POSTs
        path="/",
    )


def enforce_rate_limit(limiter, key: str) -> None:

    retry_after = limiter.hit(key)

    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )


def raise_auth_error(e: AuthError):
    raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/register", status_code=201)
def register(body: RegisterRequest, request: Request, response: Response):

    verify_origin(request)
    enforce_rate_limit(register_limiter, f"register:{client_ip(request)}")

    try:
        user = auth_service.register(
            email=body.email,
            full_name=body.full_name,
            company=body.company,
            password=body.password,
            ip=client_ip(request),
            user_agent=user_agent(request),
        )

    except AuthError as e:
        raise_auth_error(e)

    except DuplicateRecordError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Sign the new user in straight away
    token, expires_at = auth_service.start_session(user["id"], False, client_ip(request), user_agent(request))
    set_session_cookie(request, response, token, expires_at, remember_me=False)

    return public_user(user)


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response):

    verify_origin(request)
    enforce_rate_limit(login_limiter, f"login:{client_ip(request)}")

    try:
        user = auth_service.authenticate(body.email, body.password, client_ip(request), user_agent(request))

    except AuthError as e:
        raise_auth_error(e)

    token, expires_at = auth_service.start_session(
        user["id"], body.remember_me, client_ip(request), user_agent(request)
    )
    set_session_cookie(request, response, token, expires_at, body.remember_me)

    return public_user(user)


@router.get("/me")
def me(session: dict = Depends(get_current_session)):
    return public_user(session)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, session: dict = Depends(get_current_session)):

    auth_service.logout(session, client_ip(request), user_agent(request))
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/logout-all", status_code=204)
def logout_all(request: Request, response: Response, session: dict = Depends(get_current_session)):
    """Sign out of every device (e.g. after a lost laptop)."""

    auth_service.logout_everywhere(session, client_ip(request), user_agent(request))
    response.delete_cookie(SESSION_COOKIE, path="/")

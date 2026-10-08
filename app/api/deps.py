"""
Request-level security shared by every protected route.

CSRF: the session cookie is SameSite=Lax, and every state-changing request
must come from a trusted Origin (OWASP "verify origin with standard
headers"). Requests without Origin/Referer are not browser form posts, so
they can't be CSRF and are allowed through to the session check.
"""

import os
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from app.services.auth_service import resolve_session


SESSION_COOKIE = "rm_session"

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# Extra allowed browser origins, e.g. "https://app.example.com" (comma separated)
TRUSTED_ORIGINS = {
    urlparse(o.strip()).netloc
    for o in os.getenv("TRUSTED_ORIGINS", "").split(",")
    if o.strip()
}


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def verify_origin(request: Request) -> None:

    if request.method in SAFE_METHODS:
        return

    source = request.headers.get("origin") or request.headers.get("referer")

    if not source:
        return

    origin_host = urlparse(source).netloc

    if origin_host != request.headers.get("host") and origin_host not in TRUSTED_ORIGINS:
        raise HTTPException(status_code=403, detail="Cross-site request blocked.")


def get_current_session(request: Request) -> dict:
    """Dependency: the signed-in user's session, or 401."""

    verify_origin(request)

    session = resolve_session(request.cookies.get(SESSION_COOKIE))

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Please sign in to continue.",
        )

    return session

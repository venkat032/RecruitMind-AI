"""
Authentication rules.

- Passwords: Argon2id (argon2-cffi defaults), transparently re-hashed when
  the parameters are strengthened.
- Sessions: opaque random tokens; only their SHA-256 is stored, so a
  database leak does not leak usable sessions. Revocable server-side.
- Brute force: per-account lockout + per-IP rate limiting (rate_limit.py).
- Login errors never reveal whether an email is registered.
"""

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.database import auth_crud


MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))
REMEMBER_ME_DAYS = int(os.getenv("REMEMBER_ME_DAYS", "30"))
IDLE_TIMEOUT_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "120"))
TOUCH_EVERY = timedelta(minutes=5)

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128

COMMON_PASSWORDS = {
    "password", "password1", "password123", "passw0rd", "123456789012", "qwertyuiop",
    "qwerty123456", "iloveyou", "letmein", "welcome", "welcome123", "admin", "admin123",
    "administrator", "changeme", "recruitmind", "recruiter", "123456", "12345678",
    "1234567890", "abc123", "football", "monkey", "dragon", "sunshine", "princess",
}

_hasher = PasswordHasher()

# Verified when an email doesn't exist, so response time doesn't reveal it
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


class AuthError(Exception):

    def __init__(self, message: str, status_code: int = 401, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


INVALID_CREDENTIALS = "Invalid email or password."


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================
# Passwords
# ============================================================

def password_problems(password: str, email: str = "", full_name: str = "") -> list[str]:
    """Empty list = acceptable. Mirrors the checklist shown in the frontend."""

    problems = []

    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"Use at least {PASSWORD_MIN_LENGTH} characters.")

    if len(password) > PASSWORD_MAX_LENGTH:
        problems.append(f"Use at most {PASSWORD_MAX_LENGTH} characters.")

    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("Include both letters and numbers.")

    lowered = password.lower()
    # "Password2026!" is still "password": strip digits and symbols before comparing
    core = re.sub(r"[^a-z]", "", lowered)

    if lowered in COMMON_PASSWORDS or core in COMMON_PASSWORDS or len(set(lowered)) <= 3:
        problems.append("This password is too common or predictable.")

    personal = [email.split("@")[0], *full_name.split()]
    if any(len(p) >= 3 and p.lower() in lowered for p in personal):
        problems.append("Don't include your name or email in the password.")

    return problems


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:

    try:
        return _hasher.verify(password_hash, password)

    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ============================================================
# Sessions
# ============================================================

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_lifetime(remember_me: bool) -> timedelta:
    return timedelta(days=REMEMBER_ME_DAYS) if remember_me else timedelta(hours=SESSION_HOURS)


def start_session(user_id: int, remember_me: bool, ip: str | None, user_agent: str | None) -> tuple[str, datetime]:
    """Returns (raw token for the cookie, expiry)."""

    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + session_lifetime(remember_me)

    auth_crud.create_session(
        user_id=user_id,
        token_hash=hash_token(token),
        expires_at=expires_at,
        remember_me=remember_me,
        ip_address=ip,
        user_agent=(user_agent or "")[:500],
    )

    return token, expires_at


def resolve_session(token: str | None) -> dict | None:
    """The signed-in user for a session token, or None if it isn't valid."""

    if not token:
        return None

    session = auth_crud.get_session(hash_token(token))

    if session is None or session["revoked_at"] is not None or not session["is_active"]:
        return None

    now = utcnow()

    if session["expires_at"] <= now:
        return None

    idle = now - session["last_seen_at"]

    if not session["remember_me"] and idle > timedelta(minutes=IDLE_TIMEOUT_MINUTES):
        auth_crud.revoke_session(session["session_id"])
        return None

    if idle > TOUCH_EVERY:
        auth_crud.touch_session(session["session_id"])

    return session


# ============================================================
# Use cases
# ============================================================

def register(
    email: str, full_name: str, company: str | None, password: str, ip: str | None, user_agent: str | None
) -> dict:

    problems = password_problems(password, email, full_name)

    if problems:
        raise AuthError(" ".join(problems), status_code=422)

    user = auth_crud.create_user(
        email=email,
        full_name=full_name,
        company=company,
        password_hash=hash_password(password),
    )

    auth_crud.log_auth_event("register", user["id"], email, ip, user_agent)

    return user


def authenticate(email: str, password: str, ip: str | None, user_agent: str | None) -> dict:

    user = auth_crud.get_user_for_login(email)

    if user is None:
        verify_password(_DUMMY_HASH, password)
        auth_crud.log_auth_event("login_failed", None, email, ip, user_agent)
        raise AuthError(INVALID_CREDENTIALS)

    now = utcnow()

    if user["locked_until"] and user["locked_until"] > now:
        minutes = max(1, int((user["locked_until"] - now).total_seconds() // 60) + 1)
        auth_crud.log_auth_event("login_blocked_locked", user["id"], email, ip, user_agent)
        raise AuthError(
            f"Too many failed sign-in attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            status_code=423,
        )

    if not verify_password(user["password_hash"], password):
        result = auth_crud.record_failed_login(
            user["id"], MAX_FAILED_ATTEMPTS, now + timedelta(minutes=LOCKOUT_MINUTES)
        )
        locked = result["failed_login_attempts"] >= MAX_FAILED_ATTEMPTS
        auth_crud.log_auth_event("account_locked" if locked else "login_failed", user["id"], email, ip, user_agent)
        raise AuthError(INVALID_CREDENTIALS)

    if not user["is_active"]:
        auth_crud.log_auth_event("login_blocked_inactive", user["id"], email, ip, user_agent)
        raise AuthError("This account has been deactivated. Contact your workspace admin.", status_code=403)

    new_hash = hash_password(password) if _hasher.check_needs_rehash(user["password_hash"]) else None
    auth_crud.record_successful_login(user["id"], new_hash)
    auth_crud.log_auth_event("login_success", user["id"], email, ip, user_agent)

    return {k: v for k, v in user.items() if k not in ("password_hash", "failed_login_attempts", "locked_until")}


def logout(session: dict, ip: str | None, user_agent: str | None) -> None:

    auth_crud.revoke_session(session["session_id"])
    auth_crud.log_auth_event("logout", session["id"], session["email"], ip, user_agent)


def logout_everywhere(session: dict, ip: str | None, user_agent: str | None) -> int:

    count = auth_crud.revoke_all_sessions(session["id"])
    auth_crud.log_auth_event("logout_all", session["id"], session["email"], ip, user_agent)
    return count

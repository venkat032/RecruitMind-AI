"""
Authentication tests against the real PostgreSQL database.

Run:
    python -m pytest app/api/test_auth.py -v
"""

import hashlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.deps import SESSION_COOKIE
from app.database.connections import get_cursor
from app.database.models import create_tables
from app.main import app
from app.services.rate_limit import login_limiter, register_limiter


REAL_AUTH = True  # see app/conftest.py

PASSWORD = "Harbor-Lantern-2026"
PREFIX = "authtest-"


@pytest.fixture(scope="module", autouse=True)
def schema_and_cleanup():
    create_tables()
    yield
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM auth_events WHERE email LIKE %s", (f"{PREFIX}%",))
        cursor.execute("DELETE FROM users WHERE email LIKE %s", (f"{PREFIX}%",))


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    login_limiter.reset()
    register_limiter.reset()


def new_email() -> str:
    return f"{PREFIX}{uuid4().hex[:10]}@example.com"


def register(client: TestClient, email: str, password: str = PASSWORD, name: str = "Ada Recruiter"):
    return client.post(
        "/api/v1/auth/register",
        json={"full_name": name, "email": email, "company": "Acme", "password": password},
    )


def login(client: TestClient, email: str, password: str = PASSWORD, remember_me: bool = False):
    return client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password, "remember_me": remember_me},
    )


@pytest.fixture
def account():
    email = new_email()
    assert register(TestClient(app), email).status_code == 201
    return email


def db_one(sql: str, params: tuple):
    with get_cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


# ============================================================
# Registration
# ============================================================

def test_register_creates_account_and_signs_in():
    client = TestClient(app)
    email = new_email()

    response = register(client, email)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == email
    assert "password" not in str(body).lower()

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie

    assert client.get("/api/v1/auth/me").json()["email"] == email


def test_password_is_stored_as_argon2id_hash(account):
    row = db_one("SELECT password_hash FROM users WHERE email = %s", (account,))

    assert row["password_hash"].startswith("$argon2id$")
    assert PASSWORD not in row["password_hash"]


@pytest.mark.parametrize(
    "password, problem",
    [
        ("Short1", "at least 12"),
        ("onlyletterspassword", "letters and numbers"),
        ("Password2026!", "too common"),
        ("Ada-Recruiter-2026", "name or email"),
    ],
)
def test_weak_passwords_rejected(password, problem):
    response = register(TestClient(app), new_email(), password=password)

    assert response.status_code == 422
    assert problem in response.json()["detail"]


def test_common_password_rejected():
    response = register(TestClient(app), new_email(), password="qwerty123456")

    assert response.status_code == 422
    assert "common" in response.json()["detail"]


def test_duplicate_email_rejected_case_insensitive(account):
    response = register(TestClient(app), account.upper())

    assert response.status_code == 409


def test_invalid_email_rejected():
    assert register(TestClient(app), "not-an-email").status_code == 422


# ============================================================
# Login / logout
# ============================================================

def test_login_and_access_protected_route(account):
    client = TestClient(app)

    assert client.get("/api/v1/candidates").status_code == 401

    response = login(client, account)

    assert response.status_code == 200
    assert client.get("/api/v1/candidates").status_code == 200


def test_wrong_password_and_unknown_email_look_identical(account):
    wrong = login(TestClient(app), account, password="Wrong-Password-99")
    unknown = login(TestClient(app), new_email())

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password."}


def test_session_token_is_stored_hashed(account):
    client = TestClient(app)
    login(client, account)
    token = client.cookies.get(SESSION_COOKIE)

    row = db_one("SELECT token_hash FROM user_sessions WHERE token_hash = %s",
                 (hashlib.sha256(token.encode()).hexdigest(),))

    assert row is not None
    assert row["token_hash"] != token


def test_logout_revokes_session_server_side(account):
    client = TestClient(app)
    login(client, account)
    token = client.cookies.get(SESSION_COOKIE)

    assert client.post("/api/v1/auth/logout").status_code == 204

    # Replaying the old token must fail even if a copy of the cookie was kept
    replay = TestClient(app)
    replay.cookies.set(SESSION_COOKIE, token)
    assert replay.get("/api/v1/auth/me").status_code == 401


def test_logout_all_signs_out_every_device(account):
    laptop, phone = TestClient(app), TestClient(app)
    login(laptop, account)
    login(phone, account)

    assert laptop.post("/api/v1/auth/logout-all").status_code == 204
    assert phone.get("/api/v1/auth/me").status_code == 401


def test_idle_session_expires(account):
    client = TestClient(app)
    login(client, account)

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP - INTERVAL '3 hours'
            WHERE user_id = (SELECT id FROM users WHERE email = %s)
            """,
            (account,),
        )

    assert client.get("/api/v1/auth/me").status_code == 401


# ============================================================
# Brute-force protection
# ============================================================

def test_account_locks_after_five_failures(account):
    client = TestClient(app)

    for _ in range(5):
        assert login(client, account, password="Wrong-Password-99").status_code == 401

    # Even the correct password is refused while locked
    locked = login(client, account)
    assert locked.status_code == 423
    assert "Try again in" in locked.json()["detail"]

    # When the lock expires, the correct password works and the counter resets
    with get_cursor() as cursor:
        cursor.execute(
            "UPDATE users SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE email = %s",
            (account,),
        )

    assert login(client, account).status_code == 200
    row = db_one("SELECT failed_login_attempts, locked_until FROM users WHERE email = %s", (account,))
    assert row["failed_login_attempts"] == 0 and row["locked_until"] is None


def test_login_rate_limited_per_ip():
    client = TestClient(app)
    statuses = [login(client, new_email()).status_code for _ in range(11)]

    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_auth_events_are_audited(account):
    client = TestClient(app)
    login(client, account, password="Wrong-Password-99")
    login(client, account)
    client.post("/api/v1/auth/logout")

    with get_cursor() as cursor:
        cursor.execute("SELECT event FROM auth_events WHERE email = %s ORDER BY id", (account,))
        events = [r["event"] for r in cursor.fetchall()]

    assert events == ["register", "login_failed", "login_success", "logout"]


# ============================================================
# CSRF + headers
# ============================================================

def test_cross_site_post_blocked(account):
    client = TestClient(app)
    login(client, account)

    evil = client.post(
        "/api/v1/candidates",
        json={"name": "X", "email": new_email()},
        headers={"Origin": "https://evil.example"},
    )
    assert evil.status_code == 403

    # Reads are unaffected, and same-origin writes still work
    assert client.get("/api/v1/candidates", headers={"Origin": "https://evil.example"}).status_code == 200


def test_cross_site_login_blocked(account):
    response = TestClient(app).post(
        "/api/v1/auth/login",
        json={"email": account, "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )

    assert response.status_code == 403


def test_security_headers():
    response = TestClient(app).get("/api/v1/auth/me")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"

"""
Persistence for authentication: users, sessions and the security audit log.

Business rules (password policy, lockout, session lifetime) live in
app/services/auth_service.py; this module only reads and writes rows.
"""

from datetime import datetime

from psycopg2 import errors

from app.database.connections import get_cursor
from app.database.crud import DuplicateRecordError


# Never select password_hash unless it is actually needed
PUBLIC_USER_COLUMNS = """
    id, email, full_name, company, role, is_active, last_login_at, created_at
"""


# ============================================================
# Users
# ============================================================

def create_user(email: str, full_name: str, company: str | None, password_hash: str) -> dict:
    """The very first account becomes the workspace admin."""

    try:
        with get_cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO users (email, full_name, company, password_hash, role)
                VALUES (
                    %s, %s, %s, %s,
                    CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'recruiter' ELSE 'admin' END
                )
                RETURNING {PUBLIC_USER_COLUMNS}
                """,
                (email, full_name, company, password_hash)
            )

            return cursor.fetchone()

    except errors.UniqueViolation as e:
        raise DuplicateRecordError("An account with this email already exists.") from e


def get_user_for_login(email: str) -> dict | None:
    """Includes password_hash and lockout fields: only for authentication."""

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            SELECT {PUBLIC_USER_COLUMNS}, password_hash, failed_login_attempts, locked_until
            FROM users
            WHERE LOWER(email) = LOWER(%s)
            """,
            (email,)
        )

        return cursor.fetchone()


def record_failed_login(user_id: int, max_attempts: int, lock_until: datetime) -> dict:
    """Atomically count the failure and lock the account once the limit is hit."""

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                    WHEN failed_login_attempts + 1 >= %s THEN %s
                    ELSE locked_until
                END
            WHERE id = %s
            RETURNING failed_login_attempts, locked_until
            """,
            (max_attempts, lock_until, user_id)
        )

        return cursor.fetchone()


def record_successful_login(user_id: int, new_password_hash: str | None = None) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET failed_login_attempts = 0,
                locked_until = NULL,
                last_login_at = CURRENT_TIMESTAMP,
                password_hash = COALESCE(%s, password_hash)
            WHERE id = %s
            """,
            (new_password_hash, user_id)
        )


# ============================================================
# Sessions
# ============================================================

def create_session(
    user_id: int,
    token_hash: str,
    expires_at: datetime,
    remember_me: bool,
    ip_address: str | None,
    user_agent: str | None,
) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO user_sessions
                (user_id, token_hash, expires_at, remember_me, ip_address, user_agent)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (user_id, token_hash, expires_at, remember_me, ip_address, user_agent)
        )


def get_session(token_hash: str) -> dict | None:
    """Session joined with its user (no password hash)."""

    with get_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                s.id AS session_id, s.remember_me, s.last_seen_at, s.expires_at, s.revoked_at,
                u.id, u.email, u.full_name, u.company, u.role, u.is_active,
                u.last_login_at, u.created_at
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s
            """,
            (token_hash,)
        )

        return cursor.fetchone()


def touch_session(session_id: int) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            "UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = %s",
            (session_id,)
        )


def revoke_session(session_id: int) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE id = %s AND revoked_at IS NULL
            """,
            (session_id,)
        )


def revoke_all_sessions(user_id: int) -> int:

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = %s AND revoked_at IS NULL
            """,
            (user_id,)
        )

        return cursor.rowcount


def delete_expired_sessions() -> int:

    with get_cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM user_sessions
            WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
               OR revoked_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
            """
        )

        return cursor.rowcount


# ============================================================
# Audit log
# ============================================================

def log_auth_event(
    event: str,
    user_id: int | None = None,
    email: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO auth_events (user_id, email, event, ip_address, user_agent)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (user_id, email, event, ip_address, (user_agent or "")[:500])
        )

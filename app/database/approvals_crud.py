"""
Persistence for the human-in-the-loop approval queue.

Each row mirrors one LangGraph thread:
  screening -> pending (paused at Human Approval) -> deciding -> approved | rejected
  failed: the agents errored or the server restarted mid-run.
"""

from psycopg2 import errors
from psycopg2.extras import Json

from app.database.connections import get_cursor
from app.database.crud import DuplicateRecordError, RecordNotFoundError


OPEN_STATUSES = ("screening", "pending", "deciding")

APPROVAL_COLUMNS = """
        a.id, a.thread_id, a.candidate_id, a.job_id, a.status, a.source,
        a.match_score, a.recommendation, a.error, a.decision_note,
        a.submission_id, a.email_draft_id, a.decided_at, a.created_at, a.updated_at,
        c.name AS candidate_name, c.email AS candidate_email,
        j.title AS job_title, j.company AS job_company, j.location AS job_location,
        ru.full_name AS requested_by_name,
        du.full_name AS decided_by_name
"""

APPROVAL_FROM = """
    FROM approval_requests a
    JOIN candidates c ON c.id = a.candidate_id
    JOIN jobs j ON j.id = a.job_id
    LEFT JOIN users ru ON ru.id = a.requested_by
    LEFT JOIN users du ON du.id = a.decided_by
"""

# List view: no heavy analysis JSON
APPROVAL_SELECT = f"SELECT {APPROVAL_COLUMNS} {APPROVAL_FROM}"


def create_approval(
    thread_id: str, candidate_id: int, job_id: int, requested_by: int | None, source: str
) -> dict:

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO approval_requests (thread_id, candidate_id, job_id, requested_by, source)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, thread_id, status
                """,
                (thread_id, candidate_id, job_id, requested_by, source)
            )

            return cursor.fetchone()

    except errors.UniqueViolation as e:
        raise DuplicateRecordError(
            "This candidate is already being screened or waiting for approval for this job."
        ) from e

    except errors.ForeignKeyViolation as e:
        raise RecordNotFoundError("Candidate or job does not exist.") from e


def mark_pending(thread_id: str, match_score: float | None, recommendation: str | None, analysis: dict) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE approval_requests
            SET status = 'pending', match_score = %s, recommendation = %s,
                analysis = %s, error = NULL
            WHERE thread_id = %s
            """,
            (match_score, recommendation, Json(analysis), thread_id)
        )


def mark_failed(thread_id: str, error: str) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            "UPDATE approval_requests SET status = 'failed', error = %s WHERE thread_id = %s",
            (error[:2000], thread_id)
        )


def claim_for_decision(thread_id: str, decided_by: int | None, note: str | None) -> dict | None:
    """
    Atomically move pending -> deciding. Returns None if someone else already
    decided (or is deciding) it, so two recruiters can never both act on one request.
    """

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE approval_requests
            SET status = 'deciding', decided_by = %s, decision_note = %s
            WHERE thread_id = %s AND status = 'pending'
            RETURNING id
            """,
            (decided_by, note, thread_id)
        )

        return cursor.fetchone()


def release_claim(thread_id: str, error: str) -> None:
    """The decision failed part-way: put it back in the queue."""

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE approval_requests
            SET status = 'pending', decided_by = NULL, decision_note = NULL, error = %s
            WHERE thread_id = %s AND status = 'deciding'
            """,
            (error[:2000], thread_id)
        )


def mark_decided(
    thread_id: str, approved: bool, submission_id: int | None, email_draft_id: int | None
) -> None:

    with get_cursor() as cursor:
        cursor.execute(
            """
            UPDATE approval_requests
            SET status = %s, decided_at = CURRENT_TIMESTAMP, error = NULL,
                submission_id = %s, email_draft_id = %s
            WHERE thread_id = %s
            """,
            ("approved" if approved else "rejected", submission_id, email_draft_id, thread_id)
        )


def get_approval(approval_id: int) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {APPROVAL_COLUMNS}, a.analysis {APPROVAL_FROM} WHERE a.id = %s",
            (approval_id,)
        )

        return cursor.fetchone()


def get_by_thread(thread_id: str) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(f"{APPROVAL_SELECT} WHERE a.thread_id = %s", (thread_id,))

        return cursor.fetchone()


def list_approvals(status: str | None = None, job_id: int | None = None, limit: int = 500) -> list[dict]:

    conditions, params = [], []

    if status:
        conditions.append("a.status = %s")
        params.append(status)

    if job_id:
        conditions.append("a.job_id = %s")
        params.append(job_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with get_cursor() as cursor:
        cursor.execute(
            f"{APPROVAL_SELECT} {where} ORDER BY a.created_at DESC, a.id DESC LIMIT %s",
            (*params, limit)
        )

        return cursor.fetchall()


def approval_summary() -> dict:

    with get_cursor() as cursor:
        cursor.execute("SELECT status, COUNT(*) AS n FROM approval_requests GROUP BY status")
        counts = {row["status"]: row["n"] for row in cursor.fetchall()}

        cursor.execute(
            """
            SELECT MIN(created_at) AS oldest_pending
            FROM approval_requests WHERE status = 'pending'
            """
        )
        oldest = cursor.fetchone()["oldest_pending"]

    return {"counts": counts, "oldest_pending": oldest}


def open_threads(status: str) -> list[str]:

    with get_cursor() as cursor:
        cursor.execute("SELECT thread_id FROM approval_requests WHERE status = %s", (status,))

        return [row["thread_id"] for row in cursor.fetchall()]


def open_pairs(job_id: int) -> dict[int, str]:
    """candidate_id -> status for open requests on a job (to warn about duplicates)."""

    with get_cursor() as cursor:
        cursor.execute(
            """
            SELECT candidate_id, status FROM approval_requests
            WHERE job_id = %s AND status IN ('screening', 'pending', 'deciding')
            """,
            (job_id,)
        )

        return {row["candidate_id"]: row["status"] for row in cursor.fetchall()}

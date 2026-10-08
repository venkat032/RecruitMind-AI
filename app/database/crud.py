"""
Database service layer.

Agent -> Tool -> crud (this file) -> PostgreSQL

Every function runs in its own transaction via get_cursor():
commit on success, rollback + re-raise on failure.
Reads return None when a record does not exist;
writes raise RecordNotFoundError / DuplicateRecordError.
"""

from psycopg2 import errors

from app.database.connections import get_cursor
from app.database.models import SUBMISSION_STATUSES


class RecordNotFoundError(LookupError):
    """A referenced record does not exist."""


class DuplicateRecordError(ValueError):
    """A record with the same unique key already exists."""


CANDIDATE_COLUMNS = """
    id, name, email, location, skills, experience,
    resume_text, resume_file_path, created_at, updated_at
"""

JOB_COLUMNS = """
    id, title, company, location, salary, skills,
    description, contact_name, contact_email, created_at, updated_at
"""

SUBMISSION_COLUMNS = """
    id, candidate_id, job_id, match_score, status,
    recruiter_recommendation, recruiter_notes, created_at, updated_at
"""

EMAIL_DRAFT_COLUMNS = """
    id, submission_id, subject, body, status, recipient_email,
    sent_at, sent_by, sent_via, created_at, updated_at
"""

EMAIL_CLIENTS = ("gmail", "outlook", "mail_app", "other")


# ============================================================
# Candidates
# ============================================================

def create_candidate(
    name: str,
    email: str | None = None,
    location: str | None = None,
    skills: str | None = None,
    experience: int | None = None,
    resume_text: str | None = None,
    resume_file_path: str | None = None,
) -> dict:

    try:
        with get_cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO candidates
                    (name, email, location, skills, experience,
                     resume_text, resume_file_path)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING {CANDIDATE_COLUMNS}
                """,
                (name, email, location, skills, experience,
                 resume_text, resume_file_path)
            )

            return cursor.fetchone()

    except errors.UniqueViolation as e:
        raise DuplicateRecordError(
            f"A candidate with email '{email}' already exists."
        ) from e


def get_candidate(candidate_id: int) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {CANDIDATE_COLUMNS} FROM candidates WHERE id = %s",
            (candidate_id,)
        )

        return cursor.fetchone()


def get_candidate_by_email(email: str) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {CANDIDATE_COLUMNS} FROM candidates WHERE LOWER(email) = LOWER(%s)",
            (email,)
        )

        return cursor.fetchone()


def get_or_create_candidate(name: str, email: str, **fields) -> tuple[dict, bool]:
    """
    Return (candidate, created).
    An existing candidate is returned unchanged - never overwritten.
    """

    existing = get_candidate_by_email(email)

    if existing:
        return existing, False

    try:
        return create_candidate(name=name, email=email, **fields), True

    except DuplicateRecordError:
        # Created concurrently between the lookup and the insert
        return get_candidate_by_email(email), False


def search_candidates(skill: str) -> list[dict]:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {CANDIDATE_COLUMNS} FROM candidates WHERE skills ILIKE %s ORDER BY id",
            (f"%{skill}%",)
        )

        return cursor.fetchall()


def update_candidate_resume(
    candidate_id: int,
    resume_text: str,
    resume_file_path: str,
) -> dict:
    """Only the resume fields are updated; profile data is left untouched."""

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE candidates
            SET resume_text = %s,
                resume_file_path = %s
            WHERE id = %s
            RETURNING {CANDIDATE_COLUMNS}
            """,
            (resume_text, resume_file_path, candidate_id)
        )

        candidate = cursor.fetchone()

    if candidate is None:
        raise RecordNotFoundError(f"Candidate {candidate_id} not found.")

    return candidate


# ============================================================
# Jobs
# ============================================================

def create_job(
    title: str,
    company: str,
    location: str | None = None,
    salary: int | None = None,
    skills: str | None = None,
    description: str | None = None,
    contact_name: str | None = None,
    contact_email: str | None = None,
) -> dict:

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            INSERT INTO jobs
                (title, company, location, salary, skills, description, contact_name, contact_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {JOB_COLUMNS}
            """,
            (title, company, location, salary, skills, description, contact_name, contact_email)
        )

        return cursor.fetchone()


def update_job_contact(job_id: int, contact_name: str | None, contact_email: str) -> dict:
    """Set who receives submission emails for this job."""

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE jobs SET contact_name = %s, contact_email = %s
            WHERE id = %s
            RETURNING {JOB_COLUMNS}
            """,
            (contact_name, contact_email, job_id)
        )

        job = cursor.fetchone()

    if job is None:
        raise RecordNotFoundError(f"Job {job_id} not found.")

    return job


def get_job(job_id: int) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {JOB_COLUMNS} FROM jobs WHERE id = %s",
            (job_id,)
        )

        return cursor.fetchone()


def search_jobs(role: str, location: str) -> list[dict]:

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            SELECT {JOB_COLUMNS} FROM jobs
            WHERE title ILIKE %s
            AND location ILIKE %s
            ORDER BY id
            """,
            (f"%{role}%", f"%{location}%")
        )

        return cursor.fetchall()


# ============================================================
# Submissions
# ============================================================

def create_submission(
    candidate_id: int,
    job_id: int,
    match_score: float,
    recommendation: str,
    recruiter_notes: str,
    status: str = "approved",
) -> dict:

    if status not in SUBMISSION_STATUSES:
        raise ValueError(
            f"Invalid status '{status}'. Allowed: {', '.join(SUBMISSION_STATUSES)}"
        )

    try:
        with get_cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO submissions
                    (candidate_id, job_id, match_score, status,
                     recruiter_recommendation, recruiter_notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING {SUBMISSION_COLUMNS}
                """,
                (candidate_id, job_id, match_score, status,
                 recommendation, recruiter_notes)
            )

            return cursor.fetchone()

    except errors.ForeignKeyViolation as e:
        raise RecordNotFoundError(
            f"Cannot create submission: candidate {candidate_id} "
            f"or job {job_id} does not exist."
        ) from e


def get_submission(submission_id: int) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE id = %s",
            (submission_id,)
        )

        return cursor.fetchone()


# ============================================================
# Email drafts
# ============================================================

def create_email_draft(
    submission_id: int,
    subject: str,
    body: str,
    recipient_email: str | None = None,
) -> dict:

    try:
        with get_cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO email_drafts (submission_id, subject, body, status, recipient_email)
                VALUES (%s, %s, %s, 'draft', %s)
                RETURNING {EMAIL_DRAFT_COLUMNS}
                """,
                (submission_id, subject, body, recipient_email)
            )

            return cursor.fetchone()

    except errors.ForeignKeyViolation as e:
        raise RecordNotFoundError(
            f"Cannot create email draft: submission {submission_id} does not exist."
        ) from e


def mark_email_sent(email_draft_id: int, sent_by: int | None, sent_via: str) -> dict:
    """
    The recruiter sent the draft from their own mail client.
    One transaction: the draft becomes 'sent' and its submission 'submitted'.
    """

    if sent_via not in EMAIL_CLIENTS:
        raise ValueError(f"Unknown email client '{sent_via}'.")

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE email_drafts
            SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_by = %s, sent_via = %s
            WHERE id = %s
            RETURNING {EMAIL_DRAFT_COLUMNS}
            """,
            (sent_by, sent_via, email_draft_id)
        )

        draft = cursor.fetchone()

        if draft is None:
            raise RecordNotFoundError(f"Email draft {email_draft_id} not found.")

        cursor.execute(
            "UPDATE submissions SET status = 'submitted' WHERE id = %s AND status = 'approved'",
            (draft["submission_id"],)
        )

    return draft


def get_email_draft(email_draft_id: int) -> dict | None:

    with get_cursor() as cursor:
        cursor.execute(
            f"SELECT {EMAIL_DRAFT_COLUMNS} FROM email_drafts WHERE id = %s",
            (email_draft_id,)
        )

        return cursor.fetchone()


# ============================================================
# Listings (dashboard / frontend)
# ============================================================

def list_candidates() -> list[dict]:

    with get_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                c.id, c.name, c.email, c.location, c.skills, c.experience,
                c.resume_file_path, c.created_at, c.updated_at,
                (c.resume_text IS NOT NULL AND c.resume_text <> '') AS has_resume,
                COUNT(s.id) AS submission_count
            FROM candidates c
            LEFT JOIN submissions s ON s.candidate_id = c.id
            GROUP BY c.id
            ORDER BY c.created_at DESC, c.id DESC
            """
        )

        return cursor.fetchall()


def list_jobs() -> list[dict]:

    with get_cursor() as cursor:
        cursor.execute(
            f"""
            SELECT {JOB_COLUMNS},
                (SELECT COUNT(*) FROM submissions s WHERE s.job_id = jobs.id) AS submission_count
            FROM jobs
            ORDER BY created_at DESC, id DESC
            """
        )

        return cursor.fetchall()


SUBMISSION_LIST_SQL = """
    SELECT
        s.id, s.candidate_id, s.job_id, s.match_score, s.status,
        s.recruiter_recommendation, s.recruiter_notes, s.created_at, s.updated_at,
        c.name AS candidate_name, c.email AS candidate_email,
        j.title AS job_title, j.company AS job_company, j.location AS job_location,
        j.contact_name AS job_contact_name, j.contact_email AS job_contact_email,
        (SELECT COUNT(*) FROM email_drafts e WHERE e.submission_id = s.id) AS email_draft_count,
        (SELECT e.status FROM email_drafts e WHERE e.submission_id = s.id
         ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS email_status
    FROM submissions s
    JOIN candidates c ON c.id = s.candidate_id
    JOIN jobs j ON j.id = s.job_id
"""


def list_submissions() -> list[dict]:

    with get_cursor() as cursor:
        cursor.execute(f"{SUBMISSION_LIST_SQL} ORDER BY s.created_at DESC, s.id DESC")

        return cursor.fetchall()


def get_submission_details(submission_id: int) -> dict | None:
    """Submission joined with candidate + job, plus all its email drafts."""

    with get_cursor() as cursor:
        cursor.execute(f"{SUBMISSION_LIST_SQL} WHERE s.id = %s", (submission_id,))

        submission = cursor.fetchone()

        if submission is None:
            return None

        cursor.execute(
            """
            SELECT e.id, e.submission_id, e.subject, e.body, e.status, e.recipient_email,
                   e.sent_at, e.sent_by, e.sent_via, e.created_at, e.updated_at,
                   u.full_name AS sent_by_name
            FROM email_drafts e
            LEFT JOIN users u ON u.id = e.sent_by
            WHERE e.submission_id = %s
            ORDER BY e.created_at DESC, e.id DESC
            """,
            (submission_id,)
        )

        return {**submission, "email_drafts": cursor.fetchall()}

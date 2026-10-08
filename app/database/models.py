"""
Schema creation + safe, idempotent migrations.

Safe to run any number of times:
- CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
- constraints are only added when missing
- nothing is ever dropped or rewritten
"""

import psycopg2

from app.database.connections import get_cursor


SUBMISSION_STATUSES = ("pending", "approved", "rejected", "submitted")

USER_ROLES = ("admin", "recruiter")

# screening -> pending -> deciding -> approved | rejected   (failed on errors)
APPROVAL_STATUSES = ("screening", "pending", "deciding", "approved", "rejected", "failed")

TABLES_WITH_TIMESTAMPS = ("jobs", "candidates", "submissions", "email_drafts", "users", "approval_requests")


CREATE_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        salary INTEGER,
        skills TEXT,
        description TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS candidates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        location VARCHAR(255),
        skills TEXT,
        experience INTEGER,
        resume_text TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER,
        job_id INTEGER,
        match_score FLOAT,
        status VARCHAR(50),
        recruiter_recommendation TEXT,
        recruiter_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS email_drafts (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft'
    )
    """,

    # ---------------- authentication ----------------
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        -- Argon2id hash; the plain password is never stored
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'recruiter'
            CHECK (role IN ('admin', 'recruiter')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        -- SHA-256 of the session token; the token itself only lives in the cookie
        token_hash CHAR(64) NOT NULL,
        remember_me BOOLEAN NOT NULL DEFAULT FALSE,
        ip_address VARCHAR(64),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
    )
    """,
    # ---------------- human-in-the-loop approval queue ----------------
    """
    CREATE TABLE IF NOT EXISTS approval_requests (
        id SERIAL PRIMARY KEY,
        -- LangGraph thread whose checkpoint is paused at Human Approval
        thread_id VARCHAR(80) NOT NULL UNIQUE,
        candidate_id INTEGER NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
        job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
        status VARCHAR(20) NOT NULL DEFAULT 'screening'
            CHECK (status IN ('screening', 'pending', 'deciding', 'approved', 'rejected', 'failed')),
        source VARCHAR(20) NOT NULL DEFAULT 'studio',
        match_score FLOAT,
        recommendation TEXT,
        -- snapshot of the agents' output for reviewers (resume, job, match, assessment)
        analysis JSONB,
        error TEXT,
        requested_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
        decided_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
        decided_at TIMESTAMPTZ,
        decision_note TEXT,
        submission_id INTEGER REFERENCES submissions (id) ON DELETE SET NULL,
        email_draft_id INTEGER REFERENCES email_drafts (id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS auth_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        email VARCHAR(255),
        event VARCHAR(50) NOT NULL,
        ip_address VARCHAR(64),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
]


ADD_COLUMNS = [
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_file_path TEXT",
    # Hiring contact for a job: submission emails are addressed to them
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)",
    # Email hand-off tracking: who sent the draft, when and with which client
    "ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255)",
    "ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ",
    "ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS sent_by INTEGER REFERENCES users (id) ON DELETE SET NULL",
    "ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS sent_via VARCHAR(20)",
    *[
        f"""
        ALTER TABLE {table}
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        """
        for table in TABLES_WITH_TIMESTAMPS
    ],
]


# updated_at is maintained by the database, so no caller can forget it
UPDATED_AT_TRIGGER_FUNCTION = """
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
"""


# Primary keys are already indexed by PostgreSQL; these cover the
# lookups and joins the application actually performs.
CREATE_INDEXES = [
    # One candidate per email (case-insensitive). NULL emails are allowed.
    "CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_lower_key ON candidates (LOWER(email))",
    "CREATE INDEX IF NOT EXISTS submissions_candidate_id_idx ON submissions (candidate_id)",
    "CREATE INDEX IF NOT EXISTS submissions_job_id_idx ON submissions (job_id)",
    "CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions (status)",
    "CREATE INDEX IF NOT EXISTS email_drafts_submission_id_idx ON email_drafts (submission_id)",
    # One account per email (case-insensitive)
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (LOWER(email))",
    "CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_key ON user_sessions (token_hash)",
    "CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id)",
    "CREATE INDEX IF NOT EXISTS auth_events_user_id_idx ON auth_events (user_id)",
    "CREATE INDEX IF NOT EXISTS auth_events_created_at_idx ON auth_events (created_at)",
    # At most one open (screening/pending/deciding) request per candidate + job
    """CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_open_idx
       ON approval_requests (candidate_id, job_id)
       WHERE status IN ('screening', 'pending', 'deciding')""",
    "CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests (status)",
    "CREATE INDEX IF NOT EXISTS approval_requests_job_id_idx ON approval_requests (job_id)",
]


# (table, constraint name, definition)
CONSTRAINTS = [
    (
        "submissions",
        "submissions_candidate_id_fkey",
        "FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE RESTRICT",
    ),
    (
        "submissions",
        "submissions_job_id_fkey",
        "FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE RESTRICT",
    ),
    (
        "submissions",
        "submissions_status_check",
        "CHECK (status IN ('pending', 'approved', 'rejected', 'submitted'))",
    ),
    (
        "email_drafts",
        "email_drafts_status_check",
        "CHECK (status IN ('draft', 'sent'))",
    ),
    (
        "email_drafts",
        "email_drafts_submission_id_fkey",
        "FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE",
    ),
]


def _constraint_exists(cursor, name: str) -> bool:

    cursor.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = %s",
        (name,)
    )

    return cursor.fetchone() is not None


def _add_constraint_safely(cursor, table: str, name: str, definition: str) -> None:
    """
    Add as NOT VALID first: enforced for all NEW rows immediately,
    without failing on old rows. Then try to validate existing rows.
    If old rows violate it, keep the constraint (still protecting new
    data) and report the problem instead of deleting anything.
    """

    if _constraint_exists(cursor, name):
        return

    cursor.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} {definition} NOT VALID")

    cursor.execute("SAVEPOINT validate_constraint")

    try:
        cursor.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")

    except psycopg2.Error as e:
        cursor.execute("ROLLBACK TO SAVEPOINT validate_constraint")

        print(
            f"WARNING: existing rows in '{table}' violate {name}. "
            f"New rows are protected; fix the old rows, then run "
            f"'ALTER TABLE {table} VALIDATE CONSTRAINT {name}'. "
            f"Details: {e.pgerror}"
        )

    cursor.execute("RELEASE SAVEPOINT validate_constraint")


def _use_timezone_aware_timestamps(cursor) -> None:
    """
    TIMESTAMP (no zone) stores the server's local wall-clock time, which
    clients in another timezone misread. Convert to TIMESTAMPTZ once,
    interpreting existing values in the server timezone they were written in.
    """

    cursor.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(%s)
          AND column_name IN ('created_at', 'updated_at')
          AND data_type = 'timestamp without time zone'
        """,
        (list(TABLES_WITH_TIMESTAMPS),)
    )

    for row in cursor.fetchall():
        table, column = row["table_name"], row["column_name"]
        cursor.execute(
            f"""
            ALTER TABLE {table}
            ALTER COLUMN {column} TYPE TIMESTAMPTZ
            USING {column} AT TIME ZONE current_setting('TimeZone')
            """
        )


def _add_updated_at_triggers(cursor) -> None:

    cursor.execute(UPDATED_AT_TRIGGER_FUNCTION)

    for table in TABLES_WITH_TIMESTAMPS:
        cursor.execute(f"DROP TRIGGER IF EXISTS {table}_set_updated_at ON {table}")
        cursor.execute(
            f"""
            CREATE TRIGGER {table}_set_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            """
        )


def create_tables():

    # One transaction: the whole migration applies, or none of it does
    with get_cursor() as cursor:

        for sql in CREATE_TABLES + ADD_COLUMNS:
            cursor.execute(sql)

        _use_timezone_aware_timestamps(cursor)

        _add_updated_at_triggers(cursor)

        for sql in CREATE_INDEXES:
            cursor.execute(sql)

        for table, name, definition in CONSTRAINTS:
            _add_constraint_safely(cursor, table, name, definition)

    print("Database tables created.")


if __name__ == "__main__":
    create_tables()

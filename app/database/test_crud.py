"""
Step 41 persistence tests (real PostgreSQL from .env).

Every record created here is deleted again in teardown,
so existing data is never touched.

Run:
    python -m pytest app/database/test_crud.py -v
"""

import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import psycopg2
import pytest
from fastapi.testclient import TestClient

from app.api.test_recruiter_upload import make_text_pdf
from app.database import crud
from app.database.connections import get_cursor
from app.database.models import create_tables
from app.main import app
from app.services import resume_upload


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session", autouse=True)
def schema():
    create_tables()


@pytest.fixture
def cleanup():
    """Register created ids; they are deleted after the test (children first)."""

    created = {"email_drafts": [], "submissions": [], "candidates": [], "jobs": []}

    yield created

    with get_cursor() as cursor:
        for table in ("email_drafts", "submissions", "candidates", "jobs"):
            if created[table]:
                cursor.execute(
                    f"DELETE FROM {table} WHERE id = ANY(%s)",
                    (created[table],)
                )


def unique_email() -> str:
    return f"test-{uuid4().hex[:12]}@example.com"


@pytest.fixture
def candidate(cleanup):

    row = crud.create_candidate(
        name="TEST Rahul Kumar",
        email=unique_email(),
        location="Hyderabad",
        skills="Python, FastAPI, LangGraph",
        experience=3,
    )
    cleanup["candidates"].append(row["id"])

    return row


@pytest.fixture
def job(cleanup):

    row = crud.create_job(
        title="TEST AI Developer",
        company="TechNova",
        location="Hyderabad",
        salary=1000000,
        skills="Python, FastAPI",
        description="Build AI agents.",
    )
    cleanup["jobs"].append(row["id"])

    return row


@pytest.fixture
def submission(cleanup, candidate, job):

    row = crud.create_submission(
        candidate_id=candidate["id"],
        job_id=job["id"],
        match_score=87.5,
        recommendation="Strongly Recommended",
        recruiter_notes="Strong Python and FastAPI background.",
    )
    cleanup["submissions"].append(row["id"])

    return row


# ============================================================
# Required tests 1-8
# ============================================================

def test_1_create_candidate(candidate):

    assert isinstance(candidate["id"], int)
    assert candidate["created_at"] is not None
    assert candidate["updated_at"] is not None


def test_2_get_candidate(candidate):

    row = crud.get_candidate(candidate["id"])

    assert row["name"] == "TEST Rahul Kumar"
    assert row["email"] == candidate["email"]
    assert row["experience"] == 3


def test_3_update_candidate_resume(candidate):

    updated = crud.update_candidate_resume(
        candidate_id=candidate["id"],
        resume_text="Python developer with 3 years of experience.",
        resume_file_path="data/resumes/abc123.pdf",
    )

    # Re-read from the database, not from the returned object
    row = crud.get_candidate(candidate["id"])

    assert row["resume_text"] == "Python developer with 3 years of experience."
    assert row["resume_file_path"] == "data/resumes/abc123.pdf"
    assert row["name"] == candidate["name"]          # profile untouched
    assert updated["updated_at"] >= candidate["updated_at"]


def test_4_create_job(job):

    assert isinstance(job["id"], int)
    assert crud.get_job(job["id"])["title"] == "TEST AI Developer"


def test_5_create_submission(submission):

    assert isinstance(submission["id"], int)
    assert submission["status"] == "approved"


def test_6_get_submission(submission, candidate, job):

    row = crud.get_submission(submission["id"])

    assert row["candidate_id"] == candidate["id"]
    assert row["job_id"] == job["id"]
    assert row["match_score"] == 87.5
    assert row["recruiter_recommendation"] == "Strongly Recommended"


def test_7_create_email_draft(cleanup, submission):

    draft = crud.create_email_draft(
        submission_id=submission["id"],
        subject="Candidate Submission - Rahul Kumar",
        body="Dear Hiring Manager, ...",
    )
    cleanup["email_drafts"].append(draft["id"])

    row = crud.get_email_draft(draft["id"])

    assert row["submission_id"] == submission["id"]
    assert row["subject"] == "Candidate Submission - Rahul Kumar"
    assert row["body"] == "Dear Hiring Manager, ..."
    assert row["status"] == "draft"


def test_8_records_survive_a_new_process(cleanup, candidate, submission):
    """
    Read the records from a brand-new Python process (= application restart).
    Nothing is shared in memory, so the data must come from PostgreSQL.
    """

    draft = crud.create_email_draft(submission["id"], "Subject", "Body")
    cleanup["email_drafts"].append(draft["id"])

    script = (
        "import json; from app.database import crud; "
        f"print(json.dumps({{"
        f"'candidate': crud.get_candidate({candidate['id']})['email'], "
        f"'submission': crud.get_submission({submission['id']})['status'], "
        f"'draft': crud.get_email_draft({draft['id']})['status']"
        f"}}))"
    )

    output = subprocess.run(
        [sys.executable, "-c", script],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    ).stdout.strip().splitlines()[-1]

    assert json.loads(output) == {
        "candidate": candidate["email"],
        "submission": "approved",
        "draft": "draft",
    }


# ============================================================
# Duplicates, missing records, foreign keys, transactions
# ============================================================

def test_duplicate_email_is_rejected_case_insensitive(candidate):

    with pytest.raises(crud.DuplicateRecordError):
        crud.create_candidate(name="Someone Else", email=candidate["email"].upper())


def test_get_or_create_never_overwrites(candidate):

    row, created = crud.get_or_create_candidate(
        name="A Different Name",
        email=candidate["email"],
        location="Somewhere Else",
    )

    assert created is False
    assert row["id"] == candidate["id"]
    assert crud.get_candidate(candidate["id"])["name"] == "TEST Rahul Kumar"


def test_missing_records():

    assert crud.get_candidate(-1) is None
    assert crud.get_job(-1) is None
    assert crud.get_submission(-1) is None
    assert crud.get_email_draft(-1) is None

    with pytest.raises(crud.RecordNotFoundError):
        crud.update_candidate_resume(-1, "text", "data/resumes/x.pdf")


def test_submission_foreign_keys_enforced(job):

    with pytest.raises(crud.RecordNotFoundError):
        crud.create_submission(-1, job["id"], 50.0, "Maybe", "notes")


def test_email_draft_foreign_key_enforced():

    with pytest.raises(crud.RecordNotFoundError):
        crud.create_email_draft(-1, "Subject", "Body")


def test_invalid_submission_status_rejected(candidate, job):

    with pytest.raises(ValueError):
        crud.create_submission(candidate["id"], job["id"], 50.0, "x", "y", status="hired")

    # The database CHECK constraint also blocks it, even without the Python check
    with pytest.raises(psycopg2.errors.CheckViolation):
        with get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO submissions (candidate_id, job_id, status) VALUES (%s, %s, 'hired')",
                (candidate["id"], job["id"]),
            )


def test_failed_transaction_is_rolled_back():

    title = f"TEST ROLLBACK {uuid4().hex}"

    with pytest.raises(RuntimeError):
        with get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO jobs (title, company) VALUES (%s, 'X')",
                (title,)
            )
            raise RuntimeError("simulated failure after the INSERT")

    with get_cursor() as cursor:
        cursor.execute("SELECT COUNT(*) AS n FROM jobs WHERE title = %s", (title,))
        assert cursor.fetchone()["n"] == 0


# ============================================================
# Resume upload -> candidate persistence
# ============================================================

def test_upload_resume_persists_to_candidate(candidate, tmp_path, monkeypatch):

    monkeypatch.setattr(resume_upload, "RESUME_DIR", tmp_path)

    response = TestClient(app).post(
        "/api/v1/recruiter/upload-resume",
        files={"file": ("resume.pdf", make_text_pdf("Rahul Kumar Python FastAPI"), "application/pdf")},
        data={"candidate_id": str(candidate["id"])},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["candidate_id"] == candidate["id"]

    row = crud.get_candidate(candidate["id"])

    assert row["resume_text"] == "Rahul Kumar Python FastAPI"
    assert row["resume_file_path"] == body["resume_file_path"]
    assert Path(row["resume_file_path"]).name == body["filename"]


def test_upload_resume_unknown_candidate_returns_404(tmp_path, monkeypatch):

    monkeypatch.setattr(resume_upload, "RESUME_DIR", tmp_path)

    response = TestClient(app).post(
        "/api/v1/recruiter/upload-resume",
        files={"file": ("resume.pdf", make_text_pdf("Someone"), "application/pdf")},
        data={"candidate_id": "-1"},
    )

    assert response.status_code == 404
    assert list(tmp_path.iterdir()) == []      # orphan PDF removed

"""
Job hiring contacts + email hand-off tests (real PostgreSQL, no LLM calls).

Run:
    python -m pytest app/api/test_email_handoff.py -v
"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.agents.email_agent import describe_people
from app.database import approvals_crud, crud
from app.database.connections import get_cursor
from app.database.models import create_tables
from app.main import app
from app.services import workflow_service


client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def schema():
    create_tables()


@pytest.fixture
def cleanup():
    created = {"jobs": [], "candidates": [], "submissions": []}
    yield created
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM approval_requests WHERE job_id = ANY(%s)", (created["jobs"],))
        cursor.execute("DELETE FROM submissions WHERE id = ANY(%s)", (created["submissions"],))
        cursor.execute("DELETE FROM candidates WHERE id = ANY(%s)", (created["candidates"],))
        cursor.execute("DELETE FROM jobs WHERE id = ANY(%s)", (created["jobs"],))


def test_create_job_requires_and_stores_contact(cleanup):
    response = client.post(
        "/api/v1/jobs",
        json={
            "title": "TEST Platform Engineer",
            "company": "Acme",
            "contact_name": "Priya Sharma",
            "contact_email": "Priya.Hiring@Example.com",
        },
    )

    assert response.status_code == 201
    job = response.json()
    cleanup["jobs"].append(job["id"])
    assert job["contact_name"] == "Priya Sharma"
    assert job["contact_email"] == "Priya.Hiring@example.com"  # domain normalised

    assert client.post("/api/v1/jobs", json={"title": "X", "company": "Y"}).status_code == 422


def test_update_job_contact(cleanup):
    job = crud.create_job(title="TEST Data Engineer", company="Acme")
    cleanup["jobs"].append(job["id"])
    assert job["contact_email"] is None

    response = client.patch(
        f"/api/v1/jobs/{job['id']}/contact",
        json={"contact_name": "Ravi", "contact_email": "ravi@example.com"},
    )

    assert response.status_code == 200
    assert crud.get_job(job["id"])["contact_email"] == "ravi@example.com"


def make_submission(cleanup) -> tuple[dict, dict]:
    job = crud.create_job(title="TEST Role", company="Acme", contact_email="hm@example.com")
    candidate = crud.create_candidate(name="TEST Cand", email=f"test-{uuid4().hex[:8]}@example.com")
    submission = crud.create_submission(candidate["id"], job["id"], 88.0, "Strong Match", "notes")
    draft = crud.create_email_draft(submission["id"], "Subject", "Body", recipient_email=job["contact_email"])
    cleanup["jobs"].append(job["id"])
    cleanup["candidates"].append(candidate["id"])
    cleanup["submissions"].append(submission["id"])
    return submission, draft


def test_mark_sent_updates_draft_and_submission(cleanup):
    submission, draft = make_submission(cleanup)

    response = client.post(
        f"/api/v1/submissions/{submission['id']}/email-drafts/{draft['id']}/sent",
        json={"via": "gmail"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "submitted"
    assert body["email_status"] == "sent"
    sent = body["email_drafts"][0]
    assert sent["status"] == "sent" and sent["sent_via"] == "gmail" and sent["sent_at"]
    assert sent["recipient_email"] == "hm@example.com"

    again = client.post(f"/api/v1/submissions/{submission['id']}/email-drafts/{draft['id']}/sent", json={"via": "gmail"})
    assert again.status_code == 409


def test_mark_sent_rejects_mismatched_or_unknown(cleanup):
    submission, draft = make_submission(cleanup)

    assert client.post(f"/api/v1/submissions/{submission['id'] + 999999}/email-drafts/{draft['id']}/sent", json={"via": "gmail"}).status_code == 404
    assert client.post(f"/api/v1/submissions/{submission['id']}/email-drafts/{draft['id']}/sent", json={"via": "fax"}).status_code == 422


def test_list_shows_job_contact_and_email_status(cleanup):
    submission, _ = make_submission(cleanup)

    row = next(s for s in client.get("/api/v1/submissions").json() if s["id"] == submission["id"])

    assert row["job_contact_email"] == "hm@example.com"
    assert row["email_status"] == "draft"


def test_email_context_comes_from_job_and_approver(cleanup):
    job = crud.create_job(title="TEST Ctx", company="Acme", contact_name="Meera", contact_email="meera@example.com")
    candidate = crud.create_candidate(name="TEST Ctx Cand", email=f"test-{uuid4().hex[:8]}@example.com")
    cleanup["jobs"].append(job["id"])
    cleanup["candidates"].append(candidate["id"])
    thread_id = f"wf-test-{uuid4()}"
    approvals_crud.create_approval(thread_id, candidate["id"], job["id"], None, "studio")

    context = workflow_service.build_email_context(thread_id, {"full_name": "Quinn Approver", "company": "TalentCo"})

    assert context == {
        "recipient_name": "Meera",
        "recipient_email": "meera@example.com",
        "sender_name": "Quinn Approver",
        "sender_company": "TalentCo",
    }


def test_email_agent_never_needs_placeholders():
    assert describe_people({"recipient_name": "Meera", "sender_name": "Quinn", "sender_company": "TalentCo"}) == (
        "Meera",
        "Quinn, TalentCo",
    )
    # Missing data falls back to neutral wording, not "[Name]"
    assert describe_people({}) == ("the hiring team", "the recruiting team")

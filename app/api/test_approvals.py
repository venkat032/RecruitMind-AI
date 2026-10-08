"""
Approval queue tests (real PostgreSQL, no LLM calls).

The agents themselves are replaced by stand-ins here; the queue's state
machine, duplicate protection, concurrency guard and API are what's tested.
The real agents are covered by app/graph/test_persistence_e2e.py.

Run:
    python -m pytest app/api/test_approvals.py -v
"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

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
def records():
    created = {"candidates": [], "jobs": []}
    yield created

    with get_cursor() as cursor:
        if created["candidates"] or created["jobs"]:
            cursor.execute(
                "DELETE FROM approval_requests WHERE candidate_id = ANY(%s) OR job_id = ANY(%s)",
                (created["candidates"], created["jobs"]),
            )
        for table in ("candidates", "jobs"):
            if created[table]:
                cursor.execute(f"DELETE FROM {table} WHERE id = ANY(%s)", (created[table],))


@pytest.fixture
def job(records):
    row = crud.create_job(title="TEST Approvals Engineer", company="QueueCo", skills="Python")
    records["jobs"].append(row["id"])
    return row


def make_candidate(records, resume: str | None = "Python developer, 4 years.") -> dict:
    row = crud.create_candidate(name=f"TEST Cand {uuid4().hex[:6]}", email=f"test-{uuid4().hex[:10]}@example.com")
    if resume:
        row = crud.update_candidate_resume(row["id"], resume, "data/resumes/test.pdf")
    records["candidates"].append(row["id"])
    return row


@pytest.fixture
def no_background_agents(monkeypatch):
    """Batch screening registers requests but doesn't start the LLM agents."""
    monkeypatch.setattr(workflow_service._screening_pool, "submit", lambda *a, **k: None)


@pytest.fixture
def fake_agents(monkeypatch):
    """Resuming a run records the outcome without calling the Submission/Email agents."""

    def fake_resume(thread_id, approved, email_context=None):
        approvals_crud.mark_decided(thread_id, approved, submission_id=None, email_draft_id=None)
        yield {"type": "complete", "thread_id": thread_id, "approved": approved}

    monkeypatch.setattr(workflow_service, "resume_workflow", fake_resume)


def pending_request(candidate: dict, job: dict, score: float = 80.0) -> dict:
    """A request as it looks after the agents paused at Human Approval."""

    thread_id = f"wf-test-{uuid4()}"
    approvals_crud.create_approval(thread_id, candidate["id"], job["id"], None, "batch")
    approvals_crud.mark_pending(thread_id, score, "Match", {"match_result": {"match_score": score}})
    return approvals_crud.get_by_thread(thread_id)


# ============================================================
# Screening
# ============================================================

def test_batch_screening_queues_and_skips(records, job, no_background_agents):
    ready = make_candidate(records)
    no_resume = make_candidate(records, resume=None)

    response = client.post("/api/v1/approvals/screen", json={"job_id": job["id"], "candidate_ids": [ready["id"], no_resume["id"]]})

    assert response.status_code == 202
    body = response.json()
    assert [q["candidate_id"] for q in body["queued"]] == [ready["id"]]
    assert body["skipped"][0]["reason"] == "No resume uploaded."

    rows = approvals_crud.list_approvals(job_id=job["id"])
    assert [(r["candidate_id"], r["status"]) for r in rows] == [(ready["id"], "screening")]


def test_duplicate_open_request_is_skipped(records, job, no_background_agents):
    candidate = make_candidate(records)
    payload = {"job_id": job["id"], "candidate_ids": [candidate["id"]]}

    client.post("/api/v1/approvals/screen", json=payload)
    second = client.post("/api/v1/approvals/screen", json=payload).json()

    assert second["queued"] == []
    assert "Already being screened" in second["skipped"][0]["reason"]


def test_closed_request_allows_screening_again(records, job, fake_agents):
    candidate = make_candidate(records)
    first = pending_request(candidate, job)
    client.post(f"/api/v1/approvals/{first['id']}/decision", json={"approved": False})

    # The old request is closed, so the same pair can be screened again
    second = pending_request(candidate, job)
    assert second["status"] == "pending"


def test_candidates_for_job_shows_open_requests(records, job):
    candidate = make_candidate(records)
    pending_request(candidate, job)

    rows = client.get(f"/api/v1/approvals/candidates-for-job/{job['id']}").json()
    mine = next(r for r in rows if r["id"] == candidate["id"])

    assert mine["open_request"] == "pending"


# ============================================================
# Queue + decisions
# ============================================================

def test_list_filter_and_summary(records, job):
    candidate = make_candidate(records)
    request = pending_request(candidate, job, score=91.5)

    pending = client.get("/api/v1/approvals", params={"status": "pending", "job_id": job["id"]}).json()
    assert [r["id"] for r in pending] == [request["id"]]
    assert pending[0]["match_score"] == 91.5
    assert pending[0]["candidate_name"] == candidate["name"]

    summary = client.get("/api/v1/approvals/summary").json()
    assert summary["counts"]["pending"] >= 1
    assert summary["oldest_pending"] is not None

    detail = client.get(f"/api/v1/approvals/{request['id']}").json()
    assert detail["analysis"]["match_result"]["match_score"] == 91.5


def test_approve_then_second_decision_conflicts(records, job, fake_agents):
    request = pending_request(make_candidate(records), job)

    approved = client.post(f"/api/v1/approvals/{request['id']}/decision", json={"approved": True, "note": "Strong fit"})
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["decision_note"] == "Strong fit"
    assert approved.json()["decided_at"] is not None

    again = client.post(f"/api/v1/approvals/{request['id']}/decision", json={"approved": False})
    assert again.status_code == 409
    assert "already approved" in again.json()["detail"]


def test_only_one_recruiter_can_claim(records, job):
    request = pending_request(make_candidate(records), job)

    assert approvals_crud.claim_for_decision(request["thread_id"], None, None) is not None
    assert approvals_crud.claim_for_decision(request["thread_id"], None, None) is None


def test_failed_decision_returns_to_queue(records, job, monkeypatch):
    request = pending_request(make_candidate(records), job)

    def broken_resume(thread_id, approved, email_context=None):
        approvals_crud.release_claim(thread_id, "LLM timeout")
        yield {"type": "error", "message": "LLM timeout"}

    monkeypatch.setattr(workflow_service, "resume_workflow", broken_resume)

    response = client.post(f"/api/v1/approvals/{request['id']}/decision", json={"approved": True})

    assert response.status_code == 502
    row = approvals_crud.get_by_thread(request["thread_id"])
    assert row["status"] == "pending" and row["error"] == "LLM timeout"


def test_bulk_decision_reports_each_item(records, job, fake_agents):
    open_one = pending_request(make_candidate(records), job)
    decided = pending_request(make_candidate(records), job)
    client.post(f"/api/v1/approvals/{decided['id']}/decision", json={"approved": True})

    response = client.post(
        "/api/v1/approvals/bulk-decision",
        json={"ids": [open_one["id"], decided["id"], 999999999], "approved": False, "note": "Role filled"},
    ).json()

    assert response["succeeded"] == 1 and response["failed"] == 2
    assert approvals_crud.get_by_thread(open_one["thread_id"])["status"] == "rejected"


def test_validation_errors():
    assert client.get("/api/v1/approvals", params={"status": "bogus"}).status_code == 422
    assert client.get("/api/v1/approvals/999999999").status_code == 404
    assert client.post("/api/v1/approvals/bulk-decision", json={"ids": [], "approved": True}).status_code == 422


# ============================================================
# Restart recovery
# ============================================================

def test_recovery_marks_lost_screening_as_failed(records, job):
    candidate = make_candidate(records)
    thread_id = f"wf-test-{uuid4()}"
    approvals_crud.create_approval(thread_id, candidate["id"], job["id"], None, "batch")

    # No checkpoint exists for this thread: it died before reaching approval
    workflow_service.recover_interrupted_work()

    row = approvals_crud.get_by_thread(thread_id)
    assert row["status"] == "failed"
    assert "server restart" in row["error"]

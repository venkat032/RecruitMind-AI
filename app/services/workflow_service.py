"""
Runs the existing recruiter LangGraph and turns its progress into
JSON events the frontend can render live.

Every run is mirrored in the approval queue (approval_requests), so a
candidate paused at Human Approval can be decided from the Match Studio
or later from the Approvals page, by any recruiter, even after a restart
(checkpoints are stored in PostgreSQL).

Event types:
    {"type": "started",   "thread_id", "candidate_id", "job_id", "approval_id"}
    {"type": "node",      "node", "data"}        one per finished agent
    {"type": "interrupt", "thread_id", "payload"} waiting for human approval
    {"type": "complete",  "thread_id", "approved", "submission_result", "email_result"}
    {"type": "error",     "message"}
"""

import logging
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from langgraph.types import Command

from app.database import approvals_crud, crud
from app.graph.recruiter_graph import recruiter_graph


log = logging.getLogger(__name__)

APPROVAL_NODE = "human_approval"

# Background screening (batch). Small pool: each run makes several LLM calls.
_screening_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="screening")


class DecisionConflict(Exception):
    """The request is not waiting for a decision (already decided, or in progress)."""


def job_description_from_db(job: dict) -> str:

    return (
        f"{job['title']}\n\n"
        f"Company: {job['company']}\n"
        f"Location: {job['location']}\n\n"
        f"Required Skills:\n{job['skills']}\n\n"
        f"Description:\n{job['description']}"
    )


def build_initial_state(candidate: dict, job: dict) -> dict:

    # IDs come from PostgreSQL, never from the LLM
    return {
        "messages": [],
        "candidate_id": candidate["id"],
        "job_id": job["id"],
        "resume_text": candidate["resume_text"],
        "resume_analysis": {},
        "job_description": job_description_from_db(job),
        "job_analysis": {},
        "match_result": {},
        "recruiter_assessment": {},
        "human_approval": False,
        "submission_result": {},
        "email_result": {},
    }


def new_thread_id() -> str:
    return f"wf-{uuid4()}"


def thread_config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def is_awaiting_approval(thread_id: str) -> bool:

    snapshot = recruiter_graph.get_state(thread_config(thread_id))

    return snapshot.next == (APPROVAL_NODE,)


# ============================================================
# Queue bookkeeping
# ============================================================

def _record_pending(thread_id: str) -> None:
    """Snapshot what the agents produced so reviewers can decide from the queue."""

    values = recruiter_graph.get_state(thread_config(thread_id)).values
    match = values.get("match_result") or {}
    assessment = values.get("recruiter_assessment") or {}

    approvals_crud.mark_pending(
        thread_id,
        match_score=match.get("match_score"),
        recommendation=assessment.get("recommendation"),
        analysis={
            "resume_analysis": values.get("resume_analysis") or {},
            "job_analysis": values.get("job_analysis") or {},
            "match_result": match,
            "recruiter_assessment": assessment,
        },
    )


def _record_decided(thread_id: str) -> dict:

    values = recruiter_graph.get_state(thread_config(thread_id)).values
    submission = values.get("submission_result") or {}
    email = values.get("email_result") or {}

    approvals_crud.mark_decided(
        thread_id,
        approved=bool(values.get("human_approval")),
        submission_id=submission.get("submission_id"),
        email_draft_id=email.get("email_draft_id"),
    )

    return values


def open_request(candidate: dict, job: dict, requested_by: int | None, source: str) -> str:
    """
    Register a new screening in the queue and return its thread id.
    Raises DuplicateRecordError if this candidate already has an open
    request for this job.
    """

    thread_id = new_thread_id()
    approvals_crud.create_approval(thread_id, candidate["id"], job["id"], requested_by, source)

    return thread_id


def build_email_context(thread_id: str, sender: dict | None) -> dict:
    """
    Who the submission email goes to (the job's hiring contact, read fresh from
    PostgreSQL) and who it's from (the approving recruiter). Never LLM-generated.
    """

    approval = approvals_crud.get_by_thread(thread_id)
    job = crud.get_job(approval["job_id"]) if approval else None
    sender = sender or {}

    return {
        "recipient_name": (job or {}).get("contact_name"),
        "recipient_email": (job or {}).get("contact_email"),
        "sender_name": sender.get("full_name"),
        "sender_company": sender.get("company"),
    }


def claim_decision(thread_id: str, decided_by: int | None, note: str | None) -> None:

    if approvals_crud.claim_for_decision(thread_id, decided_by, note) is None:
        current = approvals_crud.get_by_thread(thread_id)

        if current is None:
            raise DecisionConflict("This approval request no longer exists.")

        who = f" by {current['decided_by_name']}" if current.get("decided_by_name") else ""
        raise DecisionConflict(f"This request is already {current['status']}{who}.")


# ============================================================
# Streaming (Match Studio)
# ============================================================

def _stream(graph_input, thread_id: str, deciding: bool = False) -> Iterator[dict]:

    config = thread_config(thread_id)

    try:
        for chunk in recruiter_graph.stream(graph_input, config, stream_mode="updates"):

            for node, update in chunk.items():

                if node == "__interrupt__":
                    _record_pending(thread_id)
                    yield {
                        "type": "interrupt",
                        "thread_id": thread_id,
                        "payload": update[0].value,
                    }

                else:
                    yield {"type": "node", "node": node, "data": update or {}}

        snapshot = recruiter_graph.get_state(config)

        if not snapshot.next:
            values = _record_decided(thread_id)

            yield {
                "type": "complete",
                "thread_id": thread_id,
                "approved": values.get("human_approval", False),
                "submission_result": values.get("submission_result", {}),
                "email_result": values.get("email_result", {}),
            }

    except Exception as e:
        message = f"{type(e).__name__}: {e}"
        log.exception("Workflow %s failed", thread_id)

        if deciding:
            approvals_crud.release_claim(thread_id, message)
        else:
            approvals_crud.mark_failed(thread_id, message)

        # The HTTP status is already 200 once streaming starts,
        # so failures are reported as an event instead.
        yield {"type": "error", "message": message}


def start_workflow(thread_id: str, candidate: dict, job: dict) -> Iterator[dict]:

    approval = approvals_crud.get_by_thread(thread_id)

    yield {
        "type": "started",
        "thread_id": thread_id,
        "candidate_id": candidate["id"],
        "job_id": job["id"],
        "approval_id": approval["id"] if approval else None,
    }

    yield from _stream(build_initial_state(candidate, job), thread_id)


def resume_workflow(thread_id: str, approved: bool, email_context: dict | None = None) -> Iterator[dict]:
    """Call claim_decision() first."""

    command = Command(resume=approved, update={"email_context": email_context or {}})

    yield from _stream(command, thread_id, deciding=True)


# ============================================================
# Batch screening + queue decisions (Approvals page)
# ============================================================

def _run_to_completion(events: Iterator[dict]) -> dict | None:
    """Drain a workflow stream; returns the error event, if any."""

    error = None
    for event in events:
        if event["type"] == "error":
            error = event
    return error


def screen_in_background(candidate: dict, job: dict, requested_by: int | None) -> str:
    """Queue one candidate for screening; the agents run on a worker thread."""

    thread_id = open_request(candidate, job, requested_by, source="batch")
    _screening_pool.submit(_run_to_completion, start_workflow(thread_id, candidate, job))

    return thread_id


def decide(thread_id: str, approved: bool, decider: dict, note: str | None) -> dict:
    """
    Synchronous decision used by the Approvals page.
    Approve runs the Submission and Email agents (a few seconds); reject ends the run.
    """

    claim_decision(thread_id, decider.get("id"), note)
    email_context = build_email_context(thread_id, decider)
    error = _run_to_completion(resume_workflow(thread_id, approved, email_context))

    if error:
        raise RuntimeError(error["message"])

    return approvals_crud.get_by_thread(thread_id)


# ============================================================
# Startup recovery
# ============================================================

def recover_interrupted_work() -> None:
    """
    Called at startup. Background runs die with the process, so:
    - 'screening' runs that reached the approval checkpoint become 'pending';
      the rest are marked 'failed' (they can be screened again).
    - 'deciding' runs go back to 'pending' if nothing happened yet, or are
      finished from their checkpoint if they stopped part-way.
    """

    for thread_id in approvals_crud.open_threads("screening"):
        try:
            if is_awaiting_approval(thread_id):
                _record_pending(thread_id)
            else:
                approvals_crud.mark_failed(thread_id, "Interrupted by a server restart. Screen this candidate again.")
        except Exception:
            log.exception("Could not recover screening %s", thread_id)

    for thread_id in approvals_crud.open_threads("deciding"):
        try:
            config = thread_config(thread_id)
            snapshot = recruiter_graph.get_state(config)

            if snapshot.next == (APPROVAL_NODE,):
                approvals_crud.release_claim(thread_id, "The decision was interrupted by a server restart.")
                continue

            if snapshot.next:
                # Stopped part-way (e.g. after Submission, before Email): finish from the checkpoint
                recruiter_graph.invoke(None, config)

            _record_decided(thread_id)
        except Exception:
            log.exception("Could not recover decision %s", thread_id)


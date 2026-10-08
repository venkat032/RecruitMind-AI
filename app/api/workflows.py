import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_session
from app.api.schemas import WorkflowDecision, WorkflowStart
from app.database import crud
from app.services import workflow_service
from app.services.workflow_service import DecisionConflict


router = APIRouter(
    prefix="/workflows",
    tags=["Workflows"]
)


def ndjson(events: Iterator[dict]) -> StreamingResponse:
    """One JSON object per line, flushed as soon as each agent finishes."""

    lines = (json.dumps(event, default=str) + "\n" for event in events)

    return StreamingResponse(
        lines,
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def load_screening_inputs(candidate_id: int, job_id: int) -> tuple[dict, dict]:
    """Candidate (with a resume) and job from PostgreSQL, or a clear HTTP error."""

    candidate = crud.get_candidate(candidate_id)

    if candidate is None:
        raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found.")

    if not candidate["resume_text"]:
        raise HTTPException(
            status_code=400,
            detail=f"{candidate['name']} has no resume yet. Upload a PDF resume first."
        )

    job = crud.get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    return candidate, job


@router.post("/run")
def run_workflow(request: WorkflowStart, session: dict = Depends(get_current_session)):
    """
    Resume + Job agents -> Matching -> Score -> pauses at Human Approval.
    Streams progress events (NDJSON). The paused run also appears in the approval queue.
    """

    candidate, job = load_screening_inputs(request.candidate_id, request.job_id)

    try:
        thread_id = workflow_service.open_request(candidate, job, session.get("id"), source="studio")

    except crud.DuplicateRecordError as e:
        raise HTTPException(status_code=409, detail=f"{e} Decide it in the Approvals queue.")

    return ndjson(workflow_service.start_workflow(thread_id, candidate, job))


@router.post("/{thread_id}/decision")
def decide(thread_id: str, request: WorkflowDecision, session: dict = Depends(get_current_session)):
    """
    Human-in-the-loop decision.
    APPROVE -> Submission + Email draft (persisted). REJECT -> END.
    """

    try:
        workflow_service.claim_decision(thread_id, session.get("id"), request.note)

    except DecisionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))

    email_context = workflow_service.build_email_context(thread_id, session)

    return ndjson(workflow_service.resume_workflow(thread_id, request.approved, email_context))

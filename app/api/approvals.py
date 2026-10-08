"""
Human-in-the-loop approval queue.

Candidates screened by the agents wait here, paused at the Human Approval
checkpoint, until a recruiter approves or rejects them.
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_session
from app.api.schemas import ApprovalDecision, BulkDecision, ScreenRequest
from app.database import approvals_crud, crud
from app.database.models import APPROVAL_STATUSES
from app.services import workflow_service
from app.services.workflow_service import DecisionConflict


router = APIRouter(
    prefix="/approvals",
    tags=["Approvals"]
)

# Approvals run the Submission + Email agents; a few in parallel keeps bulk actions quick
_decision_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="decision")


def get_or_404(approval_id: int) -> dict:

    approval = approvals_crud.get_approval(approval_id)

    if approval is None:
        raise HTTPException(status_code=404, detail=f"Approval request {approval_id} not found.")

    return approval


@router.get("")
def list_approvals(status: str | None = None, job_id: int | None = None):

    if status and status not in APPROVAL_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status '{status}'.")

    return approvals_crud.list_approvals(status=status, job_id=job_id)


@router.get("/summary")
def summary():
    return approvals_crud.approval_summary()


@router.get("/candidates-for-job/{job_id}")
def candidates_for_job(job_id: int):
    """Candidates with their screening eligibility for one job (for the screening picker)."""

    if crud.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    open_requests = approvals_crud.open_pairs(job_id)

    return [
        {**c, "open_request": open_requests.get(c["id"])}
        for c in crud.list_candidates()
    ]


@router.get("/{approval_id}")
def get_approval(approval_id: int):
    return get_or_404(approval_id)


@router.post("/screen", status_code=202)
def screen(request: ScreenRequest, session: dict = Depends(get_current_session)):
    """
    Batch screening: run the agents for many candidates against one job in the
    background. Each lands in the queue as 'pending' when it reaches approval.
    """

    job = crud.get_job(request.job_id)

    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {request.job_id} not found.")

    queued, skipped = [], []

    for candidate_id in dict.fromkeys(request.candidate_ids):  # de-duplicate, keep order
        candidate = crud.get_candidate(candidate_id)

        if candidate is None:
            skipped.append({"candidate_id": candidate_id, "reason": "Candidate not found."})
            continue

        if not candidate["resume_text"]:
            skipped.append({"candidate_id": candidate_id, "name": candidate["name"], "reason": "No resume uploaded."})
            continue

        try:
            thread_id = workflow_service.screen_in_background(candidate, job, session.get("id"))
            queued.append({"candidate_id": candidate_id, "name": candidate["name"], "thread_id": thread_id})

        except crud.DuplicateRecordError:
            skipped.append({
                "candidate_id": candidate_id,
                "name": candidate["name"],
                "reason": "Already being screened or waiting for approval for this job.",
            })

    return {"job_id": job["id"], "queued": queued, "skipped": skipped}


def _decide(approval: dict, approved: bool, decider: dict, note: str | None) -> dict:

    try:
        return workflow_service.decide(approval["thread_id"], approved, decider, note)

    except DecisionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))

    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"The agents could not finish: {e}. The request is back in the queue.")


@router.post("/{approval_id}/decision")
def decide(approval_id: int, request: ApprovalDecision, session: dict = Depends(get_current_session)):

    approval = get_or_404(approval_id)

    return _decide(approval, request.approved, session, request.note)


@router.post("/bulk-decision")
def bulk_decide(request: BulkDecision, session: dict = Depends(get_current_session)):
    """Approve or reject several pending requests. Each one succeeds or fails on its own."""

    def one(approval_id: int) -> dict:
        try:
            approval = get_or_404(approval_id)
            result = _decide(approval, request.approved, session, request.note)
            return {"id": approval_id, "ok": True, "status": result["status"], "submission_id": result["submission_id"]}

        except HTTPException as e:
            return {"id": approval_id, "ok": False, "error": e.detail}

    results = list(_decision_pool.map(one, dict.fromkeys(request.ids)))

    return {
        "succeeded": sum(r["ok"] for r in results),
        "failed": sum(not r["ok"] for r in results),
        "results": results,
    }

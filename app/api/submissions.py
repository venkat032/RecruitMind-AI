from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_session
from app.api.schemas import EmailSent
from app.database import crud


router = APIRouter(
    prefix="/submissions",
    tags=["Submissions"]
)


@router.get("")
def list_submissions():
    return crud.list_submissions()


@router.get("/{submission_id}")
def get_submission(submission_id: int):

    submission = crud.get_submission_details(submission_id)

    if submission is None:
        raise HTTPException(status_code=404, detail=f"Submission {submission_id} not found.")

    return submission


@router.post("/{submission_id}/email-drafts/{draft_id}/sent")
def mark_email_sent(
    submission_id: int,
    draft_id: int,
    request: EmailSent,
    session: dict = Depends(get_current_session),
):
    """
    Record that the recruiter sent this draft from their own mail client.
    The submission moves to 'submitted'.
    """

    draft = crud.get_email_draft(draft_id)

    if draft is None or draft["submission_id"] != submission_id:
        raise HTTPException(status_code=404, detail="Email draft not found for this submission.")

    if draft["status"] == "sent":
        raise HTTPException(status_code=409, detail="This email was already marked as sent.")

    crud.mark_email_sent(draft_id, session.get("id"), request.via)

    return crud.get_submission_details(submission_id)

from langchain_core.tools import tool

from app.database import crud


@tool
def create_submission(
    candidate_id: int,
    job_id: int,
    match_score: float,
    recommendation: str,
    recruiter_notes: str
) -> dict:
    """
    Create a candidate submission in PostgreSQL.
    """

    submission = crud.create_submission(
        candidate_id=candidate_id,
        job_id=job_id,
        match_score=match_score,
        recommendation=recommendation,
        recruiter_notes=recruiter_notes,
        status="approved"
    )

    return {
        "submission_id": submission["id"],
        "status": submission["status"]
    }

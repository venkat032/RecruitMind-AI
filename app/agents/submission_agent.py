from app.tools.submission_tools import (
    create_submission
)


def submit_candidate(
    candidate_id: int,
    job_id: int,
    match_score: float,
    recommendation: str,
    recruiter_notes: str
):

    result = create_submission.invoke(
        {
            "candidate_id": candidate_id,

            "job_id": job_id,

            "match_score": match_score,

            "recommendation": recommendation,

            "recruiter_notes": recruiter_notes
        }
    )

    return result
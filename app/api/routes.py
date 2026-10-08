from fastapi import APIRouter

from app.api.schemas import (
    RecruiterRequest,
    RecruiterResponse
)

from app.graph.matching_graph import (
    matching_graph
)


router = APIRouter(
    prefix="/api/v1/recruiter",
    tags=["Recruiter"]
)

@router.post("/analyze", response_model=RecruiterResponse)
def analyze_candidate(request: RecruiterRequest):
    result = matching_graph.invoke(
        {
            "messages": [],
            "resume_text": request.resume,
            "resume_analysis": {},
            "job_description": request.job_description,
            "job_analysis": {},
            "match_result": {},
            "recruiter_assessment": {}
        }
    )
    match_result = result["match_result"]
    assessment = result["recruiter_assessment"]

    return RecruiterResponse(

        match_score=match_result[
            "match_score"
        ],

        matched_skills=match_result[
            "matched_skills"
        ],

        missing_skills=match_result[
            "missing_skills"
        ],

        experience_match=match_result[
            "experience_match"
        ],

        recommendation=assessment[
            "recommendation"
        ],

        strengths=assessment[
            "strengths"
        ],

        concerns=assessment[
            "concerns"
        ],

        reasoning=assessment[
            "reasoning"
        ]
    )
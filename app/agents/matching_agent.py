from pydantic import BaseModel, Field

from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage
)


# ============================================================
# 1. Structured output model
# ============================================================

class MatchingResult(BaseModel):

    matched_skills: list[str] = Field(
        description="Skills from the job description that the candidate has"
    )

    missing_skills: list[str] = Field(
        description="Required job skills that the candidate does not have"
    )

    experience_match: bool = Field(
        description="Whether the candidate meets the required experience"
    )

    match_score: float = Field(
        description="Final candidate-job match score from 0 to 100"
    )

    recommendation: str = Field(
        description="Professional recruiter recommendation"
    )


# ============================================================
# 2. LLM
# ============================================================

llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0
)


matching_llm = llm.with_structured_output(
    MatchingResult
)


# ============================================================
# 3. Skill Matching
# ============================================================

def calculate_skill_match(
    candidate_skills: list[str],
    required_skills: list[str]
):
    """
    Compare candidate skills against required job skills.

    Returns:
        matched_skills
        missing_skills
        skill_score
    """

    candidate = {
        skill.strip().lower()
        for skill in candidate_skills
    }

    required = {
        skill.strip().lower()
        for skill in required_skills
    }

    matched = candidate.intersection(
        required
    )

    missing = required.difference(
        candidate
    )

    if not required:

        skill_score = 100.0

    else:

        skill_score = (
            len(matched)
            / len(required)
        ) * 100

    return (
        sorted(matched),
        sorted(missing),
        round(skill_score, 2)
    )


# ============================================================
# 4. Experience Matching
# ============================================================

def calculate_experience_match(
    candidate_experience: float,
    required_experience: float
):
    """
    Check whether the candidate satisfies
    the required years of experience.
    """

    return (
        candidate_experience
        >= required_experience
    )


# ============================================================
# 5. Deterministic Match Calculation
# ============================================================

def calculate_match(
    resume_analysis: dict,
    job_analysis: dict
):
    """
    Calculate the candidate-job match score.

    Skill Match      = 70%
    Experience Match = 30%
    """

    matched_skills, missing_skills, skill_score = (
        calculate_skill_match(
            candidate_skills=resume_analysis["skills"],
            required_skills=job_analysis["required_skills"]
        )
    )

    experience_match = calculate_experience_match(
        candidate_experience=resume_analysis[
            "experience_years"
        ],
        required_experience=job_analysis[
            "experience_years"
        ]
    )

    if experience_match:

        experience_score = 100.0

    else:

        experience_score = 0.0

    final_score = (
        (skill_score * 0.70)
        +
        (experience_score * 0.30)
    )

    return {

        "matched_skills": matched_skills,

        "missing_skills": missing_skills,

        "experience_match": experience_match,

        "skill_score": round(
            skill_score,
            2
        ),

        "experience_score": round(
            experience_score,
            2
        ),

        "match_score": round(
            final_score,
            2
        )
    }


# ============================================================
# 6. LLM Explanation
# ============================================================

def explain_match(
    resume_analysis: dict,
    job_analysis: dict,
    match_result: dict
):
    """
    Ask the LLM to explain the deterministic
    matching result.
    """

    prompt = f"""
You are an expert technical recruiter.

Analyze the candidate against the job.

========================
CANDIDATE
========================

{resume_analysis}


========================
JOB
========================

{job_analysis}


========================
DETERMINISTIC MATCH RESULT
========================

{match_result}


Your task:

1. Explain the matched skills.
2. Explain the missing skills.
3. Explain whether experience requirements are met.
4. Provide a professional recruiter recommendation.
5. DO NOT change the calculated match score.
6. DO NOT invent candidate information.
7. DO NOT invent job requirements.
8. Base your explanation only on the provided data.
"""

    messages = [

        SystemMessage(
            content="""
You are a professional recruitment analyst.

The match score is calculated by deterministic
Python logic.

You must NOT modify or recalculate the score.

Your responsibility is to explain the result
clearly and professionally.
"""
        ),

        HumanMessage(
            content=prompt
        )
    ]

    return matching_llm.invoke(
        messages
    )


# ============================================================
# 7. Main Matching Function
# ============================================================

def match_candidate(
    resume_analysis: dict,
    job_analysis: dict
):
    """
    Complete candidate-vs-job matching workflow.

    1. Calculate deterministic score.
    2. Ask LLM to explain the result.
    3. Combine both results.
    """

    # --------------------------------------------------------
    # Step 1: Calculate deterministic result
    # --------------------------------------------------------

    match_result = calculate_match(
        resume_analysis=resume_analysis,
        job_analysis=job_analysis
    )


    # --------------------------------------------------------
    # Step 2: Ask LLM for explanation
    # --------------------------------------------------------

    explanation = explain_match(
        resume_analysis=resume_analysis,
        job_analysis=job_analysis,
        match_result=match_result
    )


    # --------------------------------------------------------
    # Step 3: Convert structured LLM result to dictionary
    # --------------------------------------------------------

    result = explanation.model_dump()


    # --------------------------------------------------------
    # Step 4: Override deterministic fields
    #
    # This guarantees that the LLM cannot accidentally
    # change our calculated score.
    # --------------------------------------------------------

    result.update({

        "matched_skills":
            match_result["matched_skills"],

        "missing_skills":
            match_result["missing_skills"],

        "experience_match":
            match_result["experience_match"],

        "match_score":
            match_result["match_score"],

        "skill_score":
            match_result["skill_score"],

        "experience_score":
            match_result["experience_score"]
    })


    return result
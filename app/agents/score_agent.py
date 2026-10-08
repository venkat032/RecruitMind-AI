from pydantic import BaseModel, Field

from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage
)


class RecruiterAssessment(BaseModel):

    recommendation: str = Field(
        description=(
            "Recruiter recommendation such as "
            "Strong Match, Match, or Weak Match"
        )
    )

    strengths: list[str] = Field(
        description=(
            "Important strengths of the candidate "
            "for this job"
        )
    )

    concerns: list[str] = Field(
        description=(
            "Important concerns or gaps in the candidate"
        )
    )

    reasoning: str = Field(
        description=(
            "Professional explanation of the recruiter assessment"
        )
    )


llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0
)


score_llm = llm.with_structured_output(
    RecruiterAssessment
)


def assess_candidate(
    resume_analysis: dict,
    job_analysis: dict,
    match_result: dict
):

    prompt = f"""
You are a senior technical recruiter.

Evaluate the candidate against the job.

========================
CANDIDATE
========================

{resume_analysis}


========================
JOB
========================

{job_analysis}


========================
MATCH RESULT
========================

{match_result}


Your task:

1. Determine the recruiter's recommendation.
2. Identify the candidate's strongest qualifications.
3. Identify important gaps or concerns.
4. Explain the reasoning professionally.

Important rules:

- Do not invent candidate information.
- Do not invent job requirements.
- Do not change the calculated match score.
- Use the deterministic match result as the source of truth.
"""

    messages = [

        SystemMessage(
            content="""
You are a senior technical recruiter.

Your job is to interpret structured
candidate-job matching results.

Be factual and concise.
Do not invent information.
"""
        ),

        HumanMessage(
            content=prompt
        )
    ]

    result = score_llm.invoke(
        messages
    )

    return result


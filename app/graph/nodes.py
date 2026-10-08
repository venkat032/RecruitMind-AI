from app.graph.state import RecruiterState

from app.agents.recruiter_agent import recruiter_llm
from langgraph.prebuilt import ToolNode

from app.agents.recruiter_agent import tools
from langchain_core.messages import SystemMessage
from app.agents.resume_agent import analyze_resume
from app.agents.job_agent import analyze_job
from app.agents.matching_agent import (
    match_candidate
)

from app.agents.score_agent import (
    assess_candidate
)
from langgraph.types import interrupt

from app.agents.submission_agent import (
    submit_candidate
)

from app.agents.email_agent import (
    create_email_draft
)

SYSTEM_PROMPT = """
You are an AI Recruiter Assistant.

Your responsibilities are:

1. Search jobs when the user asks about jobs.
2. Get complete job details when a job ID is provided.
3. Search candidates when the user asks for candidates.
4. Get candidate details when a candidate ID is provided.
5. Never invent job or candidate information.
6. Use tools whenever database information is required.
7. Clearly explain the results to the user.
8. Keep responses concise and professional.
"""


def recruiter_node(
    state: RecruiterState
):
    response = recruiter_llm.invoke(
        state["messages"]
    )
    return {
        "messages": response
    }
tool_node = ToolNode(tools)

def resume_node(state:RecruiterState):
    result = analyze_resume(
        state["resume_text"]
    )
    return {
        "resume_analysis": result.model_dump()
    }

def job_node(state:RecruiterState):
    result = analyze_job(
        state["job_description"]
    )
    return {
        "job_analysis": result.model_dump()
    }

def matching_node(
    state: RecruiterState
):

    result = match_candidate(
        state["resume_analysis"],
        state["job_analysis"]
    )

    return {
        "match_result": result
    }

def score_node(
    state: RecruiterState
):

    result = assess_candidate(
        resume_analysis=state["resume_analysis"],
        job_analysis=state["job_analysis"],
        match_result=state["match_result"]
    )

    return {
        "recruiter_assessment": result.model_dump()
    }

def human_approval_node(
    state: RecruiterState
):

    assessment = state[
        "recruiter_assessment"
    ]

    approval = interrupt({

        "message": (
            "Human approval required "
            "before candidate submission."
        ),

        "candidate_id": state["candidate_id"],

        "job_id": state["job_id"],

        "match_score": state[
            "match_result"
        ]["match_score"],

        "recommendation": assessment[
            "recommendation"
        ],

        "strengths": assessment[
            "strengths"
        ],

        "concerns": assessment[
            "concerns"
        ]
    })

    return {
        "human_approval": bool(approval)
    }

def approval_router(
    state: RecruiterState
):

    if state["human_approval"]:

        return "approved"

    return "rejected"

def submission_node(
    state: RecruiterState
):

    match_result = state[
        "match_result"
    ]

    assessment = state[
        "recruiter_assessment"
    ]

    # IDs come from application state, not LLM analysis
    result = submit_candidate(

        candidate_id=state["candidate_id"],

        job_id=state["job_id"],

        match_score=match_result[
            "match_score"
        ],

        recommendation=assessment[
            "recommendation"
        ],

        recruiter_notes=assessment[
            "reasoning"
        ]
    )

    return {
        "submission_result": result
    }


def email_node(
        state: RecruiterState
):
    result = create_email_draft(
        candidate=state["resume_analysis"],
        job=state["job_analysis"],
        match_result=state["match_result"],
        recruiter_assessment=state["recruiter_assessment"],
        submission=state["submission_result"],
        email_context=state.get("email_context") or {}
    )
    return {
        "email_result": result
    }
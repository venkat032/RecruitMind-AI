from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class RecruiterState(TypedDict):

    messages: Annotated[
        list,
        add_messages
    ]

    # IDs come from the API / database, never from the LLM
    candidate_id: int

    job_id: int

    resume_text: str

    resume_analysis: dict

    job_description: str

    job_analysis: dict

    match_result: dict

    recruiter_assessment: dict

    human_approval: bool

    submission_result: dict

    email_result: dict

    # Who the submission email is from / to. Set by the application when a
    # recruiter approves (never by the LLM): sender_name, sender_company,
    # recipient_name, recipient_email.
    email_context: dict
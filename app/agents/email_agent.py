from pydantic import BaseModel,Field
from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage
)
from app.tools.email_tools import (
    save_email_draft
)

class EmailDraft(BaseModel):

    subject: str = Field(
        description="Professional email subject"
    )

    body: str = Field(
        description="Professional candidate submission email"
    )

llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0.2
)

email_llm = llm.with_structured_output(EmailDraft)

def describe_people(email_context: dict) -> tuple[str, str]:
    """Greeting target and signature, from application data (never invented)."""

    recipient = email_context.get("recipient_name") or "the hiring team"

    sender = email_context.get("sender_name") or "the recruiting team"
    if email_context.get("sender_company"):
        sender = f"{sender}, {email_context['sender_company']}"

    return recipient, sender


def generate_submission_email(
    candidate: dict,
    job: dict,
    match_result: dict,
    recruiter_assessment: dict,
    submission: dict,
    email_context: dict | None = None
):
    recipient, sender = describe_people(email_context or {})

    prompt = f"""
    Generate a professional candidate submission email.

========================
RECIPIENT (hiring contact)
========================

{recipient}


========================
SENDER (the recruiter who approved this submission)
========================

{sender}

========================
CANDIDATE
========================

{candidate}


========================
JOB
========================

{job}


========================
MATCH RESULT
========================

{match_result}


========================
RECRUITER ASSESSMENT
========================

{recruiter_assessment}


========================
SUBMISSION
========================

{submission}

Create a concise professional email.

The email should:

1. Introduce the candidate.
2. Mention the position.
3. Mention the match score.
4. Highlight important strengths.
5. Mention relevant experience.
6. Keep the tone professional.
7. Do not invent information.
8. Do not exaggerate the candidate's experience.
9. Greet the RECIPIENT by name (e.g. "Dear Priya,"), or "Dear Hiring Team," if no name is given.
10. Sign off with the SENDER exactly as given.
11. The email must be ready to send: never use placeholders such as
    [Your Name], [Hiring Manager's Name] or [Company].
12. Keep the subject short and specific, e.g. "Candidate submission: <name> for <role>".
"""
    messages = [

        SystemMessage(
            content="""
You are a professional recruitment email writer.

Create clear, concise candidate submission emails.

Use only the information provided.
Never invent candidate qualifications.
Never output bracketed placeholders; every email must be ready to send as written.
"""
        ),

        HumanMessage(
            content=prompt
        )
    ]

    result = email_llm.invoke(
        messages
    )

    return result

def create_email_draft(
    candidate: dict,
    job: dict,
    match_result: dict,
    recruiter_assessment: dict,
    submission: dict,
    email_context: dict | None = None
):

    email_context = email_context or {}

    email = generate_submission_email(
        candidate=candidate,
        job=job,
        match_result=match_result,
        recruiter_assessment=recruiter_assessment,
        submission=submission,
        email_context=email_context
    )

    result = save_email_draft.invoke(
        {
            "submission_id": submission[
                "submission_id"
            ],

            "subject": email.subject,

            "body": email.body,

            # Address comes from the job record, never from the LLM
            "recipient_email": email_context.get("recipient_email")
        }
    )

    return result
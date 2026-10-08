from langchain_core.tools import tool

from app.database import crud


@tool
def save_email_draft(
    submission_id: int,
    subject: str,
    body: str,
    recipient_email: str | None = None
) -> dict:
    """
    Save an email draft for a candidate submission in PostgreSQL.

    This development version does not send an email.
    """

    draft = crud.create_email_draft(
        submission_id=submission_id,
        subject=subject,
        body=body,
        recipient_email=recipient_email
    )

    print("\nEMAIL DRAFT SAVED")
    print("=" * 50)

    print(f"Email Draft ID: {draft['id']}")

    print(f"Submission ID: {submission_id}")

    print(f"\nSubject:\n{subject}")

    print(f"\nBody:\n{body}")

    return {
        "email_draft_id": draft["id"],
        "submission_id": draft["submission_id"],
        "recipient_email": draft["recipient_email"],
        "email_status": draft["status"],
        "subject": draft["subject"],
        "body": draft["body"]
    }

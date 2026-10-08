"""
Step 41 end-to-end persistence test (real OpenAI + real PostgreSQL).

PDF Resume -> Candidate saved -> Resume text saved -> Job loaded from
PostgreSQL -> LangGraph -> Match -> Assessment -> Human approval ->
Submission saved -> Email draft saved -> verified with fresh queries.

Run:
    python -m app.graph.test_persistence_e2e
"""

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from langgraph.types import Command

from app.api.test_recruiter_upload import make_text_pdf
from app.database import crud
from app.database.models import create_tables
from app.graph.recruiter_graph import recruiter_graph
from app.api.deps import get_current_session
from app.main import app
from app.services.workflow_service import job_description_from_db


PROJECT_ROOT = Path(__file__).resolve().parents[2]

JOB_ID = 1

RESUME = (
    "Ananya Rao - AI Developer - "
    "Skills: Python, FastAPI, LangChain, LangGraph, PostgreSQL, Docker - "
    "Experience: 3 years building AI applications and REST APIs - "
    "Education: B.Tech Computer Science"
)


def test_end_to_end_persistence():

    create_tables()

    # 1. Candidate (found by email -> re-runs never create duplicates)
    candidate, created = crud.get_or_create_candidate(
        name="Ananya Rao",
        email="ananya.rao.e2e@example.com",
        location="Hyderabad",
    )
    print(f"\n1. Candidate {candidate['id']} ({'created' if created else 'existing'})")

    # 2. Upload the PDF through the real API and link it to the candidate
    #    (run as a signed-in recruiter; auth itself is tested in test_auth.py)
    app.dependency_overrides[get_current_session] = lambda: {"id": None, "email": "e2e@example.com"}
    response = TestClient(app).post(
        "/api/v1/recruiter/upload-resume",
        files={"file": ("resume.pdf", make_text_pdf(RESUME), "application/pdf")},
        data={"candidate_id": str(candidate["id"])},
    )
    assert response.status_code == 200, response.text
    print(f"2. Resume uploaded -> {response.json()['resume_file_path']}")

    # 3. Everything the graph needs comes from PostgreSQL
    candidate = crud.get_candidate(candidate["id"])
    job = crud.get_job(JOB_ID)
    assert candidate["resume_text"] == RESUME
    assert job is not None, f"Job {JOB_ID} missing - run: python -m app.database.seed"
    print(f"3. Loaded candidate + job {job['id']} ({job['title']}) from PostgreSQL")

    # 4. LangGraph until the human approval interrupt
    config = {"configurable": {"thread_id": f"e2e-candidate-{candidate['id']}-job-{job['id']}-{uuid4()}"}}

    result = recruiter_graph.invoke(
        {
            "messages": [],
            "candidate_id": candidate["id"],
            "job_id": job["id"],
            "resume_text": candidate["resume_text"],
            "resume_analysis": {},
            "job_description": job_description_from_db(job),
            "job_analysis": {},
            "match_result": {},
            "recruiter_assessment": {},
            "human_approval": False,
            "submission_result": {},
            "email_result": {},
        },
        config,
    )
    assert recruiter_graph.get_state(config).next == ("human_approval",)
    print(f"4. Paused for approval, match score {result['__interrupt__'][0].value['match_score']}")

    # 5. Human approves
    final = recruiter_graph.invoke(Command(resume=True), config)
    print("5. Approved -> submission + email agents ran")

    # 6. Verify with fresh queries
    submission = crud.get_submission(final["submission_result"]["submission_id"])
    draft = crud.get_email_draft(final["email_result"]["email_draft_id"])

    assert submission["candidate_id"] == candidate["id"]
    assert submission["job_id"] == job["id"]
    assert submission["match_score"] == final["match_result"]["match_score"]
    assert submission["status"] == "approved"
    assert submission["recruiter_recommendation"] == final["recruiter_assessment"]["recommendation"]

    assert draft["submission_id"] == submission["id"]
    assert draft["status"] == "draft"
    assert draft["subject"] and draft["body"]

    assert (PROJECT_ROOT / candidate["resume_file_path"]).exists()

    print("\nPOSTGRESQL STATE")
    print("=" * 60)
    print(f"candidates   id={candidate['id']} name={candidate['name']} email={candidate['email']}")
    print(f"             resume_file_path={candidate['resume_file_path']}")
    print(f"jobs         id={job['id']} title={job['title']} company={job['company']} location={job['location']}")
    print(f"submissions  id={submission['id']} candidate_id={submission['candidate_id']} "
          f"job_id={submission['job_id']} match_score={submission['match_score']} "
          f"status={submission['status']}")
    print(f"             recommendation={submission['recruiter_recommendation']}")
    print(f"email_drafts id={draft['id']} submission_id={draft['submission_id']} status={draft['status']}")
    print(f"             subject={draft['subject']}")

    print("\nEND-TO-END PERSISTENCE TEST PASSED")


if __name__ == "__main__":
    test_end_to_end_persistence()

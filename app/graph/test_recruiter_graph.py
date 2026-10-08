from pprint import pprint
from uuid import uuid4

from langgraph.types import Command

from app.graph.recruiter_graph import recruiter_graph
from app.database.connections import get_connections


resume = """
Rahul Kumar

AI Developer

Skills:
Python, FastAPI, LangChain, LangGraph, PostgreSQL, Docker

Experience:
2 years of experience building AI applications and APIs.

Education:
B.Tech Computer Science
"""


job = """
AI Developer

Company: TechNova
Location: Hyderabad

Required Skills:
Python, FastAPI, PostgreSQL, LangChain

Preferred Skills:
LangGraph, Docker

Experience:
2 years

Responsibilities:
Build AI applications.
Develop FastAPI services.
Work with PostgreSQL.
Build LLM based applications.
"""


def initial_state(candidate_id: int, job_id: int):

    return {
        "messages": [],

        "candidate_id": candidate_id,
        "job_id": job_id,

        "resume_text": resume,
        "resume_analysis": {},

        "job_description": job,
        "job_analysis": {},

        "match_result": {},
        "recruiter_assessment": {},

        "human_approval": False,

        "submission_result": {},
        "email_result": {},
    }


def count_submissions():

    conn = get_connections()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM submissions")
    count = cursor.fetchone()[0]

    cursor.close()
    conn.close()

    return count


def run_until_interrupt(config: dict):
    """
    First execution: runs Resume + Job (parallel),
    Matching, Score, then pauses at Human Approval.
    """

    result = recruiter_graph.invoke(
        initial_state(candidate_id=1, job_id=1),
        config
    )

    snapshot = recruiter_graph.get_state(config)

    print("\nPAUSED AT:", snapshot.next)

    print("\nINTERRUPT PAYLOAD")
    print("=" * 50)
    pprint(result["__interrupt__"][0].value)

    assert snapshot.next == ("human_approval",)

    return result


# ============================================================
# 1. APPROVE PATH
# ============================================================

def test_approve_path():

    print("\n" + "#" * 60)
    print("APPROVE PATH")
    print("#" * 60)

    config = {
        "configurable": {
            # Checkpoints persist in PostgreSQL: a fresh thread per run
            "thread_id": f"candidate-1-job-1-{uuid4()}"
        }
    }

    run_until_interrupt(config)

    # Resume the SAME thread with the human decision
    final = recruiter_graph.invoke(
        Command(resume=True),
        config
    )

    print("\nFINAL STATE")
    print("=" * 50)
    pprint({
        "candidate_id": final["candidate_id"],
        "job_id": final["job_id"],
        "resume_analysis": final["resume_analysis"],
        "job_analysis": final["job_analysis"],
        "match_result": final["match_result"],
        "recruiter_assessment": final["recruiter_assessment"],
        "human_approval": final["human_approval"],
        "submission_result": final["submission_result"],
        "email_result": final["email_result"],
    }, sort_dicts=False)

    snapshot = recruiter_graph.get_state(config)

    assert snapshot.next == ()
    assert final["human_approval"] is True
    assert final["submission_result"]["status"] == "approved"
    assert final["email_result"]["email_status"] == "draft"
    assert (
        final["email_result"]["submission_id"]
        == final["submission_result"]["submission_id"]
    )

    print("\nAPPROVE PATH PASSED - workflow reached END")


# ============================================================
# 2. REJECT PATH
# ============================================================

def test_reject_path():

    print("\n" + "#" * 60)
    print("REJECT PATH")
    print("#" * 60)

    config = {
        "configurable": {
            "thread_id": f"candidate-1-job-1-reject-{uuid4()}"
        }
    }

    run_until_interrupt(config)

    before = count_submissions()

    final = recruiter_graph.invoke(
        Command(resume=False),
        config
    )

    after = count_submissions()

    snapshot = recruiter_graph.get_state(config)

    print("\nhuman_approval:", final["human_approval"])
    print("submission_result:", final["submission_result"])
    print("email_result:", final["email_result"])
    print("submissions before/after:", before, after)

    assert snapshot.next == ()
    assert final["human_approval"] is False
    assert final["submission_result"] == {}
    assert final["email_result"] == {}
    assert before == after

    print("\nREJECT PATH PASSED - workflow ended without submission")


if __name__ == "__main__":

    test_approve_path()
    test_reject_path()

    print("\nALL STEP 39 TESTS PASSED")

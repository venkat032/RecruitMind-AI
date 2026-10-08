from langchain_core.tools import tool

from app.database import crud


@tool
def search_candidates(skill: str) -> str:
    """
    Search candidates based on a skill.
    """

    rows = crud.search_candidates(skill)

    if not rows:

        return "No candidates found."

    results = []

    for row in rows:

        results.append(
            {
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
                "location": row["location"],
                "skills": row["skills"],
                "experience": row["experience"],
            }
        )

    return str(results)


@tool
def get_candidate(candidate_id: int) -> str:
    """
    Retrieve complete candidate information.
    """

    row = crud.get_candidate(candidate_id)

    if not row:

        return "Candidate not found."

    return str(
        {
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "location": row["location"],
            "skills": row["skills"],
            "experience": row["experience"],
            "resume": row["resume_text"],
        }
    )

from langchain_core.tools import tool

from app.database import crud


@tool
def search_jobs(
    role: str,
    location: str
) -> str:
    """
    Search for jobs based on role and location.
    """

    rows = crud.search_jobs(role, location)

    if not rows:
        return "No jobs found."

    results = []

    for row in rows:
        results.append(
            {
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
                "location": row["location"],
                "salary": row["salary"],
                "skills": row["skills"],
            }
        )

    return str(results)


@tool
def get_job(job_id: int) -> str:
    """
    Retrieve complete information about a job.
    """

    row = crud.get_job(job_id)

    if not row:
        return "Job not found."

    return str(
        {
            "id": row["id"],
            "title": row["title"],
            "company": row["company"],
            "location": row["location"],
            "salary": row["salary"],
            "skills": row["skills"],
            "description": row["description"],
        }
    )

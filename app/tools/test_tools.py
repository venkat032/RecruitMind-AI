from app.tools.job_tools import (
    search_jobs,
    get_job
)

from app.tools.candidate_tools import (
    search_candidates,
    get_candidate
)


print(
    search_jobs.invoke(
        {
            "role": "AI",
            "location": "Hyderabad"
        }
    )
)


print(
    get_job.invoke(
        {
            "job_id": 1
        }
    )
)


print(
    search_candidates.invoke(
        {
            "skill": "Python"
        }
    )
)


print(
    get_candidate.invoke(
        {
            "candidate_id": 1
        }
    )
)
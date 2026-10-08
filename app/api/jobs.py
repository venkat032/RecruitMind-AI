from fastapi import APIRouter, HTTPException

from app.api.schemas import JobContactUpdate, JobCreate
from app.database import crud
from app.tools.job_tools import search_jobs,get_job

router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"]
)

@router.get("")
def list_jobs():
    return crud.list_jobs()


@router.post("", status_code=201)
def create_job(request: JobCreate):
    return crud.create_job(**request.model_dump())


@router.patch("/{job_id}/contact")
def update_contact(job_id: int, request: JobContactUpdate):

    try:
        return crud.update_job_contact(job_id, request.contact_name or None, request.contact_email)

    except crud.RecordNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/search")
def search(
    role:str,
    location:str
):
    result = search_jobs.invoke(
        {
            "role":role,
            "location":location
        }
    )

    return {
        "results":result
    }

@router.get("/{job_id}")
def get_job_details(
    job_id:int
):
    result = get_job.invoke(
        {
            "job_id":job_id
        }
    )
    return {
        "job":result
    }
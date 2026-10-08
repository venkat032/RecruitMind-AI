from fastapi import APIRouter, HTTPException

from app.api.schemas import CandidateCreate
from app.database import crud


router = APIRouter(
    prefix="/candidates",
    tags=["Candidates"]
)


@router.get("")
def list_candidates():
    return crud.list_candidates()


@router.get("/{candidate_id}")
def get_candidate(candidate_id: int):

    candidate = crud.get_candidate(candidate_id)

    if candidate is None:
        raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found.")

    return candidate


@router.post("", status_code=201)
def create_candidate(request: CandidateCreate):

    try:
        return crud.create_candidate(**request.model_dump())

    except crud.DuplicateRecordError as e:
        raise HTTPException(status_code=409, detail=str(e))

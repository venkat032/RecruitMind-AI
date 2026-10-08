from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from pydantic import BaseModel

from app.api.schemas import ResumeUploadResponse
from app.database.crud import RecordNotFoundError
from app.graph.graph import app
from app.services.resume_upload import process_resume_upload


router = APIRouter(
    prefix="/recruiter",
    tags=["Recruiter"]
)

class RecruiterRequest(BaseModel):
    message: str

@router.post("/chat")
def recruiter_chat(
    request:RecruiterRequest
):
    result = app.invoke(
        {
            "messages":[
                {
                    "role":"user",
                    "content":request.message
                }
            ]
        }
    )

    final_message = result[
        "messages"
    ][-1]

    return {
        "response": final_message.content
    }


@router.post(
    "/upload-resume",
    response_model=ResumeUploadResponse
)
async def upload_resume(
    file: UploadFile = File(...),
    # Optional: link the resume to an existing candidate in PostgreSQL
    candidate_id: int | None = Form(None)
):

    try:
        uploaded = await process_resume_upload(
            file,
            candidate_id=candidate_id
        )

    except RecordNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e)
        )

    # ResumeUploadError and ResumeParseError are both ValueErrors:
    # bad input from the client -> 400
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process resume: {e}"
        )

    finally:
        await file.close()

    return ResumeUploadResponse(
        message="Resume uploaded successfully.",
        file_id=uploaded.file_id,
        filename=uploaded.filename,
        resume_file_path=uploaded.resume_file_path,
        candidate_id=uploaded.candidate_id,
        text_length=len(uploaded.resume_text),
        resume_text=uploaded.resume_text
    )

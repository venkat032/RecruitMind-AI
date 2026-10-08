from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.database.crud import update_candidate_resume
from app.services.resume_parser import extract_resume_text


PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Project root -> data/resumes (independent of the working directory)
RESUME_DIR = PROJECT_ROOT / "data" / "resumes"

MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024

ALLOWED_CONTENT_TYPE = "application/pdf"


class ResumeUploadError(ValueError):
    """Raised when an uploaded resume fails validation."""


@dataclass
class UploadedResume:
    file_id: str
    filename: str
    file_path: Path
    resume_file_path: str
    resume_text: str
    candidate_id: int | None = None


def validate_content_type(file: UploadFile) -> None:

    if file.content_type != ALLOWED_CONTENT_TYPE:
        raise ResumeUploadError(
            "Only PDF resumes are supported."
        )


async def read_upload(file: UploadFile) -> bytes:

    # Read at most one byte past the limit, so oversized files are
    # detected without loading the whole upload into memory.
    contents = await file.read(MAX_RESUME_SIZE_BYTES + 1)

    if not contents:
        raise ResumeUploadError(
            "Uploaded file is empty."
        )

    if len(contents) > MAX_RESUME_SIZE_BYTES:
        raise ResumeUploadError(
            "Resume file must be smaller than 5 MB."
        )

    return contents


def save_resume(contents: bytes) -> tuple[str, Path]:

    RESUME_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    file_id = str(uuid4())

    file_path = RESUME_DIR / f"{file_id}.pdf"

    file_path.write_bytes(contents)

    return file_id, file_path


def to_stored_path(file_path: Path) -> str:
    """
    Path saved in PostgreSQL, relative to the project root
    (e.g. data/resumes/<uuid>.pdf) so it works on any machine / container.
    """

    try:
        return file_path.relative_to(PROJECT_ROOT).as_posix()

    except ValueError:
        return file_path.as_posix()


async def process_resume_upload(
    file: UploadFile,
    candidate_id: int | None = None
) -> UploadedResume:

    validate_content_type(file)

    contents = await read_upload(file)

    file_id, file_path = save_resume(contents)

    resume_file_path = to_stored_path(file_path)

    try:
        resume_text = extract_resume_text(
            str(file_path)
        )

        if candidate_id is not None:
            update_candidate_resume(
                candidate_id=candidate_id,
                resume_text=resume_text,
                resume_file_path=resume_file_path
            )

    except Exception:
        # Do not keep files we could not parse or link to a candidate
        file_path.unlink(
            missing_ok=True
        )
        raise

    return UploadedResume(
        file_id=file_id,
        filename=file_path.name,
        file_path=file_path,
        resume_file_path=resume_file_path,
        resume_text=resume_text,
        candidate_id=candidate_id
    )

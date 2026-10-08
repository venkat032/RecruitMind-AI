from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints



class RecruiterRequest(BaseModel):

    resume: str

    job_description: str


class RecruiterResponse(BaseModel):

    match_score: float

    matched_skills: list[str]

    missing_skills: list[str]

    experience_match: bool

    recommendation: str

    strengths: list[str]

    concerns: list[str]

    reasoning: str


class ResumeUploadResponse(BaseModel):

    message: str

    file_id: str

    filename: str

    resume_file_path: str

    candidate_id: int | None = None

    text_length: int

    resume_text: str


class CandidateCreate(BaseModel):

    name: str = Field(min_length=1, max_length=255)

    email: EmailStr

    location: str | None = Field(default=None, max_length=255)

    skills: str | None = None

    experience: int | None = Field(default=None, ge=0, le=60)


class JobCreate(BaseModel):

    title: str = Field(min_length=1, max_length=255)

    company: str = Field(min_length=1, max_length=255)

    location: str | None = Field(default=None, max_length=255)

    salary: int | None = Field(default=None, ge=0)

    skills: str | None = None

    description: str | None = None

    # Hiring contact: submission emails for this job are addressed to them
    contact_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None

    contact_email: EmailStr


class JobContactUpdate(BaseModel):

    contact_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None

    contact_email: EmailStr


class EmailSent(BaseModel):

    # Which client the recruiter used to send it (for the audit trail)
    via: Literal["gmail", "outlook", "mail_app", "other"]


class WorkflowStart(BaseModel):

    candidate_id: int

    job_id: int


Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class WorkflowDecision(BaseModel):

    approved: bool

    note: Note | None = None


class ApprovalDecision(BaseModel):

    approved: bool

    note: Note | None = None


class BulkDecision(BaseModel):

    ids: list[int] = Field(min_length=1, max_length=100)

    approved: bool

    note: Note | None = None


class ScreenRequest(BaseModel):

    job_id: int

    candidate_ids: list[int] = Field(min_length=1, max_length=50)


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=255)]


class RegisterRequest(BaseModel):

    full_name: Name

    email: EmailStr

    company: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None

    # Policy (length, common passwords, ...) is enforced in auth_service
    password: str = Field(min_length=1, max_length=128)


class LoginRequest(BaseModel):

    email: EmailStr

    password: str = Field(min_length=1, max_length=128)

    remember_me: bool = False

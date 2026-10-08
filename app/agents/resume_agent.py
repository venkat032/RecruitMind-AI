from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel, Field

class ResumeAnalysis(BaseModel):

    name: str = Field(
        description="Candidate full name"
    )

    skills: list[str] = Field(
        description="Technical and professional skills"
    )

    experience_years: float = Field(
        description="Total years of professional experience"
    )

    education: list[str] = Field(
        description="Educational qualifications"
    )

    summary: str = Field(
        description="Short professional summary"
    )

llm = ChatOpenAI(
    model_name="gpt-4o-mini",
    temperature=0.2)

resume_llm = llm.with_structured_output(
    ResumeAnalysis
)

def analyze_resume(
    resume_text: str
) -> ResumeAnalysis:

    messages = [

        SystemMessage(
            content="""
You are an expert technical recruiter.

Analyze the candidate resume and extract
accurate structured information.

Do not invent information that is not present
in the resume.
"""
        ),

        HumanMessage(
            content=resume_text
        )
    ]

    result = resume_llm.invoke(
        messages
    )

    return result
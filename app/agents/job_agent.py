from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel, Field

class JobAnalysis(BaseModel):

    title: str = Field(
        description=(
            "Exact job title/role name as written in the "
            "job description, e.g. 'AI Developer'"
        )
    )
    company: str = Field(
        description="Company name")
    location: str = Field(
        description="Job location"
    )

    required_skills: list[str] = Field(
        description="Mandatory skills required for the job"
    )

    preferred_skills: list[str] = Field(
        description="Preferred or nice-to-have skills"
    )

    experience_years: float = Field(
        description="Required years of experience"
    )

    responsibilities: list[str] = Field(
        description="Main responsibilities"
    )
llm = ChatOpenAI(
    model_name="gpt-4o-mini",
    temperature=0.2)

job_llm = llm.with_structured_output(
    JobAnalysis)

def analyze_job(
    job_description: str
) -> JobAnalysis:
    messages = [
        SystemMessage(
            content="""
You are an expert technical recruiter.
Analyze the job description and extract accurate structured information.
The title is the role name from the job description (usually the first line).
Separate required skills from preferred skills.
Do not invent information that is not present in the job description.
"""),
        HumanMessage(
            content=job_description
        )
    ]
    result = job_llm.invoke(
        messages)
    return result

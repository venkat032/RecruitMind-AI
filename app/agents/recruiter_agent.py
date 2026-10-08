from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

from app.tools.job_tools import search_jobs, get_job
from app.tools.candidate_tools import search_candidates, get_candidate

load_dotenv()

tools = [
    search_jobs,
    get_job,
    search_candidates,
    get_candidate
]

llm = ChatOpenAI(
    model_name="gpt-4o-mini",
    temperature=0.2)

SYSTEM_PROMPT = """
    You are an AI Recruiter Assistant
    Your responsibilities are:
    1. Search jobs when the user asks about jobs.
2. Get complete job details when a job ID is provided.
3. Search candidates when the user asks for candidates.
4. Get candidate details when a candidate ID is provided.
5. Never invent job or candidate information.
6. Use tools whenever database information is required.
7. Clearly explain the results to the user.
8. Keep responses concise and professional.

"""

recruiter_llm = llm.bind_tools(tools)

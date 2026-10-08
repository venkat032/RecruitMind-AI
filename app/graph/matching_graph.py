from langgraph.graph import (
    StateGraph,
    START,
    END
)

from app.graph.state import RecruiterState
from app.graph.nodes import (
    resume_node,
    job_node,
    matching_node,
    score_node,
    human_approval_node,
    approval_router,
    submission_node,
    email_node
)
from langgraph.checkpoint.memory import MemorySaver

builder = StateGraph(
    RecruiterState
)


builder.add_node(
    "resume_agent",
    resume_node
)


builder.add_node(
    "job_agent",
    job_node
)


builder.add_node(
    "matching_agent",
    matching_node
)

builder.add_node(
    "score_agent",
    score_node
)

builder.add_node(
    "human_approval",
    human_approval_node
)
builder.add_node(
    "submission_agent",
    submission_node
)

builder.add_node(
    "email_agent",
    email_node
)

builder.add_edge(
    START,
    "resume_agent"
)


builder.add_edge(
    START,
    "job_agent"
)


builder.add_edge(
    "resume_agent",
    "matching_agent"
)


builder.add_edge(
    "job_agent",
    "matching_agent"
)

builder.add_edge(
    "matching_agent",
    "score_agent"
)

builder.add_edge(
    "score_agent",
    "human_approval"
)

builder.add_conditional_edges(
    "human_approval",
    approval_router,
    {
        "approved": "submission_agent",
        "rejected": END
    }
)
builder.add_edge(
    "submission_agent",
    "email_agent"
)

builder.add_edge(
    "email_agent",
    END
)
checkpointer = MemorySaver()
matching_graph = builder.compile(
    checkpointer=checkpointer
)
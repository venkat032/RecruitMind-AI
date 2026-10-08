import atexit

from dotenv import load_dotenv

from langgraph.graph import (
    StateGraph,
    START,
    END
)

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.database.connections import database_conninfo
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

load_dotenv()


builder = StateGraph(
    RecruiterState
)


# ============================================================
# 1. Nodes
# ============================================================

builder.add_node("resume_agent", resume_node)

builder.add_node("job_agent", job_node)

builder.add_node("matching_agent", matching_node)

builder.add_node("score_agent", score_node)

builder.add_node("human_approval", human_approval_node)

builder.add_node("submission_agent", submission_node)

builder.add_node("email_agent", email_node)


# ============================================================
# 2. Parallel branches from START
#
# Resume Agent and Job Agent run in the same superstep.
# ============================================================

builder.add_edge(START, "resume_agent")

builder.add_edge(START, "job_agent")


# ============================================================
# 3. Join
#
# A list of sources makes Matching wait until BOTH
# Resume Agent and Job Agent have finished.
# ============================================================

builder.add_edge(
    ["resume_agent", "job_agent"],
    "matching_agent"
)


# ============================================================
# 4. Matching -> Score -> Human Approval
# ============================================================

builder.add_edge("matching_agent", "score_agent")

builder.add_edge("score_agent", "human_approval")


# ============================================================
# 5. Human-in-the-loop routing
# ============================================================

builder.add_conditional_edges(
    "human_approval",
    approval_router,
    {
        "approved": "submission_agent",
        "rejected": END
    }
)


# ============================================================
# 6. Submission -> Email -> END
# ============================================================

builder.add_edge("submission_agent", "email_agent")

builder.add_edge("email_agent", END)


# ============================================================
# 7. Compile with checkpointing
#
# The checkpointer saves state at the interrupt so the
# graph can be resumed later with the same thread_id.
#
# Checkpoints live in PostgreSQL, so a candidate waiting in the
# approval queue survives server restarts and deployments.
# ============================================================

# Same connection settings as the rest of the app:
# DATABASE_URL in production (Render), POSTGRES_* locally.
checkpoint_pool = ConnectionPool(
    database_conninfo(),
    min_size=1,
    max_size=10,
    # settings required by PostgresSaver
    kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    open=True,
)

atexit.register(checkpoint_pool.close)

checkpointer = PostgresSaver(checkpoint_pool)

# Creates/migrates LangGraph's own checkpoint tables (idempotent)
checkpointer.setup()

recruiter_graph = builder.compile(
    checkpointer=checkpointer
)

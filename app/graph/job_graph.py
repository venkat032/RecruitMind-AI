from langgraph.graph import (
    StateGraph,
    START,
    END
)

from app.graph.state import RecruiterState

from app.graph.nodes import job_node


builder = StateGraph(
    RecruiterState
)


builder.add_node(
    "job_agent",
    job_node
)


builder.add_edge(
    START,
    "job_agent"
)


builder.add_edge(
    "job_agent",
    END
)


job_graph = builder.compile()
from langgraph.graph import (
    StateGraph,
    START,
    END
)

from app.graph.state import RecruiterState

from app.graph.nodes import resume_node


builder = StateGraph(
    RecruiterState
)


builder.add_node(
    "resume_agent",
    resume_node
)


builder.add_edge(
    START,
    "resume_agent"
)


builder.add_edge(
    "resume_agent",
    END
)


resume_graph = builder.compile()
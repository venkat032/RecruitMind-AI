from langgraph.graph import (
    StateGraph,
    START,
    END
)

from langgraph.prebuilt import tools_condition

from app.graph.state import RecruiterState
from app.graph.nodes import recruiter_node, tool_node


graph = StateGraph(RecruiterState)

graph.add_node("recruiter",recruiter_node)
graph.add_node("tools",tool_node)

graph.add_edge(START,"recruiter")
graph.add_conditional_edges(
    "recruiter",
    tools_condition
)

graph.add_edge("tools","recruiter")
graph.add_edge("recruiter",END)

app = graph.compile() 
from langgraph.types import Command

from app.graph.matching_graph import (
    matching_graph
)


config = {
    "configurable": {
        "thread_id": "candidate-1"
    }
}


result = matching_graph.invoke(
    Command(
        resume=True
    ),
    config
)


print("\nWORKFLOW RESULT")
print("=" * 50)

print(
    result.get(
        "submission_result"
    )
)
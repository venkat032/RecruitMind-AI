"""
Shared pytest setup.

API routes now require a signed-in user. Tests that are about other
features run as a fake signed-in recruiter; test modules that exercise
authentication itself set REAL_AUTH = True to use the real check.
"""

import pytest

from app.api.deps import get_current_session
from app.main import app


TEST_SESSION = {
    "session_id": 0,
    "id": None,  # no users row: "requested_by" / "decided_by" stay NULL
    "email": "pytest@example.com",
    "full_name": "Pytest Recruiter",
    "company": None,
    "role": "recruiter",
    "last_login_at": None,
    "created_at": None,
}


@pytest.fixture(autouse=True)
def signed_in(request):

    if getattr(request.module, "REAL_AUTH", False):
        yield
        return

    app.dependency_overrides[get_current_session] = lambda: TEST_SESSION
    yield
    app.dependency_overrides.pop(get_current_session, None)

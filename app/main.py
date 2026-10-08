from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.approvals import router as approvals_router
from app.api.auth import router as auth_router
from app.api.candidates import router as candidates_router
from app.api.deps import get_current_session
from app.api.jobs import router as jobs_router
from app.api.recruiter import router as recruiter_router
from app.api.routes import router
from app.api.submissions import router as submissions_router
from app.api.workflows import router as workflows_router
from app.database.models import create_tables
from app.services.workflow_service import recover_interrupted_work


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Create / migrate the schema (idempotent), so a fresh database
    # (e.g. a new Render Postgres) works on first boot
    create_tables()
    # Reconcile approval requests that were mid-run when the server stopped
    recover_interrupted_work()
    yield


app = FastAPI(
    title = "RecruitMind AI",
    description="FastAPI + LangGraph AI Recruiter",
    version="1.0.0",
    lifespan=lifespan
)


# Public: sign up / sign in
app.include_router(
    auth_router,
    prefix="/api/v1"
)

# Everything else requires a signed-in user
PROTECTED = [Depends(get_current_session)]

app.include_router(
    jobs_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)
app.include_router(
    recruiter_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)
app.include_router(
    candidates_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)
app.include_router(
    submissions_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)
app.include_router(
    workflows_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)
app.include_router(
    approvals_router,
    prefix="/api/v1",
    dependencies=PROTECTED
)

app.include_router(
    router,
    dependencies=PROTECTED
)


# ============================================================
# Security headers
# ============================================================

FRONTEND_CSP = "; ".join([
    "default-src 'self'",
    # the tiny inline script in index.html applies the saved theme before paint
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


@app.middleware("http")
async def security_headers(request: Request, call_next):

    response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    if request.url.path.startswith("/app"):
        response.headers["Content-Security-Policy"] = FRONTEND_CSP

    if request.url.path.startswith("/api/v1/auth"):
        response.headers["Cache-Control"] = "no-store"

    return response


@app.get("/", include_in_schema=False)
def root():
    # Visitors to the bare domain land on the website when it is built
    if FRONTEND_DIST.is_dir():
        return RedirectResponse("/app/")

    return {
        "message": "AI Recruiter API is running"
    }

@app.get("/health")
def health():
    return {
        "status": "healthy"

    }


# ============================================================
# Frontend (built with: cd frontend; npm run build)
# ============================================================

FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"

if FRONTEND_DIST.is_dir():

    app.mount(
        "/app",
        StaticFiles(directory=FRONTEND_DIST, html=True),
        name="frontend"
    )

    @app.get("/app", include_in_schema=False)
    def frontend_root():
        return RedirectResponse("/app/")

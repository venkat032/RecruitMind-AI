<p align="center">
  <img src="frontend/public/brand/wordmark-light.png" alt="RecruitMind AI" width="360" />
</p>

<p align="center">
  <b>Agentic AI recruiting: screen candidates in seconds, with a human in the loop.</b><br/>
  FastAPI · LangGraph · OpenAI GPT-4o mini · PostgreSQL · React
</p>

---

RecruitMind AI gives recruiters a team of cooperating AI agents. They read a PDF resume,
decode the job description, score the match with **transparent, deterministic math**, write a
recruiter assessment, and pause for **human approval**. On approval they record the submission
and draft a ready-to-send email to the job's hiring contact.

## Features

- **Seven-step agent workflow (LangGraph):** Resume Agent and Job Agent run in parallel, then
  Matching, Assessment, Human Approval, Submission and Email.
- **Explainable scoring:** 70% skills + 30% experience, calculated in Python. The LLM explains
  the score but can never change it.
- **Approval queue:** batch-screen many candidates for a job, then review, approve or reject
  them individually or in bulk, with decision notes, an audit trail and a 24h review target.
- **Durable workflows:** LangGraph checkpoints are stored in PostgreSQL, so paused approvals
  survive restarts. Interrupted runs are recovered on startup.
- **Email hand-off:** personalised drafts addressed to the job's hiring contact, opened in
  Gmail, Outlook or the default mail app, then marked as sent.
- **Match Studio:** watch each agent finish live (NDJSON streaming).
- **Copilot:** a tool-calling agent that answers questions from the database.
- **Authentication:** Argon2id password hashing, revocable server-side sessions in HttpOnly
  SameSite cookies, account lockout, rate limiting, CSRF origin checks and an audit log.
- **Premium React UI:** landing page, dark and light themes, responsive layout.

## Architecture

```text
React (Vite) ──► FastAPI ──► LangGraph recruiter graph ──► PostgreSQL
                    │              │                         ▲
                    │              ├─ Resume Agent ┐         │ checkpoints,
                    │              ├─ Job Agent    ┘ parallel│ candidates, jobs,
                    │              ├─ Matching (Python)      │ submissions,
                    │              ├─ Assessment             │ approval queue,
                    │              ├─ Human Approval (interrupt)  users, sessions
                    │              ├─ Submission (tool) ─────┤
                    │              └─ Email (tool) ──────────┘
                    └─ auth, uploads, approvals, submissions APIs
```

Agents never write SQL: **Agent → Tool → `app/database/crud.py` → PostgreSQL**.
Candidate and job IDs always come from the database, never from the model.

## Project structure

```text
app/
  main.py              FastAPI app, routers, security headers, startup recovery
  agents/              Resume, Job, Matching, Score, Submission, Email, Recruiter agents
  graph/               LangGraph state, nodes, recruiter graph (Postgres checkpointer)
  tools/               LangChain tools used by the agents
  services/            Auth, workflow orchestration, resume upload/parsing, rate limiting
  database/            Connection, schema migrations, CRUD (core, auth, approvals), seed
  api/                 Routers: auth, candidates, jobs, approvals, workflows, submissions
frontend/              React + TypeScript + Vite app (served by FastAPI at /app)
data/resumes/          Uploaded PDFs (git-ignored)
```

## Getting started

### Prerequisites

- Python 3.12
- Node.js 20+
- PostgreSQL 14+
- An OpenAI API key

### 1. Configure

```bash
cp .env.example .env        # then edit .env with your own values
```

### 2. Backend

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

python -m app.database.seed  # creates/migrates all tables and adds sample data (safe to re-run)
```

### 3. Frontend

```bash
cd frontend
npm install
npm run build                # FastAPI serves the build at /app
cd ..
```

### 4. Run

```bash
uvicorn app.main:app --reload
```

| URL | What |
| --- | --- |
| http://127.0.0.1:8000/app/ | Web app (landing page, sign up, dashboard) |
| http://127.0.0.1:8000/docs | Swagger API docs |

The **first account you register becomes the workspace admin.**

**Frontend development with hot reload:** keep uvicorn running, then run `cd frontend && npm run dev`
and open http://localhost:5173/app/. API calls are proxied to port 8000.

## Tests

```bash
pip install -r requirements-dev.txt

# Fast suite: real PostgreSQL, no OpenAI calls
python -m pytest app/api app/database -v

# End-to-end with the real agents (uses your OpenAI key)
python -m app.graph.test_persistence_e2e
python -m app.graph.test_recruiter_graph
```

Tests create and delete their own records. Use a development database, not production.

## Security notes

- Secrets live only in `.env` (git-ignored). Copy `.env.example` to get started.
- Passwords are hashed with Argon2id. Session tokens are random, stored only as SHA-256 hashes,
  and revocable.
- All `/api/v1` routes except `/auth/*` require sign-in.
- In production, serve over HTTPS (cookies become `Secure` automatically, or set
  `SESSION_COOKIE_SECURE=true` behind a TLS proxy) and use a shared store such as Redis for rate
  limiting if you run more than one process.

## Roadmap

- Role-based permissions (admin vs recruiter)
- Password reset via email
- Background job queue (e.g. Celery) for large batch screenings
- OCR for scanned resumes
- Docker deployment

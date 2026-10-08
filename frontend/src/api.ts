import type {
  Approval,
  ApprovalDetail,
  ApprovalSummary,
  BulkResult,
  CandidateForJob,
  EmailClient,
  ScreenResult,
  User,
  Candidate,
  Job,
  Submission,
  SubmissionDetails,
  UploadResult,
  WorkflowEvent,
} from "./types";

const BASE = "/api/v1";

/** Fired after screenings/decisions so the sidebar's pending badge refreshes at once. */
export const APPROVALS_CHANGED_EVENT = "rm:approvals-changed";

export function approvalsChanged() {
  window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
}

/** Fired when the server says the session is gone, so the app can show sign-in. */
export const UNAUTHORIZED_EVENT = "rm:unauthorized";

function checkSession(response: Response, path: string) {
  if (response.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;

  try {
    const body = await response.json();
    const detail = body?.detail;

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length) {
      // FastAPI validation errors
      message = detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = d.loc?.[d.loc.length - 1];
          return field ? `${String(field)}: ${d.msg}` : d.msg;
        })
        .join(" · ");
    }
  } catch {
    /* non-JSON error body */
  }

  return new ApiError(message, response.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path.startsWith("/health") ? path : `${BASE}${path}`, init);
  } catch {
    throw new ApiError("Cannot reach the RecruitMind API. Is uvicorn running?", 0);
  }

  checkSession(response, path);
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * POST and read an NDJSON stream, calling onEvent for every line
 * as soon as the backend flushes it (one event per finished agent).
 */
async function streamEvents(
  path: string,
  body: unknown,
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the RecruitMind API. Is uvicorn running?", 0);
  }

  checkSession(response, path);
  if (!response.ok || !response.body) throw await errorFrom(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as WorkflowEvent);
    }

    if (done) break;
  }

  if (buffer.trim()) onEvent(JSON.parse(buffer) as WorkflowEvent);
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  me: () => request<User>("/auth/me"),
  login: (body: { email: string; password: string; remember_me: boolean }) => postJson<User>("/auth/login", body),
  register: (body: { full_name: string; email: string; company?: string | null; password: string }) =>
    postJson<User>("/auth/register", body),
  logout: () => postJson<void>("/auth/logout", {}),
  logoutAll: () => postJson<void>("/auth/logout-all", {}),

  candidates: () => request<Candidate[]>("/candidates"),
  candidate: (id: number) => request<Candidate>(`/candidates/${id}`),
  createCandidate: (body: {
    name: string;
    email: string;
    location?: string | null;
    skills?: string | null;
    experience?: number | null;
  }) => postJson<Candidate>("/candidates", body),

  jobs: () => request<Job[]>("/jobs"),
  createJob: (body: {
    title: string;
    company: string;
    location?: string | null;
    salary?: number | null;
    skills?: string | null;
    description?: string | null;
    contact_name?: string | null;
    contact_email: string;
  }) => postJson<Job>("/jobs", body),
  updateJobContact: (jobId: number, body: { contact_name?: string | null; contact_email: string }) =>
    request<Job>(`/jobs/${jobId}/contact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  submissions: () => request<Submission[]>("/submissions"),
  submission: (id: number) => request<SubmissionDetails>(`/submissions/${id}`),
  markEmailSent: (submissionId: number, draftId: number, via: EmailClient) =>
    postJson<SubmissionDetails>(`/submissions/${submissionId}/email-drafts/${draftId}/sent`, { via }),

  uploadResume: (file: File, candidateId?: number) => {
    const form = new FormData();
    form.append("file", file);
    if (candidateId != null) form.append("candidate_id", String(candidateId));

    return request<UploadResult>("/recruiter/upload-resume", { method: "POST", body: form });
  },

  chat: (message: string) => postJson<{ response: string }>("/recruiter/chat", { message }),

  runWorkflow: (candidateId: number, jobId: number, onEvent: (e: WorkflowEvent) => void) =>
    streamEvents("/workflows/run", { candidate_id: candidateId, job_id: jobId }, onEvent),

  decide: (threadId: string, approved: boolean, onEvent: (e: WorkflowEvent) => void, note?: string) =>
    streamEvents(`/workflows/${encodeURIComponent(threadId)}/decision`, { approved, note: note || null }, onEvent),

  approvals: (status?: string) =>
    request<Approval[]>(`/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  approvalSummary: () => request<ApprovalSummary>("/approvals/summary"),
  approval: (id: number) => request<ApprovalDetail>(`/approvals/${id}`),
  candidatesForJob: (jobId: number) => request<CandidateForJob[]>(`/approvals/candidates-for-job/${jobId}`),
  screen: (jobId: number, candidateIds: number[]) =>
    postJson<ScreenResult>("/approvals/screen", { job_id: jobId, candidate_ids: candidateIds }),
  decideApproval: (id: number, approved: boolean, note?: string) =>
    postJson<Approval>(`/approvals/${id}/decision`, { approved, note: note || null }),
  bulkDecide: (ids: number[], approved: boolean, note?: string) =>
    postJson<BulkResult>("/approvals/bulk-decision", { ids, approved, note: note || null }),
};

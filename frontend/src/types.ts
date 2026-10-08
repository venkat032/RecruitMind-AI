export interface User {
  id: number;
  email: string;
  full_name: string;
  company: string | null;
  role: "admin" | "recruiter";
  last_login_at: string | null;
  created_at: string;
}

export interface Candidate {
  id: number;
  name: string;
  email: string | null;
  location: string | null;
  skills: string | null;
  experience: number | null;
  resume_file_path: string | null;
  created_at: string;
  updated_at: string;
  has_resume?: boolean;
  submission_count?: number;
  resume_text?: string | null;
}

export interface Job {
  id: number;
  title: string;
  company: string;
  location: string | null;
  salary: number | null;
  skills: string | null;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
  submission_count?: number;
}

export interface Submission {
  id: number;
  candidate_id: number;
  job_id: number;
  match_score: number;
  status: string;
  recruiter_recommendation: string | null;
  recruiter_notes: string | null;
  created_at: string;
  updated_at: string;
  candidate_name: string;
  candidate_email: string | null;
  job_title: string;
  job_company: string;
  job_location: string | null;
  job_contact_name: string | null;
  job_contact_email: string | null;
  email_draft_count: number;
  email_status: EmailDraftStatus | null;
}

export type EmailDraftStatus = "draft" | "sent";

export type EmailClient = "gmail" | "outlook" | "mail_app" | "other";

export interface EmailDraft {
  id: number;
  submission_id: number;
  subject: string;
  body: string;
  status: EmailDraftStatus;
  recipient_email: string | null;
  sent_at: string | null;
  sent_via: EmailClient | null;
  sent_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionDetails extends Submission {
  email_drafts: EmailDraft[];
}

export interface UploadResult {
  message: string;
  file_id: string;
  filename: string;
  resume_file_path: string;
  candidate_id: number | null;
  text_length: number;
  resume_text: string;
}

/* ---------- LangGraph state pieces ---------- */

export interface ResumeAnalysis {
  name: string;
  skills: string[];
  experience_years: number;
  education: string[];
  summary: string;
}

export interface JobAnalysis {
  title: string;
  company: string;
  location: string;
  required_skills: string[];
  preferred_skills: string[];
  experience_years: number;
  responsibilities: string[];
}

export interface MatchResult {
  matched_skills: string[];
  missing_skills: string[];
  experience_match: boolean;
  match_score: number;
  skill_score: number;
  experience_score: number;
  recommendation: string;
}

export interface Assessment {
  recommendation: string;
  strengths: string[];
  concerns: string[];
  reasoning: string;
}

export interface SubmissionResult {
  submission_id: number;
  status: string;
}

export interface EmailResult {
  email_draft_id: number;
  submission_id: number;
  recipient_email: string | null;
  email_status: string;
  subject: string;
  body: string;
}

export type NodeId =
  | "resume_agent"
  | "job_agent"
  | "matching_agent"
  | "score_agent"
  | "human_approval"
  | "submission_agent"
  | "email_agent";

export type WorkflowEvent =
  | { type: "started"; thread_id: string; candidate_id: number; job_id: number }
  | { type: "node"; node: NodeId; data: Record<string, unknown> }
  | { type: "interrupt"; thread_id: string; payload: Record<string, unknown> }
  | {
      type: "complete";
      thread_id: string;
      approved: boolean;
      submission_result: SubmissionResult | Record<string, never>;
      email_result: EmailResult | Record<string, never>;
    }
  | { type: "error"; message: string };

/* ---------- approval queue ---------- */

export type ApprovalStatus = "screening" | "pending" | "deciding" | "approved" | "rejected" | "failed";

export interface Approval {
  id: number;
  thread_id: string;
  candidate_id: number;
  job_id: number;
  status: ApprovalStatus;
  source: "studio" | "batch";
  match_score: number | null;
  recommendation: string | null;
  error: string | null;
  decision_note: string | null;
  submission_id: number | null;
  email_draft_id: number | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  candidate_name: string;
  candidate_email: string | null;
  job_title: string;
  job_company: string;
  job_location: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
}

export interface ApprovalDetail extends Approval {
  analysis: {
    resume_analysis?: Partial<ResumeAnalysis>;
    job_analysis?: Partial<JobAnalysis>;
    match_result?: Partial<MatchResult>;
    recruiter_assessment?: Partial<Assessment>;
  } | null;
}

export interface ApprovalSummary {
  counts: Partial<Record<ApprovalStatus, number>>;
  oldest_pending: string | null;
}

export interface CandidateForJob extends Candidate {
  open_request: ApprovalStatus | null;
}

export interface ScreenResult {
  job_id: number;
  queued: { candidate_id: number; name: string; thread_id: string }[];
  skipped: { candidate_id: number; name?: string; reason: string }[];
}

export interface BulkResult {
  succeeded: number;
  failed: number;
  results: { id: number; ok: boolean; status?: string; error?: string }[];
}

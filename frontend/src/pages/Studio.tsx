import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Briefcase,
  Check,
  CircleCheck,
  CircleX,
  GraduationCap,
  Hand,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  TriangleAlert,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { api, approvalsChanged } from "../api";
import { idlePipeline, Pipeline, type NodeStatus, type PipelineState } from "../components/Pipeline";
import { EmailActions } from "../components/EmailActions";
import { useToast } from "../components/Toasts";
import { Avatar, CompanyLogo, ErrorBox, Meter, PageHeader, ScoreRing, Skeleton } from "../components/ui";
import { navigate, recommendationTone, useAsync } from "../lib";
import type {
  Assessment,
  Candidate,
  EmailResult,
  Job,
  JobAnalysis,
  MatchResult,
  NodeId,
  ResumeAnalysis,
  SubmissionResult,
  WorkflowEvent,
} from "../types";

type Phase = "idle" | "running" | "awaiting" | "deciding" | "complete" | "error";

interface RunData {
  threadId?: string;
  resume?: ResumeAnalysis;
  job?: JobAnalysis;
  match?: MatchResult;
  assessment?: Assessment;
  approved?: boolean;
  submission?: SubmissionResult;
  email?: EmailResult;
}

interface LogEntry {
  at: number;
  text: string;
  tone?: "success" | "warning" | "danger";
}

const toId = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);

/* ---------------- pipeline state transitions (pure) ---------------- */

function setNodes(state: PipelineState, ids: NodeId[], status: NodeStatus, now: number): PipelineState {
  const next = { ...state };
  for (const id of ids) {
    const prev = next[id];
    next[id] =
      status === "running"
        ? { status, startedAt: now }
        : { status, startedAt: prev.startedAt, ms: prev.startedAt ? now - prev.startedAt : undefined };
  }
  return next;
}

/** Mark a node finished and start whatever LangGraph runs next. */
function advance(state: PipelineState, id: NodeId, now: number): PipelineState {
  let next = setNodes(state, [id], "done", now);

  if ((id === "resume_agent" || id === "job_agent") && next.resume_agent.status === "done" && next.job_agent.status === "done") {
    next = setNodes(next, ["matching_agent"], "running", now);
  }
  if (id === "matching_agent") next = setNodes(next, ["score_agent"], "running", now);
  if (id === "submission_agent") next = setNodes(next, ["email_agent"], "running", now);

  return next;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);

  return now;
}

/* ================================================================== */

export default function Studio({ params }: { params: URLSearchParams }) {
  const toast = useToast();
  const candidates = useAsync(() => api.candidates());
  const jobs = useAsync(() => api.jobs());

  const [candidateId, setCandidateId] = useState<number | null>(toId(params.get("candidate")));
  const [jobId, setJobId] = useState<number | null>(toId(params.get("job")));

  const [phase, setPhase] = useState<Phase>("idle");
  const [pipe, setPipe] = useState<PipelineState>(idlePipeline);
  const [run, setRun] = useState<RunData>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string>();
  const [startedAt, setStartedAt] = useState<number>();
  const [finishedAt, setFinishedAt] = useState<number>();

  const busy = phase === "running" || phase === "deciding";
  const locked = busy || phase === "awaiting";
  const now = useNow(busy);
  const elapsed = startedAt ? ((finishedAt ?? now) - startedAt) / 1000 : 0;

  const candidate = candidates.data?.find((c) => c.id === candidateId);
  const job = jobs.data?.find((j) => j.id === jobId);
  const canRun = !!candidate?.has_resume && !!job && !locked;

  const addLog = (text: string, tone?: LogEntry["tone"]) => setLog((l) => [...l, { at: Date.now(), text, tone }]);

  const reset = () => {
    setPhase("idle");
    setPipe(idlePipeline());
    setRun({});
    setLog([]);
    setError(undefined);
    setStartedAt(undefined);
    setFinishedAt(undefined);
  };

  /* -------- stream event handling -------- */

  const handle = (event: WorkflowEvent) => {
    const t = Date.now();

    switch (event.type) {
      case "started":
        setRun((r) => ({ ...r, threadId: event.thread_id }));
        addLog(`Workflow started · ${event.thread_id.slice(0, 13)}…`);
        break;

      case "node": {
        const data = event.data;

        if (event.node === "human_approval") {
          // Already reflected optimistically when the user clicked
          break;
        }

        setPipe((p) => advance(p, event.node, t));

        if (event.node === "resume_agent") {
          const resume = data.resume_analysis as ResumeAnalysis;
          setRun((r) => ({ ...r, resume }));
          addLog(`Resume analysed · ${resume.skills.length} skills, ${resume.experience_years} yrs experience`);
        } else if (event.node === "job_agent") {
          const jobAnalysis = data.job_analysis as JobAnalysis;
          setRun((r) => ({ ...r, job: jobAnalysis }));
          addLog(`Role parsed · ${jobAnalysis.required_skills.length} required skills`);
        } else if (event.node === "matching_agent") {
          const match = data.match_result as MatchResult;
          setRun((r) => ({ ...r, match }));
          addLog(`Deterministic match score · ${match.match_score}%`, "success");
        } else if (event.node === "score_agent") {
          const assessment = data.recruiter_assessment as Assessment;
          setRun((r) => ({ ...r, assessment }));
          addLog(`Recruiter assessment · ${assessment.recommendation}`);
        } else if (event.node === "submission_agent") {
          const submission = data.submission_result as SubmissionResult;
          setRun((r) => ({ ...r, submission }));
          addLog(`Submission #${submission.submission_id} saved to PostgreSQL`, "success");
        } else if (event.node === "email_agent") {
          const email = data.email_result as EmailResult;
          setRun((r) => ({ ...r, email }));
          addLog(`Email draft #${email.email_draft_id} saved (not sent)`, "success");
        }
        break;
      }

      case "interrupt":
        approvalsChanged();
        setPipe((p) => setNodes(p, ["human_approval"], "waiting", t));
        setPhase("awaiting");
        setFinishedAt(t);
        addLog("Paused · waiting for human approval", "warning");
        break;

      case "complete":
        approvalsChanged();
        setRun((r) => ({ ...r, approved: event.approved }));
        setPhase("complete");
        setFinishedAt(t);
        if (event.approved && "submission_id" in event.submission_result) {
          toast("success", "Candidate submitted", `Submission #${event.submission_result.submission_id} and its email draft are saved.`);
        } else {
          toast("info", "Workflow ended", "Rejected: nothing was submitted.");
        }
        break;

      case "error":
        fail(event.message);
        break;
    }
  };

  const fail = (message: string) => {
    const t = Date.now();
    setPipe((p) => {
      const running = (Object.keys(p) as NodeId[]).filter((id) => p[id].status === "running");
      return setNodes(p, running, "error", t);
    });
    setError(message);
    setPhase("error");
    setFinishedAt(t);
    addLog(message, "danger");
  };

  const start = async () => {
    if (!candidate || !job) return;

    reset();
    const t = Date.now();
    setPhase("running");
    setStartedAt(t);
    setPipe(setNodes(idlePipeline(), ["resume_agent", "job_agent"], "running", t));

    try {
      await api.runWorkflow(candidate.id, job.id, handle);
    } catch (e) {
      fail((e as Error).message);
    }
  };

  const decide = async (approved: boolean) => {
    if (!run.threadId) return;

    const t = Date.now();
    setPhase("deciding");
    setStartedAt((s) => (s ? s + (t - (finishedAt ?? t)) : t)); // don't count time spent deciding
    setFinishedAt(undefined);

    setPipe((p) => {
      if (approved) {
        return setNodes(setNodes(p, ["human_approval"], "done", t), ["submission_agent"], "running", t);
      }
      return setNodes(setNodes(p, ["human_approval"], "rejected", t), ["submission_agent", "email_agent"], "skipped", t);
    });
    addLog(approved ? "Approved by recruiter" : "Rejected by recruiter", approved ? "success" : "danger");

    try {
      await api.decide(run.threadId, approved, handle);
    } catch (e) {
      fail((e as Error).message);
    }
  };

  /* -------- render -------- */

  const phaseBadge = {
    idle: <span className="badge">Ready</span>,
    running: <span className="badge accent">Agents working</span>,
    awaiting: <span className="badge warning">Awaiting approval</span>,
    deciding: <span className="badge accent">Finishing</span>,
    complete: run.approved ? <span className="badge success">Submitted</span> : <span className="badge danger">Rejected</span>,
    error: <span className="badge danger">Failed</span>,
  }[phase];

  return (
    <>
      <PageHeader
        eyebrow={<><Sparkles size={14} /> Match Studio</>}
        title={<>Match a candidate to a <em>role</em></>}
        subtitle="Runs the LangGraph recruiter workflow live. The score is calculated in Python (70% skills, 30% experience); the LLM only explains it."
        actions={
          phase !== "idle" && (
            <button className="btn" onClick={reset} disabled={busy}>
              <RotateCcw size={15} /> New run
            </button>
          )
        }
      />

      <div className="studio-config" style={{ opacity: locked ? 0.6 : 1, pointerEvents: locked ? "none" : undefined }}>
        <Picker<Candidate>
          title="Candidate"
          icon={<Users size={16} />}
          items={candidates.data}
          loading={candidates.loading}
          error={candidates.error}
          selected={candidateId}
          onSelect={setCandidateId}
          searchText={(c) => `${c.name} ${c.email ?? ""} ${c.skills ?? ""}`}
          disabledReason={(c) => (c.has_resume ? undefined : "No resume")}
          render={(c) => (
            <>
              <Avatar name={c.name} size="sm" />
              <div className="list-main">
                <div className="list-title">{c.name}</div>
                <div className="list-sub">{c.email}</div>
              </div>
            </>
          )}
        />
        <Picker<Job>
          title="Job"
          icon={<Briefcase size={16} />}
          items={jobs.data}
          loading={jobs.loading}
          error={jobs.error}
          selected={jobId}
          onSelect={setJobId}
          searchText={(j) => `${j.title} ${j.company} ${j.location ?? ""} ${j.skills ?? ""}`}
          render={(j) => (
            <>
              <CompanyLogo company={j.company} size="sm" />
              <div className="list-main">
                <div className="list-title">{j.title}</div>
                <div className="list-sub">
                  {j.company}
                  {j.location ? ` · ${j.location}` : ""}
                </div>
              </div>
            </>
          )}
        />
      </div>

      <div className="card run-bar">
        <div className="run-summary">
          {candidate && job ? (
            <>
              <Avatar name={candidate.name} size="sm" />
              {candidate.name}
              <span className="x">×</span>
              {job.title}
              <span className="subtle" style={{ fontWeight: 500 }}>
                at {job.company}
              </span>
            </>
          ) : (
            <span className="muted" style={{ fontWeight: 500 }}>
              Select a candidate with a resume and a job to begin.
            </span>
          )}
        </div>
        <div className="row">
          {startedAt && <span className="timer">{elapsed.toFixed(1)}s</span>}
          <button className="btn btn-primary btn-lg" onClick={start} disabled={!canRun}>
            {phase === "running" ? <LoaderCircle size={17} className="spin" /> : <Play size={16} />}
            {phase === "running" ? "Running agents…" : "Run workflow"}
          </button>
        </div>
      </div>

      <div className="card pipeline-card">
        <div className="row-between">
          <h2 className="card-title">
            <Workflow size={16} /> Agent pipeline
          </h2>
          {phaseBadge}
        </div>
        <Pipeline state={pipe} />
      </div>

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBox message={error} onRetry={canRun || phase === "error" ? start : undefined} />
        </div>
      )}

      {phase !== "idle" && <Results run={run} phase={phase} log={log} />}

      {phase === "awaiting" && run.match && run.assessment && (
        <div className="approval-bar">
          <div className="row" style={{ gap: 14 }}>
            <div className="approval-icon">
              <Hand size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 650 }}>Human approval required</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {run.match.match_score}% match · {run.assessment.recommendation}. Approving creates a submission
                and an email draft. It's also saved in the Approvals queue.
              </div>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => navigate("approvals")} title="It stays in the approval queue">
              Decide later
            </button>
            <button className="btn btn-danger" onClick={() => decide(false)}>
              <X size={16} /> Reject
            </button>
            <button className="btn btn-success" onClick={() => decide(true)}>
              <Check size={16} /> Approve & submit
            </button>
          </div>
        </div>
      )}

      {phase === "complete" && <Outcome run={run} job={job} />}
    </>
  );
}

/* ---------------- picker ---------------- */

function Picker<T extends { id: number }>(props: {
  title: string;
  icon: ReactNode;
  items: T[] | undefined;
  loading: boolean;
  error?: string;
  selected: number | null;
  onSelect: (id: number) => void;
  searchText: (item: T) => string;
  render: (item: T) => ReactNode;
  disabledReason?: (item: T) => string | undefined;
}) {
  const [query, setQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (props.items ?? []).filter((i) => props.searchText(i).toLowerCase().includes(q));
  }, [props.items, query, props.searchText]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.items]);

  return (
    <div className="card picker">
      <div className="card-header" style={{ padding: "14px 16px" }}>
        <h2 className="card-title">
          {props.icon} {props.title}
        </h2>
        <div className="search" style={{ width: 190 }}>
          <Search size={14} />
          <input
            className="input"
            style={{ height: 32, fontSize: 13 }}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="picker-list">
        {props.error && <ErrorBox message={props.error} />}
        {props.loading && !props.items
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} style={{ padding: 8 }}>
                <Skeleton height={34} />
              </div>
            ))
          : items.map((item) => {
              const reason = props.disabledReason?.(item);
              const selected = props.selected === item.id;
              return (
                <button
                  key={item.id}
                  ref={selected ? selectedRef : undefined}
                  className={`picker-item ${selected ? "selected" : ""}`}
                  onClick={() => props.onSelect(item.id)}
                  disabled={!!reason}
                  title={reason ? `${reason}: upload one on the Candidates page` : undefined}
                >
                  <span className="radio" />
                  {props.render(item)}
                  {reason && <span className="badge warning">{reason}</span>}
                </button>
              );
            })}
        {!props.loading && props.items && items.length === 0 && (
          <div className="muted" style={{ padding: 16, fontSize: 13 }}>
            Nothing found.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- results ---------------- */

function Waiting({ label }: { label: string }) {
  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="row subtle" style={{ fontSize: 12.5 }}>
        <LoaderCircle size={14} className="spin" /> {label}
      </div>
      <Skeleton height={14} width="85%" />
      <Skeleton height={14} width="60%" />
      <Skeleton height={14} width="72%" />
    </div>
  );
}

function Results({ run, phase, log }: { run: RunData; phase: Phase; log: LogEntry[] }) {
  const active = phase === "running";
  const { match, assessment, resume, job } = run;

  return (
    <div className="grid-12">
      {/* score */}
      <div className="card span-4 fade-in">
        {match ? (
          <div className="score-card">
            <ScoreRing score={match.match_score} />
            {assessment && (
              <span className={`badge ${recommendationTone(assessment.recommendation)}`} style={{ marginTop: 14 }}>
                {assessment.recommendation}
              </span>
            )}
            <div style={{ width: "100%", marginTop: 20 }}>
              <Meter label="Skills" note="70% weight" value={match.skill_score} />
              <Meter label="Experience" note="30% weight" value={match.experience_score} />
            </div>
          </div>
        ) : (
          <div className="card-body" style={{ minHeight: 300 }}>
            {active ? <Waiting label="Waiting for the Matching agent…" /> : <span className="muted">No score.</span>}
          </div>
        )}
      </div>

      {/* skills */}
      <div className="card span-8 fade-in" style={{ animationDelay: "60ms" }}>
        <div className="card-header">
          <h2 className="card-title">
            <Target size={16} /> Skill coverage
          </h2>
          {match && (
            <span className="subtle" style={{ fontSize: 12.5 }}>
              {match.matched_skills.length} of {match.matched_skills.length + match.missing_skills.length} required
            </span>
          )}
        </div>
        <div className="card-body grid" style={{ gap: 18 }}>
          {match ? (
            <>
              <div>
                <div className="section-label">Matched</div>
                <div className="chips">
                  {match.matched_skills.length ? (
                    match.matched_skills.map((s) => (
                      <span key={s} className="chip success">
                        <Check size={12} /> {s}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No required skills matched.</span>
                  )}
                </div>
              </div>
              <div>
                <div className="section-label">Missing</div>
                <div className="chips">
                  {match.missing_skills.length ? (
                    match.missing_skills.map((s) => (
                      <span key={s} className="chip danger">
                        <X size={12} /> {s}
                      </span>
                    ))
                  ) : (
                    <span className="muted">None: every required skill is covered.</span>
                  )}
                </div>
              </div>
              {job && job.preferred_skills.length > 0 && (
                <div>
                  <div className="section-label">Nice to have</div>
                  <div className="chips">
                    {job.preferred_skills.map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="row" style={{ fontSize: 13 }}>
                {match.experience_match ? (
                  <CircleCheck size={16} color="var(--success)" />
                ) : (
                  <CircleX size={16} color="var(--danger)" />
                )}
                <span className="muted">
                  Experience requirement {match.experience_match ? "met" : "not met"}
                  {resume && job && ` · ${resume.experience_years} yrs vs ${job.experience_years} required`}
                </span>
              </div>
            </>
          ) : active ? (
            <Waiting label="Comparing skills…" />
          ) : null}
        </div>
      </div>

      {/* candidate profile */}
      <div className="card span-6 fade-in" style={{ animationDelay: "120ms" }}>
        <div className="card-header">
          <h2 className="card-title">
            <Users size={16} /> Candidate profile
          </h2>
          <span className="subtle" style={{ fontSize: 12 }}>Resume Agent</span>
        </div>
        <div className="card-body">
          {resume ? (
            <div className="grid" style={{ gap: 14 }}>
              <div className="row">
                <Avatar name={resume.name || "?"} />
                <div>
                  <div className="entity-name">{resume.name}</div>
                  <div className="subtle" style={{ fontSize: 12.5 }}>
                    {resume.experience_years} years experience
                  </div>
                </div>
              </div>
              <p className="muted" style={{ margin: 0 }}>{resume.summary}</p>
              <div className="chips">
                {resume.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
              {resume.education.length > 0 && (
                <div className="row subtle" style={{ fontSize: 13, alignItems: "flex-start" }}>
                  <GraduationCap size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  {resume.education.join(" · ")}
                </div>
              )}
            </div>
          ) : active ? (
            <Waiting label="Reading resume…" />
          ) : null}
        </div>
      </div>

      {/* role profile */}
      <div className="card span-6 fade-in" style={{ animationDelay: "160ms" }}>
        <div className="card-header">
          <h2 className="card-title">
            <Briefcase size={16} /> Role profile
          </h2>
          <span className="subtle" style={{ fontSize: 12 }}>Job Agent</span>
        </div>
        <div className="card-body">
          {job ? (
            <div className="grid" style={{ gap: 14 }}>
              <div className="row">
                <CompanyLogo company={job.company || "?"} />
                <div>
                  <div className="entity-name">{job.title}</div>
                  <div className="subtle" style={{ fontSize: 12.5 }}>
                    {job.company} · {job.location} · {job.experience_years}+ yrs
                  </div>
                </div>
              </div>
              <div className="chips">
                {job.required_skills.map((s) => (
                  <span key={s} className="chip accent">
                    {s}
                  </span>
                ))}
              </div>
              {job.responsibilities.length > 0 && (
                <ul className="point-list">
                  {job.responsibilities.slice(0, 4).map((r) => (
                    <li key={r}>
                      <ArrowRight size={14} color="var(--text-3)" /> {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : active ? (
            <Waiting label="Parsing job description…" />
          ) : null}
        </div>
      </div>

      {/* assessment */}
      <div className="card span-8 fade-in" style={{ animationDelay: "200ms" }}>
        <div className="card-header">
          <h2 className="card-title">
            <Sparkles size={16} /> Recruiter assessment
          </h2>
          {assessment && (
            <span className={`badge ${recommendationTone(assessment.recommendation)}`}>{assessment.recommendation}</span>
          )}
        </div>
        <div className="card-body">
          {assessment ? (
            <div className="grid" style={{ gap: 20 }}>
              <p className="reasoning">“{assessment.reasoning}”</p>
              <div className="grid-12" style={{ gap: 18 }}>
                <div className="span-6">
                  <div className="section-label">Strengths</div>
                  <ul className="point-list">
                    {assessment.strengths.map((s) => (
                      <li key={s}>
                        <CircleCheck size={15} color="var(--success)" /> {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="span-6">
                  <div className="section-label">Concerns</div>
                  <ul className="point-list">
                    {assessment.concerns.length ? (
                      assessment.concerns.map((s) => (
                        <li key={s}>
                          <TriangleAlert size={15} color="var(--warning)" /> {s}
                        </li>
                      ))
                    ) : (
                      <li>No concerns raised.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ) : active ? (
            <Waiting label="Waiting for the assessment…" />
          ) : null}
        </div>
      </div>

      {/* activity */}
      <div className="card span-4 fade-in" style={{ animationDelay: "240ms" }}>
        <div className="card-header">
          <h2 className="card-title">
            <Activity size={16} /> Activity
          </h2>
        </div>
        <div className="card-body">
          <ul className="log">
            {log.map((entry, i) => (
              <li key={i}>
                <time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span className={entry.tone ? `tone-${entry.tone}` : undefined}>{entry.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------- outcome ---------------- */

function Outcome({ run, job }: { run: RunData; job?: Job }) {

  if (!run.approved) {
    return (
      <div className="card outcome rejected fade-in">
        <div className="outcome-head" style={{ borderBottom: 0 }}>
          <div className="outcome-icon">
            <CircleX size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 650, fontSize: 15.5 }}>Candidate rejected</div>
            <div className="muted" style={{ fontSize: 13 }}>
              The workflow ended at human approval. No submission or email draft was created.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card outcome approved fade-in">
      <div className="outcome-head">
        <div className="outcome-icon">
          <CircleCheck size={22} />
        </div>
        <div className="list-main">
          <div style={{ fontWeight: 650, fontSize: 15.5 }}>Submitted and saved to PostgreSQL</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Submission <span className="mono">#{run.submission?.submission_id}</span> · email draft{" "}
            <span className="mono">#{run.email?.email_draft_id}</span> · status {run.email?.email_status}, not sent
          </div>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => navigate("submissions", { open: run.submission?.submission_id })}
        >
          View submission <ArrowRight size={14} />
        </button>
      </div>

      {run.email && run.submission && (
        <div style={{ margin: "18px 22px 22px" }}>
          <EmailActions
            draft={{
              id: run.email.email_draft_id,
              subject: run.email.subject,
              body: run.email.body,
              status: "draft",
              recipient_email: run.email.recipient_email,
            }}
            submissionId={run.submission.submission_id}
            jobId={job?.id ?? 0}
            contactEmail={job?.contact_email ?? null}
            contactName={job?.contact_name}
          />
        </div>
      )}
    </div>
  );
}

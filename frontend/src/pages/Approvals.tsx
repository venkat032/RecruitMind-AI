import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Hand,
  LoaderCircle,
  RotateCcw,
  Search,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";

import { api, approvalsChanged } from "../api";
import { useToast } from "../components/Toasts";
import {
  Avatar,
  CompanyLogo,
  Drawer,
  EmptyState,
  ErrorBox,
  Meter,
  PageHeader,
  ScorePill,
  ScoreRing,
  Skeleton,
} from "../components/ui";
import { formatDate, navigate, parseDate, recommendationTone, timeAgo, useAsync } from "../lib";
import type { Approval, ApprovalStatus, CandidateForJob, Job } from "../types";

type Tab = "pending" | "screening" | "approved" | "rejected" | "failed" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "screening", label: "Screening" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

type Sort = "oldest" | "newest" | "score-desc" | "score-asc";

const STATUS_BADGE: Record<ApprovalStatus, string> = {
  screening: "accent",
  pending: "warning",
  deciding: "accent",
  approved: "success",
  rejected: "danger",
  failed: "danger",
};

/** Requests waiting longer than this are flagged (review SLA). */
const SLA_HOURS = 24;

function waitingHours(a: Approval): number {
  return (Date.now() - parseDate(a.created_at).getTime()) / 36e5;
}

function inTab(a: Approval, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "screening") return a.status === "screening";
  if (tab === "pending") return a.status === "pending" || a.status === "deciding";
  return a.status === tab;
}

export default function Approvals({ params }: { params: URLSearchParams }) {
  const toast = useToast();
  const queue = useAsync(() => api.approvals());
  const jobs = useAsync(() => api.jobs());

  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "pending");
  const [query, setQuery] = useState("");
  const [jobFilter, setJobFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<Sort>("oldest");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(params.get("open") ? Number(params.get("open")) : null);
  const [screening, setScreening] = useState(false);
  const [bulk, setBulk] = useState<boolean | null>(null); // true = approve, false = reject

  const all = queue.data ?? [];
  const reload = queue.reload;

  // Live updates: fast while agents are working, relaxed otherwise
  const busy = all.some((a) => a.status === "screening" || a.status === "deciding");
  useEffect(() => {
    const id = window.setInterval(reload, busy ? 3000 : 20000);
    return () => window.clearInterval(id);
  }, [busy, reload]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TABS.map((t) => [t.id, 0])) as Record<Tab, number>;
    for (const a of all) for (const t of TABS) if (inTab(a, t.id)) c[t.id]++;
    return c;
  }, [all]);

  // Keep the sidebar badge in step with what this page already knows
  useEffect(() => {
    if (queue.data) approvalsChanged();
  }, [counts.pending, queue.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter(
      (a) =>
        inTab(a, tab) &&
        (jobFilter === "all" || a.job_id === jobFilter) &&
        [a.candidate_name, a.candidate_email, a.job_title, a.job_company, a.recommendation].some((v) =>
          v?.toLowerCase().includes(q),
        ),
    );
    const time = (a: Approval) => parseDate(a.created_at).getTime();
    const score = (a: Approval) => a.match_score ?? -1;
    const order: Record<Sort, (a: Approval, b: Approval) => number> = {
      oldest: (a, b) => time(a) - time(b),
      newest: (a, b) => time(b) - time(a),
      "score-desc": (a, b) => score(b) - score(a),
      "score-asc": (a, b) => score(a) - score(b),
    };
    return filtered.sort(order[sort]);
  }, [all, tab, query, jobFilter, sort]);

  const pendingRows = rows.filter((a) => a.status === "pending");
  const selectable = tab === "pending";
  const allSelected = pendingRows.length > 0 && pendingRows.every((a) => selected.has(a.id));

  // Drop selections that are no longer pending (decided elsewhere)
  useEffect(() => {
    setSelected((current) => {
      const stillPending = new Set([...current].filter((id) => all.some((a) => a.id === id && a.status === "pending")));
      return stillPending.size === current.size ? current : stillPending;
    });
  }, [all]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const decided = (approved: boolean, a: Approval) => {
    toast(
      approved ? "success" : "info",
      approved ? `${a.candidate_name} approved` : `${a.candidate_name} rejected`,
      approved ? `Submission #${a.submission_id} created and email drafted.` : "No submission was created.",
    );
    reload();
    approvalsChanged();
  };

  // After a decision in the drawer, move straight to the next pending request
  const openNext = (afterId: number) => {
    const queueOrder = pendingRows.filter((a) => a.id !== afterId);
    setOpenId(queueOrder[0]?.id ?? null);
  };

  const summary = useMemo(() => {
    const pending = all.filter((a) => a.status === "pending");
    const oldest = pending.reduce<Approval | null>(
      (o, a) => (!o || parseDate(a.created_at) < parseDate(o.created_at) ? a : o),
      null,
    );
    const approved = all.filter((a) => a.status === "approved").length;
    const rejected = all.filter((a) => a.status === "rejected").length;
    return {
      pending: pending.length,
      overdue: pending.filter((a) => waitingHours(a) > SLA_HOURS).length,
      oldest,
      screening: counts.screening,
      rate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : null,
    };
  }, [all, counts.screening]);

  return (
    <>
      <PageHeader
        eyebrow={<><Hand size={14} /> Human-in-the-loop</>}
        title={<>Approval <em>queue</em></>}
        subtitle="Every candidate the agents screen waits here, paused at the approval checkpoint. Nothing is submitted until a recruiter approves it."
        actions={
          <button className="btn btn-primary" onClick={() => setScreening(true)}>
            <Users size={16} /> Screen candidates
          </button>
        }
      />

      {/* ---------- summary ---------- */}
      <div className="grid-12" style={{ marginBottom: 18 }}>
        <div className="card kpi span-3">
          <div className="kpi-top">
            Awaiting decision
            <div className="kpi-icon" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
              <Hand size={16} />
            </div>
          </div>
          <div className="kpi-value">{queue.data ? summary.pending : "—"}</div>
          <div className="kpi-foot" style={summary.overdue ? { color: "var(--danger)" } : undefined}>
            {summary.overdue ? `${summary.overdue} waiting longer than ${SLA_HOURS}h` : `Within the ${SLA_HOURS}h review target`}
          </div>
        </div>
        <div className="card kpi span-3">
          <div className="kpi-top">
            Oldest request
            <div className="kpi-icon">
              <Clock size={16} />
            </div>
          </div>
          <div className="kpi-value" style={{ fontSize: 24, paddingTop: 6 }}>
            {summary.oldest ? timeAgo(summary.oldest.created_at) : "—"}
          </div>
          <div className="kpi-foot">{summary.oldest ? `${summary.oldest.candidate_name} · ${summary.oldest.job_title}` : "Queue is clear"}</div>
        </div>
        <div className="card kpi span-3">
          <div className="kpi-top">
            Agents screening
            <div className="kpi-icon">
              {summary.screening ? <LoaderCircle size={16} className="spin" /> : <Users size={16} />}
            </div>
          </div>
          <div className="kpi-value">{queue.data ? summary.screening : "—"}</div>
          <div className="kpi-foot">Will join the queue when analysed</div>
        </div>
        <div className="card kpi span-3">
          <div className="kpi-top">
            Approval rate
            <div className="kpi-icon" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
              <CircleCheck size={16} />
            </div>
          </div>
          <div className="kpi-value">
            {summary.rate ?? "—"}
            {summary.rate != null && <small>%</small>}
          </div>
          <div className="kpi-foot">Of all decided requests</div>
        </div>
      </div>

      {/* ---------- tabs + filters ---------- */}
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="segmented" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                setTab(t.id);
                setSelected(new Set());
              }}
            >
              {t.label}
              {counts[t.id] > 0 && <span className={`tab-count ${t.id === "pending" ? "hot" : ""}`}>{counts[t.id]}</span>}
            </button>
          ))}
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="search" style={{ width: 230 }}>
            <Search size={16} />
            <input className="input" placeholder="Search candidate or role…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select
            className="input select"
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            aria-label="Filter by job"
          >
            <option value="all">All jobs</option>
            {(jobs.data ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.company}
              </option>
            ))}
          </select>
          <select className="input select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="score-desc">Highest score</option>
            <option value="score-asc">Lowest score</option>
          </select>
        </div>
      </div>

      {queue.error && <ErrorBox message={queue.error} onRetry={reload} />}

      {/* ---------- table ---------- */}
      <div className="card">
        {queue.loading && !queue.data ? (
          <div className="card-body grid">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={46} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <QueueEmpty tab={tab} filtered={!!query || jobFilter !== "all"} onScreen={() => setScreening(true)} />
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  {selectable && (
                    <th style={{ width: 44 }}>
                      <input
                        type="checkbox"
                        className="cb"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(pendingRows.map((a) => a.id)))}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>Match</th>
                  <th>{tab === "failed" ? "Problem" : "Recommendation"}</th>
                  <th>{tab === "approved" || tab === "rejected" ? "Decided" : tab === "pending" ? "Waiting" : "Status"}</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <QueueRow
                    key={a.id}
                    a={a}
                    tab={tab}
                    selectable={selectable}
                    selected={selected.has(a.id)}
                    onToggle={() => toggle(a.id)}
                    onOpen={() => setOpenId(a.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- bulk actions ---------- */}
      {selectable && selected.size > 0 && (
        <div className="approval-bar bulk-bar">
          <div className="row" style={{ gap: 12 }}>
            <div className="approval-icon">
              <Hand size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 650 }}>{selected.size} selected</div>
              <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: "auto" }} onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-danger" onClick={() => setBulk(false)}>
              <X size={16} /> Reject {selected.size}
            </button>
            <button className="btn btn-success" onClick={() => setBulk(true)}>
              <Check size={16} /> Approve {selected.size}
            </button>
          </div>
        </div>
      )}

      {bulk !== null && (
        <BulkDialog
          approved={bulk}
          items={all.filter((a) => selected.has(a.id))}
          onClose={() => setBulk(null)}
          onDone={() => {
            setBulk(null);
            setSelected(new Set());
            reload();
            approvalsChanged();
          }}
        />
      )}

      {openId != null && (
        <ReviewDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onDecided={(approved, a) => {
            decided(approved, a);
            openNext(a.id);
          }}
          onScreenAgain={() => {
            setOpenId(null);
            setScreening(true);
          }}
          remaining={pendingRows.filter((a) => a.id !== openId).length}
        />
      )}

      <ScreenDrawer
        open={screening}
        jobs={jobs.data ?? []}
        onClose={() => setScreening(false)}
        onQueued={() => {
          setScreening(false);
          setTab("screening");
          reload();
          approvalsChanged();
        }}
      />
    </>
  );
}

/* ================================================================== */

function QueueEmpty({ tab, filtered, onScreen }: { tab: Tab; filtered: boolean; onScreen: () => void }) {
  if (filtered) return <EmptyState title="No matching requests" text="Try a different search or job filter." />;

  if (tab === "pending") {
    return (
      <EmptyState
        icon={<CircleCheck size={22} />}
        title="You're all caught up"
        text="No candidates are waiting for a decision. Screen candidates against a job to fill the queue."
        action={
          <button className="btn btn-primary" onClick={onScreen}>
            <Users size={16} /> Screen candidates
          </button>
        }
      />
    );
  }

  return <EmptyState title="Nothing here yet" text="Requests will appear here as they move through the workflow." />;
}

function QueueRow(props: {
  a: Approval;
  tab: Tab;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { a, tab } = props;
  const decidedView = tab === "approved" || tab === "rejected";
  const hours = waitingHours(a);
  const overdue = a.status === "pending" && hours > SLA_HOURS;

  return (
    <tr onClick={props.onOpen} className={props.selected ? "row-selected" : undefined}>
      {props.selectable && (
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="cb"
            checked={props.selected}
            disabled={a.status !== "pending"}
            onChange={props.onToggle}
            aria-label={`Select ${a.candidate_name}`}
          />
        </td>
      )}
      <td>
        <div className="row">
          <Avatar name={a.candidate_name} size="sm" />
          <div className="list-main">
            <div className="list-title">{a.candidate_name}</div>
            <div className="list-sub">{a.candidate_email}</div>
          </div>
        </div>
      </td>
      <td>
        <div className="list-title">{a.job_title}</div>
        <div className="list-sub">{a.job_company}</div>
      </td>
      <td>{a.match_score != null ? <ScorePill score={a.match_score} /> : <span className="subtle">—</span>}</td>
      <td>
        {a.status === "failed" ? (
          <span className="row" style={{ color: "var(--danger)", fontSize: 12.5, gap: 6, maxWidth: 260 }}>
            <TriangleAlert size={14} style={{ flexShrink: 0 }} />
            <span className="list-sub" style={{ color: "inherit", whiteSpace: "normal" }}>{a.error}</span>
          </span>
        ) : a.recommendation ? (
          <span className={`badge plain ${recommendationTone(a.recommendation)}`}>{a.recommendation}</span>
        ) : (
          <span className="row subtle" style={{ fontSize: 12.5, gap: 6 }}>
            <LoaderCircle size={14} className="spin" /> Agents analysing…
          </span>
        )}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {decidedView ? (
          <span className="subtle">{a.decided_at ? timeAgo(a.decided_at) : "—"}</span>
        ) : a.status === "pending" ? (
          <span className={overdue ? "sla-overdue" : "subtle"}>
            {overdue && <Clock size={12} />} {timeAgo(a.created_at)}
          </span>
        ) : (
          <span className={`badge ${STATUS_BADGE[a.status]}`} style={{ textTransform: "capitalize" }}>
            {a.status === "deciding" ? "Finishing…" : a.status}
          </span>
        )}
        {(decidedView ? a.decided_by_name : a.requested_by_name) && (
          <div className="list-sub">
            {decidedView ? "by" : "requested by"} {decidedView ? a.decided_by_name : a.requested_by_name}
          </div>
        )}
      </td>
      <td style={{ textAlign: "right" }}>
        <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), props.onOpen())}>
          {a.status === "pending" ? "Review" : "Details"} <ArrowRight size={13} />
        </button>
      </td>
    </tr>
  );
}

/* ---------------- review drawer ---------------- */

function ReviewDrawer(props: {
  id: number;
  onClose: () => void;
  onDecided: (approved: boolean, a: Approval) => void;
  onScreenAgain: () => void;
  remaining: number;
}) {
  const toast = useToast();
  const { data: a, error, loading, reload } = useAsync(() => api.approval(props.id), [props.id]);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<boolean | null>(null);

  useEffect(() => setNote(""), [props.id]);

  const decide = async (approved: boolean) => {
    if (!a) return;
    setDeciding(approved);
    try {
      const result = await api.decideApproval(a.id, approved, note.trim());
      props.onDecided(approved, result);
    } catch (e) {
      toast("error", "Decision failed", (e as Error).message);
      reload();
    } finally {
      setDeciding(null);
    }
  };

  const match = a?.analysis?.match_result;
  const assessment = a?.analysis?.recruiter_assessment;
  const resume = a?.analysis?.resume_analysis;
  const job = a?.analysis?.job_analysis;
  const isPending = a?.status === "pending";

  return (
    <Drawer
      open
      onClose={props.onClose}
      title={a ? `${a.candidate_name} → ${a.job_title}` : "Approval request"}
      subtitle={
        a
          ? `Request #${a.id} · screened ${timeAgo(a.created_at)}${a.requested_by_name ? ` by ${a.requested_by_name}` : ""} · ${a.source === "batch" ? "batch screening" : "Match Studio"}`
          : undefined
      }
      footer={
        isPending ? (
          <>
            <span className="subtle" style={{ marginRight: "auto", fontSize: 12.5, alignSelf: "center" }}>
              {props.remaining > 0 ? `${props.remaining} more waiting` : "Last one in the queue"}
            </span>
            <button className="btn btn-danger" disabled={deciding !== null} onClick={() => decide(false)}>
              {deciding === false ? <LoaderCircle size={16} className="spin" /> : <X size={16} />} Reject
            </button>
            <button className="btn btn-success" disabled={deciding !== null} onClick={() => decide(true)}>
              {deciding === true ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
              {deciding === true ? "Submitting & drafting email…" : "Approve & submit"}
            </button>
          </>
        ) : a?.submission_id ? (
          <button className="btn" onClick={() => navigate("submissions", { open: a.submission_id! })}>
            View submission #{a.submission_id} <ArrowRight size={14} />
          </button>
        ) : undefined
      }
    >
      {error && <ErrorBox message={error} onRetry={reload} />}

      {loading && !a ? (
        <div className="grid">
          <Skeleton height={160} />
          <Skeleton height={100} />
          <Skeleton height={140} />
        </div>
      ) : (
        a && (
          <>
            {a.status !== "pending" && <DecisionBanner a={a} onScreenAgain={props.onScreenAgain} />}
            {a.error && a.status === "pending" && <ErrorBox message={`Last attempt failed: ${a.error}`} />}

            {match && (
              <div className="review-score">
                <ScoreRing score={match.match_score ?? 0} size={136} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {assessment?.recommendation && (
                    <span className={`badge ${recommendationTone(assessment.recommendation)}`}>{assessment.recommendation}</span>
                  )}
                  <div style={{ marginTop: 14 }}>
                    <Meter label="Skills" note="70%" value={match.skill_score ?? 0} />
                    <Meter label="Experience" note="30%" value={match.experience_score ?? 0} />
                  </div>
                </div>
              </div>
            )}

            {match && (
              <div>
                <div className="section-label">Skill coverage</div>
                <div className="chips">
                  {(match.matched_skills ?? []).map((s) => (
                    <span key={s} className="chip success">
                      <Check size={12} /> {s}
                    </span>
                  ))}
                  {(match.missing_skills ?? []).map((s) => (
                    <span key={s} className="chip danger">
                      <X size={12} /> {s}
                    </span>
                  ))}
                  {!match.matched_skills?.length && !match.missing_skills?.length && (
                    <span className="muted">No required skills listed for this job.</span>
                  )}
                </div>
              </div>
            )}

            {assessment && (
              <div>
                <div className="section-label">Recruiter assessment</div>
                {assessment.reasoning && <p className="reasoning" style={{ fontSize: 17, marginBottom: 14 }}>“{assessment.reasoning}”</p>}
                <div className="grid-12" style={{ gap: 14 }}>
                  <div className="span-6">
                    <ul className="point-list">
                      {(assessment.strengths ?? []).map((s) => (
                        <li key={s}>
                          <CircleCheck size={15} color="var(--success)" /> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="span-6">
                    <ul className="point-list">
                      {(assessment.concerns ?? []).map((s) => (
                        <li key={s}>
                          <TriangleAlert size={15} color="var(--warning)" /> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {(resume || job) && (
              <div className="grid-12" style={{ gap: 14 }}>
                {resume && (
                  <div className="span-6 mini-card">
                    <div className="row" style={{ marginBottom: 8 }}>
                      <Avatar name={a.candidate_name} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600 }}>{a.candidate_name}</div>
                        <div className="subtle" style={{ fontSize: 12 }}>{resume.experience_years ?? "?"} yrs experience</div>
                      </div>
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>{resume.summary}</p>
                  </div>
                )}
                {job && (
                  <div className="span-6 mini-card">
                    <div className="row" style={{ marginBottom: 8 }}>
                      <CompanyLogo company={a.job_company} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600 }}>{a.job_title}</div>
                        <div className="subtle" style={{ fontSize: 12 }}>
                          {a.job_company} · {job.experience_years ?? 0}+ yrs
                        </div>
                      </div>
                    </div>
                    <div className="chips">
                      {(job.required_skills ?? []).slice(0, 6).map((s) => (
                        <span key={s} className="chip accent">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isPending && (
              <div className="field">
                <label className="label" htmlFor="decision-note">
                  Decision note <span className="subtle">(optional, saved to the audit trail)</span>
                </label>
                <textarea
                  id="decision-note"
                  className="textarea"
                  style={{ minHeight: 76 }}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Strong LangGraph experience; schedule a technical round."
                />
              </div>
            )}

            <dl className="kv" style={{ fontSize: 12.5 }}>
              <dt>Requested</dt>
              <dd>
                {formatDate(a.created_at)} {a.requested_by_name ? `by ${a.requested_by_name}` : ""}
              </dd>
              <dt>Candidate email</dt>
              <dd>{a.candidate_email ?? "—"}</dd>
              <dt>Workflow thread</dt>
              <dd className="mono">{a.thread_id}</dd>
            </dl>
          </>
        )
      )}
    </Drawer>
  );
}

function DecisionBanner({ a, onScreenAgain }: { a: Approval; onScreenAgain: () => void }) {
  if (a.status === "approved" || a.status === "rejected") {
    const approved = a.status === "approved";
    return (
      <div className={`decision-banner ${a.status}`}>
        {approved ? <CircleCheck size={20} /> : <CircleX size={20} />}
        <div>
          <div style={{ fontWeight: 650 }}>
            {approved ? "Approved" : "Rejected"}
            {a.decided_by_name ? ` by ${a.decided_by_name}` : ""}
            {a.decided_at ? ` · ${formatDate(a.decided_at)}` : ""}
          </div>
          {a.decision_note && <div className="muted" style={{ fontSize: 13 }}>“{a.decision_note}”</div>}
          {approved && a.submission_id && (
            <div className="subtle" style={{ fontSize: 12.5 }}>
              Submission #{a.submission_id} · email draft #{a.email_draft_id}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (a.status === "failed") {
    return (
      <div className="decision-banner rejected">
        <TriangleAlert size={20} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>Screening failed</div>
          <div className="muted" style={{ fontSize: 13 }}>{a.error}</div>
        </div>
        <button className="btn btn-sm" onClick={onScreenAgain}>
          <RotateCcw size={14} /> Screen again
        </button>
      </div>
    );
  }

  return (
    <div className="decision-banner pending">
      <LoaderCircle size={20} className="spin" />
      <div>
        <div style={{ fontWeight: 650 }}>{a.status === "screening" ? "Agents are analysing this candidate" : "Finishing the decision"}</div>
        <div className="muted" style={{ fontSize: 13 }}>This page updates automatically.</div>
      </div>
    </div>
  );
}

/* ---------------- bulk decision dialog ---------------- */

function BulkDialog(props: { approved: boolean; items: Approval[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const verb = props.approved ? "Approve" : "Reject";

  const run = async () => {
    setBusy(true);
    try {
      const result = await api.bulkDecide(props.items.map((a) => a.id), props.approved, note.trim());
      if (result.failed) {
        const reasons = [...new Set(result.results.filter((r) => !r.ok).map((r) => r.error))].join(" ");
        toast("error", `${result.succeeded} ${props.approved ? "approved" : "rejected"}, ${result.failed} failed`, reasons);
      } else {
        toast(
          "success",
          `${result.succeeded} candidate${result.succeeded === 1 ? "" : "s"} ${props.approved ? "approved" : "rejected"}`,
          props.approved ? "Submissions created and emails drafted." : "No submissions were created.",
        );
      }
      props.onDone();
    } catch (e) {
      toast("error", `${verb} failed`, (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="drawer-title">
          {verb} {props.items.length} candidate{props.items.length === 1 ? "" : "s"}?
        </h2>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          {props.approved
            ? "The Submission and Email agents will create a submission and an email draft for each one."
            : "These requests will be closed. No submissions or emails will be created."}
        </p>

        <div className="modal-list">
          {props.items.map((a) => (
            <div key={a.id} className="row" style={{ padding: "7px 0" }}>
              <Avatar name={a.candidate_name} size="sm" />
              <div className="list-main">
                <div className="list-title" style={{ fontSize: 13 }}>{a.candidate_name}</div>
                <div className="list-sub">{a.job_title}</div>
              </div>
              {a.match_score != null && <ScorePill score={a.match_score} />}
            </div>
          ))}
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="bulk-note">
            Note for the audit trail <span className="subtle">(optional)</span>
          </label>
          <textarea
            id="bulk-note"
            className="textarea"
            style={{ minHeight: 70 }}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={props.approved ? "e.g. Shortlisted for the hiring manager" : "e.g. Role filled"}
          />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${props.approved ? "btn-success" : "btn-danger"}`} onClick={run} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : props.approved ? <Check size={16} /> : <X size={16} />}
            {busy ? (props.approved ? "Submitting & drafting emails…" : "Rejecting…") : `${verb} ${props.items.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- batch screening drawer ---------------- */

function ScreenDrawer(props: { open: boolean; jobs: Job[]; onClose: () => void; onQueued: () => void }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const pool = useAsync<CandidateForJob[]>(
    () => (jobId == null ? Promise.resolve([]) : api.candidatesForJob(jobId)),
    [jobId],
  );

  useEffect(() => {
    if (props.open && jobId == null && props.jobs.length) setJobId(props.jobs[0].id);
  }, [props.open, props.jobs, jobId]);

  useEffect(() => setPicked(new Set()), [jobId]);

  const eligible = (c: CandidateForJob) => !!c.has_resume && !c.open_request;
  const list = (pool.data ?? []).filter((c) =>
    [c.name, c.email, c.skills].some((v) => v?.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const eligibleIds = list.filter(eligible).map((c) => c.id);
  const allPicked = eligibleIds.length > 0 && eligibleIds.every((id) => picked.has(id));

  const submit = async () => {
    if (jobId == null || !picked.size) return;
    setBusy(true);
    try {
      const result = await api.screen(jobId, [...picked]);
      toast(
        "success",
        `${result.queued.length} candidate${result.queued.length === 1 ? "" : "s"} sent to the agents`,
        result.skipped.length
          ? `${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.name ?? s.candidate_id} (${s.reason})`).join("; ")}`
          : "They'll appear in Pending as soon as each analysis finishes.",
      );
      setPicked(new Set());
      props.onQueued();
    } catch (e) {
      toast("error", "Screening failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="Screen candidates"
      subtitle="The agents analyse each candidate against the job in the background. Results land in the approval queue."
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !picked.size} onClick={submit}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Users size={16} />}
            Screen {picked.size || ""} candidate{picked.size === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="screen-job">
          Job
        </label>
        <select
          id="screen-job"
          className="input select"
          value={jobId ?? ""}
          onChange={(e) => setJobId(Number(e.target.value))}
        >
          {props.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.company}
              {j.location ? ` · ${j.location}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-label" style={{ margin: 0 }}>
            Candidates · {picked.size} selected
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!eligibleIds.length}
            onClick={() => setPicked(allPicked ? new Set() : new Set(eligibleIds))}
          >
            {allPicked ? "Clear" : "Select all eligible"}
          </button>
        </div>
        <div className="search" style={{ marginBottom: 10 }}>
          <Search size={15} />
          <input className="input" placeholder="Filter candidates…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="screen-list">
          {pool.loading && !pool.data
            ? [0, 1, 2].map((i) => <Skeleton key={i} height={44} />)
            : list.map((c) => {
                const ok = eligible(c);
                return (
                  <label key={c.id} className={`screen-item ${ok ? "" : "disabled"} ${picked.has(c.id) ? "selected" : ""}`}>
                    <input
                      type="checkbox"
                      className="cb"
                      disabled={!ok}
                      checked={picked.has(c.id)}
                      onChange={() =>
                        setPicked((p) => {
                          const next = new Set(p);
                          next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                          return next;
                        })
                      }
                    />
                    <Avatar name={c.name} size="sm" />
                    <div className="list-main">
                      <div className="list-title" style={{ fontSize: 13.5 }}>{c.name}</div>
                      <div className="list-sub">{c.email}</div>
                    </div>
                    {!c.has_resume ? (
                      <span className="badge warning">No resume</span>
                    ) : c.open_request ? (
                      <span className="badge accent" style={{ textTransform: "capitalize" }}>
                        {c.open_request === "screening" ? "Screening" : "In queue"}
                      </span>
                    ) : null}
                  </label>
                );
              })}
          {pool.data && list.length === 0 && <span className="muted">No candidates found.</span>}
        </div>
      </div>
    </Drawer>
  );
}

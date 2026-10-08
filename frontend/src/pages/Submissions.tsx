import { useMemo, useState } from "react";
import { Mail, MailCheck, Search, Send, Sparkles, TriangleAlert } from "lucide-react";

import { api } from "../api";
import { EmailActions } from "../components/EmailActions";
import { Avatar, Drawer, EmptyState, ErrorBox, PageHeader, ScorePill, Skeleton } from "../components/ui";
import { formatDate, navigate, recommendationTone, timeAgo, useAsync } from "../lib";
import type { Submission } from "../types";

const STATUS_TONE: Record<string, string> = {
  approved: "success",
  submitted: "accent",
  pending: "warning",
  rejected: "danger",
};

export default function Submissions({ params }: { params: URLSearchParams }) {
  const { data, error, loading, reload } = useAsync(() => api.submissions());
  const [query, setQuery] = useState("");
  const openParam = params.get("open");
  const openId = openParam ? Number(openParam) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((s) =>
      [s.candidate_name, s.candidate_email, s.job_title, s.job_company, s.recruiter_recommendation].some((v) =>
        v?.toLowerCase().includes(q),
      ),
    );
  }, [data, query]);

  return (
    <>
      <PageHeader
        eyebrow={<><Send size={14} /> Pipeline</>}
        title={<>Submissions <em>on record</em></>}
        subtitle="Every candidate you approved, with the deterministic score, the recruiter assessment and the generated email draft. All of it is stored in PostgreSQL."
        actions={
          <button className="btn btn-primary" onClick={() => navigate("studio")}>
            <Sparkles size={16} /> New match
          </button>
        }
      />

      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            className="input"
            placeholder="Search candidate, role, recommendation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {data && (
          <span className="subtle">
            {filtered.length} of {data.length}
          </span>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}

      <div className="card">
        {loading && !data ? (
          <div className="card-body grid">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={44} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Send size={22} />}
            title={query ? "No matching submissions" : "No submissions yet"}
            text={query ? "Try a different search term." : "Approve a candidate in the Match Studio and the submission shows up here."}
            action={
              !query && (
                <button className="btn btn-primary" onClick={() => navigate("studio")}>
                  Open Match Studio
                </button>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>Match</th>
                  <th>Recommendation</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} onClick={() => navigate("submissions", { open: s.id })}>
                    <td>
                      <div className="row">
                        <Avatar name={s.candidate_name} size="sm" />
                        <div className="list-main">
                          <div className="list-title">{s.candidate_name}</div>
                          <div className="list-sub">{s.candidate_email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="list-title">{s.job_title}</div>
                      <div className="list-sub">{s.job_company}</div>
                    </td>
                    <td>
                      <ScorePill score={s.match_score} />
                    </td>
                    <td>
                      <span className={`badge plain ${recommendationTone(s.recruiter_recommendation)}`}>
                        {s.recruiter_recommendation ?? "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_TONE[s.status] ?? ""}`} style={{ textTransform: "capitalize" }}>
                        {s.status}
                      </span>
                      <EmailStatus s={s} />
                    </td>
                    <td className="subtle" style={{ whiteSpace: "nowrap" }}>
                      {timeAgo(s.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId != null && !Number.isNaN(openId) && (
        <SubmissionDrawer id={openId} onClose={() => navigate("submissions")} onChanged={reload} />
      )}
    </>
  );
}

function SubmissionDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: s, error, loading, reload } = useAsync(() => api.submission(id), [id]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={s ? `${s.candidate_name} → ${s.job_title}` : `Submission #${id}`}
      subtitle={s ? `Submission #${s.id} · ${formatDate(s.created_at)}` : undefined}
    >
      {error && <ErrorBox message={error} onRetry={reload} />}

      {loading && !s ? (
        <div className="grid">
          <Skeleton height={60} />
          <Skeleton height={140} />
          <Skeleton height={220} />
        </div>
      ) : (
        s && (
          <>
            <div className="row-between" style={{ flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 14 }}>
                <Avatar name={s.candidate_name} size="lg" />
                <div>
                  <div className="entity-name" style={{ fontSize: 17 }}>
                    {s.candidate_name}
                  </div>
                  <div className="muted">
                    {s.job_title} · {s.job_company}
                    {s.job_location ? ` · ${s.job_location}` : ""}
                  </div>
                </div>
              </div>
              <ScorePill score={s.match_score} />
            </div>

            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <span className={`badge ${STATUS_TONE[s.status] ?? ""}`} style={{ textTransform: "capitalize" }}>
                  {s.status}
                </span>
              </dd>
              <dt>Recommendation</dt>
              <dd>{s.recruiter_recommendation ?? "—"}</dd>
              <dt>Candidate email</dt>
              <dd>{s.candidate_email ?? "—"}</dd>
              <dt>IDs</dt>
              <dd className="mono">
                candidate {s.candidate_id} · job {s.job_id}
              </dd>
            </dl>

            {s.recruiter_notes && (
              <div>
                <div className="section-label">Recruiter notes</div>
                <div className="prose-box">{s.recruiter_notes}</div>
              </div>
            )}

            <div>
              <div className="section-label">
                Email drafts ({s.email_drafts.length})
              </div>
              {s.email_drafts.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  No email draft stored for this submission.
                </div>
              ) : (
                <div className="grid" style={{ gap: 12 }}>
                  {s.email_drafts.map((d) => (
                    <EmailActions
                      key={d.id}
                      draft={d}
                      submissionId={s.id}
                      jobId={s.job_id}
                      contactEmail={s.job_contact_email}
                      contactName={s.job_contact_name}
                      onChanged={() => {
                        reload();
                        onChanged();
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </Drawer>
  );
}

/** Second line of the Status cell: where the submission email stands. */
function EmailStatus({ s }: { s: Submission }) {
  if (!s.email_draft_count) return null;

  const [icon, text, color] =
    s.email_status === "sent"
      ? [<MailCheck size={12} />, "Email sent", "var(--success)"]
      : !s.job_contact_email
        ? [<TriangleAlert size={12} />, "Email needs contact", "var(--warning)"]
        : [<Mail size={12} />, "Email ready to send", "var(--accent)"];

  return (
    <div className="row" style={{ gap: 5, marginTop: 6, fontSize: 12, color, whiteSpace: "nowrap" }}>
      {icon} {text}
    </div>
  );
}

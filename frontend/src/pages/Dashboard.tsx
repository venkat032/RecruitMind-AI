import { ArrowRight, Briefcase, Gauge, Hand, Send, Sparkles, Users } from "lucide-react";

import { api } from "../api";
import { Avatar, ErrorBox, EmptyState, ScorePill, ScoreRing, Skeleton } from "../components/ui";
import type { User } from "../types";
import { greeting, navigate, recommendationTone, timeAgo, useAsync } from "../lib";

const FLOW = ["Resume", "Job", "Matching", "Assessment", "Human approval", "Submission", "Email draft"];

export default function Dashboard({ user }: { user: User }) {
  const { data, error, loading, reload } = useAsync(() =>
    Promise.all([api.candidates(), api.jobs(), api.submissions()]),
  );

  const [candidates = [], jobs = [], submissions = []] = data ?? [];

  const latest = submissions[0];
  const withResume = candidates.filter((c) => c.has_resume).length;
  const avgScore = submissions.length ? submissions.reduce((sum, s) => sum + s.match_score, 0) / submissions.length : 0;
  const companies = new Set(jobs.map((j) => j.company)).size;
  const topJobs = [...jobs].sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0)).slice(0, 5);
  const maxDemand = Math.max(1, ...topJobs.map((j) => j.submission_count ?? 0));

  const kpis = [
    { label: "Candidates", value: candidates.length, foot: `${withResume} with a resume on file`, icon: Users },
    {
      label: "Open roles",
      value: jobs.length,
      foot: `across ${companies} ${companies === 1 ? "company" : "companies"}`,
      icon: Briefcase,
    },
    { label: "Submissions", value: submissions.length, foot: "human-approved & persisted", icon: Send },
    {
      label: "Avg. match score",
      value: avgScore ? avgScore.toFixed(1) : "—",
      suffix: avgScore ? "%" : "",
      foot: "70% skills · 30% experience",
      icon: Gauge,
    },
  ];

  return (
    <>
      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="eyebrow">
              <Sparkles size={14} /> {greeting()}, {user.full_name.split(" ")[0]}
            </div>
            <h1 className="display">
              Hire with <em>clarity</em>, not guesswork.
            </h1>
            <p>
              Seven cooperating agents read resumes, parse roles and calculate a deterministic match score. Nothing gets
              submitted until you approve it.
            </p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-lg" onClick={() => navigate("studio")}>
                <Sparkles size={17} /> Start a match
              </button>
              <button className="btn btn-lg" onClick={() => navigate("candidates", { new: 1 })}>
                Add candidate
              </button>
            </div>
          </div>

          {latest && (
            <div
              className="hero-side"
              onClick={() => navigate("submissions", { open: latest.id })}
              style={{ cursor: "pointer" }}
            >
              <div className="row-between">
                <span className="section-label" style={{ margin: 0 }}>
                  Latest match
                </span>
                <span className="subtle" style={{ fontSize: 12 }}>
                  {timeAgo(latest.created_at)}
                </span>
              </div>
              <div style={{ display: "grid", placeItems: "center", margin: "14px 0 12px" }}>
                <ScoreRing score={latest.match_score} size={132} />
                {latest.recruiter_recommendation && (
                  <span
                    className={`badge plain ${recommendationTone(latest.recruiter_recommendation)}`}
                    style={{ marginTop: 12 }}
                  >
                    {latest.recruiter_recommendation}
                  </span>
                )}
              </div>
              <div className="row">
                <Avatar name={latest.candidate_name} size="sm" />
                <div className="list-main">
                  <div className="list-title">{latest.candidate_name}</div>
                  <div className="list-sub">
                    {latest.job_title} · {latest.job_company}
                  </div>
                </div>
                </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorBox message={error} onRetry={reload} />
        </div>
      )}

      <div className="grid-12" style={{ marginBottom: 18 }}>
        {kpis.map((k, i) => (
          <div key={k.label} className="card kpi span-3 fade-in" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="kpi-top">
              {k.label}
              <div className="kpi-icon">
                <k.icon size={16} />
              </div>
            </div>
            {loading && !data ? (
              <div style={{ marginTop: 14 }}>
                <Skeleton height={32} width={80} />
              </div>
            ) : (
              <div className="kpi-value">
                {k.value}
                {k.suffix && <small>{k.suffix}</small>}
              </div>
            )}
            <div className="kpi-foot">{k.foot}</div>
          </div>
        ))}
      </div>

      <div className="grid-12">
        <div className="card span-8">
          <div className="card-header">
            <h2 className="card-title">
              <Send size={16} /> Recent submissions
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("submissions")}>
              View all <ArrowRight size={14} />
            </button>
          </div>

          {loading && !data ? (
            <div className="card-body grid">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={40} />
              ))}
            </div>
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={<Send size={22} />}
              title="No submissions yet"
              text="Run a match in the studio and approve it. Approved submissions are saved to PostgreSQL."
              action={
                <button className="btn btn-primary" onClick={() => navigate("studio")}>
                  Open Match Studio
                </button>
              }
            />
          ) : (
            submissions.slice(0, 6).map((s) => (
              <div key={s.id} className="list-row clickable" onClick={() => navigate("submissions", { open: s.id })}>
                <Avatar name={s.candidate_name} size="sm" />
                <div className="list-main">
                  <div className="list-title">{s.candidate_name}</div>
                  <div className="list-sub">
                    {s.job_title} · {s.job_company}
                  </div>
                </div>
                <span className="subtle hide-sm" style={{ fontSize: 12.5 }}>
                  {timeAgo(s.created_at)}
                </span>
                <ScorePill score={s.match_score} />
              </div>
            ))
          )}
        </div>

        <div className="span-4 grid" style={{ alignContent: "start" }}>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Briefcase size={16} /> Roles by demand
              </h2>
            </div>
            <div className="card-body grid" style={{ gap: 14 }}>
              {loading && !data
                ? [0, 1, 2].map((i) => <Skeleton key={i} height={34} />)
                : topJobs.map((j) => (
                    <div key={j.id}>
                      <div className="row-between" style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>{j.title}</span>
                        <span className="subtle">{j.submission_count ?? 0} submitted</span>
                      </div>
                      <div className="demand-bar">
                        <span style={{ width: `${((j.submission_count ?? 0) / maxDemand) * 100}%` }} />
                      </div>
                    </div>
                  ))}
              {!loading && jobs.length === 0 && <span className="muted">No jobs yet.</span>}
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-label">How a match runs</div>
            <div className="flow-mini">
              {FLOW.map((step, i) => (
                <span key={step} className="row" style={{ gap: 6 }}>
                  <span className={`step ${step === "Human approval" ? "hl" : ""}`}>
                    {step === "Human approval" && <Hand size={12} />}
                    {step}
                  </span>
                  {i < FLOW.length - 1 && <span className="sep">→</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

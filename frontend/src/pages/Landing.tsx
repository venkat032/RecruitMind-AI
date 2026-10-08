import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Briefcase,
  Check,
  Clock,
  Database,
  FileText,
  FileUp,
  Gauge,
  Hand,
  KeyRound,
  Lock,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { idlePipeline, Pipeline, type PipelineState } from "../components/Pipeline";
import { Wordmark } from "../components/Sidebar";
import { ScoreRing } from "../components/ui";
import { navigate } from "../lib";
import type { NodeId } from "../types";

/* ---------------- hero demo: a replay of the real agent pipeline ---------------- */

// Durations (ms) measured on a real run of the recruiter graph
const DEMO_MS: Record<NodeId, number> = {
  resume_agent: 3600,
  job_agent: 3600,
  matching_agent: 1600,
  score_agent: 2000,
  human_approval: 0,
  submission_agent: 200,
  email_agent: 5300,
};

const DEMO_STEPS: { done: NodeId[]; running: NodeId[]; waiting?: NodeId[] }[] = [
  { done: [], running: ["resume_agent", "job_agent"] },
  { done: ["resume_agent", "job_agent"], running: ["matching_agent"] },
  { done: ["resume_agent", "job_agent", "matching_agent"], running: ["score_agent"] },
  { done: ["resume_agent", "job_agent", "matching_agent", "score_agent"], running: [], waiting: ["human_approval"] },
  { done: ["resume_agent", "job_agent", "matching_agent", "score_agent", "human_approval"], running: ["submission_agent"] },
  {
    done: ["resume_agent", "job_agent", "matching_agent", "score_agent", "human_approval", "submission_agent"],
    running: ["email_agent"],
  },
  {
    done: ["resume_agent", "job_agent", "matching_agent", "score_agent", "human_approval", "submission_agent", "email_agent"],
    running: [],
  },
];

const STEP_DURATION = [1500, 1200, 1200, 2200, 1000, 1400, 3200];

function demoState(step: number): PipelineState {
  const state = idlePipeline();
  const { done, running, waiting = [] } = DEMO_STEPS[step];
  for (const id of done) state[id] = { status: "done", ms: id === "human_approval" ? undefined : DEMO_MS[id] };
  for (const id of running) state[id] = { status: "running" };
  for (const id of waiting) state[id] = { status: "waiting" };
  return state;
}

function HeroDemo() {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (step === DEMO_STEPS.length - 1) {
        setStep(0);
        setCycle((c) => c + 1);
      } else {
        setStep(step + 1);
      }
    }, STEP_DURATION[step]);
    return () => window.clearTimeout(id);
  }, [step]);

  const scored = step >= 2;
  const phase =
    step === 3 ? (
      <span className="badge warning">Awaiting your approval</span>
    ) : step === DEMO_STEPS.length - 1 ? (
      <span className="badge success">Submitted · email drafted</span>
    ) : (
      <span className="badge accent">Agents working</span>
    );

  return (
    <div className="demo-wrap reveal">
      <div className="demo">
        <div className="demo-chrome">
          <div className="demo-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="demo-url">
            <Lock size={11} /> recruitmind.ai/app · Match Studio
          </div>
        </div>

        <div className="demo-body">
          <div className="demo-head">
            <div className="demo-match">
              <Users size={16} className="subtle" /> Candidate
              <span className="subtle" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 20 }}>
                ×
              </span>
              <Briefcase size={16} className="subtle" /> Senior AI Engineer
            </div>
            {phase}
          </div>

          <Pipeline state={demoState(step)} />

          <div className="demo-results">
            <div className="demo-score">
              {scored ? (
                <>
                  <ScoreRing key={cycle} score={86} size={150} />
                  <span className="badge success">Strong Match</span>
                </>
              ) : (
                <div className="demo-placeholder" style={{ width: 150 }}>
                  <div className="skeleton" style={{ height: 150, borderRadius: "50%" }} />
                </div>
              )}
            </div>

            <div className="demo-panel">
              {scored ? (
                <div className="grid fade-in" style={{ gap: 14 }}>
                  <div>
                    <div className="section-label">Matched skills · 4 of 5</div>
                    <div className="chips">
                      {["Python", "FastAPI", "LangGraph", "PostgreSQL"].map((s) => (
                        <span key={s} className="chip success">
                          <Check size={12} /> {s}
                        </span>
                      ))}
                      <span className="chip danger">
                        <X size={12} /> Kubernetes
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="section-label">Assessment</div>
                    <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                      Strong backend and agent-orchestration experience that exceeds the 3-year requirement.
                      Kubernetes is the only gap, and it can be learned on the job.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="demo-placeholder">
                  <div className="row subtle" style={{ fontSize: 13 }}>
                    <Bot size={15} /> Resume and Job agents are reading in parallel…
                  </div>
                  <div className="skeleton" style={{ height: 12, width: "90%" }} />
                  <div className="skeleton" style={{ height: 12, width: "70%" }} />
                  <div className="skeleton" style={{ height: 12, width: "80%" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- content ---------------- */

const AGENTS: {
  icon: typeof FileText;
  name: string;
  kind: "llm" | "code" | "human";
  tag: string;
  text: string;
  out: string;
}[] = [
  {
    icon: FileText,
    name: "Resume Agent",
    kind: "llm",
    tag: "LLM · runs in parallel",
    text: "Reads the uploaded PDF resume and extracts the facts that matter, without inventing anything.",
    out: "name · skills · years of experience · education · summary",
  },
  {
    icon: Briefcase,
    name: "Job Agent",
    kind: "llm",
    tag: "LLM · runs in parallel",
    text: "Decodes the job description into must-have skills, nice-to-haves and the experience bar.",
    out: "required skills · preferred skills · experience · responsibilities",
  },
  {
    icon: Target,
    name: "Matching Agent",
    kind: "code",
    tag: "Deterministic Python",
    text: "Calculates the match score with transparent math. The LLM explains it but can never change it.",
    out: "score · matched skills · missing skills · experience fit",
  },
  {
    icon: Gauge,
    name: "Assessment Agent",
    kind: "llm",
    tag: "LLM",
    text: "Writes the recruiter's view on top of the score, the way a senior recruiter would brief you.",
    out: "recommendation · strengths · concerns · reasoning",
  },
  {
    icon: Hand,
    name: "Human Approval",
    kind: "human",
    tag: "You · checkpoint",
    text: "The workflow pauses here. Nothing is submitted until a recruiter approves or rejects.",
    out: "approve → continue · reject → stop, nothing saved",
  },
  {
    icon: Send,
    name: "Submission Agent",
    kind: "code",
    tag: "Tool call · PostgreSQL",
    text: "Records the approved submission with its score and recommendation in your database.",
    out: "submission record · status approved",
  },
  {
    icon: Mail,
    name: "Email Agent",
    kind: "llm",
    tag: "LLM",
    text: "Drafts a professional submission email for the hiring manager, ready to review and send.",
    out: "subject · body · saved as a draft",
  },
];

const STEPS = [
  {
    title: "Upload the resume",
    text: "Drop in a PDF. Its text is extracted and stored with the candidate; the file is kept on your server.",
    time: "1 click",
  },
  {
    title: "Agents analyse in parallel",
    text: "The Resume and Job agents work at the same time, then hand off to Matching and Assessment.",
    time: "≈ 7 seconds",
  },
  {
    title: "Review a transparent score",
    text: "See exactly which skills matched, which are missing, and why the agent recommends the candidate.",
    time: "At a glance",
  },
  {
    title: "Approve and it's submitted",
    text: "One click saves the submission and drafts the email. Reject and nothing leaves the building.",
    time: "1 decision",
  },
];

const FEATURES = [
  { icon: FileUp, title: "PDF resume intake", text: "Validated uploads up to 5 MB, text extracted automatically and linked to the candidate." },
  { icon: Workflow, title: "Live Match Studio", text: "Watch every agent finish in real time, with timings, results and a full activity log." },
  { icon: Gauge, title: "Explainable scoring", text: "70% skills, 30% experience. The same inputs always give the same score." },
  { icon: Send, title: "Submission tracking", text: "Every approved candidate, score and recommendation in one searchable table." },
  { icon: Mail, title: "Email drafts", text: "Professional submission emails written for you and saved, never sent without you." },
  { icon: MessageSquare, title: "Recruiting Copilot", text: "Ask \"AI jobs in Hyderabad?\" and get answers straight from your database." },
];

/* ---------------- page ---------------- */

function useReveal() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elements = root.current?.querySelectorAll(".reveal") ?? [];

    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("shown"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("shown");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return root;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Landing({ signedIn }: { signedIn: boolean }) {
  const root = useReveal();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const primary = signedIn
    ? { label: "Open dashboard", go: () => navigate("dashboard") }
    : { label: "Start screening free", go: () => navigate("register") };

  return (
    <div className="site" ref={root}>
      {/* ---------- nav ---------- */}
      <header className={`site-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="container">
          <a href="#/home" aria-label="RecruitMind AI home" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <Wordmark />
          </a>
          <nav className="site-links">
            <button onClick={() => scrollToId("agents")}>Agents</button>
            <button onClick={() => scrollToId("how")}>How it works</button>
            <button onClick={() => scrollToId("scoring")}>Scoring</button>
            <button onClick={() => scrollToId("security")}>Security</button>
          </nav>
          <div className="site-actions">
            {signedIn ? (
              <button className="btn btn-primary" onClick={() => navigate("dashboard")}>
                Open dashboard <ArrowRight size={15} />
              </button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={() => navigate("login")}>
                  Sign in
                </button>
                <button className="btn btn-primary" onClick={() => navigate("register")}>
                  Get started
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="lp-hero">
        <div className="container">
          <div className="pill fade-in">
            <span className="pill-tag">Agentic AI</span>
            <span className="live-dot" />
            7 AI agents screening candidates for you
          </div>

          <h1 className="lp-title fade-in" style={{ animationDelay: "80ms" }}>
            Screen candidates in <em>seconds,</em> not hours.
          </h1>

          <p className="lp-lead fade-in" style={{ animationDelay: "160ms" }}>
            RecruitMind AI gives every recruiter a team of autonomous AI agents. They read the resume, decode the
            job, score the match with transparent math and draft the submission email, then wait for your approval.
          </p>

          <div className="lp-cta fade-in" style={{ animationDelay: "240ms" }}>
            <button className="btn btn-primary btn-lg" onClick={primary.go}>
              {primary.label} <ArrowRight size={17} />
            </button>
            <button className="btn btn-lg" onClick={() => scrollToId("agents")}>
              <Bot size={17} /> Meet the agents
            </button>
          </div>

          <div className="lp-note fade-in" style={{ animationDelay: "320ms" }}>
            <span>
              <Check size={14} /> Human approval on every submission
            </span>
            <span>
              <Check size={14} /> Explainable, repeatable scores
            </span>
            <span>
              <Check size={14} /> Your data stays in your PostgreSQL
            </span>
          </div>

          <HeroDemo />
        </div>
      </section>

      {/* ---------- tech strip ---------- */}
      <section className="lp-section tight">
        <div className="container">
          <div className="tech-strip reveal">
            <span>Built on</span>
            <strong>LangGraph</strong>
            <strong>OpenAI GPT-4o mini</strong>
            <strong>FastAPI</strong>
            <strong>PostgreSQL</strong>
            <strong>LangChain</strong>
          </div>
        </div>
      </section>

      {/* ---------- stats ---------- */}
      <section className="lp-section tight">
        <div className="container">
          <div className="stats reveal">
            <div className="stat">
              <div className="stat-value">≈7s</div>
              <div className="stat-label">Resume to scored assessment</div>
              <div className="stat-note">Measured on a real run of the agent pipeline</div>
            </div>
            <div className="stat">
              <div className="stat-value">7</div>
              <div className="stat-label">Specialised agents</div>
              <div className="stat-note">Each with one job, orchestrated by LangGraph</div>
            </div>
            <div className="stat">
              <div className="stat-value">70/30</div>
              <div className="stat-label">Skills / experience weighting</div>
              <div className="stat-note">Calculated in code, never guessed by the AI</div>
            </div>
            <div className="stat">
              <div className="stat-value">100%</div>
              <div className="stat-label">Human-approved submissions</div>
              <div className="stat-note">Nothing is sent without your decision</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- faster screening ---------- */}
      <section className="lp-section">
        <div className="container">
          <div className="lp-head reveal">
            <div className="lp-kicker">
              <Timer size={14} /> Faster screening
            </div>
            <h2 className="lp-h2">
              Stop reading every resume <em>line by line.</em>
            </h2>
            <p className="lp-sub">
              Screening is the slowest part of recruiting. RecruitMind AI hands the repetitive work to agents, so
              recruiters spend their time on decisions and conversations, not copy-and-compare.
            </p>
          </div>

          <div className="compare">
            <div className="compare-card before reveal">
              <div className="compare-title">
                <h3>Manual screening</h3>
                <span className="badge">
                  <Clock size={12} /> Minutes per resume
                </span>
              </div>
              <ul className="compare-list">
                {[
                  ["Read the whole resume", "to find skills and years of experience."],
                  ["Re-read the job description", "and compare requirement by requirement."],
                  ["Judge the fit from memory", "so two recruiters can score the same person differently."],
                  ["Write up notes", "to justify the decision to the hiring manager."],
                  ["Draft the submission email", "from scratch, every single time."],
                ].map(([b, t]) => (
                  <li key={b}>
                    <span className="ico">
                      <X size={13} />
                    </span>
                    <span>
                      <b>{b}</b> {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="compare-card after reveal">
              <div className="compare-title">
                <h3>With RecruitMind AI</h3>
                <span className="badge success">
                  <Sparkles size={12} /> Seconds per resume
                </span>
              </div>
              <ul className="compare-list">
                {[
                  ["The Resume Agent extracts skills and experience", "the moment the PDF is uploaded."],
                  ["The Job Agent structures the requirements", "in parallel, at the same time."],
                  ["The Matching Agent scores with fixed rules", "so every candidate is judged the same way."],
                  ["The Assessment Agent writes the reasoning", "with strengths and concerns, ready to share."],
                  ["The Email Agent drafts the submission", "as soon as you click approve."],
                ].map(([b, t]) => (
                  <li key={b}>
                    <span className="ico">
                      <Check size={13} />
                    </span>
                    <span>
                      <b>{b}</b> {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- agents ---------- */}
      <section className="lp-section alt" id="agents">
        <div className="container">
          <div className="lp-head reveal">
            <div className="lp-kicker">
              <Bot size={14} /> Agentic AI at work
            </div>
            <h2 className="lp-h2">
              Meet your <em>agentic</em> recruiting team.
            </h2>
            <p className="lp-sub">
              Each agent is autonomous and owns one job. LangGraph orchestrates them: they run in parallel where
              they can, hand their findings to the next agent, and stop for a human before anything is submitted.
            </p>
          </div>

          <div className="agents">
            {AGENTS.map((a, i) => (
              <div
                key={a.name}
                className={`agent reveal ${a.kind}`}
                style={{ transitionDelay: `${(i % 4) * 70}ms` }}
              >
                <div className="agent-top">
                  <div className="agent-icon">
                    <a.icon size={19} />
                  </div>
                  <span className="agent-step">0{i + 1}</span>
                </div>
                <h3>{a.name}</h3>
                <span className={`badge plain ${a.kind === "human" ? "warning" : a.kind === "code" ? "" : "accent"}`} style={{ width: "fit-content" }}>
                  {a.tag}
                </span>
                <p>{a.text}</p>
                <div className="agent-out">
                  <b>Output:</b> {a.out}
                </div>
              </div>
            ))}
            <div className="agent reveal" style={{ justifyContent: "center", background: "var(--accent-soft)", borderColor: "var(--accent-ring)" }}>
              <Workflow size={26} color="var(--accent)" />
              <h3>One orchestrated workflow</h3>
              <p>
                State flows between agents automatically. You see every hand-off live in the Match Studio.
              </p>
            </div>
          </div>

          <div className="agents-note reveal">
            <ShieldCheck size={22} />
            <span>
              <b style={{ color: "var(--text)" }}>Agents act through tools, never raw SQL.</b> The AI produces
              structured results; application code validates them and writes to PostgreSQL. IDs always come from your
              database, never from the model.
            </span>
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="lp-section" id="how">
        <div className="container">
          <div className="lp-head reveal">
            <div className="lp-kicker">
              <Workflow size={14} /> How it works
            </div>
            <h2 className="lp-h2">
              From PDF to a submission in <em>four steps.</em>
            </h2>
          </div>

          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="step-card reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                <div className="step-num">0{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <div className="step-time">
                  <Clock size={13} /> {s.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- scoring ---------- */}
      <section className="lp-section alt" id="scoring">
        <div className="container split">
          <div className="reveal">
            <div className="lp-kicker">
              <Gauge size={14} /> Explainable scoring
            </div>
            <h2 className="lp-h2">
              No black-box <em>scores.</em>
            </h2>
            <p className="lp-sub">
              The match score is calculated by deterministic Python, not guessed by a language model. The AI explains
              the result; it can't change it. Same resume, same job, same score, every time.
            </p>

            <div className="formula">
              <div className="formula-row">
                <div className="formula-weight">70%</div>
                <div>
                  <b>Skill score</b>
                  <span>Matched required skills ÷ total required skills</span>
                </div>
              </div>
              <div className="formula-row">
                <div className="formula-weight">30%</div>
                <div>
                  <b>Experience score</b>
                  <span>100 if the candidate meets the required years, otherwise 0</span>
                </div>
              </div>
            </div>
          </div>

          <div className="calc-card reveal">
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ margin: 0 }}>
                Worked example
              </span>
              <span className="badge success">Strong Match</span>
            </div>
            <div style={{ display: "grid", placeItems: "center", margin: "10px 0 18px" }}>
              <ScoreRing score={86} size={170} />
            </div>
            <div className="calc-line">
              <code>skills 4 / 5 = 80 × 0.70</code>
              <b>56.0</b>
            </div>
            <div className="calc-line">
              <code>experience 5 yrs ≥ 3 yrs → 100 × 0.30</code>
              <b>30.0</b>
            </div>
            <div className="calc-line">
              <code>final match score</code>
              <b style={{ color: "var(--success)" }}>86.0</b>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- control + security ---------- */}
      <section className="lp-section" id="security">
        <div className="container">
          <div className="lp-head reveal">
            <div className="lp-kicker">
              <ShieldCheck size={14} /> Control and security
            </div>
            <h2 className="lp-h2">
              Autonomous agents, <em>accountable</em> outcomes.
            </h2>
          </div>

          <div className="duo">
            <div className="duo-card reveal">
              <div className="agent-icon" style={{ background: "var(--warning)", color: "#1d1300" }}>
                <Hand size={19} />
              </div>
              <h3>You make the final call</h3>
              <p>
                The workflow pauses at a human checkpoint. Approve and the submission and email draft are created.
                Reject and nothing is saved.
              </p>
              <div className="mock-approval">
                <div>
                  <div style={{ fontWeight: 650 }}>Human approval required</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    86% match · Strong Match
                  </div>
                </div>
                <div className="row">
                  <span className="btn btn-sm btn-danger">
                    <X size={14} /> Reject
                  </span>
                  <span className="btn btn-sm btn-success">
                    <Check size={14} /> Approve
                  </span>
                </div>
              </div>
            </div>

            <div className="duo-card reveal">
              <div className="agent-icon">
                <KeyRound size={19} />
              </div>
              <h3>Enterprise-grade access security</h3>
              <p>Every workspace is protected by authentication built to industry standards.</p>
              <ul className="check-list">
                <li>
                  <BadgeCheck size={17} />
                  <span>
                    <b>Argon2id password hashing</b>: passwords are never stored or logged.
                  </span>
                </li>
                <li>
                  <BadgeCheck size={17} />
                  <span>
                    <b>Server-side sessions</b> in HttpOnly, SameSite cookies, revocable on sign-out.
                  </span>
                </li>
                <li>
                  <BadgeCheck size={17} />
                  <span>
                    <b>Brute-force protection</b>: account lockout plus rate limiting.
                  </span>
                </li>
                <li>
                  <BadgeCheck size={17} />
                  <span>
                    <b>Audit log</b> of every sign-in, sign-out and failed attempt.
                  </span>
                </li>
                <li>
                  <BadgeCheck size={17} />
                  <span>
                    <b>Your data, your database</b>: everything is persisted in your own PostgreSQL.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section className="lp-section alt">
        <div className="container">
          <div className="lp-head reveal">
            <div className="lp-kicker">
              <Database size={14} /> The platform
            </div>
            <h2 className="lp-h2">
              Everything your recruiting desk <em>needs.</em>
            </h2>
          </div>

          <div className="features">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="feature reveal" style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <div className="feature-icon">
                  <f.icon size={19} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- final CTA ---------- */}
      <section className="lp-section">
        <div className="container">
          <div className="final-cta reveal">
            <h2>
              Give every recruiter an <em>agentic</em> team.
            </h2>
            <p>Create your workspace in under a minute and screen your first candidate in seconds.</p>
            <div className="lp-cta" style={{ marginTop: 0 }}>
              <button className="btn btn-lg btn-white" onClick={primary.go}>
                {primary.label} <ArrowRight size={17} />
              </button>
              {!signedIn && (
                <button className="btn btn-lg btn-glass" onClick={() => navigate("login")}>
                  Sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer" style={{ marginTop: 0 }}>
        <div className="container">
          <Wordmark />
          <span>Agentic recruiting · LangGraph · FastAPI · PostgreSQL</span>
          <span>© {new Date().getFullYear()} RecruitMind AI</span>
        </div>
      </footer>
    </div>
  );
}

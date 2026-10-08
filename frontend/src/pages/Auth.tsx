import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Bot, Check, Eye, EyeOff, Gauge, Hand, LoaderCircle, Lock, ShieldCheck } from "lucide-react";

import { api } from "../api";
import { Wordmark } from "../components/Sidebar";
import { useToast } from "../components/Toasts";
import { ErrorBox } from "../components/ui";
import { navigate } from "../lib";
import type { User } from "../types";

/* ---------------- layout ---------------- */

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        {/* the aside is always dark, so always use the light-text logo */}
        <span className="wordmark" role="img" aria-label="RecruitMind AI">
          <img src={`${import.meta.env.BASE_URL}brand/wordmark-dark.png`} alt="" />
        </span>

        <div className="auth-aside-body">
          <h2>
            Your <em>agentic</em> recruiting team is ready.
          </h2>
          <p>
            Seven AI agents read resumes, decode roles and score every match in seconds, then wait for your
            approval.
          </p>
          <ul className="auth-points">
            <li>
              <span className="ico">
                <Bot size={16} />
              </span>
              Resume and Job agents work in parallel
            </li>
            <li>
              <span className="ico">
                <Gauge size={16} />
              </span>
              Transparent 70/30 skills and experience score
            </li>
            <li>
              <span className="ico">
                <Hand size={16} />
              </span>
              Nothing is submitted without your approval
            </li>
          </ul>
        </div>

        <div className="auth-aside-foot">© {new Date().getFullYear()} RecruitMind AI · Agentic recruiting</div>
      </aside>

      <main className="auth-main">
        <div className="auth-top">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("home")}>
            <ArrowLeft size={15} /> Back to home
          </button>
          <Wordmark />
        </div>
        <div className="auth-form-wrap fade-in">{children}</div>
      </main>
    </div>
  );
}

function PasswordInput(props: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  id: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="pw-field">
      <input
        id={props.id}
        className="input"
        type={visible ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        maxLength={128}
        required
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function SecureNote() {
  return (
    <div className="auth-secure">
      <Lock size={13} /> Argon2id-hashed passwords · HttpOnly session cookies · audited sign-ins
    </div>
  );
}

/* ---------------- sign in ---------------- */

export function Login({ onSignedIn, next }: { onSignedIn: (user: User) => void; next?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const user = await api.login({ email: email.trim(), password, remember_me: remember });
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="sub">Sign in to your RecruitMind AI workspace.</p>

      {next && !error && (
        <div style={{ marginBottom: 16 }} className="badge accent">
          Please sign in to continue
        </div>
      )}

      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <ErrorBox message={error} />}

        <div className="field">
          <label className="label" htmlFor="login-email">
            Work email
          </label>
          <input
            id="login-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@company.com"
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="login-password">
            Password
          </label>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in for 30 days
        </label>

        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="auth-switch">
        New to RecruitMind AI? <a href="#/register">Create an account</a>
      </div>
      <SecureNote />
    </AuthLayout>
  );
}

/* ---------------- register ---------------- */

const COMMON = [
  "password", "qwertyuiop", "qwerty", "iloveyou", "letmein", "welcome", "admin", "administrator",
  "changeme", "recruitmind", "recruiter", "football", "monkey", "dragon", "sunshine", "princess",
];

/** Mirrors app/services/auth_service.py password_problems(); the server stays authoritative. */
function passwordRules(password: string, email: string, name: string) {
  const lowered = password.toLowerCase();
  const core = lowered.replace(/[^a-z]/g, "");
  const personal = [email.split("@")[0], ...name.split(/\s+/)].filter((p) => p.length >= 3);

  return [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Letters and numbers", ok: /[a-z]/i.test(password) && /\d/.test(password) },
    {
      label: "Not a common password",
      ok: password.length > 0 && !COMMON.includes(core) && !COMMON.includes(lowered) && new Set(lowered).size > 3,
    },
    {
      label: "No name or email",
      ok: password.length > 0 && !personal.some((p) => lowered.includes(p.toLowerCase())),
    },
  ];
}

const STRENGTH_COLORS = ["var(--danger)", "var(--danger)", "var(--warning)", "var(--warning)", "var(--success)"];

export function Register({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: "", email: "", company: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const rules = useMemo(() => passwordRules(form.password, form.email, form.full_name), [form]);
  const passed = rules.filter((r) => r.ok).length;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const valid = form.full_name.trim().length >= 2 && form.email.includes("@") && passed === rules.length && form.confirm === form.password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(undefined);

    try {
      const user = await api.register({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        company: form.company.trim() || null,
        password: form.password,
      });
      toast("success", `Welcome, ${user.full_name.split(" ")[0]}!`, "Your workspace is ready.");
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Create your account</h1>
      <p className="sub">Start screening candidates with AI agents in under a minute.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <ErrorBox message={error} />}

        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="reg-name">
              Full name
            </label>
            <input
              id="reg-name"
              className="input"
              value={form.full_name}
              onChange={(e) => set("full_name")(e.target.value)}
              autoComplete="name"
              placeholder="Priya Sharma"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="reg-company">
              Company <span className="subtle">(optional)</span>
            </label>
            <input
              id="reg-company"
              className="input"
              value={form.company}
              onChange={(e) => set("company")(e.target.value)}
              autoComplete="organization"
              placeholder="Acme Talent"
            />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="reg-email">
            Work email
          </label>
          <input
            id="reg-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="reg-password">
            Password
          </label>
          <PasswordInput id="reg-password" value={form.password} onChange={set("password")} autoComplete="new-password" />
          <div className="strength" aria-hidden>
            {rules.map((_, i) => (
              <span key={i} style={{ background: i < passed ? STRENGTH_COLORS[passed] : undefined }} />
            ))}
          </div>
          <ul className="rules">
            {rules.map((r) => (
              <li key={r.label} className={r.ok ? "ok" : ""}>
                <Check size={13} /> {r.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="field">
          <label className="label" htmlFor="reg-confirm">
            Confirm password
          </label>
          <PasswordInput id="reg-confirm" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
          {mismatch && (
            <span className="hint" style={{ color: "var(--danger)" }}>
              Passwords don't match.
            </span>
          )}
        </div>

        <button className="btn btn-primary btn-block" disabled={busy || !valid}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
          {busy ? "Creating your workspace…" : "Create account"}
        </button>
      </form>

      <div className="auth-switch">
        Already have an account? <a href="#/login">Sign in</a>
      </div>
      <SecureNote />
    </AuthLayout>
  );
}

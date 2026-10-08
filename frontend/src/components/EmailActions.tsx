import { useState, type FormEvent } from "react";
import { Check, CircleCheck, Copy, ExternalLink, LoaderCircle, Mail, Send, UserRound } from "lucide-react";

import { api } from "../api";
import { timeAgo } from "../lib";
import type { EmailClient, EmailDraft, SubmissionDetails } from "../types";
import { useToast } from "./Toasts";

/* ---------------- compose links (the email opens in the recruiter's own mailbox) ---------------- */

interface Message {
  to: string;
  subject: string;
  body: string;
}

const q = encodeURIComponent;

const COMPOSE: Record<Exclude<EmailClient, "other">, { label: string; url: (m: Message) => string }> = {
  gmail: {
    label: "Gmail",
    url: (m) => `https://mail.google.com/mail/?view=cm&fs=1&to=${q(m.to)}&su=${q(m.subject)}&body=${q(m.body)}`,
  },
  outlook: {
    label: "Outlook",
    url: (m) => `https://outlook.office.com/mail/deeplink/compose?to=${q(m.to)}&subject=${q(m.subject)}&body=${q(m.body)}`,
  },
  mail_app: {
    label: "Mail app",
    url: (m) => `mailto:${q(m.to)}?subject=${q(m.subject)}&body=${q(m.body)}`,
  },
};

const VIA_LABEL: Record<EmailClient, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  mail_app: "the mail app",
  other: "email",
};

type DraftLike = Pick<EmailDraft, "id" | "subject" | "body" | "status"> &
  Partial<Pick<EmailDraft, "recipient_email" | "sent_at" | "sent_via" | "sent_by_name">>;

export function EmailActions(props: {
  draft: DraftLike;
  submissionId: number;
  jobId: number;
  /** The job's current hiring contact (may be newer than the address saved on the draft). */
  contactEmail: string | null;
  contactName?: string | null;
  onChanged?: (details?: SubmissionDetails) => void;
}) {
  const toast = useToast();
  const [contact, setContact] = useState({ email: props.contactEmail, name: props.contactName ?? null });
  const [status, setStatus] = useState(props.draft);
  const [opened, setOpened] = useState<EmailClient | null>(null);
  const [saving, setSaving] = useState(false);

  const to = contact.email || status.recipient_email || "";
  const sent = status.status === "sent";

  const open = (client: Exclude<EmailClient, "other">) => {
    const url = COMPOSE[client].url({ to, subject: status.subject, body: status.body });

    if (client === "mail_app") window.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");

    setOpened(client);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${to}\nSubject: ${status.subject}\n\n${status.body}`);
      toast("success", "Email copied", "Paste it into any mail client.");
      setOpened((o) => o ?? "other");
    } catch {
      toast("error", "Couldn't access the clipboard");
    }
  };

  const markSent = async () => {
    setSaving(true);
    try {
      const details = await api.markEmailSent(props.submissionId, status.id, opened ?? "other");
      const updated = details.email_drafts.find((d) => d.id === status.id);
      if (updated) setStatus(updated);
      setOpened(null);
      toast("success", "Marked as sent", "The submission is now Submitted.");
      props.onChanged?.(details);
    } catch (e) {
      toast("error", "Couldn't update the email", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="email-preview" style={{ margin: 0 }}>
      <dl className="email-meta">
        <dt>To</dt>
        <dd>
          {to ? (
            <span className="row" style={{ gap: 6 }}>
              <UserRound size={13} className="subtle" />
              {contact.name ? `${contact.name} <${to}>` : to}
            </span>
          ) : (
            <span style={{ color: "var(--warning)" }}>No hiring contact for this job yet</span>
          )}
        </dd>
        <dt>Subject</dt>
        <dd>{status.subject}</dd>
        <dt>Status</dt>
        <dd>
          {sent ? (
            <span className="badge success">
              Sent{status.sent_via ? ` via ${VIA_LABEL[status.sent_via]}` : ""}
            </span>
          ) : (
            <span className="badge warning">Draft · ready to send</span>
          )}
        </dd>
      </dl>

      <div className="email-body">{status.body}</div>

      {!to && (
        <ContactForm
          jobId={props.jobId}
          onSaved={(email, name) => {
            setContact({ email, name });
            toast("success", "Hiring contact saved", `Emails for this job go to ${email}.`);
            props.onChanged?.();
          }}
        />
      )}

      {sent && (
        <div className="email-sent-note">
          <CircleCheck size={16} />
          Sent {status.sent_at ? timeAgo(status.sent_at) : ""}
          {status.sent_by_name ? ` by ${status.sent_by_name}` : ""}
          {status.sent_via ? ` from ${VIA_LABEL[status.sent_via]}` : ""}
        </div>
      )}

      {opened && !sent && (
        <div className="email-confirm">
          <span>
            Opened in {VIA_LABEL[opened]}. Once you've sent it, mark it as sent so the team knows.
          </span>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => setOpened(null)}>
              Not yet
            </button>
            <button className="btn btn-success btn-sm" onClick={markSent} disabled={saving}>
              {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Mark as sent
            </button>
          </div>
        </div>
      )}

      <div className="email-actions">
        <span className="subtle" style={{ fontSize: 12.5, marginRight: "auto" }}>
          {sent ? "Open again in" : "Send from"}
        </span>
        {(Object.keys(COMPOSE) as (keyof typeof COMPOSE)[]).map((client) => (
          <button
            key={client}
            className={`btn btn-sm ${client === "gmail" && !sent ? "btn-primary" : ""}`}
            disabled={!to}
            onClick={() => open(client)}
            title={to ? `Open a ready-to-send draft in ${COMPOSE[client].label}` : "Add a hiring contact first"}
          >
            {client === "mail_app" ? <Mail size={14} /> : <ExternalLink size={14} />}
            {COMPOSE[client].label}
          </button>
        ))}
        <button className="btn btn-sm btn-ghost" onClick={copy} title="Copy To, Subject and body">
          <Copy size={14} /> Copy
        </button>
      </div>
    </div>
  );
}

/* ---------------- add a hiring contact inline ---------------- */

export function ContactForm(props: {
  jobId: number;
  initialName?: string | null;
  initialEmail?: string | null;
  onSaved: (email: string, name: string | null) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState(props.initialName ?? "");
  const [email, setEmail] = useState(props.initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const job = await api.updateJobContact(props.jobId, { contact_name: name.trim() || null, contact_email: email.trim() });
      props.onSaved(job.contact_email!, job.contact_name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={props.compact ? "grid" : "contact-form"} onSubmit={save} style={props.compact ? { gap: 12 } : undefined}>
      {!props.compact && (
        <div className="label" style={{ gridColumn: "1 / -1" }}>
          Who should receive submissions for this job?
        </div>
      )}
      <input className="input" placeholder="Hiring contact name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input"
        type="email"
        placeholder="hiring.manager@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button className="btn btn-primary" disabled={busy || !email.includes("@")}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Save contact
      </button>
      {error && (
        <div className="hint" style={{ color: "var(--danger)", gridColumn: "1 / -1" }}>
          {error}
        </div>
      )}
    </form>
  );
}

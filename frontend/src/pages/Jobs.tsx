import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Briefcase, BriefcaseBusiness, LoaderCircle, Mail, MapPin, Pencil, Plus, Search, Sparkles, TriangleAlert, Wallet } from "lucide-react";

import { api } from "../api";
import { ContactForm } from "../components/EmailActions";
import { useToast } from "../components/Toasts";
import { CardSkeletons, CompanyLogo, Drawer, EmptyState, ErrorBox, PageHeader } from "../components/ui";
import { formatSalary, navigate, splitSkills, useAsync } from "../lib";
import type { Job } from "../types";

export default function Jobs() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.jobs());
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((j) =>
      [j.title, j.company, j.location, j.skills].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, query]);

  return (
    <>
      <PageHeader
        eyebrow={<><Briefcase size={14} /> Open roles</>}
        title={<>Jobs <em>worth filling</em></>}
        subtitle="The Job Agent turns each description into required skills, preferred skills and experience, which the deterministic matcher scores against."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Add job
          </button>
        }
      />

      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            className="input"
            placeholder="Search title, company, skill, city…"
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

      {loading && !data ? (
        <CardSkeletons height={230} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Briefcase size={22} />}
            title={query ? "No matching jobs" : "No jobs yet"}
            text={query ? "Try a different search term." : "Add a role to start matching candidates against it."}
            action={
              !query && (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Add job
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="cards-grid">
          {filtered.map((j, i) => {
            const skills = splitSkills(j.skills);
            return (
              <div key={j.id} className="card fade-in" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                <div className="entity-card">
                  <div className="entity-head">
                    <CompanyLogo company={j.company} />
                    <div className="list-main">
                      <div className="entity-name">{j.title}</div>
                      <div className="entity-meta">
                        <span>
                          <BriefcaseBusiness size={12} /> {j.company}
                        </span>
                        {j.location && (
                          <span>
                            <MapPin size={12} /> {j.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {j.description && <p className="clamp-3">{j.description}</p>}

                  {skills.length > 0 && (
                    <div className="chips">
                      {skills.slice(0, 6).map((s) => (
                        <span key={s} className="chip accent">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="job-contact">
                    {j.contact_email ? (
                      <>
                        <Mail size={13} className="subtle" />
                        <span title={j.contact_email}>
                          {j.contact_name ? `${j.contact_name} · ` : ""}
                          {j.contact_email}
                        </span>
                      </>
                    ) : (
                      <span className="badge warning">
                        <TriangleAlert size={12} /> No hiring contact
                      </span>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: "auto", flexShrink: 0 }}
                      onClick={() => setEditing(j)}
                    >
                      <Pencil size={13} /> {j.contact_email ? "Edit" : "Add contact"}
                    </button>
                  </div>

                  <div className="entity-foot">
                    <span className="row" style={{ gap: 6 }}>
                      <Wallet size={14} className="subtle" />
                      <span className="salary">{formatSalary(j.salary)}</span>
                    </span>
                    <button className="btn btn-sm" onClick={() => navigate("studio", { job: j.id })}>
                      <Sparkles size={14} /> Find a match
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="drawer-title">Hiring contact</h2>
            <p className="muted" style={{ margin: "6px 0 18px" }}>
              Submission emails for <b>{editing.title}</b> at {editing.company} will be addressed to this person.
            </p>
            <ContactForm
              compact
              jobId={editing.id}
              initialName={editing.contact_name}
              initialEmail={editing.contact_email}
              onSaved={(email) => {
                toast("success", "Hiring contact saved", `Emails for ${editing.title} go to ${email}.`);
                setEditing(null);
                reload();
              }}
            />
          </div>
        </div>
      )}

      <CreateJobDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
    </>
  );
}

const EMPTY = {
  title: "",
  company: "",
  location: "",
  salary: "",
  skills: "",
  description: "",
  contact_name: "",
  contact_email: "",
};

function CreateJobDrawer(props: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = (key: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    try {
      const job = await api.createJob({
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim() || null,
        salary: form.salary ? Number(form.salary) : null,
        skills: form.skills.trim() || null,
        description: form.description.trim() || null,
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim(),
      });
      toast("success", `${job.title} created`, `${job.company} · saved to PostgreSQL`);
      setForm(EMPTY);
      props.onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="Add job"
      subtitle="The clearer the required skills, the more accurate the match score."
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="create-job"
            disabled={saving || !form.title || !form.company || !form.contact_email.includes("@")}
          >
            {saving ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {saving ? "Saving…" : "Save job"}
          </button>
        </>
      }
    >
      <form id="create-job" className="grid" onSubmit={submit}>
        {error && <ErrorBox message={error} />}

        <div className="field">
          <label className="label">
            Job title <span className="req">*</span>
          </label>
          <input className="input" value={form.title} onChange={set("title")} placeholder="AI Developer" required autoFocus />
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">
              Company <span className="req">*</span>
            </label>
            <input className="input" value={form.company} onChange={set("company")} placeholder="TechNova" required />
          </div>
          <div className="field">
            <label className="label">Location</label>
            <input className="input" value={form.location} onChange={set("location")} placeholder="Hyderabad" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Hiring contact</label>
            <input className="input" value={form.contact_name} onChange={set("contact_name")} placeholder="Meera Iyer" />
          </div>
          <div className="field">
            <label className="label">
              Contact email <span className="req">*</span>
            </label>
            <input
              className="input"
              type="email"
              value={form.contact_email}
              onChange={set("contact_email")}
              placeholder="hiring@technova.com"
              required
            />
          </div>
        </div>
        <span className="hint" style={{ marginTop: -6 }}>
          Approved candidates' submission emails are addressed to this contact, ready to send.
        </span>

        <div className="field">
          <label className="label">Annual salary (INR)</label>
          <input className="input" type="number" min={0} value={form.salary} onChange={set("salary")} placeholder="1000000" />
        </div>

        <div className="field">
          <label className="label">Required skills</label>
          <input className="input" value={form.skills} onChange={set("skills")} placeholder="Python, FastAPI, PostgreSQL, LangChain" />
          <span className="hint">Comma separated. These drive 70% of the match score.</span>
        </div>

        <div className="field">
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={form.description}
            onChange={set("description")}
            placeholder="Responsibilities, required years of experience, preferred skills…"
          />
          <span className="hint">Mention required years of experience: it drives the other 30%.</span>
        </div>
      </form>
    </Drawer>
  );
}

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { FileText, LoaderCircle, Mail, MapPin, Search, Sparkles, UserPlus, Users } from "lucide-react";

import { api } from "../api";
import { useToast } from "../components/Toasts";
import { Avatar, CardSkeletons, Drawer, Dropzone, EmptyState, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { formatDate, navigate, splitSkills, useAsync } from "../lib";
import type { Candidate } from "../types";

export default function Candidates({ params }: { params: URLSearchParams }) {
  const { data, error, loading, reload } = useAsync(() => api.candidates());
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [openId, setOpenId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((c) =>
      [c.name, c.email, c.location, c.skills].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, query]);

  const closeCreate = () => {
    setCreating(false);
    if (params.get("new")) navigate("candidates");
  };

  return (
    <>
      <PageHeader
        eyebrow={<><Users size={14} /> Talent pool</>}
        title={<>Your <em>candidates</em></>}
        subtitle="Every candidate is stored in PostgreSQL. Attach a PDF resume so the Resume Agent can analyse it."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <UserPlus size={16} /> Add candidate
          </button>
        }
      />

      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            className="input"
            placeholder="Search name, email, skill, city…"
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
        <CardSkeletons />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Users size={22} />}
            title={query ? "No matching candidates" : "No candidates yet"}
            text={query ? "Try a different search term." : "Add your first candidate and upload their resume."}
            action={
              !query && (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <UserPlus size={16} /> Add candidate
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="cards-grid">
          {filtered.map((c, i) => (
            <CandidateCard key={c.id} candidate={c} index={i} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      )}

      <CreateCandidateDrawer
        open={creating}
        onClose={closeCreate}
        onCreated={(id) => {
          closeCreate();
          reload();
          setOpenId(id);
        }}
      />

      {openId != null && (
        <CandidateDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}

function CandidateCard({ candidate: c, index, onOpen }: { candidate: Candidate; index: number; onOpen: () => void }) {
  const skills = splitSkills(c.skills);

  return (
    <div className="card interactive fade-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} onClick={onOpen}>
      <div className="entity-card">
        <div className="entity-head">
          <Avatar name={c.name} />
          <div className="list-main">
            <div className="entity-name">{c.name}</div>
            <div className="entity-meta">
              {c.email && (
                <span>
                  <Mail size={12} /> {c.email}
                </span>
              )}
              {c.location && (
                <span>
                  <MapPin size={12} /> {c.location}
                </span>
              )}
            </div>
          </div>
        </div>

        {skills.length > 0 ? (
          <div className="chips">
            {skills.slice(0, 5).map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
            {skills.length > 5 && <span className="chip">+{skills.length - 5}</span>}
          </div>
        ) : (
          <span className="subtle" style={{ fontSize: 13 }}>
            Skills will be extracted from the resume by the Resume Agent.
          </span>
        )}

        <div className="entity-foot">
          {c.has_resume ? (
            <span className="badge success">Resume on file</span>
          ) : (
            <span className="badge warning">No resume</span>
          )}
          <span className="subtle" style={{ fontSize: 12.5 }}>
            {c.experience != null ? `${c.experience} yrs · ` : ""}
            {c.submission_count ?? 0} submitted
          </span>
        </div>
      </div>
    </div>
  );
}

function CreateCandidateDrawer(props: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", location: "", skills: "", experience: "" });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const reset = () => {
    setForm({ name: "", email: "", location: "", skills: "", experience: "" });
    setFile(null);
    setError(undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    try {
      const candidate = await api.createCandidate({
        name: form.name.trim(),
        email: form.email.trim(),
        location: form.location.trim() || null,
        skills: form.skills.trim() || null,
        experience: form.experience ? Number(form.experience) : null,
      });

      if (file) {
        try {
          const upload = await api.uploadResume(file, candidate.id);
          toast("success", `${candidate.name} added`, `Resume saved · ${upload.text_length.toLocaleString()} characters extracted`);
        } catch (uploadError) {
          toast("error", `${candidate.name} added, but the resume failed`, (uploadError as Error).message);
        }
      } else {
        toast("success", `${candidate.name} added`, "Upload a resume before running a match.");
      }

      reset();
      props.onCreated(candidate.id);
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
      title="Add candidate"
      subtitle="Email is the unique key: one candidate per address."
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-candidate" disabled={saving || !form.name || !form.email}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <UserPlus size={16} />}
            {saving ? "Saving…" : "Save candidate"}
          </button>
        </>
      }
    >
      <form id="create-candidate" className="grid" onSubmit={submit}>
        {error && <ErrorBox message={error} />}

        <div className="field">
          <label className="label">
            Full name <span className="req">*</span>
          </label>
          <input className="input" value={form.name} onChange={set("name")} placeholder="Rahul Kumar" required autoFocus />
        </div>

        <div className="field">
          <label className="label">
            Email <span className="req">*</span>
          </label>
          <input className="input" type="email" value={form.email} onChange={set("email")} placeholder="rahul@example.com" required />
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Location</label>
            <input className="input" value={form.location} onChange={set("location")} placeholder="Hyderabad" />
          </div>
          <div className="field">
            <label className="label">Experience (years)</label>
            <input className="input" type="number" min={0} max={60} value={form.experience} onChange={set("experience")} placeholder="3" />
          </div>
        </div>

        <div className="field">
          <label className="label">Skills</label>
          <input className="input" value={form.skills} onChange={set("skills")} placeholder="Python, FastAPI, LangGraph" />
          <span className="hint">Comma separated. Optional: matching uses the skills the Resume Agent extracts.</span>
        </div>

        <div className="field">
          <label className="label">Resume</label>
          <Dropzone file={file} onFile={setFile} onError={(m) => toast("error", "Can't use that file", m)} />
        </div>
      </form>
    </Drawer>
  );
}

function CandidateDrawer(props: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: c, error, loading, reload } = useAsync(() => api.candidate(props.id), [props.id]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    if (!file || !c) return;
    setUploading(true);

    try {
      const result = await api.uploadResume(file, c.id);
      toast("success", "Resume saved", `${result.text_length.toLocaleString()} characters extracted and stored`);
      setFile(null);
      reload();
      props.onChanged();
    } catch (err) {
      toast("error", "Upload failed", (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer
      open
      onClose={props.onClose}
      title={c?.name ?? "Candidate"}
      subtitle={c ? `Candidate #${c.id} · added ${formatDate(c.created_at)}` : undefined}
      footer={
        c && (
          <button
            className="btn btn-primary"
            disabled={!c.resume_text}
            onClick={() => navigate("studio", { candidate: c.id })}
            title={c.resume_text ? undefined : "Upload a resume first"}
          >
            <Sparkles size={16} /> Run a match
          </button>
        )
      }
    >
      {error && <ErrorBox message={error} onRetry={reload} />}

      {loading && !c ? (
        <div className="grid">
          <Skeleton height={56} />
          <Skeleton height={120} />
        </div>
      ) : (
        c && (
          <>
            <div className="row" style={{ gap: 14 }}>
              <Avatar name={c.name} size="lg" />
              <div>
                <div className="entity-name" style={{ fontSize: 17 }}>
                  {c.name}
                </div>
                <div className="muted">{c.email}</div>
              </div>
            </div>

            <dl className="kv">
              <dt>Location</dt>
              <dd>{c.location || "—"}</dd>
              <dt>Experience</dt>
              <dd>{c.experience != null ? `${c.experience} years` : "—"}</dd>
              <dt>Resume file</dt>
              <dd className="mono">{c.resume_file_path || "—"}</dd>
              <dt>Last updated</dt>
              <dd>{formatDate(c.updated_at)}</dd>
            </dl>

            {splitSkills(c.skills).length > 0 && (
              <div>
                <div className="section-label">Skills</div>
                <div className="chips">
                  {splitSkills(c.skills).map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="section-label">{c.resume_text ? "Extracted resume text" : "Resume"}</div>
              {c.resume_text ? (
                <div className="prose-box">{c.resume_text}</div>
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  No resume yet. Upload one to enable matching.
                </div>
              )}
            </div>

            <div>
              <div className="section-label">{c.resume_text ? "Replace resume" : "Upload resume"}</div>
              <div className="grid" style={{ gap: 10 }}>
                <Dropzone file={file} onFile={setFile} onError={(m) => toast("error", "Can't use that file", m)} />
                {file && (
                  <button className="btn btn-primary" onClick={upload} disabled={uploading}>
                    {uploading ? <LoaderCircle size={16} className="spin" /> : <FileText size={16} />}
                    {uploading ? "Extracting text…" : "Upload & extract"}
                  </button>
                )}
              </div>
            </div>
          </>
        )
      )}
    </Drawer>
  );
}

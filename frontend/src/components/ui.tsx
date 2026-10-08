import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, FileUp, Inbox, TriangleAlert, X } from "lucide-react";

import { avatarGradient, initials, scoreTone, toneColor } from "../lib";

/* ---------------- page header ---------------- */

export function PageHeader(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1 className="page-title">{props.title}</h1>
        {props.subtitle && <p className="page-subtitle">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="header-actions">{props.actions}</div>}
    </header>
  );
}

/* ---------------- identity ---------------- */

export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return (
    <div className={`avatar ${size ?? ""}`} style={{ background: avatarGradient(name) }} aria-hidden>
      {initials(name)}
    </div>
  );
}

export function CompanyLogo({ company, size }: { company: string; size?: "sm" }) {
  return (
    <div className={`job-logo ${size ?? ""}`} style={{ color: `hsl(${(company.length * 47) % 360} 70% 62%)` }} aria-hidden>
      {company.trim()[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

/* ---------------- score ---------------- */

export function ScorePill({ score }: { score: number }) {
  const color = toneColor(scoreTone(score));

  return (
    <span className="score-pill">
      <span className="bar">
        <span style={{ width: `${Math.min(score, 100)}%`, background: color }} />
      </span>
      <span style={{ color }}>{Math.round(score)}%</span>
    </span>
  );
}

/** Animated ring + count-up number. */
export function ScoreRing({ score, size = 168 }: { score: number; size?: number }) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const duration = 1300;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(score * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const id = `ring-${size}`;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b7cff" />
            <stop offset="55%" stopColor="#5b8cff" />
            <stop offset="100%" stopColor="#3dd6f5" />
          </linearGradient>
        </defs>
        <circle className="track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={`url(#${id})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(shown, 100) / 100)}
        />
      </svg>
      <div className="center">
        <div className="score-number" style={{ fontSize: size * 0.26 }}>
          {shown.toFixed(score % 1 === 0 ? 0 : 1)}
          <small style={{ fontSize: size * 0.1 }}>%</small>
        </div>
        {size >= 150 && <div className="score-caption">Match score</div>}
      </div>
    </div>
  );
}

export function Meter({ label, value, note }: { label: string; value: number; note?: string }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <div className="meter">
      <div className="meter-top">
        <span>
          {label} {note && <span className="subtle">· {note}</span>}
        </span>
        <b>{Math.round(value)}%</b>
      </div>
      <div className="meter-track">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/* ---------------- states ---------------- */

export function EmptyState(props: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon ?? <Inbox size={22} />}</div>
      <h3>{props.title}</h3>
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <TriangleAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>{message}</div>
      {onRetry && (
        <button className="btn btn-sm btn-danger" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} />;
}

export function CardSkeletons({ count = 6, height = 190 }: { count?: number; height?: number }) {
  return (
    <div className="cards-grid">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={18} />
      ))}
    </div>
  );
}

/* ---------------- drawer ---------------- */

export function Drawer(props: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-header">
          <div>
            <h2 className="drawer-title">{props.title}</h2>
            {props.subtitle && <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{props.subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
        {props.footer && <div className="drawer-footer">{props.footer}</div>}
      </aside>
    </>
  );
}

/* ---------------- PDF dropzone ---------------- */

const MAX_BYTES = 5 * 1024 * 1024;

export function Dropzone(props: { file: File | null; onFile: (file: File | null) => void; onError: (msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  // Same rules as the backend, checked early for instant feedback
  const accept = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") return props.onError("Only PDF resumes are supported.");
    if (file.size === 0) return props.onError("Uploaded file is empty.");
    if (file.size > MAX_BYTES) return props.onError("Resume file must be smaller than 5 MB.");
    props.onFile(file);
  };

  if (props.file) {
    return (
      <div className="file-pill">
        <div className="file-icon">
          <FileText size={18} />
        </div>
        <div className="list-main">
          <div className="list-title">{props.file.name}</div>
          <div className="list-sub">{(props.file.size / 1024).toFixed(0)} KB · PDF</div>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => props.onFile(null)} aria-label="Remove file">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`dropzone ${drag ? "drag" : ""}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        accept(e.dataTransfer.files[0]);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
    >
      <div className="dropzone-icon">
        <FileUp size={20} />
      </div>
      <div style={{ fontWeight: 600 }}>Drop a PDF resume here</div>
      <div className="hint">or click to browse · text-based PDF · max 5 MB</div>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

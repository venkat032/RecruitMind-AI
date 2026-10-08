import { useEffect, useState } from "react";
import {
  Briefcase,
  Hand,
  LayoutDashboard,
  LogOut,
  MonitorX,
  MessageSquare,
  Moon,
  Send,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";

import { api, APPROVALS_CHANGED_EVENT } from "../api";
import type { Page } from "../lib";
import type { User } from "../types";
import { Avatar } from "./ui";

const NAV: { page: Page; label: string; icon: typeof Users; tag?: string }[] = [
  { page: "dashboard", label: "Overview", icon: LayoutDashboard },
  { page: "studio", label: "Match Studio", icon: Sparkles, tag: "AI" },
  { page: "approvals", label: "Approvals", icon: Hand },
  { page: "candidates", label: "Candidates", icon: Users },
  { page: "jobs", label: "Jobs", icon: Briefcase },
  { page: "submissions", label: "Submissions", icon: Send },
  { page: "copilot", label: "Copilot", icon: MessageSquare },
];

// Files in frontend/public are served from the app's base URL (/app/)
const BRAND = `${import.meta.env.BASE_URL}brand/`;

export function BrandMark({ size = 34 }: { size?: number }) {
  return <img className="brand-mark" src={`${BRAND}icon-192.png`} width={size} height={size} alt="" />;
}

/** Full logo; the light/dark variant is chosen by CSS from the active theme. */
export function Wordmark() {
  return (
    <span className="wordmark" role="img" aria-label="RecruitMind AI">
      <img className="wordmark-on-dark" src={`${BRAND}wordmark-dark.png`} alt="" />
      <img className="wordmark-on-light" src={`${BRAND}wordmark-light.png`} alt="" />
    </span>
  );
}

/** Pending approvals for the nav badge: polled, and refreshed right after any decision. */
function usePendingCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .approvalSummary()
        .then((s) => alive && setCount(s.counts.pending ?? 0))
        .catch(() => {});

    load();
    const id = window.setInterval(load, 15000);
    window.addEventListener(APPROVALS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener(APPROVALS_CHANGED_EVENT, load);
    };
  }, []);

  return count;
}

function useApiStatus(): "checking" | "online" | "offline" {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then(() => alive && setStatus("online"))
        .catch(() => alive && setStatus("offline"));

    check();
    const id = window.setInterval(check, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return status;
}

export function Sidebar(props: {
  page: Page;
  open: boolean;
  onNavigate: () => void;
  theme: "dark" | "light";
  onTheme: (theme: "dark" | "light") => void;
  user: User;
  onSignOut: (everywhere?: boolean) => void;
}) {
  const status = useApiStatus();
  const pending = usePendingCount();

  return (
    <aside className={`sidebar ${props.open ? "open" : ""}`}>
      <div className="brand">
        <Wordmark />
        <div className="brand-sub">Agentic recruiting platform</div>
      </div>

      <div className="nav-label">Workspace</div>
      <nav className="nav">
        {NAV.map(({ page, label, icon: Icon, tag }) => (
          <a
            key={page}
            href={`#/${page}`}
            className={`nav-item ${props.page === page ? "active" : ""}`}
            onClick={props.onNavigate}
          >
            <Icon size={17} />
            {label}
            {tag && <span className="nav-tag">{tag}</span>}
            {page === "approvals" && pending > 0 && (
              <span className="nav-count" aria-label={`${pending} pending`}>
                {pending}
              </span>
            )}
          </a>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <Avatar name={props.user.full_name} size="sm" />
          <div className="list-main">
            <div className="list-title" style={{ fontSize: 13 }}>
              {props.user.full_name}
              <span className="user-role">{props.user.role}</span>
            </div>
            <div className="list-sub" style={{ fontSize: 12 }}>{props.user.email}</div>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => props.onSignOut(false)}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ justifyContent: "flex-start" }} onClick={() => props.onSignOut(true)}>
          <MonitorX size={14} /> Sign out of all devices
        </button>

        <div className="status-card">
          <div className="status-row">
            <span className={`status-dot ${status === "checking" ? "" : status}`} />
            <span style={{ fontWeight: 600 }}>
              {status === "online" ? "API online" : status === "offline" ? "API offline" : "Connecting…"}
            </span>
          </div>
          <div className="subtle" style={{ marginTop: 4, paddingLeft: 16 }}>
            {status === "offline" ? "Start uvicorn on port 8000" : "FastAPI · LangGraph · PostgreSQL"}
          </div>
        </div>

        <div className="theme-toggle" role="group" aria-label="Theme">
          <button className={props.theme === "dark" ? "active" : ""} onClick={() => props.onTheme("dark")}>
            <Moon size={14} /> Dark
          </button>
          <button className={props.theme === "light" ? "active" : ""} onClick={() => props.onTheme("light")}>
            <Sun size={14} /> Light
          </button>
        </div>
      </div>
    </aside>
  );
}

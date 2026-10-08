import {
  Briefcase,
  Check,
  FileText,
  Gauge,
  Hand,
  LoaderCircle,
  Mail,
  Send,
  Target,
  X,
} from "lucide-react";

import type { NodeId } from "../types";

export type NodeStatus = "idle" | "running" | "done" | "waiting" | "rejected" | "skipped" | "error";

export interface NodeState {
  status: NodeStatus;
  startedAt?: number;
  ms?: number;
}

export const NODES: { id: NodeId; label: string; icon: typeof FileText; running: string }[] = [
  { id: "resume_agent", label: "Resume Agent", icon: FileText, running: "Reading resume…" },
  { id: "job_agent", label: "Job Agent", icon: Briefcase, running: "Parsing role…" },
  { id: "matching_agent", label: "Matching", icon: Target, running: "Scoring skills…" },
  { id: "score_agent", label: "Assessment", icon: Gauge, running: "Evaluating…" },
  { id: "human_approval", label: "Human Approval", icon: Hand, running: "Waiting…" },
  { id: "submission_agent", label: "Submission", icon: Send, running: "Saving…" },
  { id: "email_agent", label: "Email Draft", icon: Mail, running: "Writing email…" },
];

export type PipelineState = Record<NodeId, NodeState>;

export function idlePipeline(): PipelineState {
  return Object.fromEntries(NODES.map((n) => [n.id, { status: "idle" }])) as PipelineState;
}

function statusText(node: (typeof NODES)[number], state: NodeState): string {
  switch (state.status) {
    case "running":
      return node.running;
    case "done":
      return state.ms != null ? `Done · ${(state.ms / 1000).toFixed(1)}s` : "Done";
    case "waiting":
      return "Your decision";
    case "rejected":
      return "Rejected";
    case "skipped":
      return "Skipped";
    case "error":
      return "Failed";
    default:
      return "Queued";
  }
}

function Node({ id, state }: { id: NodeId; state: NodeState }) {
  const node = NODES.find((n) => n.id === id)!;
  const Icon =
    state.status === "running" && id !== "human_approval"
      ? LoaderCircle
      : state.status === "done"
        ? Check
        : state.status === "rejected" || state.status === "error"
          ? X
          : node.icon;

  return (
    <div className={`pl-node ${state.status}`}>
      <div className="pl-icon">
        <Icon size={15} className={Icon === LoaderCircle ? "spin" : undefined} />
      </div>
      <div className="pl-text">
        <div className="pl-label">{node.label}</div>
        <div className="pl-status">{statusText(node, state)}</div>
      </div>
    </div>
  );
}

/** Connector into `to`: flowing while it runs, solid once it has finished. */
function connClass(to: NodeState): string {
  if (to.status === "running" || to.status === "waiting") return "flowing";
  if (to.status === "done" || to.status === "rejected") return "active";
  return "";
}

export function Pipeline({ state }: { state: PipelineState }) {
  const join = connClass(state.matching_agent);
  const fromResume = state.resume_agent.status === "done" ? (join || "active") : "";
  const fromJob = state.job_agent.status === "done" ? (join || "active") : "";

  return (
    <div className="pipeline-scroll">
      <div className="pipeline">
        <div className="pl-fork">
          <Node id="resume_agent" state={state.resume_agent} />
          <Node id="job_agent" state={state.job_agent} />
        </div>

        {/* Resume + Job join into Matching (LangGraph waits for both) */}
        <svg className="pl-join" width="30" height="140" viewBox="0 0 30 140" aria-hidden>
          <path className={fromResume} d="M0 32 C 18 32, 12 70, 30 70" />
          <path className={fromJob} d="M0 108 C 18 108, 12 70, 30 70" />
        </svg>

        <Node id="matching_agent" state={state.matching_agent} />
        <div className={`pl-conn ${connClass(state.score_agent)}`} />
        <Node id="score_agent" state={state.score_agent} />
        <div className={`pl-conn ${connClass(state.human_approval)}`} />
        <Node id="human_approval" state={state.human_approval} />
        <div className={`pl-conn ${connClass(state.submission_agent)}`} />
        <Node id="submission_agent" state={state.submission_agent} />
        <div className={`pl-conn ${connClass(state.email_agent)}`} />
        <Node id="email_agent" state={state.email_agent} />
      </div>
    </div>
  );
}

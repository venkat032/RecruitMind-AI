import { useCallback, useEffect, useState } from "react";

/* ---------------- formatting ---------------- */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Stable gradient per name, so an avatar always looks the same. */
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 72% 62%), hsl(${(hue + 40) % 360} 74% 52%))`;
}

export function splitSkills(skills: string | null | undefined): string[] {
  return (skills ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatSalary(salary: number | null): string {
  if (salary == null) return "Not disclosed";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(salary);
}

/** Backend timestamps are naive server-local times (PostgreSQL TIMESTAMP). */
export function parseDate(value: string): Date {
  return new Date(value.replace(" ", "T"));
}

export function timeAgo(value: string): string {
  const seconds = Math.round((Date.now() - parseDate(value).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Infinity, "year"],
  ];

  let amount = Math.max(seconds, 0);
  for (const [size, unit] of steps) {
    if (amount < size) return rtf.format(-Math.round(amount), unit);
    amount /= size;
  }
  return "";
}

export function formatDate(value: string): string {
  return parseDate(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export type Tone = "success" | "warning" | "danger";

export function scoreTone(score: number): Tone {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

export function toneColor(tone: Tone): string {
  return `var(--${tone})`;
}

export function recommendationTone(text: string | null | undefined): Tone | "accent" {
  const t = (text ?? "").toLowerCase();
  if (t.includes("weak") || t.includes("not") || t.includes("reject")) return "danger";
  if (t.includes("strong") || t.includes("highly")) return "success";
  if (t.includes("match") || t.includes("recommend")) return "warning";
  return "accent";
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/* ---------------- routing (hash based) ---------------- */

export type PublicPage = "home" | "login" | "register";
export type AppPage = "dashboard" | "candidates" | "jobs" | "studio" | "approvals" | "submissions" | "copilot";
export type Page = PublicPage | AppPage;

export const PUBLIC_PAGES: PublicPage[] = ["home", "login", "register"];
const PAGES: Page[] = [...PUBLIC_PAGES, "dashboard", "candidates", "jobs", "studio", "approvals", "submissions", "copilot"];

export interface Route {
  page: Page;
  params: URLSearchParams;
  /** true when no page was given in the URL (plain /app/) */
  isDefault: boolean;
}

export function isPublicPage(page: Page): page is PublicPage {
  return (PUBLIC_PAGES as string[]).includes(page);
}

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const known = (PAGES as string[]).includes(path);
  return { page: known ? (path as Page) : "home", params: new URLSearchParams(query), isDefault: !known };
}

export function navigate(page: Page, params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) query.set(k, String(v));
  const qs = query.toString();
  window.location.hash = `/${page}${qs ? `?${qs}` : ""}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

/* ---------------- data loading ---------------- */

export interface Async<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    load()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(undefined);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, reload };
}

/* ---------------- browser storage (never required) ---------------- */

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

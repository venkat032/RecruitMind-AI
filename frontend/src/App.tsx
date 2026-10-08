import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Menu } from "lucide-react";

import { api, UNAUTHORIZED_EVENT } from "./api";
import { BrandMark, Sidebar } from "./components/Sidebar";
import { ToastProvider, useToast } from "./components/Toasts";
import { isPublicPage, navigate, readPref, useRoute, writePref, type AppPage, type Page } from "./lib";
import Approvals from "./pages/Approvals";
import { Login, Register } from "./pages/Auth";
import Candidates from "./pages/Candidates";
import Copilot from "./pages/Copilot";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import Landing from "./pages/Landing";
import Studio from "./pages/Studio";
import Submissions from "./pages/Submissions";
import type { User } from "./types";

type Theme = "dark" | "light";

function initialTheme(): Theme {
  const saved = readPref("rm-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Change the URL after render (never during it). */
function Redirect({ to, params }: { to: Page; params?: Record<string, string> }) {
  useEffect(() => {
    navigate(to, params);
  }, [to, params]);

  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const route = useRoute();
  const toast = useToast();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // undefined = still checking the session cookie
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref("rm-theme", theme);
  }, [theme]);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  // Any API call answered with 401 means the session ended (expired, revoked, signed out elsewhere)
  useEffect(() => {
    const onUnauthorized = () => {
      setUser((current) => {
        if (current) toast("info", "Your session ended", "Please sign in again.");
        return null;
      });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.page]);

  const signedIn = useCallback(
    (u: User) => {
      setUser(u);
      const next = route.params.get("next");
      if (next && !isPublicPage(next as AppPage)) navigate(next as AppPage);
      else navigate("dashboard");
    },
    [route.params],
  );

  const signOut = async (everywhere = false) => {
    try {
      await (everywhere ? api.logoutAll() : api.logout());
    } catch {
      /* already signed out server-side */
    }
    setUser(null);
    toast("success", everywhere ? "Signed out on every device" : "Signed out");
    navigate("home");
  };

  if (user === undefined) {
    return (
      <div className="splash">
        <BrandMark size={56} />
      </div>
    );
  }

  /* ---------- signed out ---------- */

  if (user === null) {
    if (route.page === "login") return <Login onSignedIn={signedIn} next={route.params.get("next")} />;
    if (route.page === "register") return <Register onSignedIn={signedIn} />;
    if (route.page === "home") return <Landing signedIn={false} />;

    // A private page while signed out: sign in first, then come back
    return <Redirect to="login" params={{ next: route.page }} />;
  }

  /* ---------- signed in ---------- */

  if (route.page === "login" || route.page === "register" || (route.page === "home" && route.isDefault)) {
    return <Redirect to="dashboard" />;
  }

  if (route.page === "home") return <Landing signedIn />;

  return <Workspace page={route.page} params={route.params} user={user} theme={theme} onTheme={setTheme} onSignOut={signOut} />;
}

function Workspace(props: {
  page: AppPage;
  params: URLSearchParams;
  user: User;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onSignOut: (everywhere?: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const pages: Record<AppPage, ReactElement> = {
    dashboard: <Dashboard user={props.user} />,
    candidates: <Candidates params={props.params} />,
    jobs: <Jobs />,
    studio: <Studio params={props.params} />,
    approvals: <Approvals params={props.params} />,
    submissions: <Submissions params={props.params} />,
    copilot: <Copilot />,
  };

  return (
    <div className="shell">
      <Sidebar
        page={props.page}
        open={menuOpen}
        onNavigate={() => setMenuOpen(false)}
        theme={props.theme}
        onTheme={props.onTheme}
        user={props.user}
        onSignOut={props.onSignOut}
      />
      <div className={`scrim ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} />

      <main className="main">
        <div className="mobile-bar">
          <button className="btn btn-ghost btn-icon" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <BrandMark size={28} />
          <strong>RecruitMind AI</strong>
        </div>

        <div className="main-inner" key={props.page}>
          {pages[props.page]}
        </div>
      </main>
    </div>
  );
}

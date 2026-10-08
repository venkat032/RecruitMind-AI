import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Sparkles } from "lucide-react";

type Kind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: Kind;
  title: string;
  text?: string;
}

type Notify = (kind: Kind, title: string, text?: string) => void;

const ToastContext = createContext<Notify>(() => {});

export function useToast(): Notify {
  return useContext(ToastContext);
}

const ICONS = { success: CircleCheck, error: CircleX, info: Sparkles };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback<Notify>((kind, title, text) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { id, kind, title, text }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon size={18} className="toast-icon" />
              <div>
                <div className="toast-title">{t.title}</div>
                {t.text && <div className="toast-text">{t.text}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

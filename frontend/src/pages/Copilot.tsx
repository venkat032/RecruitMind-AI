import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, MessageSquare, Send, User } from "lucide-react";

import { api } from "../api";
import { Markdown } from "../components/Markdown";
import { BrandMark } from "../components/Sidebar";
import { PageHeader } from "../components/ui";

interface Message {
  role: "user" | "assistant" | "error";
  text: string;
}

const SUGGESTIONS = [
  "Find AI jobs in Hyderabad",
  "Which candidates know LangGraph?",
  "Show me the details of job 1",
  "Tell me about candidate 2",
];

export default function Copilot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setThinking(true);

    try {
      const { response } = await api.chat(message);
      setMessages((m) => [...m, { role: "assistant", text: response }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: (e as Error).message }]);
    } finally {
      setThinking(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <>
      <PageHeader
        eyebrow={<><MessageSquare size={14} /> Copilot</>}
        title={<>Ask your <em>recruiting data</em></>}
        subtitle="A tool-calling agent that searches jobs and candidates in PostgreSQL. It answers from the database and doesn't invent records."
      />

      <div className="card chat">
        <div className="chat-scroll" ref={scroller}>
          {messages.length === 0 && (
            <div className="empty" style={{ margin: "auto" }}>
              <BrandMark size={52} />
              <h3 style={{ marginTop: 14 }}>How can I help you hire today?</h3>
              <p>Ask about open roles, candidates, skills or locations.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => send(s)}>
                    {s} <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "user" : ""}`}>
              {m.role === "user" ? (
                <div className="msg-avatar">
                  <User size={16} />
                </div>
              ) : (
                <BrandMark size={32} />
              )}
              <div
                className="msg-bubble"
                style={m.role === "error" ? { color: "var(--danger)", borderColor: "var(--danger-soft)" } : undefined}
              >
                {m.role === "assistant" ? <Markdown text={m.text} /> : m.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="msg">
              <BrandMark size={32} />
              <div className="msg-bubble">
                <span className="typing">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          )}
        </div>

        <form className="chat-input" onSubmit={submit}>
          <input
            className="input"
            placeholder="Ask about jobs or candidates…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={thinking}
            autoFocus
          />
          <button className="btn btn-primary btn-lg" disabled={!input.trim() || thinking} aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </div>
    </>
  );
}

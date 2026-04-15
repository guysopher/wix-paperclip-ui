"use client";

import { useEffect, useState, useRef } from "react";
import { Loader } from "@wix/design-system";
import { Send, X } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCompany } from "./providers";
import { ensureWorkspaceHref } from "@/lib/workspace-links";
import { getIssues, type Issue } from "@/lib/api";
import { TaskLinkWithPreview, extractTaskIdentifierFromHref } from "@/components/task-link-with-preview";

interface ChatMessage {
  role: "ceo" | "user";
  text: string;
  actions?: Array<{ type: string; title: string; identifier?: string }>;
}

export function CeoChatPanel({ onClose, showCloseButton = true }: { onClose: () => void; showCloseButton?: boolean }) {
  const { companyId, companyPath } = useCompany();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [issuesByIdentifier, setIssuesByIdentifier] = useState<Record<string, Issue>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);

  const loadOpeningMessage = async (targetCompanyId: string) => {
    const storageKey = `ceo-chat-${targetCompanyId}`;
    try {
      const res = await fetch("/api/ceo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: targetCompanyId, messages: [] }),
      });
      const data = await res.json();
      if (data.text) {
        const newMessages: ChatMessage[] = [{ role: "ceo", text: data.text }];
        setMessages(newMessages);
        localStorage.setItem(storageKey, JSON.stringify(newMessages));
        return;
      }
    } catch {
      // Fall through to fallback opener.
    }

    const fallbackMessages: ChatMessage[] = [
      { role: "ceo", text: "I’m your AI Team Lead and I’m ready to help. What should I focus on first?" },
    ];
    setMessages(fallbackMessages);
    localStorage.setItem(storageKey, JSON.stringify(fallbackMessages));
  };

  // Load messages from localStorage on mount
  useEffect(() => {
    if (!companyId || initialized) return;
    const storageKey = `ceo-chat-${companyId}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setMessages(parsed);
        setLoading(false);
        setInitialized(true);
        return;
      } catch {
        // Invalid storage, continue to fetch
      }
    }

    (async () => {
      await loadOpeningMessage(companyId);
      setLoading(false);
      setInitialized(true);
    })();
  }, [companyId, initialized]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (!companyId || messages.length === 0) return;
    const storageKey = `ceo-chat-${companyId}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, companyId]);

  useEffect(() => {
    if (!companyId) {
      setIssuesByIdentifier({});
      return;
    }

    let cancelled = false;

    void getIssues(companyId)
      .then((issues) => {
        if (cancelled) {
          return;
        }

        setIssuesByIdentifier(
          issues
            .filter((issue) => issue.title !== "Board Inbox")
            .reduce<Record<string, Issue>>((acc, issue) => {
              acc[issue.identifier] = issue;
              return acc;
            }, {}),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setIssuesByIdentifier({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, messages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [messages, sending]);

  // Focus input when ready
  useEffect(() => {
    if (!sending && !loading) inputRef.current?.focus();
  }, [sending, loading]);

  const handleSend = async () => {
    if (!message.trim() || sending || !companyId) return;
    const userText = message.trim();
    setMessage("");

    const userMsg: ChatMessage = { role: "user", text: userText };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    setSending(true);
    try {
      const res = await fetch("/api/ceo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, messages: updatedMessages }),
      });
      const data = await res.json();
      if (data.text) {
        setMessages((prev) => [...prev, {
          role: "ceo",
          text: data.text,
          actions: data.actions,
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "ceo", text: "Sorry, I couldn't process that. Try again?" }]);
    }
    setSending(false);
  };

  const handleClearChat = async () => {
    if (!companyId || sending) return;
    const storageKey = `ceo-chat-${companyId}`;
    setSending(true);
    setMessages([]);
    localStorage.removeItem(storageKey);
    await loadOpeningMessage(companyId);
    setSending(false);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Loader size="small" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f7f8fa" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", background: "white", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #3899ec, #1a4a6e)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>C</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>AI Team Lead</div>
          <div style={{ fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: sending ? "#ffc107" : "#00d68f" }} />
            {sending ? "Thinking..." : "Online"}
          </div>
        </div>
        <button
          onClick={handleClearChat}
          disabled={sending}
          title="Clear chat"
          aria-label="Clear chat"
          style={{
            background: "none",
            border: "1px solid #d9e1e8",
            cursor: sending ? "default" : "pointer",
            width: 30,
            height: 30,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            color: "#5f6b7a",
            opacity: sending ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 10h2v8H7v-8zm-1 10h12l1-12H5l1 12z"
              fill="currentColor"
            />
          </svg>
        </button>
        {showCloseButton && (
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 4 }}
          >
            <X color="#999" size="20px" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px" }}>
        {messages.map((m, i) => {
          const isAgent = m.role === "ceo";
          return (
            <div key={i}>
              <div style={{ display: "flex", marginBottom: 10, justifyContent: isAgent ? "flex-start" : "flex-end" }}>
                <div style={{ maxWidth: "85%" }}>
                  <div
                    style={{
                      background: isAgent ? "white" : "#3899ec",
                      color: isAgent ? "#333" : "white",
                      padding: "11px 14px",
                      borderRadius: isAgent ? "6px 16px 16px 16px" : "16px 6px 16px 16px",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                      fontSize: 15,
                      lineHeight: 1.6,
                    }}
                  >
                    {isAgent ? (
                      <div className="timeline-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, node: _node, ...props }) => {
                              const workspaceHref = ensureWorkspaceHref(href, companyPath);
                              const taskIdentifier = extractTaskIdentifierFromHref(workspaceHref);
                              const linkedIssue = taskIdentifier ? issuesByIdentifier[taskIdentifier] : null;

                              if (!workspaceHref) {
                                return <a {...props} />;
                              }

                              if (!linkedIssue) {
                                return <a {...props} href={workspaceHref} />;
                              }

                              return (
                                <TaskLinkWithPreview
                                  {...props}
                                  href={workspaceHref}
                                  issue={linkedIssue}
                                  style={{ color: "#3899ec", textDecoration: "none" }}
                                />
                              );
                            },
                          }}
                        >
                          {m.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Action cards (created tasks) */}
              {m.actions && m.actions.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10, paddingLeft: 4 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.actions.map((action, j) => (
                      <TaskLinkWithPreview
                        key={j}
                        href={companyPath(action.identifier ? `/tasks/${action.identifier}` : "/tasks")}
                        issue={action.identifier ? issuesByIdentifier[action.identifier] || null : null}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 12px", background: "#f0f5ff", border: "1px solid #d0e0ff",
                          borderRadius: 8, textDecoration: "none", fontSize: 13, color: "#333",
                        }}
                      >
                        <span style={{ color: "#3899ec", fontWeight: 600 }}>{action.identifier || "Task"}</span>
                        <span>{action.title}</span>
                      </TaskLinkWithPreview>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sending && (
          <div style={{ display: "flex", marginBottom: 10 }}>
            <div style={{ background: "white", padding: "12px 16px", borderRadius: "6px 16px 16px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", display: "flex", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.2s" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.4s" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px 12px", background: "white", borderTop: "1px solid #eee", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          placeholder="Ask your AI Team Lead anything..."
          disabled={sending}
          style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 20, padding: "10px 16px", fontSize: 15, outline: "none", background: "#f7f8fa" }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: message.trim() && !sending ? "#3899ec" : "#d6e6f2", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: message.trim() && !sending ? "pointer" : "default", flexShrink: 0 }}
        >
          <Send size="18px" />
        </button>
      </div>
    </div>
  );
}

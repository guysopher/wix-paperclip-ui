"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Loader } from "@wix/design-system";
import { Refresh, Send, X } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCompany } from "./providers";
import { setInboxReplyOverride } from "@/lib/inbox-state";
import { ensureWorkspaceHref } from "@/lib/workspace-links";
import { CEO_CHAT_DISCUSS_EVENT, type CeoChatDiscussDetail } from "@/lib/ceo-chat-events";
import { getIssues, type Issue } from "@/lib/api";
import { TaskLinkWithPreview, extractTaskIdentifierFromHref } from "@/components/task-link-with-preview";

interface ChatMessage {
  role: "ceo" | "user";
  text: string;
  actions?: Array<{ type: string; title: string; identifier?: string }>;
}

interface DraftContext {
  issueId?: string;
  taskRef: string;
  requestText: string;
}

export function CeoChatPanel({ onClose, showCloseButton = true }: { onClose: () => void; showCloseButton?: boolean }) {
  const { companyId, companyPath } = useCompany();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [draftContext, setDraftContext] = useState<DraftContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [issuesByIdentifier, setIssuesByIdentifier] = useState<Record<string, Issue>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [initialized, setInitialized] = useState(false);

  const resizeComposer = useCallback(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 180)}px`;
  }, []);

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
    messagesRef.current = messages;
  }, [messages]);

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

  useEffect(() => {
    resizeComposer();
  }, [message, draftContext, resizeComposer]);

  // Focus input when ready
  useEffect(() => {
    if (!sending && !loading) inputRef.current?.focus();
  }, [sending, loading]);

  const sendUserMessage = useCallback(async (userText: string, sourceIssueId?: string) => {
    if (!userText.trim() || !companyId) return;
    const userMsg: ChatMessage = { role: "user", text: userText };
    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    setSending(true);
    try {
      if (sourceIssueId) {
        setInboxReplyOverride(sourceIssueId, new Date().toISOString());
      }
      const res = await fetch("/api/ceo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, messages: updatedMessages, sourceIssueId: sourceIssueId || null }),
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
  }, [companyId]);

  useEffect(() => {
    const handleDiscuss = (event: Event) => {
      const detail = (event as CustomEvent<CeoChatDiscussDetail>).detail;
      if (!detail || !companyId || detail.companyId !== companyId || sending) {
        return;
      }
      if (detail.mode === "draft" && detail.taskRef && detail.requestText) {
        setDraftContext({
          issueId: detail.issueId,
          taskRef: detail.taskRef,
          requestText: detail.requestText,
        });
        setMessage("");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (!detail.text) {
        return;
      }
      setDraftContext(null);
      setMessage("");
      void sendUserMessage(detail.text.trim(), detail.issueId);
    };

    window.addEventListener(CEO_CHAT_DISCUSS_EVENT, handleDiscuss as EventListener);
    return () => {
      window.removeEventListener(CEO_CHAT_DISCUSS_EVENT, handleDiscuss as EventListener);
    };
  }, [companyId, sendUserMessage, sending]);

  const handleSend = async () => {
    if (!message.trim() || sending || !companyId) return;
    const userText = message.trim();
    const sourceIssueId = draftContext?.issueId;
    const finalText = draftContext
      ? `Let's discuss and resolve ${draftContext.taskRef}.\nRequest: ${draftContext.requestText}\n\nMy direction: ${userText}`
      : userText;
    setMessage("");
    setDraftContext(null);
    await sendUserMessage(finalText, sourceIssueId);
  };

  const handleClearChat = async () => {
    if (!companyId || sending) return;
    const storageKey = `ceo-chat-${companyId}`;
    setSending(true);
    setMessages([]);
    setDraftContext(null);
    setMessage("");
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
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #3899ec, #1a4a6e)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16 }}>C</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>AI Team Lead</div>
          <div style={{ fontSize: 13, color: "#999", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
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
          <Refresh size="16px" />
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
                      padding: "14px 18px",
                      borderRadius: isAgent ? "8px 18px 18px 18px" : "18px 8px 18px 18px",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                      fontSize: 17,
                      lineHeight: 1.7,
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
            </div>
          );
        })}

        {sending && (
          <div style={{ display: "flex", marginBottom: 10 }}>
            <div style={{ background: "white", padding: "14px 18px", borderRadius: "8px 18px 18px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", display: "flex", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.2s" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.4s" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 14px 14px", background: "white", borderTop: "1px solid #eee", display: "flex", gap: 10, alignItems: "flex-end", flexShrink: 0 }}>
        <div
          style={{
            flex: 1,
            border: "1px solid #dce3ec",
            borderRadius: 20,
            background: "#f7f8fa",
            padding: "10px 14px 10px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.75)",
          }}
        >
          {draftContext && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 14,
                background: "#eef3f8",
                border: "1px solid #d6e1ec",
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#7a8da5", marginBottom: 4 }}>
                  Discussing {draftContext.taskRef}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5, color: "#7a8da5" }}>{draftContext.requestText}</div>
              </div>
              <button
                onClick={() => setDraftContext(null)}
                type="button"
                aria-label="Clear discuss context"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#7a8da5",
                  cursor: "pointer",
                  padding: 2,
                  lineHeight: 1,
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={draftContext ? "Add your direction..." : "Ask your AI Team Lead anything..."}
            disabled={sending}
            rows={1}
            style={{
              width: "100%",
              border: "none",
              padding: 0,
              fontSize: 17,
              lineHeight: 1.55,
              outline: "none",
              background: "transparent",
              resize: "none",
              overflowY: "auto",
            }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: message.trim() && !sending ? "#3899ec" : "#d6e6f2", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: message.trim() && !sending ? "pointer" : "default", flexShrink: 0 }}
        >
          <Send size="18px" />
        </button>
      </div>
    </div>
  );
}

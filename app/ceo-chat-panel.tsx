"use client";

import { useEffect, useState, useRef } from "react";
import { Box, Loader } from "@wix/design-system";
import { Send, X } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getCompanies,
  getAgents,
  getIssues,
  getComments,
  postComment,
  createIssue,
  invokeHeartbeat,
  type Agent,
  type Issue,
  type Comment,
} from "@/lib/api";

export function CeoChatPanel({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ceo, setCeo] = useState<Agent | null>(null);
  const [inboxIssue, setInboxIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (async () => {
      const companies = await getCompanies();
      if (!companies.length) { setLoading(false); return; }
      const cId = companies[0].id;
      const agentData = await getAgents(cId);
      setAgents(agentData);
      const ceoAgent = agentData.find((a) => a.role === "ceo");
      if (ceoAgent) setCeo(ceoAgent);

      const issues = await getIssues(cId);
      let inbox = issues.find((i) => i.title === "Board Inbox");
      if (!inbox) {
        inbox = await createIssue(cId, {
          title: "Board Inbox",
          description: "Direct communication channel between the board operator and the CEO.",
          priority: "high",
          assigneeId: ceoAgent?.id,
        });
      }
      setInboxIssue(inbox);
      const commentData = await getComments(inbox.id);
      setComments(commentData);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  useEffect(() => {
    if (waiting && inboxIssue) {
      const lastCount = comments.length;
      pollRef.current = setInterval(async () => {
        const c = await getComments(inboxIssue.id);
        if (c.length > lastCount) {
          setComments(c);
          setWaiting(false);
        }
      }, 5000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [waiting, inboxIssue, comments.length]);

  const handleSend = async () => {
    if (!message.trim() || !inboxIssue || !ceo) return;
    setSending(true);
    await postComment(inboxIssue.id, message);
    setMessage("");
    const updated = await getComments(inboxIssue.id);
    setComments(updated);
    setSending(false);
    setWaiting(true);
    try { await invokeHeartbeat(ceo.id); } catch {}
  };

  const agentName = (id: string | null) => {
    if (!id) return "You";
    return agents.find((a) => a.id === id)?.name || "Agent";
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
      <div style={{ padding: "12px 16px", background: "white", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#3899ec", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>C</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Talk to CEO</div>
          <div style={{ fontSize: 11, color: "#999", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: waiting ? "#ffc107" : "#00d68f" }} />
            {waiting ? "Thinking..." : "Online"}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 4 }}
        >
          <X color="#999" size="20px" />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px" }}>
        {comments.length === 0 && (
          <div style={{ textAlign: "center", color: "#999", marginTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#333", marginBottom: 4 }}>Talk to your CEO</div>
            <div style={{ fontSize: 12 }}>Give instructions, ask questions, manage your company.</div>
          </div>
        )}

        {[...comments].reverse().map((c) => {
          const isAgent = !!c.authorAgentId;
          const author = agentName(c.authorAgentId);
          return (
            <div key={c.id} style={{ display: "flex", marginBottom: 10, justifyContent: isAgent ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "85%" }}>
                <div style={{ fontSize: 10, color: "#999", marginBottom: 2, textAlign: isAgent ? "left" : "right" }}>
                  {author} · {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div
                  style={{
                    background: isAgent ? "white" : "#3899ec",
                    color: isAgent ? "#333" : "white",
                    padding: "8px 12px",
                    borderRadius: isAgent ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {isAgent ? (
                    <div className="timeline-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children, ...props }) => {
                            const issueMatch = href?.match(/\/AGE\/issues\/(AGE-\d+)/);
                            if (issueMatch) return <a {...props} href={`/tasks?issue=${issueMatch[1]}`} style={{ color: "#3899ec" }}>{children}</a>;
                            if (href && href.startsWith("/")) return <span style={{ color: "#3899ec", fontWeight: 500 }}>{children}</span>;
                            return <a {...props} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#3899ec" }}>{children}</a>;
                          },
                        }}
                      >{c.body}</ReactMarkdown>
                    </div>
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{c.body}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {waiting && (
          <div style={{ display: "flex", marginBottom: 10 }}>
            <div style={{ background: "white", padding: "10px 16px", borderRadius: "4px 14px 14px 14px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", display: "flex", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.2s" }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.4s" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "8px 12px 10px", background: "white", borderTop: "1px solid #eee", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          placeholder="Message CEO..."
          disabled={sending}
          style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 20, padding: "8px 14px", fontSize: 13, outline: "none", background: "#f7f8fa" }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: message.trim() && !sending ? "#3899ec" : "#d6e6f2", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: message.trim() && !sending ? "pointer" : "default", flexShrink: 0 }}
        >
          <Send size="16px" />
        </button>
      </div>
    </div>
  );
}

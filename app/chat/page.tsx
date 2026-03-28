"use client";

import { useEffect, useState, useRef } from "react";
import {
  Box,
  Text,
  Loader,
} from "@wix/design-system";
import { Send } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Providers } from "../providers";
import { Shell } from "../shell";
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

function ChatContent() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ceo, setCeo] = useState<Agent | null>(null);
  const [companyId, setCompanyId] = useState("");
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
      if (companies.length === 0) { setLoading(false); return; }
      const cId = companies[0].id;
      setCompanyId(cId);
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
    return <Box align="center" verticalAlign="middle" height="100vh"><Loader size="medium" /></Box>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f7f8fa" }}>

      {/* Header */}
      <div style={{ padding: "14px 24px", background: "white", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#3899ec", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>C</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>CEO</div>
          <div style={{ fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: waiting ? "#ffc107" : "#00d68f" }} />
            {waiting ? "Thinking..." : "Online"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {comments.length === 0 && (
          <div style={{ textAlign: "center", color: "#999", marginTop: 80 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 600, fontSize: 16, color: "#333", marginBottom: 4 }}>Talk to your CEO</div>
            <div style={{ fontSize: 13 }}>Give instructions, ask questions, manage your company.</div>
          </div>
        )}

        {[...comments].reverse().map((c) => {
          const isAgent = !!c.authorAgentId;
          const author = agentName(c.authorAgentId);
          return (
            <div key={c.id} style={{ display: "flex", marginBottom: 12, justifyContent: isAgent ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "75%" }}>
                {/* Author + time */}
                <div style={{ fontSize: 11, color: "#999", marginBottom: 2, textAlign: isAgent ? "left" : "right", paddingLeft: isAgent ? 2 : 0, paddingRight: isAgent ? 0 : 2 }}>
                  {author} · {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                {/* Bubble */}
                <div
                  style={{
                    background: isAgent ? "white" : "#3899ec",
                    color: isAgent ? "#333" : "white",
                    padding: "10px 14px",
                    borderRadius: isAgent ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {isAgent ? (
                    <div className="timeline-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children, ...props }) => {
                            // Rewrite Paperclip issue links to task detail
                            const issueMatch = href?.match(/\/AGE\/issues\/(AGE-\d+)/);
                            if (issueMatch) {
                              return <a {...props} href={`/tasks?issue=${issueMatch[1]}`} style={{ color: "#3899ec" }}>{children}</a>;
                            }
                            // Rewrite other Paperclip internal links
                            if (href && href.startsWith("/")) {
                              return <span style={{ color: "#3899ec", fontWeight: 500 }}>{children}</span>;
                            }
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

        {/* Typing dots */}
        {waiting && (
          <div style={{ display: "flex", marginBottom: 12 }}>
            <div style={{ background: "white", padding: "12px 18px", borderRadius: "4px 16px 16px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", display: "flex", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite" }} />
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.2s" }} />
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.4s" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 20px 14px", background: "white", borderTop: "1px solid #eee", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          placeholder="Message CEO..."
          disabled={sending}
          style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 24, padding: "10px 18px", fontSize: 14, outline: "none", background: "#f7f8fa" }}
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

export default function ChatPage() {
  return (
    <Providers>
      <Shell>
        <ChatContent />
      </Shell>
    </Providers>
  );
}

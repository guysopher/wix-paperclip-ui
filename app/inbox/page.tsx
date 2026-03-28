"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Box,
  Text,
  Badge,
  Loader,
  Tabs,
} from "@wix/design-system";
import { Refresh, Inbox as InboxIcon, Checklist as ChecklistIcon } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getAgents,
  getMyIssues,
  getComments,
  postComment,
  markIssueRead,
  archiveIssueFromInbox,
  invokeHeartbeat,
  type Agent,
  type Issue,
  type Comment,
} from "@/lib/api";

function timeAgo(date: string) {
  const diff = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "now";
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / 1440)}d`;
}

function InboxContent() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  // Selected
  const [selected, setSelected] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Client-side archive for items server doesn't support archiving
  const [clientArchived, setClientArchived] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("inbox:archived") || "[]")); } catch { return new Set(); }
  });

  const saveClientArchived = (ids: Set<string>) => {
    setClientArchived(ids);
    localStorage.setItem("inbox:archived", JSON.stringify([...ids]));
  };

  const agentName = useCallback((id: string | null) => {
    if (!id) return "You";
    return agents.find((a) => a.id === id)?.name || "Unknown";
  }, [agents]);

  const load = useCallback(async () => {
    const companies = await getCompanies();
    if (!companies.length) { setLoading(false); return; }
    const cId = companies[0].id;
    const [agentList, myIssues] = await Promise.all([
      getAgents(cId),
      getMyIssues(cId),
    ]);
    setAgents(agentList);
    // Filter out Board Inbox
    setIssues(myIssues.filter((i) => i.title !== "Board Inbox"));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [comments]);

  const selectIssue = async (issue: Issue) => {
    setSelected(issue);
    setReplyText("");
    setLoadingComments(true);
    // Mark as read
    if (issue.isUnreadForMe) {
      markIssueRead(issue.id).catch(() => {});
      // Optimistically update
      setIssues((prev) => prev.map((i) => i.id === issue.id ? { ...i, isUnreadForMe: false } : i));
    }
    const c = await getComments(issue.id);
    setComments(c.reverse()); // oldest first
    setLoadingComments(false);
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    await postComment(selected.id, replyText);
    setReplyText("");
    const c = await getComments(selected.id);
    setComments(c.reverse());
    setSending(false);
    // Wake up assignee
    const assigneeId = selected.assigneeAgentId || selected.assigneeId;
    if (assigneeId) { try { await invokeHeartbeat(assigneeId); } catch {} }
    load();
  };

  const handleArchive = (id: string) => {
    archiveIssueFromInbox(id); // Try server-side
    const next = new Set(clientArchived);
    next.add(id);
    saveClientArchived(next);
    if (selected?.id === id) setSelected(null);
  };

  const handleUnarchive = (id: string) => {
    const next = new Set(clientArchived);
    next.delete(id);
    saveClientArchived(next);
  };

  // Filter issues into categories
  const allNonArchived = issues.filter((i) => !clientArchived.has(i.id));
  const needsReply = allNonArchived.filter((i) => i.isUnreadForMe && !["done", "cancelled"].includes(i.status));
  const activeIssues = allNonArchived.filter((i) => !["done", "cancelled"].includes(i.status));
  const doneIssues = allNonArchived.filter((i) => ["done", "cancelled"].includes(i.status));
  const archivedIssues = issues.filter((i) => clientArchived.has(i.id));

  const filtered = activeTab === 0 ? needsReply
    : activeTab === 1 ? activeIssues
    : activeTab === 2 ? doneIssues
    : activeTab === 3 ? archivedIssues
    : needsReply;

  // Sort: unread first, then by most recent activity
  const sorted = [...filtered].sort((a, b) => {
    if (a.isUnreadForMe !== b.isUnreadForMe) return a.isUnreadForMe ? -1 : 1;
    const aTime = a.lastExternalCommentAt || a.updatedAt;
    const bTime = b.lastExternalCommentAt || b.updatedAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px 0", background: "white", borderBottom: "1px solid #eee", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Inbox</div>
            <div style={{ fontSize: 13, color: "#999" }}>
              {needsReply.length > 0
                ? `${needsReply.length} conversation${needsReply.length > 1 ? "s" : ""} need${needsReply.length === 1 ? "s" : ""} your reply`
                : "All caught up"}
            </div>
          </div>
          <button onClick={load} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Refresh size="16px" /> Refresh
          </button>
        </div>
        <Tabs
          activeId={activeTab}
          onClick={(tab) => { setActiveTab(tab.id as number); setSelected(null); }}
          items={[
            { id: 0, title: `Needs reply (${needsReply.length})` },
            { id: 1, title: `Active (${activeIssues.length})` },
            { id: 2, title: `Done (${doneIssues.length})` },
            { id: 3, title: `Archived (${archivedIssues.length})` },
          ]}
        />
      </div>

      {/* Split view */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Thread list */}
        <div style={{ width: selected ? 380 : "100%", flexShrink: 0, overflowY: "auto", borderRight: selected ? "1px solid #eee" : "none", background: "white" }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
              <InboxIcon color="#b0b0b0" size="48px" />
              <div style={{ fontWeight: 600, color: "#333", marginTop: 8 }}>
                {activeTab === 0 ? "All caught up" : activeTab === 1 ? "No active tasks" : activeTab === 2 ? "No completed tasks" : "No archived items"}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {activeTab === 0 ? "No conversations need your reply right now." : activeTab === 1 ? "All tasks are either done or in the backlog." : activeTab === 2 ? "Completed tasks will appear here." : "Archived conversations appear here."}
              </div>
            </div>
          ) : (
            sorted.map((issue) => {
              const isSelected = selected?.id === issue.id;
              const assignee = agentName(issue.assigneeAgentId || issue.assigneeId);
              const hasNewAgentComment = !!issue.lastExternalCommentAt;
              const activityTime = issue.lastExternalCommentAt || issue.updatedAt;

              return (
                <div
                  key={issue.id}
                  onClick={() => selectIssue(issue)}
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid #f4f4f4",
                    cursor: "pointer",
                    background: isSelected ? "#edf5ff" : "white",
                    borderLeft: isSelected ? "3px solid #3899ec" : issue.isUnreadForMe ? "3px solid #3899ec" : "3px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                      {issue.isUnreadForMe && (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3899ec", flexShrink: 0 }} />
                      )}
                      <span style={{ fontWeight: issue.isUnreadForMe ? 700 : 400, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {issue.title}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "#bbb", flexShrink: 0, marginLeft: 8 }} title={new Date(activityTime).toLocaleString()}>{timeAgo(activityTime)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 3, display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{issue.identifier}</span>
                    <span>·</span>
                    <span>{assignee}</span>
                    {hasNewAgentComment && (
                      <Badge size="tiny" skin="general">replied</Badge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail pane */}
        {selected && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fafbfc" }}>
            {/* Header */}
            <div style={{ padding: "14px 20px", background: "white", borderBottom: "1px solid #eee", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.title}</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                    {selected.identifier} · {agentName(selected.assigneeAgentId || selected.assigneeId)}
                    {selected.status && (
                      <Badge size="tiny" skin="general" style={{ marginLeft: 6 }}>{selected.status.replace(/_/g, " ")}</Badge>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {activeTab !== 3 ? (
                    <button onClick={() => handleArchive(selected.id)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>
                      Archive
                    </button>
                  ) : (
                    <button onClick={() => handleUnarchive(selected.id)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>
                      Unarchive
                    </button>
                  )}
                  <a href={`/tasks?issue=${selected.identifier}`} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 12px", fontSize: 12, textDecoration: "none", color: "#333", display: "inline-block" }}>
                    Full view
                  </a>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {loadingComments ? (
                <Box align="center" padding="24px"><Loader size="small" /></Box>
              ) : comments.length === 0 ? (
                <div style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>No messages yet.</div>
              ) : (
                comments.map((c) => {
                  const isAgent = !!c.authorAgentId;
                  const author = isAgent ? agentName(c.authorAgentId) : "You";
                  return (
                    <div key={c.id} style={{ marginBottom: 16, display: "flex", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                        background: isAgent ? "#3899ec" : "#162d3d", color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {author.charAt(0)}
                      </div>
                      <div style={{ flex: 1, background: "white", borderRadius: 8, padding: "10px 14px", border: "1px solid #eee" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{author}</span>
                          <span style={{ fontSize: 11, color: "#999" }}>{timeAgo(c.createdAt)}</span>
                        </div>
                        <div className="timeline-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: "#333" }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply */}
            <div style={{ padding: "10px 20px", background: "white", borderTop: "1px solid #eee", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${agentName(selected.assigneeAgentId || selected.assigneeId)}...`}
                disabled={sending}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleReply(); } }}
                style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 20, padding: "9px 16px", fontSize: 13, outline: "none", background: "#f7f8fa" }}
              />
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || sending}
                style={{
                  background: replyText.trim() && !sending ? "#3899ec" : "#d6e6f2", color: "white",
                  border: "none", borderRadius: 20, padding: "9px 18px", fontSize: 13, fontWeight: 600,
                  cursor: replyText.trim() && !sending ? "pointer" : "default",
                }}
              >
                {sending ? "Sending..." : "Reply"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Providers>
      <Shell>
        <InboxContent />
      </Shell>
    </Providers>
  );
}

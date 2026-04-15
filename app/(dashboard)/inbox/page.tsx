"use client";

import React, { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box,
  Text,
  Badge,
  Loader,
  Tabs,
  Tooltip,
} from "@wix/design-system";
import { Refresh, Inbox as InboxIcon } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCompany } from "../../providers";
import { TaskLinkWithPreview, extractTaskIdentifierFromHref } from "@/components/task-link-with-preview";
import { ensureWorkspaceHref } from "@/lib/workspace-links";
import {
  getAgents,
  getMyIssues,
  getIssuesAssignedToMe,
  getIssues,
  getComments,
  postComment,
  createIssue,
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

const STATUS_COLORS: Record<string, string> = {
  blocked: "#ee5951",
  in_progress: "#3899ec",
  in_review: "#8b5cf6",
  todo: "#f5a623",
  backlog: "#b0b0b0",
  done: "#00b876",
  cancelled: "#999",
};

const TAB_KEYS = ["all", "needs-reply", "sent", "active", "done", "archived"];
const DEFAULT_TAB_KEY = "needs-reply";

function DescriptionBlock({
  description,
  companyPath,
  issuesByIdentifier,
}: {
  description: string;
  companyPath: (path: string) => string;
  issuesByIdentifier: Record<string, Issue>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = description.length > 300;
  const preview = isLong && !expanded ? description.slice(0, 300) + "…" : description;

  return (
    <div style={{
      marginBottom: 20,
      background: "#f7f8fa",
      border: "1px solid #e8e8e8",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      <div style={{ padding: "10px 16px 6px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid #eeeeee" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>Brief</span>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <div className="timeline-markdown" style={{ fontSize: 14, color: "#444", lineHeight: 1.75 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, node: _node, ...props }) => {
                const taskIdentifier = extractTaskIdentifierFromHref(href);
                const linkedIssue = taskIdentifier ? issuesByIdentifier[taskIdentifier] : null;
                const workspaceHref = ensureWorkspaceHref(href, companyPath);

                if (!workspaceHref || !linkedIssue) {
                  return <a {...props} href={workspaceHref || href} />;
                }

                return <TaskLinkWithPreview {...props} href={workspaceHref} issue={linkedIssue} />;
              },
            }}
          >
            {preview}
          </ReactMarkdown>
        </div>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ marginTop: 6, background: "none", border: "none", color: "#3899ec", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function InboxContent() {
  const { companyId, companyPath } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const initialTab = Math.max(0, TAB_KEYS.indexOf(searchParams.get("tab") || DEFAULT_TAB_KEY));
  const [activeTab, setActiveTab] = useState(initialTab);

  const updateTab = (tabId: number) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    if (TAB_KEYS[tabId] === DEFAULT_TAB_KEY) params.delete("tab");
    else params.set("tab", TAB_KEYS[tabId]);
    router.replace(companyPath(`/inbox${params.toString() ? `?${params}` : ""}`), { scroll: false });
  };

  const [selected, setSelected] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Compose
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState<string>("ceo");
  const [composeText, setComposeText] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const issuesByIdentifier = issues.reduce<Record<string, Issue>>((acc, issue) => {
    acc[issue.identifier] = issue;
    return acc;
  }, {});

  const handleCompose = async () => {
    if (!composeText.trim() || !companyId) return;
    setComposeSending(true);
    try {
      // Create a task assigned to the selected agent
      const assigneeId = composeTo === "ceo" ? agents.find((a) => a.role === "ceo")?.id : composeTo;
      const newIssue = await createIssue(companyId, {
        title: composeText.slice(0, 80),
        description: composeText,
        priority: "high",
        assigneeId: assigneeId,
      });
      if (assigneeId) { try { await invokeHeartbeat(assigneeId); } catch {} }
      setComposing(false);
      setComposeText("");
      setComposeTo("ceo");
      await load();
      if (newIssue) selectIssue(newIssue);
    } catch { /* skip */ }
    setComposeSending(false);
  };

  // Client-side archive
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
    if (!companyId) { setLoading(false); return; }
    const [agentList, assignedToMe, myIssues, blockedIssues] = await Promise.all([
      getAgents(companyId),
      getIssuesAssignedToMe(companyId),
      getMyIssues(companyId),
      getIssues(companyId, "status=blocked"),
    ]);
    setAgents(agentList);
    // Merge all sources, deduplicated, skip Board Inbox
    const seen = new Set<string>();
    const merged: Issue[] = [];
    for (const list of [assignedToMe, myIssues, blockedIssues]) {
      for (const issue of list) {
        if (!seen.has(issue.id) && issue.title !== "Board Inbox") {
          seen.add(issue.id);
          merged.push(issue);
        }
      }
    }
    setIssues(merged);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [comments]);

  const selectIssue = async (issue: Issue) => {
    setSelected(issue);
    setReplyText("");
    setLoadingComments(true);
    if (issue.isUnreadForMe) {
      markIssueRead(issue.id).catch(() => {});
      setIssues((prev) => prev.map((i) => i.id === issue.id ? { ...i, isUnreadForMe: false } : i));
    }
    const c = await getComments(issue.id);
    setComments(c.reverse());
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
    const assigneeId = selected.assigneeAgentId || selected.assigneeId;
    if (assigneeId) { try { await invokeHeartbeat(assigneeId); } catch {} }
    load();
  };

  const handleArchive = (id: string) => {
    archiveIssueFromInbox(id);
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

  // Filter
  const allNonArchived = issues.filter((i) => !clientArchived.has(i.id));
  // "Needs reply" = assigned to me OR unread OR blocked
  const needsReply = allNonArchived.filter((i) =>
    !["done", "cancelled"].includes(i.status) &&
    (i.assigneeUserId === "local-board" || i.isUnreadForMe || i.status === "blocked")
  );
  // "Sent" = issues I touched that are assigned to agents (not to me)
  const sentByMe = allNonArchived.filter((i) =>
    i.assigneeUserId !== "local-board" && !["done", "cancelled"].includes(i.status)
  );
  const activeIssues = allNonArchived.filter((i) => !["done", "cancelled"].includes(i.status));
  const doneIssues = allNonArchived.filter((i) => ["done", "cancelled"].includes(i.status));
  const archivedIssues = issues.filter((i) => clientArchived.has(i.id));

  const filtered = activeTab === 0 ? allNonArchived
    : activeTab === 1 ? needsReply
    : activeTab === 2 ? sentByMe
    : activeTab === 3 ? activeIssues
    : activeTab === 4 ? doneIssues
    : activeTab === 5 ? archivedIssues
    : allNonArchived;

  // Sort: blocked first, then unread, then by recent activity
  const sorted = [...filtered].sort((a, b) => {
    if (a.status === "blocked" && b.status !== "blocked") return -1;
    if (b.status === "blocked" && a.status !== "blocked") return 1;
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
      <div style={{ padding: "18px 24px 0", background: "white", borderBottom: "1px solid #eee", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>Inbox</div>
            <div style={{ fontSize: 14, color: "#999" }}>
              {needsReply.length > 0
                ? `${needsReply.length} need${needsReply.length === 1 ? "s" : ""} your attention`
                : "All caught up"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setComposing(true)} style={{ background: "#3899ec", color: "white", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 14, cursor: "pointer", fontWeight: 600 }}>
              Compose
            </button>
            <button onClick={load} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "7px 14px", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Refresh size="16px" /> Refresh
            </button>
          </div>
        </div>
        <Tabs
          activeId={activeTab}
          onClick={(tab) => { updateTab(tab.id as number); setSelected(null); }}
          items={[
            { id: 0, title: `All (${allNonArchived.length})` },
            { id: 1, title: `Needs reply (${needsReply.length})` },
            { id: 2, title: `Sent (${sentByMe.length})` },
            { id: 3, title: `Active (${activeIssues.length})` },
            { id: 4, title: `Done (${doneIssues.length})` },
            { id: 5, title: `Archived (${archivedIssues.length})` },
          ]}
        />
      </div>

      {/* Split view */}
      <div className="inbox-split" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Thread list */}
        <div className={`inbox-list${selected ? " has-selection" : ""}`} style={{ width: selected ? 380 : "100%", flexShrink: 0, overflowY: "auto", borderRight: selected ? "1px solid #e8e8e8" : "none", background: "#f4f5f7" }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
              <InboxIcon color="#b0b0b0" size="48px" />
              <div style={{ fontWeight: 600, color: "#333", marginTop: 8 }}>
                {activeTab === 0 ? "Nothing here yet" : activeTab === 1 ? "All caught up" : activeTab === 2 ? "No sent items" : activeTab === 3 ? "No active tasks" : activeTab === 4 ? "No completed tasks" : "No archived items"}
              </div>
              <div style={{ fontSize: 14, marginTop: 4 }}>
                {activeTab === 0 ? "Messages from your agents will appear here." : activeTab === 1 ? "No conversations need your reply right now." : ""}
              </div>
            </div>
          ) : (
            <div style={{ padding: "10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            {sorted.map((issue) => {
              const isSelected = selected?.id === issue.id;
              const assignee = agentName(issue.assigneeAgentId || issue.assigneeId);
              const activityTime = issue.lastExternalCommentAt || issue.updatedAt;
              const isAssignedToMe = issue.assigneeUserId === "local-board";
              const isBlocked = issue.status === "blocked";
              const isDone = issue.status === "done" || issue.status === "cancelled";

              const avatarBg = isBlocked ? "#fde8e8" : isDone ? "#f0f0f0" : isAssignedToMe ? "#fff4e6" : "#ddeeff";
              const avatarColor = isBlocked ? "#d63031" : isDone ? "#aaa" : isAssignedToMe ? "#e67e22" : "#3899ec";

              return (
                <div
                  key={issue.id}
                  onClick={() => selectIssue(issue)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected ? "#ddeeff" : "white",
                    border: `1px solid ${isSelected ? "#3899ec55" : isBlocked ? "#ee595133" : "#e8e8e8"}`,
                    boxShadow: isSelected ? "0 1px 4px rgba(56,153,236,0.12)" : "0 1px 2px rgba(0,0,0,0.04)",
                    transition: "background 0.12s, border-color 0.12s",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { if (!isSelected) { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#d0d0d0"; } }}
                  onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = isBlocked ? "#ee595133" : "#e8e8e8"; } }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                    background: avatarBg, color: avatarColor,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15, fontWeight: 700,
                  }}>
                    {assignee.charAt(0).toUpperCase()}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                        {issue.isUnreadForMe && (
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3899ec", flexShrink: 0 }} />
                        )}
                        <TaskLinkWithPreview
                          href={companyPath(`/tasks/${issue.identifier}`)}
                          issue={issue}
                          onClick={(event) => event.stopPropagation()}
                          style={{
                            fontSize: 15,
                            fontWeight: issue.isUnreadForMe ? 700 : 500,
                            color: isDone ? "#aaa" : "#1a1a1a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textDecoration: "none",
                            display: "block",
                            minWidth: 0,
                          }}
                        >
                          {issue.title}
                        </TaskLinkWithPreview>
                      </div>
                      <span style={{ fontSize: 12, color: "#bbb", flexShrink: 0 }}>
                        {timeAgo(activityTime)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <Text size="small" secondary>{assignee}</Text>
                      {isBlocked && <Badge size="tiny" skin="danger">Blocked</Badge>}
                      {isAssignedToMe && !isBlocked && <Badge size="tiny" skin="warning">Needs reply</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>

        {/* Detail pane */}
        {selected && (
          <div className="inbox-detail" style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fafbfc" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", background: "white", borderBottom: "1px solid #eee", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <button
                    className="inbox-back-btn"
                    onClick={() => setSelected(null)}
                    style={{ display: "none", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "#3899ec", fontSize: 14, padding: 0, marginBottom: 6 }}
                  >
                    ← Back
                  </button>
                  <TaskLinkWithPreview
                    href={companyPath(`/tasks/${selected.identifier}`)}
                    issue={selected}
                    style={{ fontWeight: 700, fontSize: 20, marginBottom: 6, color: "#1a1a1a", textDecoration: "none", display: "inline-block" }}
                  >
                    {selected.title}
                  </TaskLinkWithPreview>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                      padding: "2px 8px", borderRadius: 4, letterSpacing: 0.3,
                      background: selected.status === "blocked" ? "#fee2e2" : selected.status === "done" ? "#e8f5e9" : "#f0f0f0",
                      color: STATUS_COLORS[selected.status] || "#999",
                    }}>
                      {selected.status.replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 13, color: "#999" }}>{selected.identifier}</span>
                    <span style={{ fontSize: 13, color: "#ccc" }}>&middot;</span>
                    {(selected.assigneeAgentId || selected.assigneeId) ? (
                      <a href={companyPath(`/team/${selected.assigneeAgentId || selected.assigneeId}`)} style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                        {agentName(selected.assigneeAgentId || selected.assigneeId)}
                      </a>
                    ) : (
                      <span style={{ fontSize: 13, color: "#999" }}>Unassigned</span>
                    )}
                    {selected.priority === "high" || selected.priority === "critical" ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#ee5951", textTransform: "uppercase" }}>
                        {selected.priority}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 16 }}>
                  {activeTab !== 5 ? (
                    <button onClick={() => handleArchive(selected.id)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#666" }}>
                      Archive
                    </button>
                  ) : (
                    <button onClick={() => handleUnarchive(selected.id)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#666" }}>
                      Unarchive
                    </button>
                  )}
                  <TaskLinkWithPreview
                    href={companyPath(`/tasks/${selected.identifier}`)}
                    issue={selected}
                    style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", fontSize: 13, textDecoration: "none", color: "#666", display: "inline-flex", alignItems: "center" }}
                  >
                    Open task
                  </TaskLinkWithPreview>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
              {/* Description block — shown inline in the thread, not in the header */}
              {selected.description && selected.title !== "Board Inbox" && (
                <DescriptionBlock
                  description={selected.description}
                  companyPath={companyPath}
                  issuesByIdentifier={issuesByIdentifier}
                />
              )}
              {loadingComments ? (
                <Box align="center" padding="24px"><Loader size="small" /></Box>
              ) : comments.length === 0 ? (
                <div style={{ textAlign: "center", color: "#999", padding: "40px 0", fontSize: 14 }}>No messages yet. Send a reply to start the conversation.</div>
              ) : (
                comments.map((c, idx) => {
                  const isAgent = !!c.authorAgentId;
                  const author = isAgent ? agentName(c.authorAgentId) : "You";
                  const prevComment = idx > 0 ? comments[idx - 1] : null;
                  const authorChanged = !prevComment || (prevComment.authorAgentId !== c.authorAgentId) || (!!prevComment.authorAgentId !== !!c.authorAgentId);

                  return (
                    <div key={c.id}>
                      {/* Divider between different authors */}
                      {idx > 0 && authorChanged && (
                        <div style={{ height: 1, background: "#e8e8e8", margin: "20px 0" }} />
                      )}
                      {/* Spacing between same-author messages */}
                      {idx > 0 && !authorChanged && (
                        <div style={{ height: 12 }} />
                      )}

                      <div style={{
                        display: "flex", gap: 12, alignItems: "flex-start",
                        padding: isAgent ? "0" : "0",
                      }}>
                        {/* Avatar */}
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                          background: isAgent ? "linear-gradient(135deg, #3899ec, #1a4a6e)" : "#162d3d",
                          color: "white",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700,
                        }}>
                          {author.charAt(0)}
                        </div>

                        {/* Message content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Author + time */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                            {isAgent && c.authorAgentId ? (
                              <a href={companyPath(`/team/${c.authorAgentId}`)} style={{ fontWeight: 600, fontSize: 14, color: "#3899ec", textDecoration: "none" }}>{author}</a>
                            ) : (
                              <span style={{ fontWeight: 600, fontSize: 14, color: "#333" }}>{author}</span>
                            )}
                            <span style={{ fontSize: 11, color: "#bbb" }}>
                              {new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>

                          {/* Message body */}
                          <div style={{
                            padding: "12px 16px",
                            background: isAgent ? "white" : "#f0f5ff",
                            borderRadius: 10,
                            border: isAgent ? "1px solid #e8e8e8" : "1px solid #ccdcf5",
                            fontSize: 14, lineHeight: 1.8, color: "#333",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                          }}>
                            <div className="timeline-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  a: ({ href, node: _node, ...props }) => {
                                    const taskIdentifier = extractTaskIdentifierFromHref(href);
                                    const linkedIssue = taskIdentifier ? issuesByIdentifier[taskIdentifier] : null;
                                    const workspaceHref = ensureWorkspaceHref(href, companyPath);

                                    if (!workspaceHref || !linkedIssue) {
                                      return <a {...props} href={workspaceHref || href} />;
                                    }

                                    return <TaskLinkWithPreview {...props} href={workspaceHref} issue={linkedIssue} />;
                                  },
                                }}
                              >
                                {c.body}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply */}
            <div style={{ padding: "12px 20px", background: "white", borderTop: "1px solid #eee", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${agentName(selected.assigneeAgentId || selected.assigneeId)}...`}
                  disabled={sending}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                  rows={1}
                  style={{
                    flex: 1, border: "1px solid #e0e0e0", borderRadius: 8,
                    padding: "10px 14px", fontSize: 14, outline: "none", background: "#f7f8fa",
                    resize: "none", fontFamily: "inherit", minHeight: 40,
                  }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = Math.min(target.scrollHeight, 120) + "px";
                  }}
                />
                <Tooltip content="Send reply and wake up the assigned agent" placement="top">
                  <button
                    onClick={handleReply}
                    disabled={!replyText.trim() || sending}
                    style={{
                      background: replyText.trim() && !sending ? "#3899ec" : "#d6e6f2", color: "white",
                      border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
                      cursor: replyText.trim() && !sending ? "pointer" : "default", flexShrink: 0,
                    }}
                  >
                    {sending ? "..." : "Reply"}
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compose overlay */}
      {composing && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setComposing(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 500, background: "white", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.15)", overflow: "hidden" }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", fontWeight: 700, fontSize: 16 }}>
              New message
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 4 }}>TO</div>
                <select
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                >
                  <option value="ceo">AI Business Manager (Board Inbox)</option>
                  {agents.filter((a) => a.role !== "ceo").map((a) => (
                    <option key={a.id} value={a.id}>{a.name} — {a.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 4 }}>MESSAGE</div>
                <textarea
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  placeholder={composeTo === "ceo" ? "Message to the AI Business Manager..." : "Describe the task..."}
                  rows={5}
                  autoFocus
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setComposing(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ddd", background: "white", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={handleCompose}
                disabled={!composeText.trim() || composeSending}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: "none",
                  background: composeText.trim() && !composeSending ? "#3899ec" : "#d6e6f2",
                  color: "white", fontSize: 13, fontWeight: 600, cursor: composeText.trim() && !composeSending ? "pointer" : "default",
                }}
              >
                {composeSending ? "Sending..." : composeTo === "ceo" ? "Send to AI Business Manager" : "Create Task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
      <InboxContent />
    </Suspense>
  );
}

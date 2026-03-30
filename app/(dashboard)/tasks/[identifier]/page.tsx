"use client";

import { use, useEffect, useState, useCallback, Suspense } from "react";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Button,
  Loader,
  Dropdown,
  Divider,
  Tooltip,
} from "@wix/design-system";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCompany } from "../../../providers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import {
  getIssues,
  getAgents,
  getComments,
  postComment,
  updateIssue,
  invokeHeartbeat,
  type Issue,
  type Agent,
  type Comment,
} from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const STATUS_SKINS: Record<
  string,
  "general" | "success" | "warning" | "danger" | "neutral" | "urgent"
> = {
  backlog: "neutral",
  todo: "general",
  in_progress: "warning",
  in_review: "general",
  done: "success",
  blocked: "danger",
  cancelled: "neutral",
};

const PRIORITY_SKINS: Record<
  string,
  "general" | "success" | "warning" | "danger" | "neutral" | "urgent"
> = {
  critical: "danger",
  high: "warning",
  medium: "general",
  low: "neutral",
};

function TaskDetailContent({ identifier }: { identifier: string }) {
  const { companyId } = useCompany();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  const agentName = (id: string | null) => {
    if (!id) return "Unassigned";
    return agents.find((a) => a.id === id)?.name || "Unknown";
  };

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    const [issueData, agentData] = await Promise.all([
      getIssues(companyId),
      getAgents(companyId),
    ]);
    const found = issueData.find(
      (i: Issue) => i.identifier === identifier
    );
    setIssue(found || null);
    setAgents(agentData);
    setLoading(false);

    if (found) {
      setLoadingComments(true);
      try {
        const c = await getComments(found.id);
        setComments(c);
      } catch {
        setComments([]);
      }
      setLoadingComments(false);
    }
  }, [companyId, identifier]);

  useEffect(() => {
    load();
  }, [load]);

  const handleComment = async () => {
    if (!newComment.trim() || !issue) return;
    setSendingComment(true);
    try {
      await postComment(issue.id, newComment);
      setNewComment("");
      const c = await getComments(issue.id);
      setComments(c);
      // Wake up the assignee
      const assigneeId = issue.assigneeAgentId || issue.assigneeId;
      if (assigneeId) {
        try {
          await invokeHeartbeat(assigneeId);
        } catch {}
      }
    } finally {
      setSendingComment(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!issue) return;
    await updateIssue(issue.id, { status: newStatus });
    setIssue({ ...issue, status: newStatus });
  };

  const handleAssigneeChange = async (newAssigneeId: string | undefined) => {
    if (!issue) return;
    await updateIssue(issue.id, {
      assigneeAgentId: newAssigneeId || null,
    } as Partial<Issue>);
    setIssue({ ...issue, assigneeAgentId: newAssigneeId || null });
    load();
  };

  const agentDropdownOptions = [
    { id: "", value: "Unassigned" },
    ...agents.map((a) => ({ id: a.id, value: a.name })),
  ];

  const statusDropdownOptions = Object.entries(STATUS_LABELS).map(
    ([id, value]) => ({ id, value })
  );

  if (loading) {
    return (
      <Box align="center" verticalAlign="middle" height="400px">
        <Loader size="medium" />
      </Box>
    );
  }

  if (!issue) {
    return (
      <Page>
        <Page.Header
          title={
            <Breadcrumbs
              items={[
                { label: "Tasks", href: "/tasks" },
                { label: identifier },
              ]}
            />
          }
        />
        <Page.Content>
          <Card>
            <Card.Content>
              <Box align="center" padding="48px">
                <Text secondary>
                  Task {identifier} not found.
                </Text>
              </Box>
            </Card.Content>
          </Card>
        </Page.Content>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header
        title={
          <Breadcrumbs
            items={[
              { label: "Tasks", href: "/tasks" },
              { label: `${identifier} ${issue.title}` },
            ]}
          />
        }
        actionsBar={
          <Box direction="horizontal" gap="6px" verticalAlign="middle">
            <Text size="small" secondary>
              Status:
            </Text>
            <Dropdown
              size="small"
              selectedId={issue.status}
              onSelect={(o) => handleStatusChange(String(o.id))}
              options={statusDropdownOptions}
              border="round"
              popoverProps={{ placement: "bottom-end" }}
            />
          </Box>
        }
      />
      <Page.Content>
        {/* Header card */}
        <Card>
          <Card.Content>
            <Box direction="vertical" gap="12px">
              <Text weight="bold" size="medium">
                {issue.title}
              </Text>
              <Box direction="horizontal" gap="8px" verticalAlign="middle">
                <Text size="tiny" secondary style={{ fontFamily: "monospace" }}>
                  {issue.identifier || `#${issue.number}`}
                </Text>
                <Badge
                  size="tiny"
                  skin={STATUS_SKINS[issue.status] || "general"}
                >
                  {STATUS_LABELS[issue.status] || issue.status}
                </Badge>
                {issue.priority && (
                  <Badge
                    size="tiny"
                    skin={PRIORITY_SKINS[issue.priority] || "general"}
                  >
                    {issue.priority}
                  </Badge>
                )}
                <Box direction="horizontal" gap="6px" verticalAlign="middle">
                  <Text size="tiny" secondary>
                    Assignee:
                  </Text>
                  <Dropdown
                    size="small"
                    selectedId={issue.assigneeAgentId || issue.assigneeId || ""}
                    onSelect={(option) =>
                      handleAssigneeChange(
                        option.id ? String(option.id) : undefined
                      )
                    }
                    options={agentDropdownOptions}
                    border="round"
                    placeholder="Assign..."
                  />
                </Box>
              </Box>
              {issue.description && (
                <>
                  <Divider />
                  <div
                    className="timeline-markdown"
                    style={{
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "#32536a",
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {issue.description}
                    </ReactMarkdown>
                  </div>
                </>
              )}
            </Box>
          </Card.Content>
        </Card>

        <Box marginTop="18px">
          <Card>
            <Card.Header title="Comments & Activity" />
            <Card.Divider />
            <Card.Content>
              {loadingComments ? (
                <Box align="center" padding="24px">
                  <Loader size="small" />
                </Box>
              ) : comments.length === 0 ? (
                <Box padding="24px" align="center">
                  <Text secondary>No activity yet on this task.</Text>
                </Box>
              ) : (
                comments.map((c, i) => {
                  const isAgent = !!c.authorAgentId;
                  const author = isAgent
                    ? agentName(c.authorAgentId)
                    : "You";
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        gap: 12,
                        padding: "14px 0",
                        borderBottom:
                          i < comments.length - 1
                            ? "1px solid #f0f0f0"
                            : "none",
                      }}
                    >
                      {/* Avatar */}
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          backgroundColor: isAgent ? "#3899ec" : "#162d3d",
                          color: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {author.charAt(0).toUpperCase()}
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 4,
                          }}
                        >
                          {isAgent && c.authorAgentId ? (
                            <a
                              href={`/team/${c.authorAgentId}`}
                              style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#3899ec",
                                textDecoration: "none",
                              }}
                            >
                              {author}
                            </a>
                          ) : (
                            <Text size="small" weight="bold">
                              {author}
                            </Text>
                          )}
                          <Text size="tiny" secondary>
                            {new Date(c.createdAt).toLocaleString()}
                          </Text>
                        </div>
                        <div
                          className="timeline-markdown"
                          style={{
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "#32536a",
                            wordBreak: "break-word",
                          }}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {c.body}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </Card.Content>

            {/* Sticky reply bar */}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                background: "#f0f4f7",
                padding: "10px 24px",
                borderTop: "1px solid #e8e8e8",
                borderRadius: "0 0 8px 8px",
                position: "sticky",
                bottom: 0,
              }}
            >
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Reply to this task..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleComment();
                  }
                }}
                style={{
                  flex: 1,
                  border: "1px solid #d6e6f2",
                  borderRadius: 20,
                  outline: "none",
                  padding: "8px 16px",
                  fontSize: 14,
                  background: "white",
                  boxSizing: "border-box" as const,
                  height: 38,
                }}
              />
              <button
                onClick={handleComment}
                disabled={!newComment.trim() || sendingComment}
                style={{
                  background:
                    newComment.trim() && !sendingComment
                      ? "#3899ec"
                      : "#b6d4ee",
                  color: "white",
                  border: "none",
                  borderRadius: 20,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor:
                    newComment.trim() && !sendingComment
                      ? "pointer"
                      : "default",
                  whiteSpace: "nowrap" as const,
                  flexShrink: 0,
                }}
              >
                {sendingComment ? "Sending..." : "Send"}
              </button>
            </div>
          </Card>
        </Box>
      </Page.Content>
    </Page>
  );
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = use(params);

  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>
      }
    >
      <TaskDetailContent identifier={identifier} />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Button,
  Loader,
  Input,
  Modal,
  CustomModalLayout,
  FormField,
  InputArea,
  Dropdown,
  Divider,
  Table,
  TableToolbar,
  Search,
} from "@wix/design-system";
import { Add, Refresh } from "@wix/wix-ui-icons-common";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getIssues,
  getAgents,
  getComments,
  createIssue,
  updateIssue,
  postComment,
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

const STATUS_SKINS: Record<string, "general" | "success" | "warning" | "danger" | "neutral" | "urgent"> = {
  backlog: "neutral",
  todo: "general",
  in_progress: "warning",
  in_review: "general",
  done: "success",
  blocked: "danger",
  cancelled: "neutral",
};

const PRIORITY_SKINS: Record<string, "general" | "success" | "warning" | "danger" | "neutral" | "urgent"> = {
  critical: "danger",
  high: "warning",
  medium: "general",
  low: "neutral",
};

function TasksContent() {
  const searchParams = useSearchParams();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [autoOpened, setAutoOpened] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newAssignee, setNewAssignee] = useState<string | undefined>();

  // Detail modal
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("in_progress");

  const load = useCallback(async () => {
    const companies = await getCompanies();
    if (companies.length > 0) {
      setCompanyId(companies[0].id);
      const [issueData, agentData] = await Promise.all([
        getIssues(companies[0].id),
        getAgents(companies[0].id),
      ]);
      setIssues(issueData.filter((i: Issue) => i.title !== "Board Inbox"));
      setAgents(agentData);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-open issue from ?issue=AGE-8 query param
  useEffect(() => {
    const issueParam = searchParams.get("issue");
    if (issueParam && issues.length > 0 && !autoOpened) {
      const match = issues.find((i) => i.identifier === issueParam);
      if (match) {
        openDetail(match);
        setAutoOpened(true);
      }
    }
  }, [issues, searchParams, autoOpened]);

  const agentName = (id: string | null) => {
    if (!id) return "Unassigned";
    return agents.find((a) => a.id === id)?.name || "Unknown";
  };

  const filteredIssues = issues
    .filter((i) => filterStatus === "all" || i.status === filterStatus)
    .filter((i) =>
      !searchTerm || i.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const openDetail = async (issue: Issue) => {
    setSelectedIssue(issue);
    setEditingStatus(issue.status);
    setLoadingComments(true);
    try {
      const c = await getComments(issue.id);
      setComments(c);
    } catch {
      setComments([]);
    }
    setLoadingComments(false);
  };

  const closeDetail = () => {
    setSelectedIssue(null);
    setComments([]);
    setNewComment("");
    setEditingStatus(null);
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !companyId) return;
    await createIssue(companyId, {
      title: newTitle,
      description: newDesc,
      priority: newPriority,
      assigneeId: newAssignee,
    });
    setShowCreate(false);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("medium");
    setNewAssignee(undefined);
    load();
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedIssue) return;
    await updateIssue(selectedIssue.id, { status: newStatus });
    setEditingStatus(newStatus);
    setSelectedIssue({ ...selectedIssue, status: newStatus });
    load();
  };

  const handleComment = async () => {
    if (!newComment.trim() || !selectedIssue) return;
    await postComment(selectedIssue.id, newComment);
    setNewComment("");
    const c = await getComments(selectedIssue.id);
    setComments(c);
  };

  const agentDropdownOptions = [
    { id: "", value: "Unassigned" },
    ...agents.map((a) => ({ id: a.id, value: a.name })),
  ];

  const statusDropdownOptions = Object.entries(STATUS_LABELS).map(([id, value]) => ({
    id,
    value,
  }));

  if (loading) {
    return (
      <Box align="center" verticalAlign="middle" height="400px">
        <Loader size="medium" />
      </Box>
    );
  }

  const columns = [
    {
      title: "ID",
      render: (row: Issue) => (
        <Text size="small" secondary style={{ fontFamily: "monospace" }}>{row.identifier || `#${row.number}`}</Text>
      ),
      width: "10%",
    },
    {
      title: "Task",
      render: (row: Issue) => (
        <Text size="small">{row.title}</Text>
      ),
      width: "30%",
    },
    {
      title: "Assignee",
      render: (row: Issue) => <Text size="small">{agentName(row.assigneeAgentId || row.assigneeId)}</Text>,
      width: "20%",
    },
    {
      title: "Priority",
      render: (row: Issue) =>
        row.priority ? (
          <Badge size="small" skin={PRIORITY_SKINS[row.priority] || "general"}>
            {row.priority}
          </Badge>
        ) : null,
      width: "15%",
    },
    {
      title: "Status",
      render: (row: Issue) => (
        <Badge size="small" skin={STATUS_SKINS[row.status] || "general"}>
          {STATUS_LABELS[row.status] || row.status}
        </Badge>
      ),
      width: "15%",
    },
    {
      title: "",
      render: (row: Issue) => (
        <a
          href="#"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openDetail(row);
          }}
          style={{
            color: "#3899ec",
            textDecoration: "none",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          View
        </a>
      ),
      width: "10%",
    },
  ];

  return (
    <>
      <Page>
        <Page.Header
          title="Tasks"
          subtitle={`${filteredIssues.length} of ${issues.length} issues`}
          actionsBar={
            <Box direction="horizontal" gap="6px">
              <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>
                Refresh
              </Button>
              <Button size="small" prefixIcon={<Add />} onClick={() => setShowCreate(true)}>
                New Task
              </Button>
            </Box>
          }
        />
        <Page.Content>
          <Card hideOverflow>
            <Table
              skin="standard"
              data={filteredIssues}
              columns={columns}
              rowVerticalPadding="medium"
            >
              <TableToolbar>
                <TableToolbar.ItemGroup position="start">
                  <TableToolbar.Item>
                    <TableToolbar.Title>{`Tasks (${filteredIssues.length})`}</TableToolbar.Title>
                  </TableToolbar.Item>
                  <TableToolbar.Item>
                    <Box height="18px"><Divider direction="vertical" /></Box>
                  </TableToolbar.Item>
                  <TableToolbar.Item>
                    <Dropdown
                      size="small"
                      selectedId={filterStatus}
                      onSelect={(o) => setFilterStatus(String(o.id))}
                      options={[
                        { id: "all", value: "All statuses" },
                        ...statusDropdownOptions,
                      ]}
                      border="round"
                      popoverProps={{ placement: "bottom-start" }}
                    />
                  </TableToolbar.Item>
                </TableToolbar.ItemGroup>
                <TableToolbar.ItemGroup position="end">
                  <TableToolbar.Item>
                    <Search
                      size="small"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onClear={() => setSearchTerm("")}
                      placeholder="Search..."
                    />
                  </TableToolbar.Item>
                </TableToolbar.ItemGroup>
              </TableToolbar>
              <Table.Content />
              {filteredIssues.length === 0 && (
                <div style={{ padding: "48px 24px", textAlign: "center" }}>
                  <Text secondary>
                    {filterStatus === "in_progress"
                      ? "No tasks are in progress right now."
                      : filterStatus === "all"
                        ? "No tasks yet."
                        : `No ${STATUS_LABELS[filterStatus]?.toLowerCase() || filterStatus} tasks.`}
                  </Text>
                  {filterStatus !== "all" && (
                    <div style={{ marginTop: 8 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setFilterStatus("all"); }} style={{ color: "#3899ec", fontSize: 13, textDecoration: "none" }}>
                        View all tasks
                      </a>
                    </div>
                  )}
                </div>
              )}
            </Table>
          </Card>
        </Page.Content>
      </Page>

      {/* Create modal */}
      <Modal isOpen={showCreate} onRequestClose={() => setShowCreate(false)} shouldCloseOnOverlayClick>
        <CustomModalLayout
          width="60vw"
          title="Create Task"
          primaryButtonText="Create"
          primaryButtonOnClick={handleCreate}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowCreate(false)}
          onCloseButtonClick={() => setShowCreate(false)}
        >
          <Box direction="vertical" gap="12px">
            <FormField label="Title" required>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </FormField>
            <FormField label="Description">
              <InputArea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} />
            </FormField>
            <FormField label="Priority">
              <Dropdown
                selectedId={newPriority}
                onSelect={(option) => setNewPriority(String(option.id))}
                options={[
                  { id: "critical", value: "Critical" },
                  { id: "high", value: "High" },
                  { id: "medium", value: "Medium" },
                  { id: "low", value: "Low" },
                ]}
              />
            </FormField>
            <FormField label="Assignee">
              <Dropdown
                selectedId={newAssignee || ""}
                onSelect={(option) => setNewAssignee(option.id ? String(option.id) : undefined)}
                options={agentDropdownOptions}
                placeholder="Select agent..."
              />
            </FormField>
          </Box>
        </CustomModalLayout>
      </Modal>

      {/* Detail modal */}
      <Modal isOpen={!!selectedIssue} onRequestClose={closeDetail} shouldCloseOnOverlayClick>
        {selectedIssue && (
          <CustomModalLayout
            width="90vw"
            maxHeight="90vh"
            title={
              <Box direction="vertical" gap="6px">
                <Text weight="bold" size="medium">{selectedIssue.title}</Text>
                <Box direction="horizontal" gap="6px" verticalAlign="middle">
                  <Text size="tiny" secondary>#{selectedIssue.number}</Text>
                  <Badge size="small" skin={STATUS_SKINS[selectedIssue.status] || "general"}>
                    {STATUS_LABELS[selectedIssue.status] || selectedIssue.status}
                  </Badge>
                  {selectedIssue.priority && (
                    <Badge size="small" skin={PRIORITY_SKINS[selectedIssue.priority] || "general"}>
                      {selectedIssue.priority}
                    </Badge>
                  )}
                  <Dropdown
                    size="small"
                    selectedId={selectedIssue.assigneeId || ""}
                    onSelect={async (option) => {
                      const newAssigneeId = option.id ? String(option.id) : undefined;
                      await updateIssue(selectedIssue.id, { assigneeId: newAssigneeId || null } as Partial<Issue>);
                      setSelectedIssue({ ...selectedIssue, assigneeId: newAssigneeId || null });
                      load();
                    }}
                    options={agentDropdownOptions}
                    border="round"
                    placeholder="Assign..."
                  />
                </Box>
              </Box>
            }
            onCloseButtonClick={closeDetail}
          >
            {/* Timeline */}
            <div style={{ maxHeight: "calc(90vh - 250px)", overflowY: "auto" }}>
              {loadingComments ? (
                <Box align="center" padding="24px"><Loader size="small" /></Box>
              ) : comments.length === 0 ? (
                <Box padding="24px" align="center">
                  <Text secondary>No activity yet on this task.</Text>
                </Box>
              ) : (
                comments.map((c, i) => {
                  const isAgent = !!c.authorAgentId;
                  const author = isAgent ? agentName(c.authorAgentId) : "You";
                  return (
                    <div key={c.id} style={{ display: "flex", gap: 12, padding: "14px 0", borderBottom: i < comments.length - 1 ? "1px solid #f0f0f0" : "none" }}>
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
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <Text size="small" weight="bold">{author}</Text>
                          <Text size="tiny" secondary>
                            {new Date(c.createdAt).toLocaleString()}
                          </Text>
                        </div>
                        <div className="timeline-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: "#32536a", wordBreak: "break-word" }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply bar */}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                background: "#f0f4f7",
                margin: "12px -30px -30px -30px",
                padding: "10px 24px",
                borderRadius: "0 0 8px 8px",
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
                  boxSizing: "border-box",
                  height: 38,
                }}
              />
              <button
                onClick={handleComment}
                disabled={!newComment.trim()}
                style={{
                  background: newComment.trim() ? "#3899ec" : "#b6d4ee",
                  color: "white",
                  border: "none",
                  borderRadius: 20,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: newComment.trim() ? "pointer" : "default",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                Send
              </button>
            </div>

          </CustomModalLayout>
        )}
      </Modal>
    </>
  );
}

export default function TasksPage() {
  return (
    <Providers>
      <Shell>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
          <TasksContent />
        </Suspense>
      </Shell>
    </Providers>
  );
}

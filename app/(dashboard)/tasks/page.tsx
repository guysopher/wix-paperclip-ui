"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Button,
  Loader,
  Modal,
  CustomModalLayout,
  FormField,
  InputArea,
  Dropdown,
  Divider,
  Table,
  TableToolbar,
  Search,
  Pagination,
} from "@wix/design-system";
import { Add, Refresh, Checklist as ChecklistIcon } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import {
  getIssues,
  getAgents,
  createIssue,
  type Issue,
  type Agent,
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
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  // Create modal
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newAssignee, setNewAssignee] = useState<string | undefined>();
  const ceoAgent = agents.find((a) => a.role === "ceo");

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get("status") || "all");

  const updateFilterUrl = (status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (status === "all") params.delete("status");
    else params.set("status", status);
    router.replace(`/tasks${params.toString() ? `?${params}` : ""}`, { scroll: false });
  };

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const [issueData, agentData] = await Promise.all([
      getIssues(companyId),
      getAgents(companyId),
    ]);
    const filteredIssues = issueData.filter((i: Issue) => i.title !== "Board Inbox");
    setIssues(filteredIssues);
    setAgents(agentData);

    // Debug: log agent IDs
    if (process.env.NODE_ENV === 'development') {
      console.log('Loaded agents:', agentData.map((a: Agent) => ({ id: a.id, name: a.name })));
      console.log('Tasks with assignees:', filteredIssues.map((i: Issue) => ({
        id: i.identifier,
        title: i.title.substring(0, 50),
        assigneeAgentId: i.assigneeAgentId,
        assigneeId: i.assigneeId,
      })));
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Redirect ?issue=AGE-8 to detail page
  const issueParam = searchParams.get("issue");
  if (issueParam) {
    router.replace(`/tasks/${issueParam}`);
    return null;
  }

  const agentName = (id: string | null) => {
    if (!id) return "Unassigned";
    return agents.find((a) => a.id === id)?.name || "Unknown";
  };

  const filteredIssues = issues
    .filter((i) => filterStatus === "all" || i.status === filterStatus)
    .filter((i) =>
      !searchTerm || i.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / PAGE_SIZE));
  const pageIssues = filteredIssues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filterStatus, searchTerm]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !companyId || !newAssignee) return;
    await createIssue(companyId, {
      title: newTitle,
      description: newDesc,
      status: "todo",
      priority: newPriority,
      assigneeAgentId: newAssignee || null,
    });
    setShowCreate(false);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("medium");
    setNewAssignee(undefined);
    load();
  };

  const agentDropdownOptions = agents.map((a) => ({ id: a.id, value: a.name }));

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
      render: (row: Issue) => {
        const id = row.assigneeAgentId || row.assigneeId;
        const name = agentName(id);

        // Debug: log unassigned tasks to console
        if (!id && process.env.NODE_ENV === 'development') {
          console.log(`Unassigned task ${row.identifier}:`, {
            assigneeAgentId: row.assigneeAgentId,
            assigneeId: row.assigneeId,
            assigneeUserId: row.assigneeUserId,
            title: row.title,
          });
        }

        return id ? <a href={`/team/${id}`} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>{name}</a> : <Text size="small" secondary>Unassigned</Text>;
      },
      width: "20%",
    },
    {
      title: "Priority",
      render: (row: Issue) =>
        row.priority ? (
          <Badge size="tiny" skin={PRIORITY_SKINS[row.priority] || "general"}>
            {row.priority}
          </Badge>
        ) : null,
      width: "15%",
    },
    {
      title: "Status",
      render: (row: Issue) => (
        <Badge size="tiny" skin={STATUS_SKINS[row.status] || "general"}>
          {STATUS_LABELS[row.status] || row.status}
        </Badge>
      ),
      width: "15%",
    },
    {
      title: "",
      render: (row: Issue) => (
        <a href={`/tasks/${row.identifier}`} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>View</a>
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
              <Button size="small" prefixIcon={<Add />} onClick={() => { setNewAssignee(ceoAgent?.id); setShowCreate(true); }}>
                New Task
              </Button>
            </Box>
          }
        />
        <Page.Content>
          <Card hideOverflow>
            <Table
              skin="standard"
              data={pageIssues}
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
                      onSelect={(o) => { const s = String(o.id); setFilterStatus(s); updateFilterUrl(s); }}
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
                  <ChecklistIcon color="#b0b0b0" size="48px" />
                  <div style={{ marginTop: 8 }}>
                    <Text secondary>
                      {filterStatus === "in_progress"
                        ? "No tasks are in progress right now."
                        : filterStatus === "all"
                          ? "No tasks yet."
                          : `No ${STATUS_LABELS[filterStatus]?.toLowerCase() || filterStatus} tasks.`}
                    </Text>
                  </div>
                  {filterStatus !== "all" && issues.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setFilterStatus("all"); updateFilterUrl("all"); }} style={{ color: "#3899ec", fontSize: 13, textDecoration: "none" }}>
                        View all tasks
                      </a>
                    </div>
                  )}
                </div>
              )}
            </Table>
            {totalPages > 1 && (
              <Box align="center" padding="20px">
                <Pagination
                  totalPages={totalPages}
                  currentPage={page}
                  onChange={({ page: p }) => setPage(p)}
                />
              </Box>
            )}
          </Card>
        </Page.Content>
      </Page>

      {/* Create modal */}
      <Modal isOpen={showCreate} onRequestClose={() => setShowCreate(false)} shouldCloseOnOverlayClick>
        <CustomModalLayout
          width="500px"
          title="Create Task"
          primaryButtonText="Create"
          primaryButtonOnClick={handleCreate}
          primaryButtonDisabled={!newTitle.trim() || !newAssignee}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowCreate(false)}
          onCloseButtonClick={() => setShowCreate(false)}
        >
          <Box direction="vertical" gap="12px">
            <FormField label="What needs to be done?" required infoContent="Be specific. The assigned agent will read this and work on it during their next check-in.">
              <InputArea
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Describe the task in detail. The assigned team member will read this and act on it..."
                rows={5}
                resizable
              />
            </FormField>
            <FormField label="Assign to" required infoContent="The agent who will work on this task. They'll pick it up during their next scheduled check-in, or you can wake them up manually.">
              <Dropdown
                selectedId={newAssignee || ""}
                onSelect={(option) => setNewAssignee(String(option.id))}
                options={agentDropdownOptions}
                placeholder="Select agent..."
              />
            </FormField>
          </Box>
        </CustomModalLayout>
      </Modal>

    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
      <TasksContent />
    </Suspense>
  );
}

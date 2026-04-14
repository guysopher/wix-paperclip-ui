// Always use the Next.js proxy so browser traffic does not depend on upstream CORS.
const API_BASE = "/api/paperclip";
const PICASSO_BRIDGE_BASE = "/api/picasso-bridge";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function bridgeRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PICASSO_BRIDGE_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Health
export const runHealthCheck = () =>
  fetch("/api/health", { method: "POST" }).then((r) => r.json());
export const runCompanyHealthCheck = (companyId: string) =>
  fetch("/api/health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  }).then((r) => r.json());
export const restartPaperclipServer = () =>
  fetch("/api/health/restart", { method: "POST" }).then(async (r) => {
    const data = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok) {
      throw new Error(data.error || r.statusText);
    }
    return data as { ok: boolean; message: string };
  });

// Companies
export const getCompanies = () => request<Company[]>("/companies");
export const getCompany = (id: string) => request<Company>(`/companies/${id}`);
export const getDashboard = (companyId: string) =>
  request<Dashboard>(`/companies/${companyId}/dashboard`);

// Agents
export const getAgents = (companyId: string) =>
  request<Agent[]>(`/companies/${companyId}/agents`);
export const getOrg = (companyId: string) =>
  request<OrgNode[]>(`/companies/${companyId}/org`);
export const getAgent = (id: string) => request<Agent>(`/agents/${id}`);
export const invokeHeartbeat = (agentId: string) =>
  request<void>(`/agents/${agentId}/heartbeat/invoke`, { method: "POST" });
export const pauseAgent = (agentId: string) =>
  request<Agent>(`/agents/${agentId}/pause`, { method: "POST" });
export const resumeAgent = (agentId: string) =>
  request<Agent>(`/agents/${agentId}/resume`, { method: "POST" });
export const updateAgent = (agentId: string, data: Record<string, unknown>) =>
  request<Agent>(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(data) });

// Issues
export const getIssues = (companyId: string, params?: string) =>
  request<Issue[]>(`/companies/${companyId}/issues${params ? `?${params}` : ""}`);
export const getIssue = (id: string) => request<Issue>(`/issues/${id}`);
export const createIssue = (companyId: string, data: Partial<Issue>) =>
  request<Issue>(`/companies/${companyId}/issues`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const updateIssue = (id: string, data: Partial<Issue>) =>
  request<Issue>(`/issues/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// Issue inbox actions
export const markIssueRead = (issueId: string) =>
  request<unknown>(`/issues/${issueId}/read`, { method: "POST" });
export const archiveIssueFromInbox = (issueId: string) =>
  request<unknown>(`/issues/${issueId}/inbox-archive`, { method: "POST", body: "{}" }).catch(() => null);
export const getMyIssues = (companyId: string) =>
  request<Issue[]>(`/companies/${companyId}/issues?touchedByUserId=me&status=backlog,todo,in_progress,in_review,blocked,done`);
export const getIssuesAssignedToMe = (companyId: string) =>
  request<Issue[]>(`/companies/${companyId}/issues?assigneeUserId=local-board`);

// Comments
export const getComments = (issueId: string) =>
  request<Comment[]>(`/issues/${issueId}/comments`);
export const postComment = (issueId: string, body: string, authorAgentId?: string) =>
  request<Comment>(`/issues/${issueId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, authorAgentId }),
  });

// Activity
export const getActivity = (companyId: string) =>
  request<ActivityEntry[]>(`/companies/${companyId}/activity`);

// Approvals
export const getApprovals = (companyId: string) =>
  request<Approval[]>(`/companies/${companyId}/approvals`);

// Approvals — actions
export const updateApproval = (approvalId: string, data: { status: string; notes?: string }) => {
  const action = data.status === "approved" ? "approve" : "reject";
  return request<Approval>(`/approvals/${approvalId}/${action}`, {
    method: "POST",
    body: JSON.stringify(data.notes ? { notes: data.notes } : {}),
  });
};

// Runs
export const getHeartbeatRuns = (companyId: string, params?: string) =>
  request<HeartbeatRun[]>(`/companies/${companyId}/heartbeat-runs${params ? `?${params}` : ""}`);
export const getHeartbeatRun = (runId: string) =>
  request<HeartbeatRun>(`/heartbeat-runs/${runId}`);
export const getHeartbeatRunLog = (runId: string) =>
  request<Record<string, string>>(`/heartbeat-runs/${runId}/log`);
export const cancelHeartbeatRun = (runId: string) =>
  request<HeartbeatRun>(`/heartbeat-runs/${runId}/cancel`, { method: "POST" });
export const getRuns = (companyId: string, status?: string) =>
  request<HeartbeatRun[]>(`/companies/${companyId}/heartbeat-runs${status ? `?status=${status}` : ""}`).catch(() => [] as HeartbeatRun[]);

export interface Approval {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  invocationSource: string;
  triggerDetail: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  exitCode: number | null;
  usageJson: string | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  logBytes: number | null;
  contextSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// Company
export const createCompany = (data: Partial<Company>) =>
  request<Company>("/companies", { method: "POST", body: JSON.stringify(data) });
export const updateCompany = (companyId: string, data: Partial<Company>) =>
  request<Company>(`/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteCompany = (companyId: string) =>
  request<{ ok: boolean }>(`/companies/${companyId}`, { method: "DELETE" });
export const archiveCompany = (companyId: string) =>
  request<Company>(`/companies/${companyId}/archive`, { method: "POST", body: "{}" });

// Agents — create
export const createAgent = (companyId: string, data: Record<string, unknown>) =>
  request<Agent>(`/companies/${companyId}/agents`, { method: "POST", body: JSON.stringify(data) });

// Goals
export const getGoals = (companyId: string) =>
  request<Goal[]>(`/companies/${companyId}/goals`);
export const createGoal = (companyId: string, data: Partial<Goal>) =>
  request<Goal>(`/companies/${companyId}/goals`, { method: "POST", body: JSON.stringify(data) });
export const deleteGoal = (goalId: string) =>
  request<Goal>(`/goals/${goalId}`, { method: "DELETE" });

// Types
export interface Company {
  id: string;
  name: string;
  description: string;
  status: string;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  maxTokensPerHour?: number;
  disableOnDemandWakeup?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  title: string;
  status: string;
  companyId: string;
  reportsTo: string | null;
  capabilities: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  budgetMonthlyCents: number;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  icon?: string;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  parentId: string | null;
  number: number;
  issueNumber: number;
  identifier: string;
  isUnreadForMe?: boolean;
  lastExternalCommentAt?: string | null;
  myLastTouchAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  createdAt: string;
}

export interface Dashboard {
  agents: Record<string, number>;
  tasks: Record<string, number>;
  costs: { monthSpendCents: number; monthBudgetCents: number; monthUtilizationPercent: number };
  pendingApprovals: number;
}

export interface ActivityEntry {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  level: string;
  status: string;
}

export interface PicassoBridgeJobRequest {
  mode: "create_site";
  prompt: string;
  designer?: string;
  companyId?: string;
  issueId?: string;
  requestedBy?: string;
  metadata?: Record<string, string>;
}

export interface PicassoBridgeJobResult {
  siteId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  developmentUrl?: string | null;
  siteUrl?: string | null;
}

export interface PicassoBridgeJob {
  id: string;
  mode: "create_site";
  status: string;
  prompt: string;
  designer: string;
  companyId?: string | null;
  issueId?: string | null;
  requestedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  result?: PicassoBridgeJobResult | null;
  hasRecording?: boolean;
  stdout?: string;
  stderr?: string;
  recording?: string;
}

export const createPicassoBridgeJob = (data: PicassoBridgeJobRequest) =>
  bridgeRequest<{ jobId: string; status: string; mode: string; pollUrl: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getPicassoBridgeJob = (jobId: string, includeLogs = false) =>
  bridgeRequest<PicassoBridgeJob>(`/jobs/${jobId}${includeLogs ? "?includeLogs=1" : ""}`);

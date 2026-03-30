"use client";

import { useEffect, useState } from "react";
import {
  Page,
  Card,
  Text,
  Heading,
  Box,
  Badge,
  Loader,
  Button,
  Divider,
  Modal,
  CustomModalLayout,
  FormField,
  Input,
  Dropdown,
  Tooltip,
  PopoverMenu,
  IconButton,
} from "@wix/design-system";
import {
  Add,
  More,
  Refresh,
  Users,
  Checklist,
  Promote,
  Statistics,
  Confirm,
  Activity,
  PauseFilled,
  PlayFilled,
} from "@wix/wix-ui-icons-common";
import { useCompany } from "../providers";
import {
  getDashboard,
  getActivity,
  getAgents,
  getGoals,
  getIssues,
  invokeHeartbeat,
  pauseAgent,
  resumeAgent,
  getRuns,
  createIssue,
  runHealthCheck,
  getCompany,
  type Company,
  type Dashboard,
  type ActivityEntry,
  type Agent,
  type Goal,
  type Issue,
  type HeartbeatRun,
} from "@/lib/api";

interface Story { icon: string; text: string; detail?: string; link?: string; actorLink?: string; }

function buildStory(entry: ActivityEntry, agents: Agent[]): Story | null {
  const isUser = entry.actorType === "user";
  const actorAgent = entry.agentId ? agents.find((a) => a.id === entry.agentId) : null;
  // For agent.updated, the entity IS the agent being updated
  const entityAgent = entry.entityType === "agent" ? agents.find((a) => a.id === entry.entityId) : null;

  const actor = isUser ? "You" : (actorAgent?.name || "An agent");
  const actorLink = !isUser && actorAgent ? `/team/${actorAgent.id}` : undefined;
  const entityLink = entityAgent ? `/team/${entityAgent.id}` : undefined;
  const runLink = entry.entityType === "run" ? `/runs/${entry.entityId}` : undefined;
  const d = entry.details || {};
  const identifier = (d.identifier as string) || "";
  const issueTitle = (d.issueTitle as string) || "";
  const snippet = (d.bodySnippet as string) || "";
  const status = (d.status as string) || "";
  const prev = (d._previous as Record<string, string>) || {};

  switch (entry.action) {
    case "issue.comment_added": {
      const preview = snippet.replace(/[#*`\[\]]/g, "").replace(/\n/g, " ").trim().slice(0, 120);
      return {
        icon: isUser ? "💬" : "📨",
        text: `${actor} ${isUser ? "commented on" : "posted an update on"} ${identifier || "a task"}${issueTitle && !identifier ? ` — ${issueTitle}` : ""}`,
        detail: preview ? `"${preview}${snippet.length > 120 ? "..." : ""}"` : undefined,
        link: identifier ? `/tasks/${identifier}` : undefined,
        actorLink,
      };
    }
    case "issue.updated": {
      const taskLink = identifier ? `/tasks/${identifier}` : undefined;
      if (status === "done") {
        return { icon: "✅", text: `${actor} completed ${identifier}${issueTitle ? ` — ${issueTitle}` : ""}`, link: taskLink, actorLink };
      }
      if (status === "in_progress") {
        return { icon: "🔨", text: `${actor} started working on ${identifier}${issueTitle ? ` — ${issueTitle}` : ""}`, link: taskLink, actorLink };
      }
      if (status === "in_review") {
        return { icon: "👀", text: `${actor} moved ${identifier} to review${issueTitle ? ` — ${issueTitle}` : ""}`, link: taskLink, actorLink };
      }
      if (status === "blocked") {
        return { icon: "🚫", text: `${identifier} is blocked${issueTitle ? ` — ${issueTitle}` : ""}`, link: taskLink, actorLink };
      }
      return { icon: "📝", text: `${actor} updated ${identifier || "a task"}${issueTitle ? ` — ${issueTitle}` : ""}`, link: taskLink, actorLink };
    }
    case "issue.created":
      return { icon: "➕", text: `${actor} created ${identifier ? identifier + " " : ""}${issueTitle || "a new task"}`, link: identifier ? `/tasks/${identifier}` : undefined, actorLink };
    case "issue.checked_out":
      return { icon: "🔨", text: `${actor} picked up ${identifier}${issueTitle ? ` — ${issueTitle}` : ""} and started working`, link: identifier ? `/tasks/${identifier}` : undefined, actorLink };
    case "issue.released":
      return { icon: "📤", text: `${actor} released ${identifier}${issueTitle ? ` — ${issueTitle}` : ""}`, link: identifier ? `/tasks/${identifier}` : undefined, actorLink };
    case "issue.read_marked":
      return null; // Boring, skip
    case "agent.created": {
      const who = entityAgent?.name || "A new team member";
      return { icon: "👋", text: `${who} joined the team as ${entityAgent?.title || "a new role"}`, actorLink: entityLink };
    }
    case "agent.updated": {
      const who = entityAgent?.name || "A team member";
      const keys = (d.changedTopLevelKeys as string[]) || [];
      const configKeys = (d.changedAdapterConfigKeys as string[]) || [];
      if (keys.includes("name")) return { icon: "✏️", text: `${who} was renamed`, actorLink: entityLink };
      if (configKeys.includes("promptTemplate") && configKeys.length <= 3) {
        return { icon: "📋", text: `${who}'s role description was updated`, actorLink: entityLink };
      }
      if (configKeys.includes("model")) {
        return { icon: "⚙️", text: `${who}'s seniority level was changed`, actorLink: entityLink };
      }
      if (configKeys.length > 3) {
        return { icon: "⚙️", text: `${who}'s profile was reconfigured`, actorLink: entityLink };
      }
      if (keys.includes("reportsTo")) return { icon: "🔀", text: `${who}'s reporting line was changed`, actorLink: entityLink };
      return null; // Skip other generic updates
    }
    case "heartbeat.invoked": {
      const wokeAgent = actorAgent || entityAgent;
      const whoWoke = wokeAgent?.name || "An agent";
      const wokeLink = wokeAgent ? `/team/${wokeAgent.id}` : undefined;
      return { icon: "⏰", text: isUser ? `You woke up ${whoWoke} for a check-in` : `${whoWoke} started a scheduled check-in`, actorLink: wokeLink };
    }
    case "run.completed":
      return { icon: "✔️", text: `${actor} finished a work session`, link: runLink, actorLink };
    case "run.failed":
      return { icon: "⚠️", text: `${actor}'s work session failed`, detail: (d.error as string) || undefined, link: runLink, actorLink };
    default:
      return null; // Skip unknown actions instead of showing raw text
  }
}

function timeAgo(date: string) {
  const diff = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / 1440)}d ago`;
}

function agentStatusText(agent: Agent): string {
  if (agent.status === "running") return "Working now";
  if (agent.status === "paused") return "On leave";
  if (agent.status === "error") return "Needs attention";

  // Check if next heartbeat is actually upcoming
  const last = agent.lastHeartbeatAt;
  const interval = (agent.adapterConfig?.heartbeatIntervalSec as number) || 0;
  if (last && interval) {
    const next = new Date(new Date(last).getTime() + interval * 1000);
    const diff = Math.round((next.getTime() - Date.now()) / 60000);
    if (diff > 0 && diff < 60) return `Wakes in ${diff}m`;
    if (diff >= 60) return `Wakes in ${Math.round(diff / 60)}h`;
  }

  // Overdue or no schedule — show last activity
  if (last) {
    const ago = Math.round((Date.now() - new Date(last).getTime()) / 60000);
    if (ago < 1) return "Active just now";
    if (ago < 60) return `Active ${ago}m ago`;
    if (ago < 1440) return `Active ${Math.round(ago / 60)}h ago`;
    return `Active ${Math.round(ago / 1440)}d ago`;
  }

  return "Idle";
}

function DashboardContent() {
  const { companyId } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<string | undefined>();

  // Health check
  const [healthResult, setHealthResult] = useState<{ status: string; checks: Array<{ name: string; status: string; detail?: string }>; actions: string[] } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const load = async () => {
    if (!companyId) { setLoading(false); return; }
    const c = await getCompany(companyId);
    setCompany(c);
    const [dash, act, agentList, goalList, issueList, runList] = await Promise.all([
      getDashboard(companyId),
      getActivity(companyId).catch(() => []),
      getAgents(companyId),
      getGoals(companyId).catch(() => []),
      getIssues(companyId).catch(() => []),
      getRuns(companyId),
    ]);
    setDashboard(dash);
    setActivity((act || []).slice(0, 15));
    setAgents(agentList);
    setGoals(goalList);
    setIssues(issueList);
    setRuns(runList);
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId]);

  if (loading) {
    return (
      <Page>
        <Page.Header title={<div className="skeleton-bar" style={{ width: 180, height: 28 }} />} />
        <Page.Content>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Card key={n}>
                <Card.Content>
                  <div className="skeleton-bar" style={{ width: 60, height: 10, marginBottom: 12 }} />
                  <div className="skeleton-bar" style={{ width: 50, height: 28, marginBottom: 8 }} />
                  <div className="skeleton-bar" style={{ width: 90, height: 10 }} />
                </Card.Content>
              </Card>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <Card.Content>
                {[1, 2, 3].map((n) => (
                  <div key={n} style={{ display: "flex", gap: 10, padding: "12px 0", borderBottom: n < 3 ? "1px solid #f0f0f0" : "none" }}>
                    <div className="skeleton-bar" style={{ width: 10, height: 10, borderRadius: "50%" }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton-bar" style={{ width: "70%", height: 14, marginBottom: 6 }} />
                      <div className="skeleton-bar" style={{ width: "40%", height: 10 }} />
                    </div>
                  </div>
                ))}
              </Card.Content>
            </Card>
            <Card>
              <Card.Content>
                {[1, 2, 3].map((n) => (
                  <div key={n} style={{ display: "flex", gap: 10, padding: "12px 0", borderBottom: n < 3 ? "1px solid #f0f0f0" : "none" }}>
                    <div style={{ flex: 1 }}>
                      <div className="skeleton-bar" style={{ width: "80%", height: 14, marginBottom: 6 }} />
                      <div className="skeleton-bar" style={{ width: "50%", height: 10 }} />
                    </div>
                  </div>
                ))}
              </Card.Content>
            </Card>
          </div>
        </Page.Content>
      </Page>
    );
  }

  if (!company || !dashboard) {
    return <Text>No company found.</Text>;
  }

  const totalTasks = Object.values(dashboard.tasks).reduce((a, b) => a + b, 0);
  const doneTasks = dashboard.tasks.done || 0;
  const activeTasks = (dashboard.tasks.open || 0) + (dashboard.tasks.inProgress || 0);
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const runningAgents = agents.filter((a) => a.status === "running");
  const idleAgents = agents.filter((a) => a.status === "idle" || a.status === "active");

  const recentIssues = issues
    .filter((i) => i.status !== "done" && i.status !== "cancelled" && i.title !== "Board Inbox")
    .slice(0, 5);

  // Token usage analytics
  const tokenStats = (() => {
    type Usage = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; rawInputTokens?: number; rawOutputTokens?: number; costUsd?: number; model?: string };
    const parsed: Array<{ usage: Usage; agentId: string; date: string }> = [];
    for (const r of runs) {
      if (!r.usageJson) continue;
      try {
        const u: Usage = typeof r.usageJson === "string" ? JSON.parse(r.usageJson) : r.usageJson;
        parsed.push({ usage: u, agentId: r.agentId, date: r.createdAt });
      } catch { /* skip */ }
    }

    // Totals
    let totalInput = 0, totalOutput = 0, totalCached = 0, totalCost = 0;
    for (const p of parsed) {
      totalInput += p.usage.rawInputTokens || p.usage.inputTokens || 0;
      totalOutput += p.usage.rawOutputTokens || p.usage.outputTokens || 0;
      totalCached += p.usage.cachedInputTokens || 0;
      totalCost += p.usage.costUsd || 0;
    }

    // By agent
    const byAgent: Record<string, { input: number; output: number; cached: number; runs: number }> = {};
    for (const p of parsed) {
      if (!byAgent[p.agentId]) byAgent[p.agentId] = { input: 0, output: 0, cached: 0, runs: 0 };
      byAgent[p.agentId].input += p.usage.rawInputTokens || p.usage.inputTokens || 0;
      byAgent[p.agentId].output += p.usage.rawOutputTokens || p.usage.outputTokens || 0;
      byAgent[p.agentId].cached += p.usage.cachedInputTokens || 0;
      byAgent[p.agentId].runs += 1;
    }

    // By day (last 7 days)
    const byDay: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      byDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const p of parsed) {
      const day = p.date.slice(0, 10);
      if (day in byDay) byDay[day] += (p.usage.rawOutputTokens || p.usage.outputTokens || 0) + (p.usage.rawInputTokens || p.usage.inputTokens || 0);
    }

    return { totalInput, totalOutput, totalCached, totalCost, byAgent, byDay, totalRuns: parsed.length };
  })();

  const ceoAgent = agents.find((a) => a.role === "ceo");
  const agentDropdownOptions = [
    { id: "", value: "Unassigned" },
    ...agents.map((a) => ({ id: a.id, value: a.name })),
  ];

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !company) return;
    await createIssue(company.id, {
      title: newTaskTitle,
      assigneeId: newTaskAssignee,
    });
    setShowCreate(false);
    setNewTaskTitle("");
    setNewTaskAssignee(undefined);
    load();
  };

  return (
    <>
    <Page>
      <Page.Header
        title={company.name}
        actionsBar={
          <Box direction="horizontal" gap="6px" verticalAlign="middle">
            <Button size="tiny" priority="secondary" prefixIcon={<Refresh />} onClick={load}>
              Refresh
            </Button>
            <PopoverMenu
              placement="bottom-end"
              triggerElement={
                <IconButton size="small" priority="secondary">
                  <More />
                </IconButton>
              }
            >
              <PopoverMenu.MenuItem
                text={healthLoading ? "Checking..." : "Health Check"}
                subtitle="Run diagnostics and fix stale runs"
                disabled={healthLoading}
                onClick={async () => {
                  setHealthLoading(true);
                  setHealthResult(null);
                  try {
                    const result = await runHealthCheck();
                    setHealthResult(result);
                  } catch { setHealthResult({ status: "error", checks: [{ name: "api", status: "error", detail: "Health check failed" }], actions: [] }); }
                  setHealthLoading(false);
                }}
              />
              <PopoverMenu.MenuItem
                text={agents.length > 0 && agents.every((a) => a.status === "paused") ? "Resume All Agents" : "Pause All Agents"}
                subtitle={agents.length > 0 && agents.every((a) => a.status === "paused") ? "Agents will start checking in again" : "Stop all scheduled work"}
                disabled={agents.length === 0}
                onClick={async () => {
                  const allPaused = agents.every((a) => a.status === "paused");
                  for (const agent of agents) {
                    try {
                      if (allPaused) await resumeAgent(agent.id);
                      else await pauseAgent(agent.id);
                    } catch {}
                  }
                  load();
                }}
              />
              <PopoverMenu.Divider />
              <PopoverMenu.MenuItem
                text="About"
                onClick={() => setShowLearnMore(true)}
              />
            </PopoverMenu>
          </Box>
        }
      />
      <Page.Content>
        {/* Health check results */}
        {healthResult && (
          <div style={{
            padding: "14px 20px",
            borderRadius: 8,
            marginBottom: 20,
            background: healthResult.status === "healthy" ? "#f0faf0" : healthResult.status === "repaired" ? "#fff8e1" : "#fff5f5",
            border: `1px solid ${healthResult.status === "healthy" ? "#c8e6c9" : healthResult.status === "repaired" ? "#ffe082" : "#ffcdd2"}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: healthResult.status === "healthy" ? "#2e7d32" : healthResult.status === "repaired" ? "#f57f17" : "#c62828" }}>
                {healthResult.status === "healthy" ? "All systems healthy" : healthResult.status === "repaired" ? "Issues found and repaired" : "Problems detected"}
              </div>
              <button onClick={() => setHealthResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 16 }}>x</button>
            </div>
            {healthResult.checks.map((check, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#555", marginBottom: 3 }}>
                <span>{check.status === "ok" ? "✓" : check.status === "warning" ? "⚠" : check.status === "repaired" ? "🔧" : "✗"}</span>
                <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{check.name.replace(/_/g, " ")}</span>
                {check.detail && <span style={{ color: "#888" }}>— {check.detail}</span>}
              </div>
            ))}
            {healthResult.actions.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#666", fontStyle: "italic" }}>
                Actions taken: {healthResult.actions.join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Goals */}
        {goals.length > 0 && (
          <div style={{ background: "linear-gradient(135deg, #162d3d 0%, #1a4a6e 100%)", borderRadius: 12, padding: "20px 28px", marginBottom: 20, color: "white" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, opacity: 0.6, marginBottom: 10 }}>Company Goals</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {goals.map((goal, i) => (
                <div key={goal.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 16, marginTop: 1 }}>
                    {goal.status === "completed" ? "✅" : goal.status === "archived" ? "📦" : "🎯"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>{goal.title}</div>
                    {goal.description && (
                      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>{goal.description}</div>
                    )}
                  </div>
                  {goal.level && goal.level !== "company" && (
                    <span style={{ fontSize: 11, opacity: 0.5, textTransform: "capitalize", marginTop: 3 }}>{goal.level}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Key metrics row */}
          <div className="dashboard-metrics" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Team</div>
                    <Users color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>{agents.length}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                    {runningAgents.length > 0 ? `${runningAgents.length} working now` : "All available"}
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Tasks Done</div>
                    <Checklist color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>{doneTasks}<span style={{ fontSize: 16, color: "#999", fontWeight: 400 }}>/{totalTasks}</span></div>
                  <div style={{ width: "100%", height: 4, background: "#eee", borderRadius: 2, marginTop: 8 }}>
                    <div style={{ width: `${progressPct}%`, height: 4, background: "#00d68f", borderRadius: 2 }} />
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Active Work</div>
                    <Promote color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: activeTasks > 0 ? "#3899ec" : "#162d3d", marginTop: 4 }}>{activeTasks}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                    {dashboard.tasks.blocked ? `${dashboard.tasks.blocked} blocked` : "No blockers"}
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Runs</div>
                    <Refresh color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>
                    {runs.filter((r) => r.status === "succeeded").length}
                    <span style={{ fontSize: 16, color: "#999", fontWeight: 400 }}>/{runs.length}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                    {runs.filter((r) => r.status === "failed").length > 0
                      ? `${runs.filter((r) => r.status === "failed").length} failed`
                      : "All successful"}
                  </div>
                </Card.Content>
              </Card>
            </div>
          </div>

          {/* Team + Open work row */}
          <div className="dashboard-panels" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Team status */}
          <Card>
              <Card.Header title="Team Status" />
              <Card.Content>
                {agents
                  .sort((a, b) => {
                    if (a.status === "running" && b.status !== "running") return -1;
                    if (b.status === "running" && a.status !== "running") return 1;
                    const aTime = a.lastHeartbeatAt ? new Date(a.lastHeartbeatAt).getTime() : 0;
                    const bTime = b.lastHeartbeatAt ? new Date(b.lastHeartbeatAt).getTime() : 0;
                    return bTime - aTime;
                  })
                  .map((agent, i) => {
                    const statusText = agentStatusText(agent);
                    const interval = (agent.adapterConfig?.heartbeatIntervalSec as number) || 0;
                    const lastHb = agent.lastHeartbeatAt;
                    let nextRunText = "";
                    if (lastHb && interval && agent.status !== "running" && agent.status !== "paused") {
                      const elapsed = Math.round((Date.now() - new Date(lastHb).getTime()) / 1000);
                      const remaining = interval - (elapsed % interval);
                      const min = Math.ceil(remaining / 60);
                      if (min <= 1) nextRunText = "Next run in ~1 minute";
                      else nextRunText = `Next run in ${min} minutes`;
                    } else if (interval && agent.status !== "running" && agent.status !== "paused") {
                      const schedMin = Math.round(interval / 60);
                      nextRunText = `Every ${schedMin}m`;
                    }
                    return (
                      <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < agents.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                        {/* Status dot */}
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                          background: agent.status === "running" ? "#00d68f" : agent.status === "error" ? "#ff4d4f" : agent.status === "paused" ? "#ffc107" : "#b0b0b0",
                          boxShadow: agent.status === "running" ? "0 0 6px #00d68f" : "none",
                        }} />
                        {/* Name */}
                        <a
                          href={agent.status === "running"
                            ? `/runs?agent=${agent.id}`
                            : `/team/${agent.id}`}
                          style={{ flex: 1, textDecoration: "none", color: "inherit" }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{agent.name}</div>
                          <div style={{ fontSize: 12, color: "#999" }}>{agent.title}</div>
                        </a>
                        {/* Status + wake */}
                        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                          {agent.status === "running" ? (
                            <a href={`/runs?agent=${agent.id}&status=running`} style={{ textDecoration: "none" }}>
                              <Badge size="tiny" skin="success">Working</Badge>
                            </a>
                          ) : agent.status === "paused" ? (
                            <Badge size="tiny" skin="warning">On leave</Badge>
                          ) : agent.status === "error" ? (
                            <Badge size="tiny" skin="danger">Needs attention</Badge>
                          ) : (
                            <>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ color: "#999", fontSize: 12 }}>{statusText}</div>
                                {nextRunText && <div style={{ color: "#3899ec", fontSize: 11, fontWeight: 500, marginTop: 1 }}>{nextRunText}</div>}
                              </div>
                              <Tooltip content="Trigger an immediate check-in. The agent will review tasks and messages right now." placement="top">
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    const btn = e.currentTarget;
                                    btn.disabled = true;
                                    btn.textContent = "Waking...";
                                    try {
                                      await invokeHeartbeat(agent.id);
                                      btn.textContent = "Woke!";
                                      setTimeout(() => load(), 2000);
                                    } catch {
                                      btn.textContent = "Failed";
                                    }
                                  }}
                                  style={{
                                    background: "none",
                                    border: "1px solid #ddd",
                                    borderRadius: 4,
                                    padding: "2px 8px",
                                    fontSize: 11,
                                    color: "#3899ec",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Wake up
                                </button>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </Card.Content>
            </Card>

          {/* Open work */}
            <Card>
              <Card.Header
                title="Open Work"
                suffix={
                  <Box direction="horizontal" gap="12px" verticalAlign="middle">
                    <Button size="tiny" prefixIcon={<Add />} onClick={() => { setNewTaskAssignee(ceoAgent?.id); setShowCreate(true); }}>Create Task</Button>
                    <a href="/tasks" style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>View all</a>
                  </Box>
                }
              />
              <Card.Content>
                {recentIssues.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center" }}>
                    <Checklist color="#b0b0b0" size="48px" />
                    <div style={{ marginTop: 8 }}>
                      <Text secondary>No open tasks. The team is ready for new work.</Text>
                    </div>
                  </div>
                ) : (
                  recentIssues.map((issue, i) => {
                    const assignee = agents.find((a) => a.id === (issue.assigneeAgentId || issue.assigneeId));
                    const statusSkin: Record<string, "general" | "success" | "warning" | "danger" | "neutral"> = {
                      backlog: "neutral", todo: "general", in_progress: "warning", blocked: "danger",
                    };
                    const statusLabel: Record<string, string> = {
                      backlog: "Backlog", todo: "To Do", in_progress: "In Progress", blocked: "Blocked",
                    };
                    return (
                      <a
                        key={issue.id}
                        href={`/tasks/${issue.identifier}`}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < recentIssues.length - 1 ? "1px solid #f0f0f0" : "none", textDecoration: "none", color: "inherit" }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, color: "#162d3d" }}>{issue.title}</div>
                          <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                            {issue.identifier} · {assignee ? assignee.name : "Unassigned"}
                          </div>
                        </div>
                        <Badge size="tiny" skin={statusSkin[issue.status] || "general"}>
                          {statusLabel[issue.status] || issue.status}
                        </Badge>
                      </a>
                    );
                  })
                )}
              </Card.Content>
            </Card>
          </div>

          {/* Achievements */}
          {(() => {
            const doneIssues = issues
              .filter((i) => i.status === "done" && i.title !== "Board Inbox")
              .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime());
            if (doneIssues.length === 0) return null;
            return (
              <div>
                <Card>
                  <Card.Header
                    title={`Achievements (${doneIssues.length})`}
                    suffix={<span style={{ fontSize: 12, color: "#999" }}>Completed work</span>}
                  />
                  <Card.Content>
                    {doneIssues.slice(0, 5).map((issue, i) => {
                      const assignee = agents.find((a) => a.id === (issue.assigneeAgentId || issue.assigneeId));
                      const completedDate = issue.completedAt || issue.updatedAt;
                      const desc = issue.description || "";
                      const summary = desc
                        .split("\n")
                        .map((l: string) => l.replace(/^#+\s*/, "").replace(/^\*+/, "").trim())
                        .filter((l: string) => l.length > 10 && !l.startsWith("---") && !l.startsWith("|"))[0] || "";
                      return (
                        <a
                          key={issue.id}
                          href={`/tasks/${issue.identifier}`}
                          style={{
                            display: "flex",
                            gap: 12,
                            padding: "12px 0",
                            borderBottom: i < Math.min(doneIssues.length, 5) - 1 ? "1px solid #f0f0f0" : "none",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          <div style={{
                            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                            background: "#e8f7e8", color: "#00a854",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, marginTop: 2,
                          }}>
                            ✓
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: "#162d3d" }}>{issue.title}</div>
                              <span style={{ fontSize: 11, color: "#bbb", flexShrink: 0 }} title={new Date(completedDate).toLocaleString()}>
                                {timeAgo(completedDate)}
                              </span>
                            </div>
                            {summary && (
                              <div style={{ fontSize: 13, color: "#666", marginTop: 3, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {summary}
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: "#999", marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{issue.identifier}</span>
                              <span>·</span>
                              <span>{assignee?.name || "Unassigned"}</span>
                            </div>
                          </div>
                        </a>
                      );
                    })}
                    {doneIssues.length > 5 && (
                      <div style={{ padding: "10px 0", textAlign: "center" }}>
                        <a href="/tasks" style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>
                          See all tasks →
                        </a>
                      </div>
                    )}
                  </Card.Content>
                </Card>
              </div>
            );
          })()}

          {/* Activity feed */}
          <div>
            <Card>
              <Card.Header title="Recent Activity" />
              <Card.Content>
                {activity.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center" }}>
                    <Activity color="#b0b0b0" size="48px" />
                    <div style={{ marginTop: 8 }}>
                      <Text secondary>No activity yet. Wake up an agent to get started.</Text>
                    </div>
                  </div>
                ) : (
                  <div style={{ position: "relative", paddingLeft: 24 }}>
                    {/* Timeline line */}
                    <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 2, background: "#e5e5e5" }} />
                    {activity.map((entry, i) => {
                      const story = buildStory(entry, agents);
                      if (!story) return null;

                      return (
                        <div key={entry.id || i} style={{ display: "flex", gap: 12, marginBottom: 18, position: "relative" }}>
                          {/* Timeline icon */}
                          <div style={{
                            position: "absolute", left: -22, top: 0,
                            width: 18, height: 18,
                            background: "white",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12,
                          }}>
                            {story.icon}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>
                              {story.link ? (
                                <a href={story.link} style={{ color: "inherit", textDecoration: "none" }}>
                                  {story.text}
                                </a>
                              ) : story.text}
                            </div>
                            {story.detail && (
                              <div style={{ fontSize: 13, color: "#888", marginTop: 3, fontStyle: "italic", lineHeight: 1.4 }}>
                                {story.detail}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: "#bbb", marginTop: 3 }}>
                              <span title={new Date(entry.createdAt).toLocaleString()}>{timeAgo(entry.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card.Content>
            </Card>
          </div>
          {/* Token Usage Analytics */}
          {tokenStats.totalRuns > 0 && (
            <div>
              <Card>
                <Card.Header title="Token Usage" subtitle={`${tokenStats.totalRuns} runs tracked`} />
                <Card.Content>
                  {/* Summary stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d" }}>{(tokenStats.totalOutput / 1000).toFixed(1)}k</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Output tokens</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d" }}>{(tokenStats.totalInput / 1000).toFixed(1)}k</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Input tokens</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d" }}>{(tokenStats.totalCached / 1000).toFixed(1)}k</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Cached tokens</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d" }}>${tokenStats.totalCost.toFixed(2)}</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Total cost</div>
                    </div>
                  </div>

                  <Divider />

                  {/* Daily usage bar chart */}
                  <div style={{ marginTop: 20, marginBottom: 24 }}>
                    <Text size="small" weight="bold" secondary>DAILY USAGE (last 7 days)</Text>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: 12, height: 120 }}>
                      {(() => {
                        const days = Object.entries(tokenStats.byDay);
                        const maxVal = Math.max(...days.map(([, v]) => v), 1);
                        return days.map(([day, val]) => {
                          const pct = (val / maxVal) * 100;
                          const label = new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
                          return (
                            <div key={day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                              <div style={{ fontSize: 10, color: "#999" }}>{val > 0 ? `${(val / 1000).toFixed(1)}k` : ""}</div>
                              <div style={{ width: "100%", maxWidth: 48, height: `${Math.max(pct, 2)}%`, background: val > 0 ? "linear-gradient(180deg, #3899ec 0%, #1a6fbf 100%)" : "#eee", borderRadius: "4px 4px 0 0", transition: "height 0.3s ease" }} />
                              <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <Divider />

                  {/* Usage by agent */}
                  <div style={{ marginTop: 20 }}>
                    <Text size="small" weight="bold" secondary>USAGE BY AGENT</Text>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {(() => {
                        const agentEntries = Object.entries(tokenStats.byAgent)
                          .map(([id, data]) => ({ id, name: agents.find((a) => a.id === id)?.name || "Unknown", ...data, total: data.input + data.output }))
                          .sort((a, b) => b.total - a.total);
                        const maxTotal = Math.max(...agentEntries.map((a) => a.total), 1);

                        return agentEntries.map((agent) => (
                          <div key={agent.id}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <a href={`/team/${agent.id}`} style={{ fontSize: 13, fontWeight: 500, color: "#162d3d", textDecoration: "none" }}>{agent.name}</a>
                              <div style={{ fontSize: 12, color: "#666" }}>
                                {(agent.total / 1000).toFixed(1)}k tokens · {agent.runs} runs
                              </div>
                            </div>
                            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "#f0f0f0" }}>
                              <div style={{ width: `${(agent.output / maxTotal) * 100}%`, background: "#3899ec", transition: "width 0.3s" }} title={`Output: ${(agent.output / 1000).toFixed(1)}k`} />
                              <div style={{ width: `${(agent.input / maxTotal) * 100}%`, background: "#7bc8f6", transition: "width 0.3s" }} title={`Input: ${(agent.input / 1000).toFixed(1)}k`} />
                              <div style={{ width: `${(agent.cached / maxTotal) * 100}%`, background: "#d6e6f2", transition: "width 0.3s" }} title={`Cached: ${(agent.cached / 1000).toFixed(1)}k`} />
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "#999" }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#3899ec", marginRight: 4, verticalAlign: "middle" }} />Output</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#7bc8f6", marginRight: 4, verticalAlign: "middle" }} />Input</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#d6e6f2", marginRight: 4, verticalAlign: "middle" }} />Cached</span>
                    </div>
                  </div>
                </Card.Content>
              </Card>
            </div>
          )}
        </div>
      </Page.Content>
    </Page>

    <Modal isOpen={showCreate} onRequestClose={() => setShowCreate(false)} shouldCloseOnOverlayClick>
      <CustomModalLayout
        width="500px"
        title="Create Task"
        primaryButtonText="Create"
        primaryButtonOnClick={handleCreateTask}
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={() => setShowCreate(false)}
        onCloseButtonClick={() => setShowCreate(false)}
      >
        <Box direction="vertical" gap="12px">
          <FormField label="Title" required infoContent="Be specific. The assigned agent will read this and work on it during their next check-in.">
            <Input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="What needs to be done?" />
          </FormField>
          <FormField label="Assignee" infoContent="The agent who will work on this. They'll pick it up during their next scheduled check-in, or you can wake them up manually.">
            <Dropdown
              selectedId={newTaskAssignee || ""}
              onSelect={(option) => setNewTaskAssignee(option.id ? String(option.id) : undefined)}
              options={agentDropdownOptions}
              placeholder="Select agent..."
            />
          </FormField>
        </Box>
      </CustomModalLayout>
    </Modal>

    {/* Learn More modal */}
    <Modal isOpen={showLearnMore} onRequestClose={() => setShowLearnMore(false)} shouldCloseOnOverlayClick>
      <CustomModalLayout
        width="640px"
        title="How your AI company works"
        onCloseButtonClick={() => setShowLearnMore(false)}
        primaryButtonText="Got it"
        primaryButtonOnClick={() => setShowLearnMore(false)}
      >
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "#333" }}>
          <p style={{ marginTop: 0 }}>
            <strong>You are running a company staffed entirely by AI agents.</strong> Each team member is an autonomous AI that can read code, write code, create tasks, communicate with other agents, and report back to you.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>🏢 Your Team</h3>
          <p>
            Your company has a real org chart — a CEO, managers, engineers, and QA. Each agent has a role description that defines how they think and work. The CEO coordinates everyone and reports directly to you.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>⏰ How They Work</h3>
          <p>
            Agents work in <strong>check-ins</strong> (called heartbeats). During each check-in, an agent wakes up, reads their inbox, reviews tasks, does work, and goes back to sleep. You can set how often each agent checks in, or wake them up manually anytime.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>💬 Talking to the CEO</h3>
          <p>
            The chat panel on the right is your direct line to the CEO. Send a message and the CEO will wake up, read it, take action (assign tasks, make decisions, coordinate the team), and reply. Think of it like messaging a real executive.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>📋 Tasks &amp; Inbox</h3>
          <p>
            Work is tracked as tasks. Agents create, assign, and complete tasks autonomously. Your <strong>Inbox</strong> shows conversations that need your input — when an agent asks a question or reports results, it appears there. Reply directly to keep things moving.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>📊 Runs</h3>
          <p>
            Every time an agent wakes up and does work, it creates a <strong>run</strong> — a complete log of what they thought, what tools they used, and what they accomplished. You can review any run to see exactly what happened.
          </p>

          <div style={{ marginTop: 16, padding: "12px 16px", background: "#f0f4f7", borderRadius: 8, fontSize: 13, color: "#666" }}>
            <strong>Powered by Paperclip</strong> — an open-source platform for orchestrating AI agent teams. Your agents run Claude and other AI models, coordinated through a control plane that manages tasks, budgets, and governance.
          </div>
        </div>
      </CustomModalLayout>
    </Modal>
    </>
  );
}

export default function Home() {
  return <DashboardContent />;
}

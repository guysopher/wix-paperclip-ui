"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  PopoverMenu,
  IconButton,
} from "@wix/design-system";
import {
  Add,
  More,
  Refresh,
  Users,
  Checklist,
  Inbox,
  Promote,
  Statistics,
  Confirm,
  PauseFilled,
  PlayFilled,
} from "@wix/wix-ui-icons-common";
import { useCompany } from "../providers";
import { AgentAvatar } from "@/components/agent-avatar";
import { TaskLinkWithPreview } from "@/components/task-link-with-preview";
import { getHeartbeatPolicy } from "@/lib/agent-heartbeat";
import {
  getDashboard,
  getAgents,
  getGoals,
  getIssues,
  invokeHeartbeat,
  pauseAgent,
  resumeAgent,
  updateAgent,
  getRuns,
  createIssue,
  runCompanyHealthCheck,
  restartPaperclipServer,
  getCompany,
  type Company,
  type Dashboard,
  type Agent,
  type Goal,
  type Issue,
  type HeartbeatRun,
} from "@/lib/api";

const FEED_AVATAR_COLORS = ["#3899ec", "#e01f5a", "#2ca55a", "#ff6b35", "#7c4dff", "#00bcd4", "#f59e0b"];
function feedAvatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return FEED_AVATAR_COLORS[Math.abs(h) % FEED_AVATAR_COLORS.length];
}
function feedParseUsage(usageJson: string | null) {
  if (!usageJson) return null;
  try {
    const u = JSON.parse(usageJson);
    const cost = u.total_cost_usd ? `$${u.total_cost_usd.toFixed(4)}` : null;
    const out = u.usage?.output_tokens || u.output_tokens || 0;
    const inp = u.usage?.input_tokens || u.input_tokens || 0;
    const cac = u.usage?.cache_read_input_tokens || u.cache_read_input_tokens || 0;
    const tokens = out + inp + cac > 0 ? `${((out + inp + cac) / 1000).toFixed(1)}k tokens` : null;
    return { cost: cost || "—", tokens: tokens || "—" };
  } catch { return null; }
}
function feedDuration(start: string | null, end: string | null) {
  if (!start) return "—";
  const sec = Math.round((((end ? new Date(end) : new Date()).getTime()) - new Date(start).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
const FEED_STATUS_SKINS: Record<string, "success" | "warning" | "neutral" | "danger" | "general"> = {
  succeeded: "success", running: "warning", queued: "neutral", failed: "danger", timed_out: "danger", cancelled: "neutral",
};
const FEED_STATUS_LABELS: Record<string, string> = {
  succeeded: "Completed", running: "Running", queued: "Queued", failed: "Failed", timed_out: "Timed out", cancelled: "Cancelled",
};
const FEED_SOURCE_LABELS: Record<string, string> = {
  on_demand: "Manual", scheduled: "Scheduled", mention: "Mentioned", assignment: "Assigned",
};
const ACTIVITY_INTERVAL_OPTIONS = [
  { seconds: 48 * 3600, shortLabel: "48h" },
  { seconds: 36 * 3600, shortLabel: "36h" },
  { seconds: 24 * 3600, shortLabel: "24h" },
  { seconds: 18 * 3600, shortLabel: "18h" },
  { seconds: 12 * 3600, shortLabel: "12h" },
  { seconds: 8 * 3600, shortLabel: "8h" },
  { seconds: 6 * 3600, shortLabel: "6h" },
  { seconds: 4 * 3600, shortLabel: "4h" },
  { seconds: 3 * 3600, shortLabel: "3h" },
  { seconds: 2 * 3600, shortLabel: "2h" },
  { seconds: 90 * 60, shortLabel: "90m" },
  { seconds: 60 * 60, shortLabel: "1h" },
  { seconds: 45 * 60, shortLabel: "45m" },
  { seconds: 30 * 60, shortLabel: "30m" },
  { seconds: 20 * 60, shortLabel: "20m" },
  { seconds: 15 * 60, shortLabel: "15m" },
  { seconds: 10 * 60, shortLabel: "10m" },
] as const;
const DEFAULT_ACTIVITY_INTERVAL_SEC = 20 * 60;
const MONTHLY_SECONDS = 30 * 24 * 60 * 60;

type DashboardHealthResult = {
  status: string;
  companyId?: string | null;
  checkedAt?: string;
  checks: Array<{ name: string; status: string; detail?: string }>;
  actions: string[];
  controls?: { restartAvailable?: boolean };
};


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
  const interval = getHeartbeatPolicy(agent).intervalSec;
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

function formatHeartbeatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    return `${minutes} min`;
  }

  return `${seconds}s`;
}

function describeActivityLevel(index: number): string {
  const ratio = index / (ACTIVITY_INTERVAL_OPTIONS.length - 1);
  if (ratio < 0.25) return "Calm";
  if (ratio < 0.55) return "Steady";
  if (ratio < 0.85) return "Busy";
  return "Max";
}

function closestActivityIndex(intervalSec: number): number {
  let closestIndex = 0;
  let closestDiff = Number.POSITIVE_INFINITY;

  ACTIVITY_INTERVAL_OPTIONS.forEach((option, index) => {
    const diff = Math.abs(option.seconds - intervalSec);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function getCompanyActivityInterval(agents: Agent[]): number {
  const scheduledIntervals = agents
    .map((agent) => getHeartbeatPolicy(agent).intervalSec)
    .filter((intervalSec) => intervalSec > 0)
    .sort((a, b) => a - b);

  if (scheduledIntervals.length === 0) {
    return DEFAULT_ACTIVITY_INTERVAL_SEC;
  }

  return scheduledIntervals[Math.floor((scheduledIntervals.length - 1) / 2)];
}

function DashboardContent() {
  const router = useRouter();
  const { companyId, companies, setCompanyId, companyPath } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [feedNarratives, setFeedNarratives] = useState<Record<string, { title: string; description: string } | null>>({});
  const [agentNarratives, setAgentNarratives] = useState<Record<string, { title: string; time: string } | null>>({});
  const [goalProgress, setGoalProgress] = useState<Record<string, { progress: number; comment: string; updatedAt: string } | null>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<string | undefined>();
  const [activitySliderIndex, setActivitySliderIndex] = useState<number | null>(null);
  const [activitySliderDirty, setActivitySliderDirty] = useState(false);
  const [savingActivity, setSavingActivity] = useState(false);
  const [activityFeedback, setActivityFeedback] = useState("");
  const [activityError, setActivityError] = useState("");

  // Health check
  const [healthResult, setHealthResult] = useState<DashboardHealthResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [restartingServer, setRestartingServer] = useState(false);

  const load = async () => {
    if (!companyId) { setLoading(false); return; }
    const c = await getCompany(companyId);
    setCompany(c);
    const [dash, agentList, goalList, issueList, runList] = await Promise.all([
      getDashboard(companyId),
      getAgents(companyId),
      getGoals(companyId).catch(() => []),
      getIssues(companyId).catch(() => []),
      getRuns(companyId),
    ]);
    setDashboard(dash);
    setAgents(agentList);
    setGoals(goalList);
    setIssues(issueList);
    setRuns(runList);
    setLoading(false);

    // Fetch narratives for the 3 most recent runs
    const agentMap = new Map(agentList.map((a: Agent) => [a.id, a]));
    const latest = [...runList]
      .sort((a: HeartbeatRun, b: HeartbeatRun) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
    setFeedNarratives(Object.fromEntries(latest.map((r: HeartbeatRun) => [r.id, r.status === "running" || r.status === "queued" ? { title: "", description: "" } : null])));
    latest.filter((r: HeartbeatRun) => r.status !== "running" && r.status !== "queued").forEach((run: HeartbeatRun) => {
      const agent = agentMap.get(run.agentId);
      const params = new URLSearchParams({
        agentName: agent?.name || "Unknown",
        agentRole: agent?.role || "",
        status: run.status,
        source: run.invocationSource,
      });
      if (run.error) params.set("error", run.error);
      if (run.triggerDetail) params.set("triggerDetail", run.triggerDetail);
      fetch(`/api/run-narrative/${run.id}?${params}`)
        .then((r) => r.json())
        .then((data: { title?: string; description?: string; goalProgress?: Array<{ goalId: string; progress: number; comment: string }> }) => {
          setFeedNarratives((prev) => ({ ...prev, [run.id]: { title: data.title || "", description: data.description || "" } }));
          // Update goal progress if present
          if (data.goalProgress && data.goalProgress.length > 0) {
            const progressMap: Record<string, { progress: number; comment: string; updatedAt: string }> = {};
            data.goalProgress.forEach((gp) => {
              progressMap[gp.goalId] = { progress: gp.progress, comment: gp.comment, updatedAt: run.createdAt };
            });
            setGoalProgress((prev) => ({ ...prev, ...progressMap }));
          }
        })
        .catch(() => setFeedNarratives((prev) => ({ ...prev, [run.id]: { title: "", description: "" } })));
    });

    // Fetch goal progress from the most recent CEO run
    const ceo = agentList.find((a: Agent) => a.role === "ceo");
    if (ceo) {
      const ceoRuns = runList
        .filter((r: HeartbeatRun) => r.agentId === ceo.id && r.status === "succeeded")
        .sort((a: HeartbeatRun, b: HeartbeatRun) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (ceoRuns.length > 0) {
        const latestCeoRun = ceoRuns[0];
        fetch(`/api/run-narrative/${latestCeoRun.id}`)
          .then((r) => r.json())
          .then((data: { goalProgress?: Array<{ goalId: string; progress: number; comment: string }> }) => {
            if (data.goalProgress && data.goalProgress.length > 0) {
              const progressMap: Record<string, { progress: number; comment: string; updatedAt: string }> = {};
              data.goalProgress.forEach((gp) => {
                progressMap[gp.goalId] = { progress: gp.progress, comment: gp.comment, updatedAt: latestCeoRun.createdAt };
              });
              setGoalProgress(progressMap);
            }
          })
          .catch(() => {});
      }
    }

    // Fetch latest narrative for each agent
    agentList.forEach((agent: Agent) => {
      const agentRuns = runList
        .filter((r: HeartbeatRun) => r.agentId === agent.id && r.status === "succeeded")
        .sort((a: HeartbeatRun, b: HeartbeatRun) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (agentRuns.length > 0) {
        const latestRun = agentRuns[0];
        const params = new URLSearchParams({
          agentName: agent.name,
          agentRole: agent.role || "",
          status: latestRun.status,
          source: latestRun.invocationSource,
        });

        fetch(`/api/run-narrative/${latestRun.id}?${params}`)
          .then((r) => r.json())
          .then((data: { title?: string }) => {
            setAgentNarratives((prev) => ({
              ...prev,
              [agent.id]: { title: data.title || "", time: latestRun.createdAt },
            }));
          })
          .catch(() => {
            setAgentNarratives((prev) => ({ ...prev, [agent.id]: { title: "", time: latestRun.createdAt } }));
          });
      }
    });
  };

  useEffect(() => { load(); }, [companyId]);

  // Auto-refresh when agents are running (every 10 seconds)
  useEffect(() => {
    const runningCount = agents.filter((a) => a.status === "running").length;
    if (runningCount > 0) {
      const interval = setInterval(() => {
        load();
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [agents]);

  useEffect(() => {
    const nextIndex = closestActivityIndex(getCompanyActivityInterval(agents));
    if (!activitySliderDirty || activitySliderIndex === null) {
      setActivitySliderIndex(nextIndex);
    }
  }, [agents, activitySliderDirty, activitySliderIndex]);

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

  if (!companyId) {
    return (
      <Page>
        <Page.Content>
          <Box align="center" verticalAlign="middle" height="80vh" direction="vertical" gap="32px">
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
                margin: "0 auto 20px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "white", fontSize: 30, fontWeight: 700 }}>C</span>
              </div>
              <Heading size="medium">Welcome to Wix AI Team</Heading>
              <Text secondary style={{ marginTop: 8, display: "block" }}>
                {companies.length > 0 ? "Select an AI Team to get started, or create a new one." : "Create your first AI Team to get started."}
              </Text>
            </div>

            {companies.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", maxWidth: 600 }}>
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCompanyId(c.id)}
                    style={{
                      padding: "14px 24px",
                      border: "1.5px solid #e0e0e0",
                      borderRadius: 10,
                      background: "white",
                      cursor: "pointer",
                      minWidth: 160,
                      textAlign: "left",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#3899ec"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(56,153,236,0.15)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#e0e0e0"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", fontSize: 14, fontWeight: 700, marginBottom: 10,
                    }}>
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#162d3d" }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2, textTransform: "capitalize" }}>{c.status}</div>
                  </button>
                ))}
              </div>
            )}

            <Button prefixIcon={<Add />} onClick={() => router.push("/new")}>
              New AI Team
            </Button>
          </Box>
        </Page.Content>
      </Page>
    );
  }

  if (!company || !dashboard) {
    return null;
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
    const byAgent: Record<string, { input: number; output: number; cached: number; runs: number; cost: number }> = {};
    for (const p of parsed) {
      if (!byAgent[p.agentId]) byAgent[p.agentId] = { input: 0, output: 0, cached: 0, runs: 0, cost: 0 };
      byAgent[p.agentId].input += p.usage.rawInputTokens || p.usage.inputTokens || 0;
      byAgent[p.agentId].output += p.usage.rawOutputTokens || p.usage.outputTokens || 0;
      byAgent[p.agentId].cached += p.usage.cachedInputTokens || 0;
      byAgent[p.agentId].runs += 1;
      byAgent[p.agentId].cost += p.usage.costUsd || 0;
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
  const companyActivityIntervalSec = getCompanyActivityInterval(agents);
  const companyActivityIndex = closestActivityIndex(companyActivityIntervalSec);
  const selectedActivityIndex = activitySliderIndex ?? companyActivityIndex;
  const selectedActivityIntervalSec =
    ACTIVITY_INTERVAL_OPTIONS[selectedActivityIndex]?.seconds ?? DEFAULT_ACTIVITY_INTERVAL_SEC;
  const scheduledIntervals = agents
    .map((agent) => getHeartbeatPolicy(agent).intervalSec)
    .filter((intervalSec) => intervalSec > 0)
    .sort((a, b) => a - b);
  const uniqueScheduledIntervals = Array.from(new Set(scheduledIntervals));
  const pausedAgents = agents.filter((agent) => agent.status === "paused").length;
  const estimateAgents = agents.filter((agent) => agent.status !== "paused");
  const averageTokensPerRun =
    tokenStats.totalRuns > 0
      ? (tokenStats.totalInput + tokenStats.totalOutput + tokenStats.totalCached) / tokenStats.totalRuns
      : 0;
  const averageCostPerRun = tokenStats.totalRuns > 0 ? tokenStats.totalCost / tokenStats.totalRuns : 0;
  const projectedMonthlyUsage = (() => {
    if (estimateAgents.length === 0 || tokenStats.totalRuns === 0) {
      return { runs: 0, tokens: 0, cost: 0, hasData: false };
    }

    const monthlyRunsPerAgent = MONTHLY_SECONDS / selectedActivityIntervalSec;
    let runs = 0;
    let tokens = 0;
    let cost = 0;

    for (const agent of estimateAgents) {
      const agentUsage = tokenStats.byAgent[agent.id];
      const averageAgentTokens =
        agentUsage && agentUsage.runs > 0
          ? (agentUsage.input + agentUsage.output + agentUsage.cached) / agentUsage.runs
          : averageTokensPerRun;
      const averageAgentCost =
        agentUsage && agentUsage.runs > 0 ? agentUsage.cost / agentUsage.runs : averageCostPerRun;
      runs += monthlyRunsPerAgent;
      tokens += averageAgentTokens * monthlyRunsPerAgent;
      cost += averageAgentCost * monthlyRunsPerAgent;
    }

    return { runs, tokens, cost, hasData: true };
  })();
  const monthlyBudgetUsd = company.budgetMonthlyCents / 100;
  const projectedBudgetPct =
    monthlyBudgetUsd > 0 ? Math.round((projectedMonthlyUsage.cost / monthlyBudgetUsd) * 100) : null;

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !company) return;
    await createIssue(company.id, {
      title: newTaskTitle,
      assigneeAgentId: newTaskAssignee,
    });
    setShowCreate(false);
    setNewTaskTitle("");
    setNewTaskAssignee(undefined);
    load();
  };

  const handleApplyActivityLevel = async () => {
    if (!agents.length) return;

    setSavingActivity(true);
    setActivityError("");
    setActivityFeedback("");
    try {
      const updatedAgents = await Promise.all(
        agents.map((agent) =>
          updateAgent(agent.id, {
            adapterConfig: {
              ...agent.adapterConfig,
              heartbeatIntervalSec: selectedActivityIntervalSec,
            },
          })
        )
      );
      setAgents(updatedAgents);
      setActivitySliderDirty(false);
      setActivityFeedback(
        `All ${updatedAgents.length} agent${updatedAgents.length === 1 ? "" : "s"} now check in every ${formatHeartbeatInterval(selectedActivityIntervalSec)}.`
      );
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Failed to update agent activity.");
    } finally {
      setSavingActivity(false);
    }
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
                  if (!companyId) return;
                  setHealthLoading(true);
                  setHealthResult(null);
                  try {
                    const result = await runCompanyHealthCheck(companyId);
                    setHealthResult(result);
                  } catch {
                    setHealthResult({
                      status: "error",
                      checks: [{ name: "api", status: "error", detail: "Health check failed" }],
                      actions: [],
                      controls: { restartAvailable: false },
                    });
                  }
                  setHealthLoading(false);
                }}
              />
              <PopoverMenu.MenuItem
                text={restartingServer ? "Restarting Paperclip..." : "Restart Paperclip"}
                subtitle="Calls the configured Paperclip restart hook"
                disabled={restartingServer}
                onClick={async () => {
                  setRestartingServer(true);
                  try {
                    const result = await restartPaperclipServer();
                    setHealthResult({
                      status: "repaired",
                      checks: [
                        {
                          name: "restart",
                          status: "repaired",
                          detail: result.message || "Restart request sent",
                        },
                      ],
                      actions: ["Restart request sent to Paperclip server"],
                      controls: { restartAvailable: true },
                    });
                  } catch (error) {
                    setHealthResult({
                      status: "error",
                      checks: [
                        {
                          name: "restart",
                          status: "error",
                          detail:
                            error instanceof Error ? error.message : "Restart failed",
                        },
                      ],
                      actions: [],
                      controls: { restartAvailable: false },
                    });
                  }
                  setRestartingServer(false);
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
        {/* Company Status Banner */}
        <div style={{
          background: "linear-gradient(135deg, #f7f9fc 0%, #e8f0fe 100%)",
          borderRadius: 10,
          padding: "18px 26px",
          marginBottom: 24,
          border: "1px solid #d6e4f5",
          display: "flex",
          alignItems: "center",
          gap: 28,
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: runningAgents.length > 0 ? "#00d68f" : "#b0b0b0",
              boxShadow: runningAgents.length > 0 ? "0 0 8px #00d68f" : "none",
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#162d3d" }}>
              {runningAgents.length > 0 ? `${runningAgents.length} agent${runningAgents.length > 1 ? 's' : ''} working` : "All agents idle"}
            </span>
          </div>
          <div style={{ height: 20, width: 1, background: "#d0d0d0" }} />
          <div style={{ fontSize: 13, color: "#666" }}>
            <span style={{ fontWeight: 600 }}>{activeTasks}</span> active task{activeTasks !== 1 ? 's' : ''}
          </div>
          <div style={{ height: 20, width: 1, background: "#d0d0d0" }} />
          <div style={{ fontSize: 13, color: "#666" }}>
            <span style={{ fontWeight: 600 }}>{dashboard.tasks.blocked || 0}</span> blocked
          </div>
          <div style={{ height: 20, width: 1, background: "#d0d0d0" }} />
          <div style={{ fontSize: 13, color: "#666" }}>
            <span style={{ fontWeight: 600 }}>{runs.filter((r) => r.status === "succeeded").length}/{runs.length}</span> runs successful
          </div>
        </div>

        {/* Health check results */}
        {healthResult && (
          <div style={{
            padding: "14px 20px",
            borderRadius: 8,
            marginBottom: 20,
            background:
              healthResult.status === "healthy"
                ? "#f0faf0"
                : healthResult.status === "repaired"
                  ? "#fff8e1"
                  : healthResult.status === "warning"
                    ? "#fff8e1"
                    : "#fff5f5",
            border: `1px solid ${
              healthResult.status === "healthy"
                ? "#c8e6c9"
                : healthResult.status === "repaired"
                  ? "#ffe082"
                  : healthResult.status === "warning"
                    ? "#ffe082"
                    : "#ffcdd2"
            }`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 14,
                color:
                  healthResult.status === "healthy"
                    ? "#2e7d32"
                    : healthResult.status === "repaired"
                      ? "#f57f17"
                      : healthResult.status === "warning"
                        ? "#f57f17"
                        : "#c62828",
              }}>
                {healthResult.status === "healthy"
                  ? "All systems healthy"
                  : healthResult.status === "repaired"
                    ? "Issues found and repaired"
                    : healthResult.status === "warning"
                      ? "Attention needed"
                      : "Problems detected"}
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
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={async () => {
                  if (!companyId || healthLoading) return;
                  setHealthLoading(true);
                  try {
                    const result = await runCompanyHealthCheck(companyId);
                    setHealthResult(result);
                  } catch {
                    setHealthResult({
                      status: "error",
                      checks: [{ name: "api", status: "error", detail: "Health check failed" }],
                      actions: [],
                      controls: { restartAvailable: false },
                    });
                  }
                  setHealthLoading(false);
                }}
                disabled={healthLoading}
                style={{
                  border: "1px solid #d6d6d6",
                  background: "white",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: healthLoading ? "default" : "pointer",
                  color: "#2f6fed",
                }}
              >
                {healthLoading ? "Checking..." : "Run again"}
              </button>
              {healthResult.controls?.restartAvailable && (
                <button
                  onClick={async () => {
                    if (restartingServer) return;
                    setRestartingServer(true);
                    try {
                      const result = await restartPaperclipServer();
                      setHealthResult({
                        status: "repaired",
                        checks: [
                          ...healthResult.checks,
                          {
                            name: "restart",
                            status: "repaired",
                            detail: result.message || "Restart request sent",
                          },
                        ],
                        actions: [
                          ...healthResult.actions,
                          "Restart request sent to Paperclip server",
                        ],
                        controls: { restartAvailable: true },
                      });
                    } catch (error) {
                      setHealthResult({
                        status: "error",
                        checks: [
                          ...healthResult.checks,
                          {
                            name: "restart",
                            status: "error",
                            detail:
                              error instanceof Error ? error.message : "Restart failed",
                          },
                        ],
                        actions: healthResult.actions,
                        controls: { restartAvailable: true },
                      });
                    }
                    setRestartingServer(false);
                  }}
                  disabled={restartingServer}
                  style={{
                    border: "1px solid #d6d6d6",
                    background: "white",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: restartingServer ? "default" : "pointer",
                    color: "#c62828",
                  }}
                >
                  {restartingServer ? "Restarting..." : "Restart Paperclip"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Goals */}
        {goals.length > 0 && (
          <div style={{ background: "linear-gradient(135deg, #162d3d 0%, #1a4a6e 100%)", borderRadius: 12, padding: "20px 28px", marginBottom: 20, color: "white" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, opacity: 0.6, marginBottom: 10 }}>Company Goals</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {goals.map((goal, i) => {
                const progress = goalProgress[goal.id];
                return (
                  <div key={goal.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ fontSize: 16, marginTop: 1 }}>
                      {goal.status === "completed" ? "✅" : goal.status === "archived" ? "📦" : "🎯"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>{goal.title}</div>
                      {goal.description && (
                        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>{goal.description}</div>
                      )}
                      {progress && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{progress.progress}%</div>
                            <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${progress.progress}%`, height: "100%", background: "rgba(0,214,143,0.9)", borderRadius: 3, transition: "width 0.3s" }} />
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.5 }}>{timeAgo(progress.updatedAt)}</div>
                          </div>
                          {progress.comment && (
                            <div style={{ fontSize: 12, opacity: 0.75, fontStyle: "italic", marginTop: 4 }}>"{progress.comment}"</div>
                          )}
                        </div>
                      )}
                    </div>
                    {goal.level && goal.level !== "company" && (
                      <span style={{ fontSize: 11, opacity: 0.5, textTransform: "capitalize", marginTop: 3 }}>{goal.level}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#999", marginBottom: 12, fontWeight: 600 }}>Quick Actions</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => { setNewTaskAssignee(ceoAgent?.id); setShowCreate(true); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              color: "#2f6fed",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Add size="18px" />
            <span>Create Task</span>
          </button>
          {ceoAgent && (
            <button
              onClick={async () => {
                try {
                  await invokeHeartbeat(ceoAgent.id);
                  setTimeout(() => load(), 2000);
                } catch {}
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: 0,
                color: "#2f6fed",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Refresh size="18px" />
              <span>Wake AI Team Lead</span>
            </button>
          )}
          <button
            onClick={() => window.location.href = companyPath("/inbox")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              color: "#2f6fed",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Inbox size="18px" />
            <span>View Inbox {dashboard.tasks.open > 0 && `(${dashboard.tasks.open})`}</span>
          </button>
          <button
            onClick={async () => {
              if (!companyId) return;
              setHealthLoading(true);
              setHealthResult(null);
              try {
                const result = await runCompanyHealthCheck(companyId);
                setHealthResult(result);
              } catch { setHealthResult({ status: "error", checks: [{ name: "api", status: "error", detail: "Health check failed" }], actions: [], controls: { restartAvailable: false } }); }
              setHealthLoading(false);
            }}
            disabled={healthLoading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              color: healthLoading ? "#9fb6e8" : "#2f6fed",
              fontSize: 15,
              fontWeight: 600,
              cursor: healthLoading ? "default" : "pointer",
            }}
          >
            <Confirm size="18px" />
            <span>{healthLoading ? "Checking..." : "Health Check"}</span>
          </button>
        </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Key metrics row */}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#999", marginBottom: 14, fontWeight: 600 }}>Key Metrics</div>
          <div className="dashboard-metrics" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 18 }}>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Team</div>
                    <Users color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 8 }}>{agents.length}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                    {runningAgents.length > 0 ? `${runningAgents.length} working now` : "All available"}
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Tasks Done</div>
                    <Checklist color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 8 }}>{doneTasks}<span style={{ fontSize: 16, color: "#999", fontWeight: 400 }}>/{totalTasks}</span></div>
                  <div style={{ width: "100%", height: 4, background: "#eee", borderRadius: 2, marginTop: 10 }}>
                    <div style={{ width: `${progressPct}%`, height: 4, background: "#00d68f", borderRadius: 2 }} />
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Active Work</div>
                    <Promote color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: activeTasks > 0 ? "#3899ec" : "#162d3d", marginTop: 8 }}>{activeTasks}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                    {dashboard.tasks.blocked ? `${dashboard.tasks.blocked} blocked` : "No blockers"}
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Runs</div>
                    <Refresh color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 8 }}>
                    {runs.filter((r) => r.status === "succeeded").length}
                    <span style={{ fontSize: 16, color: "#999", fontWeight: 400 }}>/{runs.length}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                    {runs.filter((r) => r.status === "failed").length > 0
                      ? `${runs.filter((r) => r.status === "failed").length} failed`
                      : "All successful"}
                  </div>
                </Card.Content>
              </Card>
            </div>
          </div>
          </div>

          {/* Team status - Full width */}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#999", marginBottom: 14, fontWeight: 600 }}>Your Team</div>
          <div style={{
            background: "white",
            borderRadius: 12,
            border: "1px solid #e8ecf0",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              padding: "20px 24px",
              borderBottom: "1px solid #f0f3f5",
              background: "linear-gradient(to bottom, #fafbfc, #ffffff)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#162d3d", marginBottom: 4 }}>
                    {agents.filter(a => a.status === "running").length > 0 ? "🚀 " : ""}
                    Team Activity
                  </div>
                  <div style={{ fontSize: 13, color: "#7a92a5" }}>
                    {agents.filter(a => a.status === "running").length > 0
                      ? `${agents.filter(a => a.status === "running").length} team member${agents.filter(a => a.status === "running").length > 1 ? "s" : ""} working now`
                      : `${agents.length} team member${agents.length > 1 ? "s" : ""} ready`
                    }
                  </div>
                </div>
                <a href={companyPath("/team")} style={{
                  color: "#3899ec",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  View team
                  <span style={{ fontSize: 16 }}>→</span>
                </a>
              </div>
            </div>

            {/* Team members */}
            <div style={{ padding: "8px 0" }}>
              {agents
                .sort((a, b) => {
                  // Sort by hierarchy (like team page)
                  const ROLE_ORDER: Record<string, number> = { ceo: 0, pm: 1, cmo: 2, engineer: 3, qa: 4, designer: 5 };
                  const aOrder = ROLE_ORDER[a.role] ?? 99;
                  const bOrder = ROLE_ORDER[b.role] ?? 99;
                  if (aOrder !== bOrder) return aOrder - bOrder;
                  const aHasReports = agents.some((x) => x.reportsTo === a.id);
                  const bHasReports = agents.some((x) => x.reportsTo === b.id);
                  if (aHasReports !== bHasReports) return aHasReports ? -1 : 1;
                  return a.name.localeCompare(b.name);
                })
                .map((agent, i) => {
                  const statusText = agentStatusText(agent);
                  const narrative = agentNarratives[agent.id];
                  const interval = getHeartbeatPolicy(agent).intervalSec;
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
                    <div
                      key={agent.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        padding: "16px 24px",
                        borderBottom: i < agents.length - 1 ? "1px solid #f5f7f9" : "none",
                        transition: "background 0.15s ease",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#fafbfc"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      onClick={() => window.location.href = companyPath(agent.status === "running" ? `/runs?agent=${agent.id}` : `/team/${agent.id}`)}
                    >
                      {/* Status indicator */}
                      <div style={{ position: "relative" }}>
                        <AgentAvatar
                          agentName={agent.name}
                          agentRole={agent.role}
                          icon={agent.icon}
                          size={52}
                          fontSize={20}
                        />
                        <div style={{
                          position: "absolute",
                          bottom: -2,
                          right: -2,
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: agent.status === "running" ? "#00d68f" : agent.status === "error" ? "#ff4d4f" : agent.status === "paused" ? "#ffc107" : "#d1dbe3",
                          border: "3px solid white",
                          boxShadow: agent.status === "running" ? "0 0 8px rgba(0, 214, 143, 0.4)" : "none",
                        }} />
                      </div>

                      {/* Name and activity */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: "#162d3d" }}>{agent.name}</span>
                          <span style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {agent.title}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: "#5a6c7d", lineHeight: 1.5 }}>
                          {agent.status === "running" ? (
                            <span style={{ color: "#00d68f", fontWeight: 500 }}>● Working now</span>
                          ) : narrative?.title ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {narrative.title}
                              </span>
                              <span style={{ color: "#a3b5c7", flexShrink: 0 }}>· {timeAgo(narrative.time)}</span>
                            </div>
                          ) : (
                            <span style={{ color: "#a3b5c7" }}>{statusText}</span>
                          )}
                        </div>
                      </div>

                      {/* Action */}
                      <div style={{ flexShrink: 0 }}>
                        {agent.status === "running" ? (
                          <div style={{
                            background: "#e6f9f2",
                            color: "#00a862",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}>
                            <div style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "#00d68f",
                              animation: "active-pulse 2s ease-in-out infinite",
                            }} />
                            Active
                          </div>
                        ) : agent.status === "paused" ? (
                          <Badge size="medium" skin="warning">On leave</Badge>
                        ) : agent.status === "error" ? (
                          <Badge size="medium" skin="danger">Needs attention</Badge>
                        ) : (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
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
                              background: "#3899ec",
                              color: "white",
                              border: "none",
                              borderRadius: 6,
                              padding: "8px 16px",
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              transition: "background 0.15s ease",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#2b7bc9"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#3899ec"; }}
                          >
                            Wake up
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          </div>

          {/* Achievements */}
          {(() => {
            const doneIssues = issues
              .filter((i) => i.status === "done" && i.title !== "Board Inbox")
              .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime());
            if (doneIssues.length === 0) return null;
            return (
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#999", marginBottom: 14, fontWeight: 600 }}>Recent Achievements</div>
                <Card>
                  <Card.Header
                    title={`${doneIssues.length} Completed`}
                    suffix={<a href={companyPath("/tasks?status=done")} style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>View all</a>}
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
                        <TaskLinkWithPreview
                          key={issue.id}
                          href={companyPath(`/tasks/${issue.identifier}`)}
                          issue={issue}
                          block
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
                        </TaskLinkWithPreview>
                      );
                    })}
                    {doneIssues.length > 5 && (
                      <div style={{ padding: "10px 0", textAlign: "center" }}>
                        <a href={companyPath("/tasks?status=done")} style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>
                          See all achievements →
                        </a>
                      </div>
                    )}
                  </Card.Content>
                </Card>
              </div>
            );
          })()}

          {/* Open work - Full width */}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#999", marginBottom: 14, fontWeight: 600 }}>Open Work</div>
            <Card>
              <Card.Header
                suffix={
                  <Box direction="horizontal" gap="12px" verticalAlign="middle">
                    <Button size="tiny" prefixIcon={<Add />} onClick={() => { setNewTaskAssignee(ceoAgent?.id); setShowCreate(true); }}>Create Task</Button>
                    <a href={companyPath("/tasks")} style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>View all</a>
                  </Box>
                }
              />
              <Card.Content>
                {recentIssues.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <Checklist color="#b0b0b0" size="48px" />
                    <div style={{ marginTop: 12 }}>
                      <Text weight="bold">No open tasks</Text>
                      <div style={{ marginTop: 6 }}>
                        <Text size="small" secondary>The team is ready for new work. Create a task to get started.</Text>
                      </div>
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <Button size="small" onClick={() => { setNewTaskAssignee(ceoAgent?.id); setShowCreate(true); }}>
                        Create First Task
                      </Button>
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
                      <TaskLinkWithPreview
                        key={issue.id}
                        href={companyPath(`/tasks/${issue.identifier}`)}
                        issue={issue}
                        block
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
                      </TaskLinkWithPreview>
                    );
                  })
                )}
              </Card.Content>
            </Card>
          </div>

          {/* Token Usage Analytics */}
          <div>
            <Card>
              <Card.Header
                title="Token Usage"
                subtitle={tokenStats.totalRuns > 0 ? `${tokenStats.totalRuns} runs tracked` : "No runs tracked yet"}
              />
              <Card.Content>
                <div
                  style={{
                    padding: "18px 20px",
                    borderRadius: 12,
                    border: "1px solid #d6e4f5",
                    background: "linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)",
                    marginBottom: 24,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      flexWrap: "wrap",
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: "#4a6375", textTransform: "uppercase", letterSpacing: 0.4 }}>
                        Company activity
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>
                        {describeActivityLevel(selectedActivityIndex)}
                      </div>
                      <div style={{ fontSize: 13, color: "#4a6375", marginTop: 4 }}>
                        Selected cadence: <strong>{formatHeartbeatInterval(selectedActivityIntervalSec)}</strong> for every agent.
                      </div>
                    </div>
                    <div style={{ minWidth: 220 }}>
                      <div style={{ fontSize: 12, color: "#4a6375", textTransform: "uppercase", letterSpacing: 0.4 }}>
                        Estimated monthly spend
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>
                        {projectedMonthlyUsage.hasData ? `~$${projectedMonthlyUsage.cost.toFixed(2)}` : "—"}
                      </div>
                      <div style={{ fontSize: 13, color: "#4a6375", marginTop: 4 }}>
                        {projectedMonthlyUsage.hasData
                          ? `~${(projectedMonthlyUsage.tokens / 1000).toFixed(1)}k tokens / ${Math.round(projectedMonthlyUsage.runs).toLocaleString()} scheduled runs`
                          : "Estimate appears after the team has usable run history."}
                      </div>
                    </div>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={ACTIVITY_INTERVAL_OPTIONS.length - 1}
                    step={1}
                    value={selectedActivityIndex}
                    disabled={savingActivity || agents.length === 0}
                    onChange={(event) => {
                      setActivitySliderIndex(Number(event.target.value));
                      setActivitySliderDirty(true);
                      setActivityFeedback("");
                      setActivityError("");
                    }}
                    style={{
                      width: "100%",
                      accentColor: "#3899ec",
                      cursor: savingActivity || agents.length === 0 ? "not-allowed" : "pointer",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      marginTop: 8,
                      fontSize: 12,
                      color: "#4a6375",
                    }}
                  >
                    <span>48h · lowest activity</span>
                    <span>10m · highest activity</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 16,
                      flexWrap: "wrap",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#4a6375" }}>
                      {uniqueScheduledIntervals.length > 1 && scheduledIntervals.length > 0
                        ? `Current schedules are mixed: ${formatHeartbeatInterval(scheduledIntervals[0])} to ${formatHeartbeatInterval(scheduledIntervals[scheduledIntervals.length - 1])}. Applying this will unify all agent intervals.`
                        : `Current company setting: ${formatHeartbeatInterval(companyActivityIntervalSec)} for ${agents.length} agent${agents.length === 1 ? "" : "s"}.`}
                      {pausedAgents > 0 && ` ${pausedAgents} paused agent${pausedAgents === 1 ? " is" : "s are"} excluded from the spend estimate.`}
                      {projectedMonthlyUsage.hasData && projectedBudgetPct !== null && ` Estimated budget use: ${projectedBudgetPct}% of monthly budget.`}
                    </div>
                    <Button
                      size="small"
                      onClick={handleApplyActivityLevel}
                      disabled={
                        savingActivity ||
                        agents.length === 0 ||
                        (!activitySliderDirty &&
                          selectedActivityIntervalSec === companyActivityIntervalSec &&
                          uniqueScheduledIntervals.length <= 1)
                      }
                    >
                      {savingActivity ? "Applying..." : "Apply to all agents"}
                    </Button>
                  </div>

                  {(activityFeedback || activityError) && (
                    <div
                      style={{
                        marginTop: 12,
                        fontSize: 13,
                        color: activityError ? "#d64545" : "#2b6a3f",
                      }}
                    >
                      {activityError || activityFeedback}
                    </div>
                  )}
                </div>

                {tokenStats.totalRuns > 0 ? (
                  <>
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
                            .map(([id, data]) => ({ id, name: agents.find((a) => a.id === id)?.name || "Unknown", ...data, total: data.input + data.output + data.cached }))
                            .sort((a, b) => b.total - a.total);
                          const maxTotal = Math.max(...agentEntries.map((a) => a.total), 1);

                          return agentEntries.map((agent) => (
                            <div key={agent.id}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <a href={companyPath(`/team/${agent.id}`)} style={{ fontSize: 13, fontWeight: 500, color: "#162d3d", textDecoration: "none" }}>{agent.name}</a>
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
                  </>
                ) : (
                  <div style={{ paddingTop: 4, fontSize: 13, color: "#66788a" }}>
                    Token analytics will fill in after the team has completed a few runs.
                  </div>
                )}
              </Card.Content>
            </Card>
          </div>

          {/* Recent Activity - Compact */}
          {(() => {
            // Show only the 3 most recent runs
            const latestRuns = [...runs]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3);

            if (latestRuns.length === 0) return null;

            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Text size="medium" weight="bold">Recent Activity</Text>
                  <a href={companyPath("/activity")} style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>See all →</a>
                </div>
                <Card>
                  <Card.Content>
                    {latestRuns.map((run, idx) => {
                      const agent = agents.find((a) => a.id === run.agentId);
                      const agentName = agent?.name || "Unknown";
                      const narrative = feedNarratives[run.id];

                      return (
                        <div key={run.id} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 0",
                          borderBottom: idx < latestRuns.length - 1 ? "1px solid #f0f0f0" : "none"
                        }}>
                          <a href={companyPath(`/team/${run.agentId}`)} style={{ textDecoration: "none", flexShrink: 0 }}>
                            <AgentAvatar
                              agentName={agentName}
                              agentRole={agent?.role}
                              icon={agent?.icon}
                              size={32}
                              fontSize={12}
                            />
                          </a>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <a href={companyPath(`/team/${run.agentId}`)} style={{ textDecoration: "none", color: "inherit", fontWeight: 600, fontSize: 13 }}>{agentName}</a>
                              <Badge size="tiny" skin={FEED_STATUS_SKINS[run.status] || "general"}>{FEED_STATUS_LABELS[run.status] || run.status}</Badge>
                              <span style={{ fontSize: 11, color: "#bbb" }}>· {timeAgo(run.createdAt)}</span>
                            </div>
                            {run.status === "running" || run.status === "queued" ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#3899ec", fontSize: 12 }}>
                                <Loader size="tiny" />
                                <span>{run.status === "queued" ? "Waiting to start…" : "Running now…"}</span>
                              </div>
                            ) : narrative?.title ? (
                              <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {narrative.title}
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: "#ccc", fontStyle: "italic" }}>No summary</span>
                            )}
                          </div>
                          <a href={companyPath(`/runs/${run.id}`)} style={{ color: "#3899ec", textDecoration: "none", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>View</a>
                        </div>
                      );
                    })}
                  </Card.Content>
                </Card>
              </div>
            );
          })()}
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
        title="How your AI Team works"
        onCloseButtonClick={() => setShowLearnMore(false)}
        primaryButtonText="Got it"
        primaryButtonOnClick={() => setShowLearnMore(false)}
      >
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "#333" }}>
          <p style={{ marginTop: 0 }}>
            <strong>You are running an AI Team staffed entirely by AI agents.</strong> Each specialist can create tasks, communicate with other agents, and report back to you.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>🏢 Your Team</h3>
          <p>
            Your AI Team has a real operating structure — an AI Team Lead plus specialist agents for the areas of support your business needs. Each agent has a role description that defines how they think and work. The AI Team Lead coordinates everyone and reports directly to you.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>⏰ How They Work</h3>
          <p>
            Agents work in <strong>check-ins</strong> (called heartbeats). During each check-in, an agent wakes up, reads their inbox, reviews tasks, does work, and goes back to sleep. You can set how often each agent checks in, or wake them up manually anytime.
          </p>

          <h3 style={{ fontSize: 15, marginBottom: 6, color: "#162d3d" }}>💬 Talking to the AI Team Lead</h3>
          <p>
            The chat panel on the right is your direct line to the AI Team Lead. Send a message and the AI Team Lead will wake up, read it, coordinate the specialists, and reply.
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

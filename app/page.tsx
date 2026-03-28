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
} from "@wix/design-system";
import {
  Refresh,
  Users,
  Checklist,
  Promote,
  Statistics,
  Confirm,
  Activity,
} from "@wix/wix-ui-icons-common";
import { Providers } from "./providers";
import { Shell } from "./shell";
import {
  getCompanies,
  getDashboard,
  getActivity,
  getAgents,
  getGoals,
  getIssues,
  type Company,
  type Dashboard,
  type ActivityEntry,
  type Agent,
  type Goal,
  type Issue,
} from "@/lib/api";

interface Story { icon: string; text: string; detail?: string; link?: string; actorLink?: string; }

function buildStory(entry: ActivityEntry, agents: Agent[]): Story | null {
  const isUser = entry.actorType === "user";
  const actorAgent = entry.agentId ? agents.find((a) => a.id === entry.agentId) : null;
  // For agent.updated, the entity IS the agent being updated
  const entityAgent = entry.entityType === "agent" ? agents.find((a) => a.id === entry.entityId) : null;

  const actor = isUser ? "You" : (actorAgent?.name || "An agent");
  const actorLink = !isUser && actorAgent ? `/team?agent=${actorAgent.id}` : undefined;
  const entityLink = entityAgent ? `/team?agent=${entityAgent.id}` : undefined;
  const runLink = entry.entityType === "run" ? `/runs?run=${entry.entityId}` : undefined;
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
        link: identifier ? `/tasks?issue=${identifier}` : undefined,
        actorLink,
      };
    }
    case "issue.updated": {
      const taskLink = identifier ? `/tasks?issue=${identifier}` : undefined;
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
      return { icon: "➕", text: `${actor} created ${identifier ? identifier + " " : ""}${issueTitle || "a new task"}`, link: identifier ? `/tasks?issue=${identifier}` : undefined, actorLink };
    case "issue.checked_out":
      return { icon: "🔨", text: `${actor} picked up ${identifier}${issueTitle ? ` — ${issueTitle}` : ""} and started working`, link: identifier ? `/tasks?issue=${identifier}` : undefined, actorLink };
    case "issue.released":
      return { icon: "📤", text: `${actor} released ${identifier}${issueTitle ? ` — ${issueTitle}` : ""}`, link: identifier ? `/tasks?issue=${identifier}` : undefined, actorLink };
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
      const wokeLink = wokeAgent ? `/team?agent=${wokeAgent.id}` : undefined;
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
  const [company, setCompany] = useState<Company | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const companies = await getCompanies();
    if (companies.length > 0) {
      const c = companies[0];
      setCompany(c);
      const [dash, act, agentList, goalList, issueList] = await Promise.all([
        getDashboard(c.id),
        getActivity(c.id).catch(() => []),
        getAgents(c.id),
        getGoals(c.id).catch(() => []),
        getIssues(c.id).catch(() => []),
      ]);
      setDashboard(dash);
      setActivity((act || []).slice(0, 15));
      setAgents(agentList);
      setGoals(goalList);
      setIssues(issueList);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
          <div style={{ display: "grid", gridTemplateColumns: "5fr 7fr", gap: 16 }}>
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

  return (
    <Page>
      <Page.Header
        title={company.name}
        actionsBar={
          <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>
            Refresh
          </Button>
        }
      />
      <Page.Content>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 16 }}>
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
            <a href="/approvals" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="metric-card-hover" style={{ borderRadius: 8 }}>
                <Card>
                  <Card.Content>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Approvals</div>
                      <Confirm color="#b0b0b0" size="20px" />
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: dashboard.pendingApprovals > 0 ? "#ee5951" : "#162d3d", marginTop: 4 }}>{dashboard.pendingApprovals}</div>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                      {dashboard.pendingApprovals > 0 ? "need your review" : "All clear"}
                    </div>
                  </Card.Content>
                </Card>
              </div>
            </a>
            <div className="metric-card-hover" style={{ borderRadius: 8 }}>
              <Card>
                <Card.Content>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Spend</div>
                    <Statistics color="#b0b0b0" size="20px" />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#162d3d", marginTop: 4 }}>${((dashboard.costs.monthSpendCents || 0) / 100).toFixed(0)}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                    {dashboard.costs.monthBudgetCents ? `of $${(dashboard.costs.monthBudgetCents / 100).toFixed(0)} budget` : "This month"}
                  </div>
                </Card.Content>
              </Card>
            </div>
          </div>

          {/* Team + Open work row */}
          <div style={{ display: "grid", gridTemplateColumns: "5fr 7fr", gap: 16 }}>
          {/* Team status */}
          <Card>
              <Card.Header title="Team Status" />
              <Card.Content>
                {agents
                  .sort((a, b) => {
                    const order: Record<string, number> = { running: 0, idle: 1, active: 1, paused: 2, error: 3 };
                    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                  })
                  .map((agent, i) => {
                    const statusText = agentStatusText(agent);
                    return (
                      <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < agents.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                        {/* Status dot */}
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                          background: agent.status === "running" ? "#00d68f" : agent.status === "error" ? "#ff4d4f" : agent.status === "paused" ? "#ffc107" : "#b0b0b0",
                          boxShadow: agent.status === "running" ? "0 0 6px #00d68f" : "none",
                        }} />
                        {/* Name */}
                        <a href={`/team?agent=${agent.id}`} style={{ flex: 1, textDecoration: "none", color: "inherit" }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{agent.name}</div>
                          <div style={{ fontSize: 12, color: "#999" }}>{agent.title}</div>
                        </a>
                        {/* Status */}
                        <div style={{ textAlign: "right" }}>
                          {agent.status === "running" ? (
                            <a href={`/runs?agent=${agent.id}&status=running`} style={{ textDecoration: "none" }}>
                              <Badge size="tiny" skin="success">Working</Badge>
                            </a>
                          ) : agent.status === "paused" ? (
                            <Badge size="tiny" skin="warning">On leave</Badge>
                          ) : agent.status === "error" ? (
                            <Badge size="tiny" skin="danger">Needs attention</Badge>
                          ) : (
                            <span style={{ color: "#999", fontSize: 12 }}>
                              {statusText}
                            </span>
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
                suffix={<a href="/tasks" style={{ color: "#3899ec", textDecoration: "none", fontSize: 13 }}>View all tasks</a>}
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
                        href={`/tasks?issue=${issue.identifier}`}
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
        </div>
      </Page.Content>
    </Page>
  );
}

export default function Home() {
  return (
    <Providers>
      <Shell>
        <DashboardContent />
      </Shell>
    </Providers>
  );
}

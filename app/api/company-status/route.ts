import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getCompanyBusinessDescription, getCompanyWixBinding } from "@/lib/company-metadata";

const client = new OpenAI();

type StatusCompany = {
  name: string;
  description?: string | null;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
};

type StatusDashboard = {
  agents?: Record<string, number>;
  tasks?: Record<string, number>;
  pendingApprovals?: number;
};

type StatusAgent = {
  id: string;
  name: string;
  title: string;
  role: string;
  status: string;
  lastHeartbeatAt?: string | null;
};

type StatusGoal = {
  title: string;
  status?: string;
  description?: string;
};

type StatusIssue = {
  identifier: string;
  title: string;
  status: string;
  priority?: string;
  updatedAt: string;
  assigneeAgentId?: string | null;
  assigneeId?: string | null;
};

type StatusRun = {
  agentId: string;
  status: string;
  invocationSource?: string;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type CompanyStatusRequest = {
  company?: StatusCompany | null;
  dashboard?: StatusDashboard | null;
  agents?: StatusAgent[];
  goals?: StatusGoal[];
  issues?: StatusIssue[];
  inboxIssues?: StatusIssue[];
  runs?: StatusRun[];
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function summarizeIssues(issues: StatusIssue[], agents: StatusAgent[]): string {
  const openIssues = issues.filter((issue) => !["done", "cancelled"].includes(issue.status));
  const relevantIssues = [...openIssues]
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        blocked: 0,
        in_review: 1,
        in_progress: 2,
        todo: 3,
        backlog: 4,
      };
      const aPriority = priorityOrder[a.status] ?? 99;
      const bPriority = priorityOrder[b.status] ?? 99;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, 10);

  if (relevantIssues.length === 0) {
    return "No open issues.";
  }

  return relevantIssues
    .map((issue) => {
      const assigneeId = issue.assigneeAgentId || issue.assigneeId || "";
      const assignee = agents.find((agent) => agent.id === assigneeId);
      const assigneeLabel = assignee ? assignee.title || assignee.name : "Unassigned";
      return `- ${issue.title} [${issue.status}] owner: ${assigneeLabel} updated: ${formatDateTime(issue.updatedAt)}`;
    })
    .join("\n");
}

function summarizeInbox(issues: StatusIssue[]): string {
  if (issues.length === 0) {
    return "No current board conversations.";
  }

  return issues
    .slice(0, 8)
    .map((issue) => `- ${issue.title} [${issue.status}]`)
    .join("\n");
}

function summarizeRuns(runs: StatusRun[], agents: StatusAgent[]): string {
  if (runs.length === 0) {
    return "No runs yet.";
  }

  return [...runs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((run) => {
      const agent = agents.find((entry) => entry.id === run.agentId) || null;
      const agentLabel = agent?.title || agent?.name || run.agentId || "Unknown agent";
      const detail = run.error ? ` error: ${run.error.slice(0, 180)}` : "";
      return `- ${agentLabel} [${run.status}] ${formatDateTime(run.createdAt)}${detail}`;
    })
    .join("\n");
}

function summarizeGoals(goals: StatusGoal[]): string {
  if (goals.length === 0) {
    return "No formal goals are set.";
  }

  return goals
    .slice(0, 8)
    .map((goal) => `- ${goal.title}${goal.status ? ` [${goal.status}]` : ""}${goal.description ? ` :: ${goal.description}` : ""}`)
    .join("\n");
}

function summarizeAgents(agents: StatusAgent[]): string {
  if (agents.length === 0) {
    return "No agents.";
  }

  return agents
    .map((agent) => `- ${agent.title || agent.name} [${agent.status}] last check-in: ${formatDateTime(agent.lastHeartbeatAt)}`)
    .join("\n");
}

const SYSTEM_PROMPT = `You are writing a status update for the board of a company that is managed by an AI team.

Return Markdown only.

Write like an executive status memo, not a task dump.
The audience is the board/founder.

Requirements:
- Start with a short headline sentence that says the current state of the business in plain words.
- Then write 3 to 5 short markdown sections with concise headings.
- Focus on business progress, operating momentum, major blockers, risks, and what matters next.
- Explain the state in plain language. Do not sound technical.
- Do not enumerate raw task lists.
- Do not mention more than 2 task IDs, and only if they are genuinely useful.
- Prefer naming themes and outcomes over internal mechanics.
- Be honest about failures or uncertainty.
- If board input is needed, end with a short "Board attention" section.
- Keep it tight: around 220-380 words.

Good section examples:
- Overall status
- What is moving
- Main risk
- Team signal
- Board attention

Avoid:
- giant bullet lists
- every task title
- internal jargon
- generic encouragement`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompanyStatusRequest;
    const company = body.company;
    if (!company) {
      return NextResponse.json({ error: "Company snapshot is required" }, { status: 400 });
    }

    const businessDescription = getCompanyBusinessDescription(company.description);
    const wixBinding = getCompanyWixBinding(company.description);
    const agents = Array.isArray(body.agents) ? body.agents : [];
    const goals = Array.isArray(body.goals) ? body.goals : [];
    const issues = Array.isArray(body.issues) ? body.issues : [];
    const inboxIssues = Array.isArray(body.inboxIssues) ? body.inboxIssues : [];
    const runs = Array.isArray(body.runs) ? body.runs : [];
    const dashboard = body.dashboard || {};

    const prompt = [
      `Company: ${company.name}`,
      `Business summary: ${businessDescription || "Not captured yet."}`,
      `Wix site: ${wixBinding?.siteUrl || "Unknown"}`,
      `Budget: monthly $${((company.budgetMonthlyCents || 0) / 100).toFixed(2)}, spent $${((company.spentMonthlyCents || 0) / 100).toFixed(2)}`,
      `Dashboard tasks: ${JSON.stringify(dashboard.tasks || {})}`,
      `Pending approvals: ${dashboard.pendingApprovals || 0}`,
      "",
      "Agents:",
      summarizeAgents(agents),
      "",
      "Goals:",
      summarizeGoals(goals),
      "",
      "Open issues:",
      summarizeIssues(issues, agents),
      "",
      "Inbox issues needing board visibility:",
      summarizeInbox(inboxIssues),
      "",
      "Recent runs:",
      summarizeRuns(runs, agents),
    ].join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });

    const markdown = response.choices[0]?.message?.content?.trim() || "No status summary available.";

    return NextResponse.json({ markdown });
  } catch (error) {
    console.error("company-status route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate company status" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getCompanyBusinessDescription,
  getCompanyWixBinding,
  parseCompanyDescription,
} from "@/lib/company-metadata";

const client = new OpenAI();

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

interface ActivationChatRequest {
  companyId?: string;
  issueId?: string;
  trigger?: "initial_open" | "backend_update" | "user_message";
  messages?: Array<{
    role: "ceo" | "user";
    text: string;
  }>;
}

interface CompanyData {
  id: string;
  name: string;
  description: string;
}

interface IssueData {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommentData {
  id: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  createdAt: string;
}

interface AgentData {
  id: string;
  name: string;
  role: string;
  title: string;
  status: string;
}

interface HeartbeatRunData {
  id: string;
  agentId: string;
  status: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultJson?: {
    result?: string;
  } | null;
  stdoutExcerpt?: string | null;
}

async function paperclip<T>(path: string): Promise<T> {
  const response = await fetch(`${PAPERCLIP_API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Paperclip request failed: ${path} (${response.status})`);
  }

  return response.json();
}

function isHiddenSystemComment(body: string): boolean {
  return body.startsWith("[System context - not visible to user]");
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function summarizeInstalledApps(description: string): string {
  const metadata = parseCompanyDescription(description);
  const installedApps = Array.isArray(metadata.extra?.installedApps)
    ? metadata.extra.installedApps
    : metadata.wixBinding?.data?.installedApps;
  if (!Array.isArray(installedApps) || installedApps.length === 0) {
    return "Unknown";
  }

  return installedApps
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 8)
    .join(", ");
}

function summarizeOpenIssues(issues: IssueData[]): string {
  const openIssues = issues.filter((issue) => !["done", "cancelled"].includes(issue.status));
  if (openIssues.length === 0) {
    return "No open issues.";
  }

  return openIssues
    .slice(0, 6)
    .map((issue) => `- ${issue.identifier}: ${issue.title} [${issue.status}]`)
    .join("\n");
}

function summarizeComments(comments: CommentData[], agents: AgentData[]): string {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));
  const visibleComments = comments.filter((comment) => !isHiddenSystemComment(comment.body));

  if (visibleComments.length === 0) {
    return "No visible comments yet.";
  }

  return visibleComments
    .slice(-8)
    .map((comment) => {
      const author = comment.authorAgentId
        ? agentMap.get(comment.authorAgentId) || "AI Team Lead"
        : "Founder";
      return `- ${author} (${formatDate(comment.createdAt)}): ${comment.body}`;
    })
    .join("\n");
}

function summarizeRuns(runs: HeartbeatRunData[], agents: AgentData[]): string {
  if (runs.length === 0) {
    return "No heartbeat runs yet.";
  }

  const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));
  const sortedRuns = [...runs]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 4);

  return sortedRuns
    .map((run) => {
      const agentName = agentMap.get(run.agentId) || "Unknown agent";
      const snippet =
        run.resultJson?.result ||
        run.stdoutExcerpt ||
        run.error ||
        "";
      return `- ${agentName} run ${run.id} [${run.status}] started ${formatDate(run.startedAt)}${snippet ? ` :: ${snippet.slice(0, 220)}` : ""}`;
    })
    .join("\n");
}

function buildTriggerInstruction(trigger: ActivationChatRequest["trigger"]): string {
  switch (trigger) {
    case "backend_update":
      return "There is fresh progress from the background work. Give the founder a short, useful update that sounds like a calm, trusted AI Team Lead checking in. Mention only the most relevant new findings or next move.";
    case "user_message":
      return "The founder just replied. Answer them warmly and casually using the current backend state. If their request needs the background AI Team Lead or specialist agents to act, say you'll handle it and mention what is already underway.";
    case "initial_open":
    default:
      return "The founder just opened the business assessment chat and is effectively evaluating whether to activate you. Write a brief opening message with no question at the end. Introduce yourself as the AI Team Lead, briefly explain that you coordinate specialist agents across areas like site improvements, content and SEO, commerce or bookings, and operations, and say that you have already started reviewing the business and are preparing recommendations. If you already know one useful thing, mention it briefly. If research is still in progress, say that clearly and say that updates are coming soon. Keep it confident, direct, calm, and human. Do not sound stiff, official, or overly operational. Do not open with 'I only have the basics' or ask generic discovery questions unless access is fully blocked.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActivationChatRequest;
    if (!body.companyId || !body.issueId) {
      return NextResponse.json({ error: "Missing companyId or issueId" }, { status: 400 });
    }

    const [company, issue, comments, agents, issues, runs] = await Promise.all([
      paperclip<CompanyData>(`/companies/${body.companyId}`),
      paperclip<IssueData>(`/issues/${body.issueId}`),
      paperclip<CommentData[]>(`/issues/${body.issueId}/comments`).catch(() => []),
      paperclip<AgentData[]>(`/companies/${body.companyId}/agents`).catch(() => []),
      paperclip<IssueData[]>(`/companies/${body.companyId}/issues`).catch(() => []),
      paperclip<HeartbeatRunData[]>(`/companies/${body.companyId}/heartbeat-runs`).catch(() => []),
    ]);

    const wixBinding = getCompanyWixBinding(company.description);
    const businessDescription = getCompanyBusinessDescription(company.description);
    const activeRunCount = runs.filter((run) => ["queued", "running"].includes(run.status)).length;

    const systemPrompt = `You are the founder-facing Wix AI Team Lead business assessment chat.

There is a real backend AI Team Lead doing the actual work in Paperclip. Your job is to read the current AI Team, issue, comment, and run state and talk to the founder like a capable person they would trust to handle the business with them.

Rules:
- Sound warm, sharp, and practical.
- Sound like the main representative of an AI Team the founder could trust with the business.
- Use natural, conversational language. Slightly casual is good. Do not sound like a consultant, operator memo, or technocrat.
- Never write like an internal report.
- Never use markdown headers or labels like "Kickstart complete", "Business", "Key findings", or "Next steps".
- Never mention JSON, metadata population, task completion, or internal system bookkeeping.
- Keep responses concise. Usually 80-170 words.
- If helpful, you may use a short bullet list of at most 4 items, but the message should still feel conversational.
- In the first message, introduce yourself, explain the AI Team in plain language, and promote what the team can help with across areas like site improvements, content, commerce, bookings, CRM, or operations.
- In the first message, be especially brief and straightforward: 2 short paragraphs is ideal.
- If background work is still running, say that clearly and tell the founder what you already know so far.
- If the background work already found useful details, translate them into plain language and a concrete plan.
- Say clearly that you have already started reviewing the business and are preparing recommendations for next steps.
- If the founder asks for something, answer based on the current evidence. If you need the backend AI Team Lead or specialist agents to carry it out, say you'll take care of it and mention what is already underway.
- Avoid roleplay or hype. Keep it calm, smart, business-focused, and easy to talk to.
- End with a direct, human question when appropriate.
- For the initial opening message, do not ask a question yet. Just introduce the concept, say research is underway, and say that updates are coming soon.

Current activation state:
- AI Team name: ${company.name}
- Business description: ${businessDescription || "Not filled yet"}
- Meta site ID: ${wixBinding?.metaSiteId || "Unknown"}
- Site name: ${wixBinding?.siteName || "Unknown"}
- Site URL: ${wixBinding?.siteUrl || "Unknown"}
- Installed apps: ${summarizeInstalledApps(company.description)}
- Active background runs: ${activeRunCount}
- Current activation issue: ${issue.identifier} - ${issue.title} [${issue.status}]

Open AI Team issues:
${summarizeOpenIssues(issues)}

Recent founder/backend comments:
${summarizeComments(comments, agents)}

Recent runs:
${summarizeRuns(runs, agents)}

Important instruction:
${buildTriggerInstruction(body.trigger)}
`;

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const message of body.messages || []) {
      chatMessages.push({
        role: message.role === "user" ? "user" : "assistant",
        content: message.text,
      });
    }

    if (!body.messages || body.messages.length === 0) {
      chatMessages.push({
        role: "user",
        content: "[Start the founder-facing activation conversation now.]",
      });
    } else if (body.trigger === "backend_update") {
      chatMessages.push({
        role: "user",
        content: "[There is a meaningful backend update. Send a short progress update to the founder.]",
      });
    }

    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 400,
      messages: chatMessages,
    });

    return NextResponse.json({
      text: response.choices[0]?.message?.content || "",
    });
  } catch (error) {
    console.error("Activation chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Activation chat failed" },
      { status: 500 },
    );
  }
}

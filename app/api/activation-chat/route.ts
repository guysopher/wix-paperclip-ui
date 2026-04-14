import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getCompanyActivation,
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

function buildTriggerInstruction(
  trigger: ActivationChatRequest["trigger"],
  activeRunCount: number,
  issueStatus: string,
): string {
  switch (trigger) {
    case "backend_update":
      if (activeRunCount === 0) {
        return `The background run has finished and this should usually be treated as the conclusion of the assessment. Do not send another generic progress note. Unless the evidence clearly shows the work is blocked or incomplete, give the founder the practical wrap-up now: summarize the main improvements, recommend the specialist agents to hire, define the AI Team goals, and end with the exact promise: "With this team we can achieve these goals and start growing your business. Should I start working?" Current issue status: ${issueStatus}.`;
      }
      return "There is fresh progress from the background work. Give the founder a short, useful update that sounds like a calm, trusted AI Team Lead checking in. Mention only the most relevant new findings or next move.";
    case "user_message":
      return "The founder just replied. Answer them warmly and casually using the current backend state. If their request needs the background AI Team Lead or specialist agents to act, say you'll handle it and mention what is already underway.";
    case "initial_open":
    default:
      return "The founder just opened the business assessment chat and is effectively evaluating whether to activate you. Write a brief opening message with no question at the end. Introduce yourself as the AI Team Lead, briefly explain that you coordinate specialist agents across areas like site improvements, content and SEO, commerce or bookings, and operations, and say that you have already started reviewing the business and are preparing recommendations. If you already know one useful thing, mention it briefly. If research is still in progress, say that clearly and say that updates are coming soon. Keep it confident, direct, calm, and human. Do not sound stiff, official, or overly operational. Do not open with 'I only have the basics' or ask generic discovery questions unless access is fully blocked.";
  }
}

function buildNewSiteBuildInstruction(
  trigger: ActivationChatRequest["trigger"],
  status: string,
): string {
  switch (trigger) {
    case "backend_update":
      if (status === "succeeded") {
        return "The first site build has succeeded. Give the founder a concise, confident update. Mention that the first version is ready, briefly say what happens next, and suggest 2 to 4 practical ways the AI Team Lead can keep helping grow the business.";
      }
      if (status === "failed" || status === "canceled") {
        return "The site build did not complete successfully. Explain that plainly, keep it calm, and immediately pivot to what you can still help with next. Do not sound alarmist or technical.";
      }
      return "The site build is underway. Give the founder a short progress update and suggest 2 to 4 practical next steps the AI Team Lead can help with for the business while the first version is being built.";
    case "user_message":
      if (status === "succeeded") {
        return "The first site build has already succeeded. Answer like the founder is now moving from creation into execution. Keep it practical and suggest concrete next moves you can help with.";
      }
      if (status === "failed" || status === "canceled") {
        return "The site build did not start or complete successfully. Say that plainly, keep it calm, and pivot quickly into what you can do next for the founder without sounding technical.";
      }
      return "The founder just replied during the new-site build flow. Answer them conversationally, grounded in the current business inputs and build state. If the build is already underway, mention that naturally and suggest practical next steps you can help with.";
    case "initial_open":
    default:
      if (status === "failed" || status === "canceled") {
        return "The site build did not complete successfully. Explain that simply and confidently, then suggest the most useful next things the AI Team Lead can still help with for the business.";
      }
      return "The founder just completed the intake for a new site build. Tell them you are starting the first version now, keep it warm and practical, and mention a few concrete business areas you can help with next beyond just the site build.";
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
    const activation = getCompanyActivation(company.description);
    const activeRunCount = runs.filter((run) => ["queued", "running"].includes(run.status)).length;

    if (activation?.mode === "new_site") {
      const picassoStatus = activation.picassoBridge?.status || "not_started";

      const buildPrompt = `You are the founder-facing AI Team Lead for a brand new Wix site creation flow.

The founder interview is already complete. The conversation you are continuing now is post-activation: the company exists, the first version of the site is being created, and you are guiding the founder through the next phase.

Rules:
- Sound warm, sharp, practical, and confident.
- Keep it concise. Usually 70-160 words.
- Never sound like a system log, internal operator note, or technical support ticket.
- Do not mention internal tools, bridge services, JSON, metadata, tasks, or implementation details.
- Be founder-facing and business-focused.
- Suggest practical business next steps you can help with beyond just "building the site".
- If useful, you may use a short bullet list with at most 4 items.

Current business inputs:
- Business name: ${company.name}
- Business summary: ${businessDescription || "Not captured yet"}
- Activation issue brief:
${issue.description || "No activation brief available."}

Current build state:
- Picasso job status: ${picassoStatus}
- Site ID: ${activation.picassoBridge?.siteId || "Unknown"}
- Development URL: ${activation.picassoBridge?.developmentUrl || "Unknown"}
- Site URL: ${activation.picassoBridge?.siteUrl || "Unknown"}

Instruction:
${buildNewSiteBuildInstruction(body.trigger, picassoStatus)}
`;

      const buildMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: buildPrompt },
      ];

      for (const message of body.messages || []) {
        buildMessages.push({
          role: message.role === "user" ? "user" : "assistant",
          content: message.text,
        });
      }

      if (!body.messages || body.messages.length === 0) {
        buildMessages.push({
          role: "user",
          content: "[Start the founder-facing new-site build conversation now.]",
        });
      }

      const buildResponse = await client.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 300,
        messages: buildMessages,
      });

      return NextResponse.json({
        text: buildResponse.choices[0]?.message?.content || "",
      });
    }

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
- When the research is complete enough to make recommendations, present a practical proposal with:
  - the most important improvements to make first
  - the specialist agents you would hire
  - the goals this AI Team can realistically accomplish for the business
- End that proposal with this exact promise: "With this team we can achieve these goals and start growing your business. Should I start working?"
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
${buildTriggerInstruction(body.trigger, activeRunCount, issue.status)}
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

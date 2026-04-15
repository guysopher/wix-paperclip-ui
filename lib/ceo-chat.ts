import OpenAI from "openai";
import { getCompanyBusinessDescription } from "@/lib/company-metadata";

const client = new OpenAI();

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

export interface CeoChatMessage {
  role: "ceo" | "user";
  text: string;
}

export interface CeoChatAction {
  type: string;
  title: string;
  identifier?: string;
}

export interface CeoChatResult {
  text: string;
  actions?: CeoChatAction[];
}

interface CompanyData {
  name: string;
  description: string;
}

interface AgentData {
  id: string;
  name: string;
  role: string;
  title: string;
  status: string;
}

interface IssueData {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

interface GoalData {
  title: string;
  status: string;
}

async function paperclip<T>(path: string): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API}${path}`, {
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
  });
  return res.json();
}

async function paperclipPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function buildSystemPrompt(companyId: string): Promise<string> {
  const [company, agents, issues, goals] = await Promise.all([
    paperclip<CompanyData>(`/companies/${companyId}`),
    paperclip<AgentData[]>(`/companies/${companyId}/agents`),
    paperclip<IssueData[]>(`/companies/${companyId}/issues`),
    paperclip<GoalData[]>(`/companies/${companyId}/goals`).catch(() => []),
  ]);

  const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));
  const activeIssues = issues
    .filter((issue) => !["done", "cancelled"].includes(issue.status))
    .slice(0, 30);
  const doneCount = issues.filter((issue) => issue.status === "done").length;
  const boardTasks = activeIssues.filter((issue) => issue.assigneeUserId && !issue.assigneeAgentId);
  const teamTasks = activeIssues.filter((issue) => !issue.assigneeUserId || issue.assigneeAgentId);

  const teamList = agents
    .map((agent) => `- ${agent.name} (${agent.title}, ${agent.status})`)
    .join("\n");

  const boardTaskList = boardTasks
    .map((issue) => `- [${issue.identifier}] "${issue.title}" [${issue.status}${issue.priority === "high" || issue.priority === "critical" ? ", " + issue.priority : ""}]`)
    .join("\n");

  const taskList = teamTasks
    .map((issue) => `- [${issue.identifier}] "${issue.title}" [${issue.status}${issue.priority === "high" || issue.priority === "critical" ? ", " + issue.priority : ""}]${issue.assigneeAgentId ? " → " + (agentMap.get(issue.assigneeAgentId) || "unassigned") : ""}`)
    .join("\n");

  const goalList = goals
    .filter((goal) => goal.status === "active")
    .map((goal) => `- ${goal.title}`)
    .join("\n");

  return `You are the AI Team Lead of ${company.name}. The board member (human) is calling you for a quick chat. This is like a phone call — be fast, direct, helpful, and easy to talk to.

ABOUT THE AI TEAM:
${getCompanyBusinessDescription(company.description) || "No description set."}

YOUR TEAM (${agents.length} agents):
${teamList || "No agents hired yet."}

⚠️ TASKS REQUIRING BOARD ATTENTION (${boardTasks.length}):
${boardTaskList || "None — all tasks are assigned to the team."}

TEAM TASKS (${teamTasks.length} active, ${doneCount} done):
${taskList || "No active team tasks."}

AI TEAM GOALS:
${goalList || "No goals set."}

HOW TO BEHAVE IN THIS CHAT:
- This is a quick, real-time conversation. Keep answers SHORT (1-3 sentences).
- You know everything about the AI Team — answer questions about tasks, specialists, progress, blockers.
- **CRITICAL**: If there are tasks requiring board attention, PROACTIVELY mention them in your response even if the board member doesn't ask directly. Say something like "By the way, [task title](/tasks/ID) needs your input" or "Quick heads up — you have [task title](/tasks/ID) waiting for you."
- If the board member asks you to do something actionable, use the create_task tool to create a task. ALWAYS provide assignee_name — every task must have an owner. If no specific agent fits, assign to yourself (AI Team Lead).
- Be direct, confident, and helpful. Slightly casual is good. Do not sound stiff, corporate, or bureaucratic.
- If you don't know something specific, say so — don't make things up.
- When referring to tasks, ALWAYS use the task TITLE, not the ID. Add a markdown link in the format: [task title](/tasks/IDENTIFIER). For example: "We're working on [improving the search algorithm](/tasks/AGE-5)" instead of "AGE-5 is in progress".
- Reference agent names when relevant.
- You can suggest next steps, flag risks, and give strategic advice.
- Never use markdown headers or bullet points — just talk naturally like you're on a call.`;
}

const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task/issue for the team. Use this when the board member asks you to do something actionable. ALWAYS assign to a specific agent — never leave assignee_name blank.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title" },
          description: { type: "string", description: "Detailed task description" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          assignee_name: { type: "string", description: "Name of the agent to assign to (from the team list). Required — every task must have an owner. If unsure, assign to yourself (AI Team Lead)." },
        },
        required: ["title", "description", "priority", "assignee_name"],
      },
    },
  },
];

export async function runCeoChat(companyId: string, messages: CeoChatMessage[]): Promise<CeoChatResult> {
  const systemPrompt = await buildSystemPrompt(companyId);

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const message of messages) {
    if (message.role === "user") {
      openaiMessages.push({ role: "user", content: message.text });
    } else {
      openaiMessages.push({ role: "assistant", content: message.text });
    }
  }

  if (openaiMessages.length === 1) {
    openaiMessages.push({
      role: "user",
      content: "[The board member just opened the chat. Greet them casually as the AI Team Lead in 1 sentence. Keep it warm, calm, and business-focused. If there are tasks requiring board attention, proactively mention them with links. If there are urgent blockers or high-priority team items, mention one briefly.]",
    });
  }

  let response = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 500,
    messages: openaiMessages,
    tools: TOOLS,
  });

  const actions: CeoChatAction[] = [];

  while (response.choices[0]?.finish_reason === "tool_calls" || response.choices[0]?.message?.tool_calls?.length) {
    const toolCalls = response.choices[0].message.tool_calls || [];
    openaiMessages.push(response.choices[0].message);

    const agents = await paperclip<AgentData[]>(`/companies/${companyId}/agents`);

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function" || toolCall.function.name !== "create_task") {
        continue;
      }

      try {
        const args = JSON.parse(toolCall.function.arguments);
        let assigneeId: string | undefined;

        if (args.assignee_name) {
          const match = agents.find((agent) =>
            agent.name.toLowerCase() === args.assignee_name.toLowerCase() ||
            agent.role.toLowerCase() === args.assignee_name.toLowerCase()
          );
          if (match) {
            assigneeId = match.id;
          }
        }

        if (!assigneeId) {
          const ceo = agents.find((agent) => agent.role === "ceo");
          if (ceo) {
            assigneeId = ceo.id;
          }
        }

        const issue = await paperclipPost<IssueData>(`/companies/${companyId}/issues`, {
          title: args.title,
          description: args.description,
          priority: args.priority || "medium",
          assigneeId,
        });

        actions.push({ type: "create_task", title: args.title, identifier: issue.identifier });
        openaiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: true, identifier: issue.identifier, title: args.title }),
        });
      } catch (error) {
        openaiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: false, error: String(error) }),
        });
      }
    }

    response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 500,
      messages: openaiMessages,
      tools: TOOLS,
    });
  }

  return {
    text: response.choices[0]?.message?.content || "",
    actions: actions.length > 0 ? actions : undefined,
  };
}

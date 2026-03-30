import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI();

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

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
}
interface GoalData {
  title: string;
  status: string;
}

/** Build a system prompt with live company context */
async function buildSystemPrompt(companyId: string): Promise<string> {
  const [company, agents, issues, goals] = await Promise.all([
    paperclip<CompanyData>(`/companies/${companyId}`),
    paperclip<AgentData[]>(`/companies/${companyId}/agents`),
    paperclip<IssueData[]>(`/companies/${companyId}/issues`),
    paperclip<GoalData[]>(`/companies/${companyId}/goals`).catch(() => []),
  ]);

  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  const activeIssues = issues
    .filter((i) => !["done", "cancelled"].includes(i.status))
    .slice(0, 30);
  const doneCount = issues.filter((i) => i.status === "done").length;

  const teamList = agents
    .map((a) => `- ${a.name} (${a.title}, ${a.status})`)
    .join("\n");

  const taskList = activeIssues
    .map((i) => `- ${i.identifier}: "${i.title}" [${i.status}${i.priority === "high" || i.priority === "critical" ? ", " + i.priority : ""}]${i.assigneeAgentId ? " → " + (agentMap.get(i.assigneeAgentId) || "unassigned") : ""}`)
    .join("\n");

  const goalList = goals
    .filter((g) => g.status === "active")
    .map((g) => `- ${g.title}`)
    .join("\n");

  return `You are the CEO of ${company.name}. The board member (human) is calling you for a quick chat. This is like a phone call — be fast, direct, and helpful.

ABOUT THE COMPANY:
${company.description || "No description set."}

YOUR TEAM (${agents.length} agents):
${teamList || "No agents hired yet."}

ACTIVE TASKS (${activeIssues.length} active, ${doneCount} done):
${taskList || "No active tasks."}

COMPANY GOALS:
${goalList || "No goals set."}

HOW TO BEHAVE IN THIS CHAT:
- This is a quick, real-time conversation. Keep answers SHORT (1-3 sentences).
- You know everything about the company — answer questions about tasks, team, progress, blockers.
- If the board member asks you to do something actionable, use the create_task tool to create a task.
- Be direct, confident, and helpful. No fluff.
- If you don't know something specific, say so — don't make things up.
- Reference specific task IDs (like AGE-5) and agent names when relevant.
- You can suggest next steps, flag risks, and give strategic advice.
- Never use markdown headers or bullet points — just talk naturally like you're on a call.`;
}

const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task/issue for the team. Use this when the board member asks you to do something actionable.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title" },
          description: { type: "string", description: "Detailed task description" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          assignee_name: { type: "string", description: "Name of the agent to assign to (from the team list)" },
        },
        required: ["title", "description", "priority"],
      },
    },
  },
];

export async function POST(request: NextRequest) {
  try {
    const { companyId, messages } = await request.json();
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    // Build context-rich system prompt
    const systemPrompt = await buildSystemPrompt(companyId);

    // Build OpenAI messages
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === "user") {
        openaiMessages.push({ role: "user", content: msg.text });
      } else if (msg.role === "ceo") {
        openaiMessages.push({ role: "assistant", content: msg.text });
      }
    }

    // If no messages yet, get an opening line
    if (openaiMessages.length === 1) {
      openaiMessages.push({ role: "user", content: "[The board member just picked up the phone. Greet them briefly and ask what's on their mind. If there are blockers or urgent items, mention them proactively.]" });
    }

    // Call OpenAI with tool use
    let response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 500,
      messages: openaiMessages,
      tools: TOOLS,
    });

    const actions: Array<{ type: string; title: string; identifier?: string }> = [];

    // Handle tool calls (create tasks)
    while (response.choices[0]?.finish_reason === "tool_calls" || response.choices[0]?.message?.tool_calls?.length) {
      const toolCalls = response.choices[0].message.tool_calls || [];
      openaiMessages.push(response.choices[0].message);

      // Fetch agents for assignee resolution
      const agents = await paperclip<AgentData[]>(`/companies/${companyId}/agents`);

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        if (tc.function.name === "create_task") {
          try {
            const args = JSON.parse(tc.function.arguments);
            // Resolve assignee
            let assigneeId: string | undefined;
            if (args.assignee_name) {
              const match = agents.find((a) =>
                a.name.toLowerCase() === args.assignee_name.toLowerCase() ||
                a.role.toLowerCase() === args.assignee_name.toLowerCase()
              );
              if (match) assigneeId = match.id;
            }
            // Default to CEO if no assignee
            if (!assigneeId) {
              const ceo = agents.find((a) => a.role === "ceo");
              if (ceo) assigneeId = ceo.id;
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
              tool_call_id: tc.id,
              content: JSON.stringify({ success: true, identifier: issue.identifier, title: args.title }),
            });
          } catch (e) {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ success: false, error: String(e) }),
            });
          }
        }
      }

      // Get the final response after tool execution
      response = await client.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 500,
        messages: openaiMessages,
        tools: TOOLS,
      });
    }

    const text = response.choices[0]?.message?.content || "";

    return NextResponse.json({ text, actions: actions.length > 0 ? actions : undefined });
  } catch (e: unknown) {
    console.error("CEO chat error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chat failed" },
      { status: 500 },
    );
  }
}

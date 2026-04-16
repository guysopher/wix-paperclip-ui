import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getCompanyBusinessDescription } from "@/lib/company-metadata";

const client = new OpenAI();

type RequestCompany = {
  name: string;
  description?: string | null;
};

type RequestAgent = {
  id: string;
  name: string;
  title: string;
  role: string;
};

type RequestIssue = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority?: string;
  updatedAt: string;
  assigneeAgentId?: string | null;
  assigneeId?: string | null;
};

type CeoRequestInput = {
  company?: RequestCompany | null;
  agents?: RequestAgent[];
  issues?: RequestIssue[];
};

type CeoRequestOutput = {
  requests: Array<{
    issueId: string;
    ask: string;
    quickReplies: string[];
  }>;
};

function stripMarkdown(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SYSTEM_PROMPT = `You rewrite internal AI-team blockers into very clear founder requests.

Return ONLY valid JSON with this exact shape:
{
  "requests": [
    {
      "issueId": "string",
      "ask": "one clear request sentence",
      "quickReplies": ["reply option 1", "reply option 2"]
    }
  ]
}

Rules:
- Each request must be easy for a founder to understand in under 5 seconds.
- The ask must be a single direct sentence that already includes the needed context.
- The ask must clearly say what the founder needs to decide, send, confirm, approve, or do.
- Prefer a question when the founder needs to choose or confirm something.
- Prefer a direct request when the founder needs to send or do something.
- Never use task IDs in the ask.
- Never mention internal workflow words like issue, inbox, board, heartbeat, run, blocker, or ticket.
- Prefer business language over technical language.
- Do not split the request into a title and explanation.
- The quick replies must read like natural answers to the exact ask.
- Quick replies must not be generic UI labels unless they are truly the best answer.
- Avoid "Done" unless the ask is literally about completing a manual action.
- Good quick replies are things like:
  - "Yes, launch in Hebrew"
  - "No, English only"
  - "Use the Instagram feed"
  - "Start with 8 products"
  - "Skip that for now"
- Keep each quick reply under 8 words.
- The two quick replies should usually represent the two most likely answers.
- Keep "ask" under 120 characters when possible.
- Output at most 3 requests.`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CeoRequestInput;
    const company = body.company;
    const issues = Array.isArray(body.issues) ? body.issues : [];
    const agents = Array.isArray(body.agents) ? body.agents : [];

    if (!company) {
      return NextResponse.json({ error: "Company is required" }, { status: 400 });
    }

    if (issues.length === 0) {
      return NextResponse.json({ requests: [] satisfies CeoRequestOutput["requests"] });
    }

    const businessDescription = getCompanyBusinessDescription(company.description);
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const issueLines = issues.map((issue) => {
      const assigneeId = issue.assigneeAgentId || issue.assigneeId || "";
      const assignee = assigneeId ? agentMap.get(assigneeId) : null;
      return [
        `issueId: ${issue.id}`,
        `title: ${issue.title}`,
        `status: ${issue.status}`,
        `priority: ${issue.priority || "unknown"}`,
        `owner: ${assignee?.title || assignee?.name || "Unassigned"}`,
        `updated: ${issue.updatedAt}`,
        `description: ${stripMarkdown(issue.description) || "No extra detail."}`,
      ].join("\n");
    });

    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Company: ${company.name}`,
            `Business: ${businessDescription || "Not captured yet."}`,
            "",
            "Requests to translate:",
            issueLines.join("\n\n---\n\n"),
          ].join("\n"),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<CeoRequestOutput>;

    const requests = Array.isArray(parsed.requests)
      ? parsed.requests
          .filter((item): item is CeoRequestOutput["requests"][number] =>
            !!item &&
            typeof item.issueId === "string" &&
            typeof item.ask === "string" &&
            Array.isArray(item.quickReplies),
          )
          .map((item) => ({
            issueId: item.issueId,
            ask: item.ask.trim(),
            quickReplies: item.quickReplies
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(0, 2),
          }))
          .slice(0, 3)
      : [];

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("ceo-requests route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate CEO requests" },
      { status: 500 },
    );
  }
}

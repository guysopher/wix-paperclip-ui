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
- Write every ask directly to the founder in natural second-person language.
- The ask must sound like the AI Team is asking the founder for something concrete right now.
- The ask must be a single direct sentence that already includes the needed context.
- The ask must clearly say what the founder needs to decide, send, confirm, approve, or do.
- Prefer a question when the founder needs to choose or confirm something.
- Prefer a direct request when the founder needs to send or do something.
- Never phrase the ask as an internal status update, a summary of what happened, or a statement about "the founder".
- Bad: "The founder approved the AI Team Lead proposal for Sweet Marley."
- Good: "Do you want us to start executing the approved Sweet Marley plan now?"
- Bad: "Turn the approved site proposal into the first real version of the business site for Sweet Marley."
- Good: "Should we turn the approved Sweet Marley site proposal into the first live version now?"
- Bad: "Review the founder's Instagram and current collection to define positioning, audience feel, messaging direction..."
- Good: "Please send the Instagram account and current collection you want us to use for Sweet Marley's positioning."
- Never use task IDs, issue identifiers, or internal reference codes in the ask.
- If the source contains task IDs or codes, translate them into plain language instead of copying them.
- Never mention internal workflow words like issue, inbox, board, heartbeat, run, blocker, or ticket.
- Prefer business language over technical language.
- Do not split the request into a title and explanation.
- Bad: "Use the already-completed launch prep in SWEA-45, SWEA-46, and SWEA-47."
- Good: "Review the prepared launch content and approve it for the storefront."
- Bad: "Apply SWEA-30 on the live site."
- Good: "Apply the prepared launch updates on the live site."
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

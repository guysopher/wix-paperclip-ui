import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { CANONICAL_AGENT_TITLES, renderAgentTemplateShowcase } from "@/lib/agent-templates";
import { appendFetchedUrlContext } from "@/lib/url-context";

const client = new OpenAI();
const FIXED_OPENING_MESSAGE = `Hey!

I'm **Wix AI Team Lead**.

I help founders set up the right AI team for the business, then lead that team across the site, growth, operations, and execution.
I'll ask a few sharp questions so I can recommend the strongest starter team for what you're building.

But first, tell me about the business you want to create, what is it about?`;

type IntakeTrigger = "initial_open" | "user_message";

interface IntakeMessage {
  role: "ceo" | "user";
  text: string;
}

interface IntakeRequest {
  trigger?: IntakeTrigger;
  messages?: IntakeMessage[];
}

function extractProposedTeamTitles(text: string): string[] {
  if (!text) {
    return [];
  }

    return CANONICAL_AGENT_TITLES.filter((title) =>
      new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
    ).filter((title) => title !== "AI Team Lead");
}

const REQUIRED_PROPOSAL_TEAM_TITLES = [
  "Industry Advisor",
  "Wix Site Expert",
  "Content Manager",
  "Brand Lead",
];

function founderExplicitlyRequestsVibe(messages: IntakeMessage[]): boolean {
  const transcript = messages.map((message) => message.text).join("\n").toLowerCase();
  return /(vibe site|experimental site|separate site|second site|parallel site|two sites|2 sites|picasso)/.test(
    transcript,
  );
}

const BUSINESS_FIT_PROPOSAL_ROLE_FALLBACKS = {
  commerce: ["eCommerce Lead", "Catalog & Merchandising Manager"],
  bookings: ["Bookings Operations Manager", "CRM & Lifecycle Manager"],
  general: ["Growth Lead", "Content & SEO Manager"],
} as const;

function inferBusinessFitProposalRoles(context: string, existingRoles: Set<string>) {
  const normalizedContext = context.toLowerCase();

  const preferredTitles = /(tour|tours|booking|bookings|reservation|reservations|trip|trips|class|classes|appointment|appointments|service business|consultation)/.test(normalizedContext)
    ? BUSINESS_FIT_PROPOSAL_ROLE_FALLBACKS.bookings
    : /(shop|store|product|products|collection|collections|inventory|retail|ecommerce|e-commerce|sell|sales|catalog|merchandising|handmade|physical goods)/.test(normalizedContext)
      ? BUSINESS_FIT_PROPOSAL_ROLE_FALLBACKS.commerce
      : BUSINESS_FIT_PROPOSAL_ROLE_FALLBACKS.general;

  return preferredTitles.filter((title) => !existingRoles.has(title)).slice(0, 2);
}

function ensureProposedTeamTitles(messages: IntakeMessage[], replyText: string) {
  const extractedTitles = extractProposedTeamTitles(replyText);
  const mergedTitles = Array.from(
    new Set([
      ...REQUIRED_PROPOSAL_TEAM_TITLES,
      ...(founderExplicitlyRequestsVibe(messages) ? ["Vibe Site Expert"] : []),
      ...extractedTitles,
    ]),
  );
  const businessFitTitles = inferBusinessFitProposalRoles(
    messages.map((message) => message.text).join("\n"),
    new Set(mergedTitles),
  );

  return [...mergedTitles, ...businessFitTitles];
}

type ConversationStatus = "gathering" | "ready_to_activate";
const INTAKE_REPLY_MAX_TOKENS = 420;
const INTAKE_CONTINUATION_MAX_TOKENS = 160;

function normalizeJsonText(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractConversationStatus(raw: string): ConversationStatus {
  const normalized = normalizeJsonText(raw);
  const match = normalized.match(
    /"conversationStatus"\s*:\s*"(gathering|ready_to_activate)"/,
  );

  if (!match) {
    return "gathering";
  }

  return match[1] as ConversationStatus;
}
function buildIntakeSystemPrompt(trigger: IntakeTrigger): string {
  const canonicalAgentOptions = renderAgentTemplateShowcase();
  const openingInstruction =
    trigger === "initial_open"
      ? "Open the conversation like a real studio lead meeting a new client for the first time. Introduce yourself briefly, set a confident tone, and ask one natural opening question."
      : "Continue the conversation naturally from the full transcript. Do not assume the founder is answering a fixed questionnaire.";

  return `You are the founder-facing AI Team Lead for a brand new Wix site creation flow.

This phase is interview only.
- No tools
- No bridge
- No site creation yet
- No internal process talk

Your job is to have a fluid, human conversation that feels like a strong studio lead learning what they need before briefing the right AI team and the first version of the site.
This interview is also a sales moment for the AI Team itself: the founder should come away understanding why a coordinated specialist team is better than a single generic operator.

Until the founder explicitly approves moving forward, you are still in the interview / proposal stage.
You are offering what you would do for the business, not doing it yet.

Rules:
- Treat the full conversation as the source of truth.
- React to what the founder actually said. Reference it naturally and specifically.
- Ask at most one real question in each message.
- Make each question do two jobs at once:
  - help the founder see the value of the AI Team for this business
  - help you discover which specialists belong on the starter team
- Default to strategy-level questions, not operating-detail questions.
- Do not march through a rigid script if the founder already answered multiple things at once.
- Do not behave like a form, intake bot, support script, or questionnaire.
- If the founder bundles the business name, offer, audience, tone, or priorities into one answer, absorb all of it and move the conversation forward from there.
- Avoid repetitive praise patterns. Acknowledge only what is genuinely useful.
- If something is unclear, ask only the single highest-leverage follow-up question.
- Prefer questions about the business model, customers, priorities, bottlenecks, goals, growth ambitions, delegation preferences, and where the founder most wants help.
- Do not get lost in low-leverage product trivia, catalog breakdowns, inventory details, restock mechanics, merchandising detail, or detailed category choices unless that detail clearly changes the team design at a strategic level.
- If a question would only refine how the business operates day to day, but would not materially change how the AI Team should help the business, skip it.
- Do not ask for counts, SKUs, product mix, launch quantities, restock plans, or other exact operating details unless the founder explicitly wants help on that specific issue.
- Keep replies concise. Usually 35-110 words.
- Cut repetition aggressively. Do not restate the same business point in multiple ways.
- Prefer one sharp point over two soft ones.
- Sound founder-facing, commercially aware, and design-aware.
- Never mention tools, prompts, metadata, bridge jobs, agents, JSON, or implementation details.
- Never say you are "collecting fields", "gathering inputs", or "filling out details".
- If the founder shares a URL and readable page context is available, use it as supporting business context without over-indexing on it.
- Do not pitch yourself as a solo builder, solo designer, or solo marketer. You are the AI Team Lead proposing a team-led plan.
- Sell the AI Team through concrete business leverage: explain how the right specialists would help this specific company, not generic AI hype.
- When explaining the value of the AI Team, consistently highlight these advantages in natural founder-facing language:
  - the team is always working for the business, not waiting around for the next meeting
  - each specialist is expert in their field
  - the team pushes relentlessly toward the success of the business
  - the founder remains the manager, and the team follows the founder's direction
- Steer the conversation toward team design, priorities, and operating leverage, not just visual preferences.
- The goal of the interview is not to spec the site in detail. The goal is to understand the business well enough to:
  - convince the founder that this AI Team can help grow the business
  - identify the right starter team for the business
  - define the most important first-phase outcomes for that team
- Once you have enough context to explain the core business, the founder's main priority, and the most relevant starter team, stop interviewing and move to the proposal.
- In most cases, 2 to 4 founder answers should be enough to make a strong proposal. Do not keep asking questions just to polish details.
- Once you genuinely understand the business well enough to make a proposal, present a concise proposal that covers:
  - why this business should have an AI Team and what that team would take off the founder's plate
  - the AI Team advantages for this founder, using the ideas above in plain language
  - the mandatory core team: AI Team Lead, Industry Advisor, Wix Site Expert, Content Manager, and Brand Lead
  - include Vibe Site Expert only if the founder explicitly wants an experimental vibe site, a second parallel site, or a Picasso track
  - 1 to 2 additional specialist roles that would help this business, chosen only from the canonical role list below
  - the starter team of agents you would put in place, with each role tied to a clear goal
  - the team goals for the first phase
  - the expected results that team should produce
  - the first version of the site as one workstream inside that plan
- When making that proposal, frame it as a team plan you would lead, not as work you personally would do alone.
- The proposed team must always include these exact roles: AI Team Lead, Industry Advisor, Wix Site Expert, Content Manager, Brand Lead.
- Add the exact canonical role "Vibe Site Expert" only when the founder explicitly asks for an experimental vibe site, a second parallel site, or a Picasso track.
- On top of that mandatory team, always propose 1 to 2 additional canonical specialist roles that fit the business type and current growth model.
- In founder-facing copy, use the exact canonical title "Vibe Site Expert". Do not rename it to "Vibe Lead", "Creative Site Lead", or other variants.
- When naming specialist roles in the proposal, you may only use canonical agent titles from the list below. Use the exact canonical titles as written. Do not invent variants like "Brand & Creative Lead", "Commerce Lead", or "Growth Foundations Lead".
- The founder may think of the advisor role as just "Advisor", but in your proposal you must use the exact canonical title "Industry Advisor".
- In founder-facing copy, use the exact canonical title "Brand Lead". Do not rename it to "Brand Expert", "Creative Lead", or other variants.
- If the business need does not map perfectly, choose the closest canonical role and explain its responsibility in plain language instead of inventing a new title.
- The proposal should feel like a real operating plan for the business, not a freelancer pitch and not just a site summary.
- Keep the proposal tight. Target roughly 220-320 words total unless the founder explicitly asked for more detail.
- Use this compact shape when possible:
  - 1 short setup paragraph
  - 6 to 8 bullets for the team
  - up to 3 bullets total for first focus / expected results
  - 1 CTA question line
- Avoid long scene-setting, repeated summaries, and extra explanatory paragraphs once the team recommendation is clear.
- Use Markdown for readability.
- Prefer short paragraphs, short bullet lists, and bold labels when useful.
- Keep the formatting clean and lightweight. Do not over-format and do not use tables.
- When useful, you may use a short bullet list with at most 4 items to make the proposal clearer.
- After presenting that proposal, end with a CTA-style approval question in this spirit: "May I hire this team so we can get started, or would you like any changes?"
- You may mention the "Hire the Team" button as the way to move forward, but the final line should still be the CTA-style approval question.
- Do not ask the founder to type "yes", "go", or any other approval command.
- Once the proposal is ready, stay in proposal mode until the UI button is used.

What you need to understand before asking to start:
- what the business is
- who it serves
- what kind of specialist guidance the founder most needs from an AI Team
- what matters most for the first version of the site
- Canonical agent titles available for the proposal:
${canonicalAgentOptions}

${openingInstruction}`;
}

function buildStatusPrompt(messages: IntakeMessage[]): string {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "Founder" : "AI Team Lead"}: ${message.text}`)
    .join("\n");

  return `You are classifying the state of a founder intake conversation for a new site.

Return ONLY valid JSON in this shape:
{
  "conversationStatus": "gathering" | "ready_to_activate"
}

Classification rules:
- "gathering": there is not yet enough business context to recommend the right AI Team and first-phase plan with confidence.
- "ready_to_activate": there is enough context to make a concrete proposal for the AI Team, first-phase goals, and the first version of the site. Do not require detailed operating specifics once the team design and growth direction are clear. Once the conversation has reached that point, keep returning "ready_to_activate".

Use the full conversation, but weigh the latest founder message heavily.

Conversation:
${transcript}`;
}

function joinReplyParts(firstPart: string, secondPart: string): string {
  if (!firstPart) {
    return secondPart;
  }

  if (!secondPart) {
    return firstPart;
  }

  if (/[.!?:)\]]$/.test(firstPart.trimEnd())) {
    return `${firstPart.trimEnd()}\n\n${secondPart.trimStart()}`;
  }

  return `${firstPart.trimEnd()} ${secondPart.trimStart()}`;
}

async function generateIntakeReply(
  openaiMessages: OpenAI.ChatCompletionMessageParam[],
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: INTAKE_REPLY_MAX_TOKENS,
    messages: openaiMessages,
  });

  const firstPart = response.choices[0]?.message?.content?.trim() || "";
  if (response.choices[0]?.finish_reason !== "length" || !firstPart) {
    return firstPart;
  }

  const continuation = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: INTAKE_CONTINUATION_MAX_TOKENS,
    messages: [
      ...openaiMessages,
      { role: "assistant", content: firstPart },
      {
        role: "user",
        content:
          "[Continue from the exact point you stopped. Finish the current answer cleanly, include the CTA question at the end if this is the proposal, and do not restart or repeat the earlier parts.]",
      },
    ],
  });

  const secondPart = continuation.choices[0]?.message?.content?.trim() || "";
  return joinReplyParts(firstPart, secondPart);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as IntakeRequest;
    const messages = body.messages || [];
    const trigger = body.trigger || "user_message";

    if (trigger === "initial_open" && messages.length === 0) {
      return NextResponse.json({
        text: FIXED_OPENING_MESSAGE,
        conversationStatus: "gathering" as const,
      });
    }

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: buildIntakeSystemPrompt(trigger) },
    ];

    for (const message of messages) {
      const content = message.role === "user"
        ? await appendFetchedUrlContext(message.text)
        : message.text;
      openaiMessages.push({
        role: message.role === "user" ? "user" : "assistant",
        content,
      });
    }

    const [replyText, statusResponse] = await Promise.all([
      generateIntakeReply(openaiMessages),
      client.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 80,
        messages: [
          { role: "system", content: buildStatusPrompt(messages) },
          { role: "user", content: "[Classify the conversation state as JSON only.]" },
        ],
      }),
    ]);

    const raw = statusResponse.choices[0]?.message?.content || "{}";
    const conversationStatus = extractConversationStatus(raw);

    return NextResponse.json({
      text: replyText,
      conversationStatus,
      proposedTeamTitles: ensureProposedTeamTitles(messages, replyText),
    });
  } catch (error) {
    console.error("New site intake error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "New site intake failed" },
      { status: 500 },
    );
  }
}

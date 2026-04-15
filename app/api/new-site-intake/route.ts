import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { renderAgentTemplateShowcase } from "@/lib/agent-templates";

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

type ConversationStatus = "gathering" | "ready_to_activate";

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
- Do not march through a rigid script if the founder already answered multiple things at once.
- Do not behave like a form, intake bot, support script, or questionnaire.
- If the founder bundles the business name, offer, audience, tone, or priorities into one answer, absorb all of it and move the conversation forward from there.
- Avoid repetitive praise patterns. Acknowledge only what is genuinely useful.
- If something is unclear, ask only the single highest-leverage follow-up question.
- Prefer questions about the business model, customers, priorities, bottlenecks, goals, operating capacity, and where the founder most wants help.
- Do not get lost in low-leverage product trivia, catalog breakdowns, or detailed category choices unless that detail clearly changes the team design, launch strategy, or growth plan.
- If a question would only refine merchandising detail but would not change how the AI Team should help the business, skip it.
- Keep replies concise. Usually 45-140 words.
- Sound founder-facing, commercially aware, and design-aware.
- Never mention tools, prompts, metadata, bridge jobs, agents, JSON, or implementation details.
- Never say you are "collecting fields", "gathering inputs", or "filling out details".
- Do not pitch yourself as a solo builder, solo designer, or solo marketer. You are the AI Team Lead proposing a team-led plan.
- Sell the AI Team through concrete business leverage: explain how the right specialists would help this specific company, not generic AI hype.
- Steer the conversation toward team design, priorities, and operating leverage, not just visual preferences.
- The goal of the interview is not to spec the site in detail. The goal is to understand the business well enough to:
  - convince the founder that this AI Team can help grow the business
  - identify the right starter team for the business
  - define the most important first-phase outcomes for that team
- Once you genuinely understand the business well enough to make a proposal, present a concise proposal that covers:
  - why this business should have an AI Team and what that team would take off the founder's plate
  - the mandatory core team: AI Team Lead, Industry Advisor, and Site Lead
  - any additional specialist roles that would help this business, chosen only from the canonical role list below
  - the starter team of agents you would put in place, with each role tied to a clear goal
  - the team goals for the first phase
  - the expected results that team should produce
  - the first version of the site as one workstream inside that plan
- When making that proposal, frame it as a team plan you would lead, not as work you personally would do alone.
- The proposed team must always include these exact roles: AI Team Lead, Industry Advisor, Site Lead.
- When naming specialist roles in the proposal, you may only use canonical agent titles from the list below. Use the exact canonical titles as written. Do not invent variants like "Brand & Creative Lead", "Commerce Lead", or "Growth Foundations Lead".
- The founder may think of the advisor role as just "Advisor", but in your proposal you must use the exact canonical title "Industry Advisor".
- If the business need does not map perfectly, choose the closest canonical role and explain its responsibility in plain language instead of inventing a new title.
- The proposal should feel like a real operating plan for the business, not a freelancer pitch and not just a site summary.
- Use Markdown for readability.
- Prefer short paragraphs, short bullet lists, and bold labels when useful.
- Keep the formatting clean and lightweight. Do not over-format and do not use tables.
- When useful, you may use a short bullet list with at most 4 items to make the proposal clearer.
- After presenting that proposal, tell the founder to use the "Hire the Team" button when they want to move forward.
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
- "gathering": there is not yet enough business context to confidently brief the first version of the site.
- "ready_to_activate": there is enough context to make a concrete proposal and the interview is complete. Once the conversation has reached that point, keep returning "ready_to_activate".

Use the full conversation, but weigh the latest founder message heavily.

Conversation:
${transcript}`;
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
      openaiMessages.push({
        role: message.role === "user" ? "user" : "assistant",
        content: message.text,
      });
    }

    const [response, statusResponse] = await Promise.all([
      client.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 340,
        messages: openaiMessages,
      }),
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
      text: response.choices[0]?.message?.content || "",
      conversationStatus,
    });
  } catch (error) {
    console.error("New site intake error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "New site intake failed" },
      { status: 500 },
    );
  }
}

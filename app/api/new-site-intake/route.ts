import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI();
const FIXED_OPENING_MESSAGE = `Hey!

I'm Wix AI Team Lead,
I can help you set up a new business and site with a team of agents I'll hire just for your business.
They can build and maintain your site, manage your business, SEO and more

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

Your job is to have a fluid, human conversation that feels like a strong studio lead learning what they need before briefing a first version of the site.

Until the founder explicitly approves moving forward, you are still in the interview / proposal stage.
You are offering what you would do for the business, not doing it yet.

Rules:
- Treat the full conversation as the source of truth.
- React to what the founder actually said. Reference it naturally and specifically.
- Ask at most one real question in each message.
- Do not march through a rigid script if the founder already answered multiple things at once.
- Do not behave like a form, intake bot, support script, or questionnaire.
- If the founder bundles the business name, offer, audience, tone, or priorities into one answer, absorb all of it and move the conversation forward from there.
- Avoid repetitive praise patterns. Acknowledge only what is genuinely useful.
- If something is unclear, ask only the single highest-leverage follow-up question.
- Keep replies concise. Usually 45-140 words.
- Sound founder-facing, commercially aware, and design-aware.
- Never mention tools, prompts, metadata, bridge jobs, agents, JSON, or implementation details.
- Never say you are "collecting fields", "gathering inputs", or "filling out details".
- Do not pitch yourself as a solo builder, solo designer, or solo marketer. You are the AI Team Lead proposing a team-led plan.
- Once you genuinely understand the business well enough to make a proposal, present a concise proposal that covers:
  - the starter team of agents you would put in place, with each role tied to a clear goal
  - the team goals for the first phase
  - the expected results that team should produce
  - the first version of the site as one workstream inside that plan
- When making that proposal, frame it as a team plan you would lead, not as work you personally would do alone.
- The proposal should feel like a real operating plan for the business, not a freelancer pitch and not just a site summary.
- When useful, you may use a short bullet list with at most 4 items to make the proposal clearer.
- After presenting that proposal, tell the founder to use the "Hire the Team" button when they want to move forward.
- Do not ask the founder to type "yes", "go", or any other approval command.
- Once the proposal is ready, stay in proposal mode until the UI button is used.

What you need to understand before asking to start:
- what the business is
- who it serves
- what matters most for the first version of the site

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

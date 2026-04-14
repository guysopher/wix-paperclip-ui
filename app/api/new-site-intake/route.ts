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

type ConversationStatus = "gathering" | "ready_to_activate" | "activate_now";

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

Rules:
- Treat the full conversation as the source of truth.
- React to what the founder actually said. Reference it naturally and specifically.
- Ask at most one real question in each message.
- Do not march through a rigid script if the founder already answered multiple things at once.
- Do not behave like a form, intake bot, support script, or questionnaire.
- If the founder bundles the business name, offer, audience, tone, or priorities into one answer, absorb all of it and move the conversation forward from there.
- Avoid repetitive praise patterns. Acknowledge only what is genuinely useful.
- If something is unclear, ask only the single highest-leverage follow-up question.
- Keep replies concise. Usually 45-110 words.
- Sound founder-facing, commercially aware, and design-aware.
- Never mention tools, prompts, metadata, bridge jobs, agents, JSON, or implementation details.
- Never say you are "collecting fields", "gathering inputs", or "filling out details".
- Once you genuinely understand the business well enough to start, briefly say what you understand and ask for explicit permission to start building the first version.
- If the founder already gave explicit permission to start building, say that you are starting now.

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
  "conversationStatus": "gathering" | "ready_to_activate" | "activate_now"
}

Classification rules:
- "gathering": there is not yet enough business context to confidently brief the first version of the site.
- "ready_to_activate": there is enough context to brief the first version, but the founder has not explicitly approved starting the build yet.
- "activate_now": there is enough context to start, and the founder has explicitly approved starting the build in context. This must be based on a clear approval such as "yes", "go ahead", "start", "build it", "let's do it", or equivalent in context of starting the site build. Do not use "activate_now" for a generic "yes" to some other question.

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
        max_completion_tokens: 260,
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
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as { conversationStatus?: ConversationStatus };
    const conversationStatus =
      parsed.conversationStatus === "ready_to_activate" || parsed.conversationStatus === "activate_now"
        ? parsed.conversationStatus
        : "gathering";

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

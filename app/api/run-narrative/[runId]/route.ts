import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { parseRunLog } from "@/lib/run-utils";

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const SOURCE_LABELS: Record<string, string> = {
  on_demand: "was manually triggered",
  scheduled: "ran on their scheduled check-in",
  mention: "was mentioned and woke up",
  assignment: "was assigned a new task",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const { searchParams } = request.nextUrl;
    const agentName = searchParams.get("agentName") || "The agent";
    const agentRole = searchParams.get("agentRole") || "";
    const status = searchParams.get("status") || "";
    const source = searchParams.get("source") || "";
    const errorMsg = searchParams.get("error") || "";
    const triggerDetail = searchParams.get("triggerDetail") || "";

    // Fetch the run log from paperclip
    let logText = "";
    try {
      const logRes = await fetch(`${PAPERCLIP_API}/heartbeat-runs/${runId}/log`, {
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        signal: AbortSignal.timeout(8000),
      });
      if (logRes.ok) {
        const logData = await logRes.json();
        logText =
          typeof logData === "string"
            ? logData
            : (logData.content ?? logData.log ?? logData.output ?? "");
      }
    } catch {
      // Log unavailable — will fall back to metadata only
    }

    // Parse and cap log entries to keep the prompt manageable
    const entries = logText ? parseRunLog(logText).slice(0, 25) : [];
    const logSummary = entries
      .map((e) => {
        if (e.kind === "assistant") return `Thought: ${e.text.slice(0, 400)}`;
        if (e.kind === "tools") return `Did: ${e.text}`;
        if (e.kind === "result") return `Result: ${e.text.slice(0, 200)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n");

    const isRunning = status === "running" || status === "queued";
    const outcomeLabel = isRunning
      ? "still running (in progress)"
      : status === "succeeded"
      ? "completed successfully"
      : status === "failed"
      ? `failed${errorMsg ? `: ${errorMsg.slice(0, 150)}` : ""}`
      : status === "timed_out"
      ? "timed out"
      : status === "cancelled"
      ? "was cancelled"
      : status;

    const prompt = `Summarize what this AI agent did in two parts. Return JSON only.

Agent: ${agentName}${agentRole ? ` (${agentRole})` : ""}
Outcome: ${outcomeLabel}${triggerDetail ? ` — context: ${triggerDetail.slice(0, 80)}` : ""}

${logSummary ? `What happened:\n${logSummary}` : "No log available."}

Return this exact JSON shape:
{
  "title": "<commit-message style, max 10 words, starts with verb, no period>",
  "description": "<2 sentences max, plain English, what was done and the result, no agent name>"
}

Title examples: "Reviewed 3 PRs and approved 2" / "Fixed broken login after OAuth config change" / "Failed to sync inventory — API timeout"
Description: specific, non-technical, past tense. If it failed, say why briefly.`;

    const client = new OpenAI();
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 120,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return NextResponse.json({
      title: (parsed.title as string)?.trim() ?? "",
      description: (parsed.description as string)?.trim() ?? "",
    });
  } catch (e) {
    console.error("Narrative generation failed:", e);
    return NextResponse.json({ narrative: "" });
  }
}

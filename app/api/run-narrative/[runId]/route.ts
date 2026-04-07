import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    // Fetch the run log
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
      // Log unavailable
    }

    // Look for the RUN_SUMMARY marker the agent writes at the end of every run
    if (logText) {
      const match = logText.match(/^RUN_SUMMARY:\s*(\{.*\})\s*$/m);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          return NextResponse.json({
            title: (parsed.title as string)?.trim() ?? "",
            description: (parsed.description as string)?.trim() ?? "",
            goalProgress: Array.isArray(parsed.goalProgress) ? parsed.goalProgress : [],
          });
        } catch {
          // Malformed JSON — fall through to empty
        }
      }
    }

    // No marker found (run predates this feature) — return empty
    return NextResponse.json({ title: "", description: "", goalProgress: [] });
  } catch (e) {
    console.error("Narrative fetch failed:", e);
    return NextResponse.json({ title: "", description: "" });
  }
}

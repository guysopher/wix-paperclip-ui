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
    const logRes = await fetch(`${PAPERCLIP_API}/heartbeat-runs/${runId}/log`, {
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
      signal: AbortSignal.timeout(8000),
    });

    if (!logRes.ok) {
      return NextResponse.json({ error: "Failed to fetch log", status: logRes.status });
    }

    const logData = await logRes.json();
    const logText = typeof logData === "string"
      ? logData
      : (logData.content ?? logData.log ?? logData.output ?? "");

    // Look for RUN_SUMMARY
    const match = logText.match(/^RUN_SUMMARY:\s*(\{.*\})\s*$/m);

    // Also try multiline JSON in case it's formatted
    const multilineMatch = logText.match(/RUN_SUMMARY:\s*(\{[\s\S]*?\})\s*(?=\n\n|\n[A-Z]|$)/);

    return NextResponse.json({
      runId,
      logLength: logText.length,
      hasRUNSUMMARY: !!match || !!multilineMatch,
      singleLineMatch: match ? match[1] : null,
      multilineMatch: multilineMatch ? multilineMatch[1] : null,
      last500chars: logText.slice(-500),
      containsGoalProgress: logText.includes("goalProgress"),
      containsRUNSUMMARY: logText.includes("RUN_SUMMARY"),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}

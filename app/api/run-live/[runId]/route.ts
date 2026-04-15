import { NextRequest, NextResponse } from "next/server";
import { parseRunLog } from "@/lib/run-utils";

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

function normalizeAssistantText(text: string): string {
  const cleaned = text
    .replace(/RUN_SUMMARY:\s*\{[\s\S]*$/m, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  return cleaned.length > 240 ? `${cleaned.slice(0, 237).trim()}...` : cleaned;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;

    const logRes = await fetch(`${PAPERCLIP_API}/heartbeat-runs/${runId}/log`, {
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
      signal: AbortSignal.timeout(8000),
    });

    if (!logRes.ok) {
      return NextResponse.json({ entries: [] });
    }

    const logData = await logRes.json();
    const raw =
      typeof logData === "string"
        ? logData
        : (logData.content ?? logData.log ?? logData.output ?? "");

    if (!raw) {
      return NextResponse.json({ entries: [] });
    }

    const entries = parseRunLog(raw)
      .filter((entry) => entry.kind !== "result")
      .map((entry, index) => {
        return {
          id: `${entry.timestamp || "entry"}-${index}`,
          kind: entry.kind,
          text: entry.kind === "assistant" ? normalizeAssistantText(entry.text) : entry.text.trim(),
          timestamp: entry.timestamp || "",
        };
      })
      .filter((entry) => entry.text)
      .slice(-12);

    return NextResponse.json({
      entries,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Live run feed failed:", error);
    return NextResponse.json({ entries: [] });
  }
}

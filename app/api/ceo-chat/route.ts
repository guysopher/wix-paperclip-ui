import { NextRequest, NextResponse } from "next/server";
import { runCeoChat } from "@/lib/ceo-chat";

export async function POST(request: NextRequest) {
  try {
    const { companyId, messages } = await request.json();
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    const result = await runCeoChat(companyId, messages || []);
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("AI Business Manager chat error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chat failed" },
      { status: 500 },
    );
  }
}

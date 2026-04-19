import { NextRequest, NextResponse } from "next/server";
import { repairCompanyState } from "@/lib/server/company-repair";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyId =
      typeof body?.companyId === "string" && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : null;
    const startup = body?.startup === true;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required." },
        { status: 400 },
      );
    }

    const result = await repairCompanyState(companyId, { startup });

    return NextResponse.json({
      ok: result.ok,
      ready: result.ready,
      companyId: result.companyId,
      companyName: result.companyName,
      startup: result.startup,
      approvalsApproved: result.approvalsApproved,
      staleTasksUpdated: result.staleTasksUpdated,
      promptSync: result.promptSync,
      instructionFilesSynced: result.instructionFilesSynced,
      timeoutDefaultsUpdated: result.timeoutDefaultsUpdated,
      heartbeatDefaultsUpdated: result.heartbeatDefaultsUpdated,
      binding: result.binding,
      notes: result.notes,
      checkedAt: result.checkedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to repair company state.",
      },
      { status: 500 },
    );
  }
}

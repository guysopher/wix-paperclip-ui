import { NextRequest, NextResponse } from "next/server";
import { repairCompanyState } from "@/lib/server/company-repair";
import { getResolvedPaperclipApiUrl } from "@/lib/server/deployment-topology";

const PAPERCLIP_API_URL = getResolvedPaperclipApiUrl();

interface PaperclipCompany {
  id: string;
}

async function paperclip<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...options?.headers,
    },
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        `Paperclip API request failed: ${res.status} ${res.statusText} for ${path}`,
    );
  }

  return payload as T;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId =
      typeof body?.companyId === "string" && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : null;

    const companyIds = requestedCompanyId
      ? [requestedCompanyId]
      : (await paperclip<PaperclipCompany[]>("/companies")).map((company) => company.id);

    const companyResults = await Promise.all(companyIds.map((companyId) => repairCompanyState(companyId)));

    const updatedCount = companyResults.reduce(
      (sum, result) =>
        sum +
        result.promptSync.updatedCount +
        result.instructionFilesSynced +
        result.approvalsApproved +
        result.staleTasksUpdated,
      0,
    );
    const skippedCount = companyResults.reduce((sum, result) => sum + result.promptSync.skippedCount, 0);
    const errorCount = companyResults.reduce((sum, result) => sum + result.promptSync.errorCount, 0);

    return NextResponse.json({
      ok: errorCount === 0,
      updatedCount,
      skippedCount,
      errorCount,
      results: companyResults.map((result) => ({
        companyId: result.companyId,
        companyName: result.companyName,
        targeted:
          result.promptSync.updatedCount +
          result.promptSync.skippedCount +
          result.promptSync.errorCount +
          result.instructionFilesSynced,
        updated: [
          ...(result.promptSync.updatedCount > 0
            ? [{ kind: "stored_prompts", count: result.promptSync.updatedCount }]
            : []),
          ...(result.instructionFilesSynced > 0
            ? [{ kind: "managed_instruction_files", count: result.instructionFilesSynced }]
            : []),
          ...(result.approvalsApproved > 0
            ? [{ kind: "approvals", count: result.approvalsApproved }]
            : []),
          ...(result.staleTasksUpdated > 0
            ? [{ kind: "stale_board_tasks", count: result.staleTasksUpdated }]
            : []),
        ],
        skipped: result.promptSync.skippedCount > 0 ? [{ kind: "agent_prompts", count: result.promptSync.skippedCount }] : [],
        errors:
          result.promptSync.errorCount > 0
            ? [{ kind: "agent_prompts", count: result.promptSync.errorCount, error: "One or more prompt repairs failed." }]
            : [],
        ready: result.ready,
        notes: result.notes,
        binding: result.binding,
      })),
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

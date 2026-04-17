import { NextRequest, NextResponse } from "next/server";
import { repairCompanyState } from "@/lib/server/company-repair";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyId =
      typeof body?.companyId === "string" && body.companyId.trim()
        ? body.companyId.trim()
        : "";

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const result = await repairCompanyState(companyId, {
      startup: Boolean(body?.startup),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to repair company state.",
      },
      { status: 500 },
    );
  }
}

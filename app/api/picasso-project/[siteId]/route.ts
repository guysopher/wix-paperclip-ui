import { NextRequest, NextResponse } from "next/server";
import { verifyPicassoProject } from "@/lib/server/picasso-project";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;

  if (!siteId) {
    return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
  }

  try {
    const verification = await verifyPicassoProject(siteId);
    return NextResponse.json(verification, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify Picasso project";
    const status = /ENOENT|Missing access token|Unexpected token/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

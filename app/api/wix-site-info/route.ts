import { NextRequest, NextResponse } from "next/server";

/**
 * Fetch Wix site properties using the Wix Headless API.
 * This is a lightweight proxy that avoids exposing auth tokens to the client.
 * For now, returns empty — the actual data comes from the wix-config and MCP tools.
 */
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
  }

  // Return basic info — live properties are fetched by agents via MCP
  return NextResponse.json({
    siteId,
    dashboardUrl: `https://manage.wix.com/dashboard/${siteId}`,
    editorUrl: `https://editor.wix.com/html/editor/web/renderer/edit/${siteId}`,
  });
}

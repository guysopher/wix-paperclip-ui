import { NextRequest } from "next/server";
import { handlePicassoMcpRequest } from "@/lib/picasso-mcp-tools";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      400,
    );
  }

  const response = await handlePicassoMcpRequest(payload);
  if (response === null) {
    return new Response(null, { status: 204 });
  }

  return jsonResponse(response);
}

export async function GET() {
  return jsonResponse(
    {
      ok: true,
      protocol: "jsonrpc",
      endpoint: "/api/picasso-mcp",
      methods: ["initialize", "tools/list", "tools/call"],
    },
    200,
  );
}

export async function DELETE() {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Method not allowed." },
    },
    405,
  );
}

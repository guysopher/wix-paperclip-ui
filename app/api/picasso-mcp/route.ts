import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPicassoMcpServer } from "@/lib/picasso-mcp-tools";

async function handleMcp(req: Request): Promise<Response> {
  const server = createPicassoMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(request: NextRequest) {
  return handleMcp(request);
}

export async function GET() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST for MCP requests." },
      id: null,
    }),
    { status: 405, headers: { "Content-Type": "application/json" } },
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    { status: 405, headers: { "Content-Type": "application/json" } },
  );
}

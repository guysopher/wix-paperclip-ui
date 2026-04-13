import { NextRequest, NextResponse } from "next/server";

const PICASSO_BRIDGE_URL =
  process.env.PICASSO_BRIDGE_URL ||
  "http://localhost:3401";

const PICASSO_BRIDGE_TOKEN = process.env.PICASSO_BRIDGE_TOKEN || "";
const UPSTREAM_TIMEOUT_MS = 10000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function usesLocalhostUpstream(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

function assertPicassoBridgeConfiguration() {
  if (!PICASSO_BRIDGE_TOKEN) {
    return jsonError("PICASSO_BRIDGE_TOKEN is not configured", 500);
  }

  if (process.env.VERCEL && (!process.env.PICASSO_BRIDGE_URL || usesLocalhostUpstream(PICASSO_BRIDGE_URL))) {
    return jsonError(
      "PICASSO_BRIDGE_URL is not configured with a deployment-reachable Picasso bridge.",
      500,
    );
  }

  return null;
}

async function proxyResponse(res: Response) {
  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${PICASSO_BRIDGE_TOKEN}`,
    ...extra,
  };
}

async function forward(
  method: "GET" | "POST",
  request: NextRequest,
  path: string[],
) {
  const configurationError = assertPicassoBridgeConfiguration();
  if (configurationError) {
    return configurationError;
  }

  const url = `${PICASSO_BRIDGE_URL.replace(/\/$/, "")}/${path.join("/")}${request.nextUrl.search}`;
  try {
    const body = method === "POST" ? await request.text() : undefined;
    return proxyResponse(
      await fetch(url, {
        method,
        headers: buildHeaders(),
        body: body || undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }),
    );
  } catch {
    return jsonError(`Failed to reach Picasso bridge: ${url}`, 502);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward("GET", request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward("POST", request, path);
}

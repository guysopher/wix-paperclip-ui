import { NextRequest, NextResponse } from "next/server";
import { getDeploymentTopology, getSiteAutomationLabel } from "@/lib/server/deployment-topology";

const TOPOLOGY = getDeploymentTopology();
const SITE_AUTOMATION_URL = TOPOLOGY.siteAutomationBaseUrl;
const SITE_AUTOMATION_TOKEN = TOPOLOGY.siteAutomationToken;
const UPSTREAM_TIMEOUT_MS = 10000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function assertPicassoBridgeConfiguration() {
  if (!TOPOLOGY.siteAutomationUpstreamConfigured) {
    return jsonError(
      TOPOLOGY.siteAutomationMode === "embedded"
        ? "Embedded site automation is not configured. Set SITE_AUTOMATION_EMBEDDED_URL or use SITE_AUTOMATION_MODE=bridge."
        : "PICASSO_BRIDGE_URL is not configured. Set it or use SITE_AUTOMATION_MODE=embedded with a supported backend.",
      501,
    );
  }

  if (TOPOLOGY.siteAutomationTokenRequired && !SITE_AUTOMATION_TOKEN) {
    return jsonError("PICASSO_BRIDGE_TOKEN is not configured", 500);
  }

  if (process.env.VERCEL && TOPOLOGY.usesLocalSiteAutomationUpstream) {
    return jsonError(
      `${getSiteAutomationLabel(TOPOLOGY)} is not configured with a deployment-reachable upstream.`,
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
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  if (SITE_AUTOMATION_TOKEN) {
    headers.set("Authorization", `Bearer ${SITE_AUTOMATION_TOKEN}`);
  }
  return headers;
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

  const url = `${SITE_AUTOMATION_URL.replace(/\/$/, "")}/${path.join("/")}${request.nextUrl.search}`;
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
    return jsonError(`Failed to reach ${getSiteAutomationLabel(TOPOLOGY)}: ${url}`, 502);
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

import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";
const UPSTREAM_TIMEOUT_MS = 10000;

const PROXY_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function usesLocalhostUpstream(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

function isPaperclipUpstreamConfigured() {
  return Boolean(process.env.PAPERCLIP_API_URL || process.env.NEXT_PUBLIC_PAPERCLIP_API_URL);
}

function assertPaperclipUpstream() {
  if (process.env.VERCEL && (!isPaperclipUpstreamConfigured() || usesLocalhostUpstream(PAPERCLIP_API_URL))) {
    return jsonError(
      "PAPERCLIP_API_URL is not configured with a deployment-reachable Paperclip backend.",
      500,
    );
  }

  return null;
}

async function proxyResponse(res: Response) {
  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}${request.nextUrl.search}`;
  const configurationError = assertPaperclipUpstream();
  if (configurationError) {
    return configurationError;
  }

  try {
    return proxyResponse(await fetch(url, { headers: PROXY_HEADERS, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }));
  } catch (e) {
    return jsonError(`Paperclip upstream unreachable or timed out: ${url}`, 502);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  const configurationError = assertPaperclipUpstream();
  if (configurationError) {
    return configurationError;
  }

  try {
    const body = await request.text();
    return proxyResponse(
      await fetch(url, {
        method: "POST",
        headers: PROXY_HEADERS,
        body: body || undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }),
    );
  } catch (e) {
    return jsonError(`Paperclip upstream unreachable or timed out: ${url}`, 502);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  const configurationError = assertPaperclipUpstream();
  if (configurationError) {
    return configurationError;
  }

  try {
    const body = await request.text();
    return proxyResponse(
      await fetch(url, {
        method: "PATCH",
        headers: PROXY_HEADERS,
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }),
    );
  } catch (e) {
    return jsonError(`Paperclip upstream unreachable or timed out: ${url}`, 502);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  const configurationError = assertPaperclipUpstream();
  if (configurationError) {
    return configurationError;
  }

  try {
    return proxyResponse(
      await fetch(url, {
        method: "DELETE",
        headers: PROXY_HEADERS,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }),
    );
  } catch (e) {
    return jsonError(`Paperclip upstream unreachable or timed out: ${url}`, 502);
  }
}

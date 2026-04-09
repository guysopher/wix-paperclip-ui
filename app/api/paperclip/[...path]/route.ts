import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const PROXY_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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
  try {
    return proxyResponse(await fetch(url, { headers: PROXY_HEADERS }));
  } catch (e) {
    return jsonError(`Upstream unreachable: ${url}`, 502);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  try {
    const body = await request.text();
    return proxyResponse(await fetch(url, { method: "POST", headers: PROXY_HEADERS, body: body || undefined }));
  } catch (e) {
    return jsonError(`Upstream unreachable: ${url}`, 502);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  try {
    const body = await request.text();
    return proxyResponse(await fetch(url, { method: "PATCH", headers: PROXY_HEADERS, body }));
  } catch (e) {
    return jsonError(`Upstream unreachable: ${url}`, 502);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = `${PAPERCLIP_API_URL}/${path.join("/")}`;
  try {
    return proxyResponse(await fetch(url, { method: "DELETE", headers: PROXY_HEADERS }));
  } catch (e) {
    return jsonError(`Upstream unreachable: ${url}`, 502);
  }
}

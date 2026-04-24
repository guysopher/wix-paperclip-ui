import { NextResponse } from "next/server";
import { getDeploymentTopology } from "@/lib/server/deployment-topology";

const PAPERCLIP_RESTART_URL = getDeploymentTopology().paperclipRestartUrl;
const PAPERCLIP_RESTART_TOKEN = process.env.PAPERCLIP_RESTART_TOKEN;
const RESTART_TIMEOUT_MS = 15000;

export async function POST() {
  if (!PAPERCLIP_RESTART_URL) {
    return NextResponse.json(
      {
        error:
          "PAPERCLIP_RESTART_URL is not configured. Point it at a private restart hook for the Paperclip server.",
      },
      { status: 501 },
    );
  }

  try {
    const response = await fetch(PAPERCLIP_RESTART_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PAPERCLIP_RESTART_TOKEN
          ? { Authorization: `Bearer ${PAPERCLIP_RESTART_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        requestedBy: "wix-paperclip-ui",
        requestedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(RESTART_TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            (payload && typeof payload.error === "string" && payload.error) ||
            `Restart hook failed: ${response.status} ${response.statusText}`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        (payload && typeof payload.message === "string" && payload.message) ||
        "Restart request sent to the Paperclip restart hook.",
      upstream: payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to reach restart hook: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 502 },
    );
  }
}

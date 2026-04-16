import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REPAIR_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

interface PaperclipCompany {
  id: string;
  name: string;
}

interface PaperclipAgent {
  id: string;
  name: string;
  status: string;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
}

interface PaperclipRun {
  id: string;
  status: string;
  error: string | null;
}

interface AdapterEnvironmentCheck {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

interface AdapterEnvironmentResult {
  status: "pass" | "warn" | "fail";
  checks?: AdapterEnvironmentCheck[];
}

async function paperclip(path: string, options?: RequestInit) {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...options?.headers,
    },
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        `Paperclip API request failed: ${res.status} ${res.statusText} for ${path}`,
    );
  }

  return payload;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findCodexHealthCheck(result: AdapterEnvironmentResult): AdapterEnvironmentCheck | null {
  const checks = result.checks || [];
  return (
    checks.find((check) => check.code === "codex_hello_probe_passed") ||
    checks.find((check) => check.code === "codex_hello_probe_auth_required") ||
    checks.find((check) => check.code === "codex_hello_probe_failed") ||
    checks.find((check) => check.code === "codex_command_unresolvable") ||
    null
  );
}

export async function POST(request: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured in the UI server environment." },
      { status: 501 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedCompanyId =
    typeof body?.companyId === "string" && body.companyId.trim().length > 0
      ? body.companyId.trim()
      : null;

  let helperAgentId: string | null = null;

  try {
    const companies = (await paperclip("/companies")) as PaperclipCompany[];
    if (!companies.length) {
      return NextResponse.json({ error: "No companies found." }, { status: 404 });
    }

    const targetCompany =
      (requestedCompanyId
        ? companies.find((company) => company.id === requestedCompanyId)
        : companies[0]) || companies[0];

    const agents = (await paperclip(`/companies/${targetCompany.id}/agents`)) as PaperclipAgent[];
    const codexProbeAgent =
      agents.find((agent) => agent.status !== "paused" && agent.adapterType === "codex_local") ||
      null;

    if (!codexProbeAgent) {
      return NextResponse.json(
        { error: "No codex_local agent found to verify after repair." },
        { status: 400 },
      );
    }

    const codexProbeCwd =
      typeof codexProbeAgent.adapterConfig?.cwd === "string" &&
      codexProbeAgent.adapterConfig.cwd.trim().length > 0
        ? codexProbeAgent.adapterConfig.cwd.trim()
        : process.cwd();

    const helperAgent = (await paperclip(`/companies/${targetCompany.id}/agents`, {
      method: "POST",
      body: JSON.stringify({
        name: "Codex API Key Repair",
        role: "general",
        title: "Codex API Key Repair",
        capabilities: "Repairs host-level Codex API key authentication for Paperclip agents",
        adapterType: "process",
        adapterConfig: {
          command: "sh",
          args: [
            "-lc",
            'set -e; mkdir -p "$HOME/.codex"; codex logout >/dev/null 2>&1 || true; printenv OPENAI_API_KEY | codex login --with-api-key',
          ],
          cwd: codexProbeCwd,
          env: {
            OPENAI_API_KEY,
          },
          timeoutSec: 120,
        },
      }),
    })) as PaperclipAgent;

    helperAgentId = helperAgent.id;

    await paperclip(`/agents/${helperAgentId}/heartbeat/invoke`, { method: "POST" });

    const deadline = Date.now() + REPAIR_TIMEOUT_MS;
    let helperRun: PaperclipRun | null = null;

    while (Date.now() < deadline) {
      const runs = (await paperclip(
        `/companies/${targetCompany.id}/heartbeat-runs?agentId=${encodeURIComponent(helperAgentId)}`,
      )) as PaperclipRun[];
      helperRun = runs[0] || helperRun;
      if (helperRun && ["succeeded", "failed", "canceled"].includes(helperRun.status)) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!helperRun) {
      throw new Error("Timed out waiting for the Codex repair job to start.");
    }

    if (helperRun.status !== "succeeded") {
      throw new Error(helperRun.error || `Codex repair job ended with status ${helperRun.status}.`);
    }

    const verification = (await paperclip(
      `/companies/${targetCompany.id}/adapters/${encodeURIComponent(codexProbeAgent.adapterType || "codex_local")}/test-environment`,
      {
        method: "POST",
        body: JSON.stringify({
          adapterConfig: codexProbeAgent.adapterConfig || {},
        }),
      },
    )) as AdapterEnvironmentResult;

    const codexCheck = findCodexHealthCheck(verification);
    const passed = codexCheck?.code === "codex_hello_probe_passed";

    return NextResponse.json({
      ok: passed,
      companyId: targetCompany.id,
      message: passed
        ? "Codex host authentication was repaired successfully."
        : codexCheck?.detail || codexCheck?.message || "Codex auth repair completed, but verification is inconclusive.",
      verification,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to repair Codex auth.",
      },
      { status: 500 },
    );
  } finally {
    if (helperAgentId) {
      await paperclip(`/agents/${helperAgentId}`, { method: "DELETE" }).catch(() => null);
    }
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getHeartbeatPolicy } from "@/lib/agent-heartbeat";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const STALE_RUN_THRESHOLD_MS = 15 * 60 * 1000;
const SCHEDULER_LOOKBACK_MS = 30 * 60 * 1000;
const OVERDUE_GRACE_MS = 5 * 60 * 1000;

type CheckStatus = "ok" | "warning" | "repaired" | "error";
type OverallStatus = "healthy" | "warning" | "repaired" | "error";

interface HealthCheckEntry {
  name: string;
  status: CheckStatus;
  detail?: string;
}

interface HealthResponseBody {
  status: OverallStatus;
  companyId: string | null;
  checkedAt: string;
  checks: HealthCheckEntry[];
  actions: string[];
  controls: {
    restartAvailable: boolean;
    codexRepairAvailable?: boolean;
  };
}

interface PaperclipCompany {
  id: string;
  name: string;
}

interface PaperclipRun {
  id: string;
  agentId: string;
  status: string;
  startedAt: string | null;
  createdAt: string;
}

interface PaperclipAgent {
  id: string;
  name: string;
  status: string;
  lastHeartbeatAt: string | null;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
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

  if (!res.ok) {
    throw new Error(`Paperclip API request failed: ${res.status} ${res.statusText} for ${path}`);
  }

  return res.json();
}

function restartAvailable() {
  return Boolean(process.env.PAPERCLIP_RESTART_URL);
}

function deriveOverallStatus(checks: HealthCheckEntry[]): OverallStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  if (checks.some((check) => check.status === "repaired")) {
    return "repaired";
  }
  return "healthy";
}

function formatOverdueAgents(overdueAgents: PaperclipAgent[]) {
  return overdueAgents
    .slice(0, 4)
    .map((agent) => agent.name)
    .join(", ");
}

function mapAdapterCheckStatus(level: AdapterEnvironmentCheck["level"]): CheckStatus {
  if (level === "error") {
    return "error";
  }
  if (level === "warn") {
    return "warning";
  }
  return "ok";
}

function findCodexHealthCheck(result: AdapterEnvironmentResult): AdapterEnvironmentCheck | null {
  const checks = result.checks || [];
  return (
    checks.find((check) => check.code === "codex_hello_probe_passed") ||
    checks.find((check) => check.code === "codex_hello_probe_auth_required") ||
    checks.find((check) => check.code === "codex_hello_probe_failed") ||
    checks.find((check) => check.code === "codex_command_unresolvable") ||
    checks.find((check) => check.code === "codex_openai_api_key_missing") ||
    null
  );
}

export async function POST(request: NextRequest) {
  const actions: string[] = [];
  const checks: HealthCheckEntry[] = [];
  let targetCompanyId: string | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId =
      typeof body?.companyId === "string" && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : null;

    const companies = (await paperclip("/companies")) as PaperclipCompany[];
    if (!companies?.length) {
      const response: HealthResponseBody = {
        status: "error",
        companyId: null,
        checkedAt: new Date().toISOString(),
        checks: [{ name: "api", status: "error", detail: "No companies found" }],
        actions,
        controls: {
          restartAvailable: restartAvailable(),
          codexRepairAvailable: Boolean(process.env.OPENAI_API_KEY),
        },
      };
      return NextResponse.json(response);
    }

    checks.push({ name: "api", status: "ok", detail: "Paperclip API reachable" });

    const targetCompany =
      (requestedCompanyId
        ? companies.find((company) => company.id === requestedCompanyId)
        : companies[0]) || companies[0];

    targetCompanyId = targetCompany.id;
    checks.push({
      name: "company",
      status: "ok",
      detail: `Checking ${targetCompany.name} (${targetCompany.id})`,
    });

    const [runs, agents] = await Promise.all([
      paperclip(`/companies/${targetCompany.id}/heartbeat-runs`) as Promise<PaperclipRun[]>,
      paperclip(`/companies/${targetCompany.id}/agents`) as Promise<PaperclipAgent[]>,
    ]);

    const now = Date.now();

    const staleRuns = (runs || []).filter(
      (run) =>
        run.status === "running" &&
        run.startedAt &&
        now - new Date(run.startedAt).getTime() > STALE_RUN_THRESHOLD_MS,
    );

    if (staleRuns.length > 0) {
      const cancelResults = await Promise.allSettled(
        staleRuns.map((run) => paperclip(`/heartbeat-runs/${run.id}/cancel`, { method: "POST" })),
      );
      const cancelled = cancelResults.filter((result) => result.status === "fulfilled").length;
      const staleStatus: CheckStatus = cancelled > 0 ? "repaired" : "error";

      checks.push({
        name: "stale_runs",
        status: staleStatus,
        detail: `Cancelled ${cancelled} of ${staleRuns.length} stale runs`,
      });
      if (cancelled > 0) {
        actions.push(`Cancelled ${cancelled} stale run${cancelled === 1 ? "" : "s"}`);
      }
    } else {
      checks.push({ name: "stale_runs", status: "ok", detail: "No stale runs found" });
    }

    const errorAgents = (agents || []).filter((agent) => agent.status === "error");
    if (errorAgents.length > 0) {
      checks.push({
        name: "agents",
        status: "warning",
        detail: `${errorAgents.length} agent(s) need attention: ${errorAgents
          .slice(0, 4)
          .map((agent) => agent.name)
          .join(", ")}`,
      });
    } else {
      checks.push({
        name: "agents",
        status: "ok",
        detail: `${agents.length} agent${agents.length === 1 ? "" : "s"} healthy`,
      });
    }

    const recentRuns = (runs || []).filter(
      (run) => now - new Date(run.createdAt).getTime() < SCHEDULER_LOOKBACK_MS,
    );
    const scheduledAgents = (agents || []).filter(
      (agent) => agent.status !== "paused" && getHeartbeatPolicy(agent).intervalSec > 0,
    );
    const overdueAgents = scheduledAgents.filter((agent) => {
      const intervalMs = getHeartbeatPolicy(agent).intervalSec * 1000;
      if (!intervalMs) {
        return false;
      }

      if (!agent.lastHeartbeatAt) {
        return true;
      }

      return now - new Date(agent.lastHeartbeatAt).getTime() > intervalMs + OVERDUE_GRACE_MS;
    });

    if (scheduledAgents.length === 0) {
      checks.push({
        name: "scheduler",
        status: "ok",
        detail: "No scheduled agents configured",
      });
    } else if (recentRuns.length === 0) {
      checks.push({
        name: "scheduler",
        status: "warning",
        detail: `No runs in the last 30 minutes despite ${scheduledAgents.length} active agents with schedules`,
      });
    } else if (overdueAgents.length > 0) {
      checks.push({
        name: "scheduler",
        status: "warning",
        detail: `${overdueAgents.length} scheduled agent(s) appear overdue: ${formatOverdueAgents(overdueAgents)}`,
      });
    } else {
      checks.push({
        name: "scheduler",
        status: "ok",
        detail: `${recentRuns.length} run${recentRuns.length === 1 ? "" : "s"} in the last 30 minutes`,
      });
    }

    const codexProbeAgent =
      (agents || []).find((agent) => agent.status !== "paused" && agent.adapterType === "codex_local") ||
      null;

    if (codexProbeAgent) {
      try {
        const adapterHealth = (await paperclip(
          `/companies/${targetCompany.id}/adapters/${encodeURIComponent(codexProbeAgent.adapterType || "codex_local")}/test-environment`,
          {
            method: "POST",
            body: JSON.stringify({
              adapterConfig: codexProbeAgent.adapterConfig || {},
            }),
          },
        )) as AdapterEnvironmentResult;

        const codexCheck = findCodexHealthCheck(adapterHealth);
        checks.push({
          name: "runtime_auth",
          status: codexCheck ? mapAdapterCheckStatus(codexCheck.level) : adapterHealth.status === "pass" ? "ok" : "warning",
          detail: codexCheck
            ? `${codexProbeAgent.name}: ${codexCheck.detail || codexCheck.message}`
            : `${codexProbeAgent.name}: Codex runtime auth looks healthy`,
        });
      } catch (error) {
        checks.push({
          name: "runtime_auth",
          status: "warning",
          detail:
            error instanceof Error
              ? `Could not verify Codex auth: ${error.message}`
              : "Could not verify Codex auth",
        });
      }
    } else {
      checks.push({
        name: "runtime_auth",
        status: "ok",
        detail: "No Codex agents to probe",
      });
    }

    const lastRun = [...(runs || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    checks.push({
      name: "activity",
      status: lastRun ? "ok" : "warning",
      detail: lastRun
        ? `Latest run created ${new Date(lastRun.createdAt).toLocaleString()}`
        : "No runs recorded yet for this company",
    });

    const response: HealthResponseBody = {
      status: deriveOverallStatus(checks),
      companyId: targetCompanyId,
      checkedAt: new Date().toISOString(),
      checks,
      actions,
      controls: {
        restartAvailable: restartAvailable(),
        codexRepairAvailable: Boolean(process.env.OPENAI_API_KEY),
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    const response: HealthResponseBody = {
      status: "error",
      companyId: targetCompanyId,
      checkedAt: new Date().toISOString(),
      checks: [
        ...checks,
        {
          name: "api",
          status: "error",
          detail: `Cannot reach Paperclip API: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ],
      actions,
      controls: {
        restartAvailable: restartAvailable(),
        codexRepairAvailable: Boolean(process.env.OPENAI_API_KEY),
      },
    };

    return NextResponse.json(response);
  }
}

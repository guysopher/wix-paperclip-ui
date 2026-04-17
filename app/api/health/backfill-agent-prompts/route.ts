import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";
const BACKFILL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

interface PaperclipCompany {
  id: string;
  name: string;
}

interface PaperclipAgent {
  id: string;
  name: string;
  companyId: string;
  adapterConfig?: Record<string, unknown>;
}

interface PaperclipRun {
  id: string;
  status: string;
  error: string | null;
}

interface BackfillTarget {
  id: string;
  path: string;
}

interface BackfillSummary {
  companyId: string;
  companyName: string;
  targeted: number;
  updated: Array<{ id: string; name: string; length: number }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  errors: Array<{ id: string; name?: string; error: string }>;
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

async function getRunOutput(runId: string) {
  const payload = await paperclip(`/heartbeat-runs/${runId}/log`).catch(() => null);
  if (typeof payload === "string") {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.log === "string") return record.log;
    if (typeof record.output === "string") return record.output;
  }
  return "";
}

function buildBackfillScript() {
  return `node <<'NODE'
const fs = require('fs');

async function request(apiBase, path, options = {}) {
  const res = await fetch(apiBase + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...(options.headers || {}),
    },
  });
  const text = await res.text().catch(() => '');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error((payload && payload.error) || text || res.statusText);
  }
  return payload;
}

(async () => {
  const apiBase = process.env.LOCAL_PAPERCLIP_API_URL || 'http://127.0.0.1:3100/api';
  const companyId = process.env.TARGET_COMPANY_ID || '';
  const targets = JSON.parse(process.env.TARGETS_JSON || '[]');
  const agents = await request(apiBase, '/companies/' + companyId + '/agents');
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const result = { updated: [], skipped: [], errors: [] };

  for (const target of targets) {
    const agent = byId.get(target.id);
    if (!agent) {
      result.errors.push({ id: target.id, error: 'Agent not found' });
      continue;
    }

    const existingPrompt =
      typeof agent.adapterConfig?.promptTemplate === 'string'
        ? agent.adapterConfig.promptTemplate.trim()
        : '';
    if (existingPrompt) {
      result.skipped.push({ id: agent.id, name: agent.name, reason: 'promptTemplate already present' });
      continue;
    }

    let content = '';
    try {
      content = fs.readFileSync(target.path, 'utf8').trim();
    } catch (error) {
      result.errors.push({
        id: agent.id,
        name: agent.name,
        error: 'Failed to read instructions file: ' + (error && error.message ? error.message : String(error)),
      });
      continue;
    }

    if (!content) {
      result.skipped.push({ id: agent.id, name: agent.name, reason: 'instructions file empty' });
      continue;
    }

    try {
      await request(apiBase, '/agents/' + agent.id, {
        method: 'PATCH',
        body: JSON.stringify({
          adapterConfig: {
            ...(agent.adapterConfig || {}),
            promptTemplate: content,
          },
        }),
      });
      result.updated.push({ id: agent.id, name: agent.name, length: content.length });
    } catch (error) {
      result.errors.push({
        id: agent.id,
        name: agent.name,
        error: 'Failed to patch agent: ' + (error && error.message ? error.message : String(error)),
      });
    }
  }

  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE`;
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    const match = value.match(/\{[\s\S]*\}$/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

async function runCompanyBackfill(company: PaperclipCompany, targets: BackfillTarget[]) {
  let helperAgentId: string | null = null;

  try {
    const helperAgent = (await paperclip(`/companies/${company.id}/agents`, {
      method: "POST",
      body: JSON.stringify({
        name: "Agent Prompt Backfill",
        role: "general",
        title: "Agent Prompt Backfill",
        capabilities: "Backfills managed agent instructions into adapterConfig.promptTemplate",
        adapterType: "process",
        adapterConfig: {
          command: "sh",
          args: ["-lc", buildBackfillScript()],
          cwd: "/tmp",
          env: {
            TARGET_COMPANY_ID: company.id,
            TARGETS_JSON: JSON.stringify(targets),
            LOCAL_PAPERCLIP_API_URL: "http://127.0.0.1:3100/api",
          },
          timeoutSec: 120,
        },
      }),
    })) as PaperclipAgent;

    helperAgentId = helperAgent.id;
    await paperclip(`/agents/${helperAgentId}/heartbeat/invoke`, { method: "POST" });

    const deadline = Date.now() + BACKFILL_TIMEOUT_MS;
    let helperRun: PaperclipRun | null = null;

    while (Date.now() < deadline) {
      const runs = (await paperclip(
        `/companies/${company.id}/heartbeat-runs?agentId=${encodeURIComponent(helperAgentId)}`,
      )) as PaperclipRun[];
      helperRun = runs[0] || helperRun;
      if (helperRun && ["succeeded", "failed", "canceled", "timed_out"].includes(helperRun.status)) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!helperRun) {
      throw new Error("Timed out waiting for the backfill helper run to start.");
    }

    if (helperRun.status !== "succeeded") {
      throw new Error(helperRun.error || `Backfill helper ended with status ${helperRun.status}.`);
    }

    const output = await getRunOutput(helperRun.id);
    const parsed = tryParseJson<Omit<BackfillSummary, "companyId" | "companyName" | "targeted">>(output);
    if (!parsed) {
      throw new Error("Backfill helper completed, but no JSON summary was returned.");
    }

    return {
      companyId: company.id,
      companyName: company.name,
      targeted: targets.length,
      updated: parsed.updated || [],
      skipped: parsed.skipped || [],
      errors: parsed.errors || [],
    } satisfies BackfillSummary;
  } finally {
    if (helperAgentId) {
      await paperclip(`/agents/${helperAgentId}`, { method: "DELETE" }).catch(() => null);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId =
      typeof body?.companyId === "string" && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : null;
    const requestedAgentId =
      typeof body?.agentId === "string" && body.agentId.trim().length > 0
        ? body.agentId.trim()
        : null;

    const companies = (await paperclip("/companies")) as PaperclipCompany[];
    const targetCompanies = requestedCompanyId
      ? companies.filter((company) => company.id === requestedCompanyId)
      : companies;

    const results: BackfillSummary[] = [];

    for (const company of targetCompanies) {
      const agents = (await paperclip(`/companies/${company.id}/agents`)) as PaperclipAgent[];
      const targets = agents
        .filter((agent) => !requestedAgentId || agent.id === requestedAgentId)
        .map((agent) => {
          const promptTemplate =
            typeof agent.adapterConfig?.promptTemplate === "string"
              ? agent.adapterConfig.promptTemplate.trim()
              : "";
          const instructionsFilePath =
            typeof agent.adapterConfig?.instructionsFilePath === "string"
              ? agent.adapterConfig.instructionsFilePath.trim()
              : "";

          if (promptTemplate || !instructionsFilePath) {
            return null;
          }

          return {
            id: agent.id,
            path: instructionsFilePath,
          } satisfies BackfillTarget;
        })
        .filter((target): target is BackfillTarget => Boolean(target));

      if (!targets.length) {
        continue;
      }

      results.push(await runCompanyBackfill(company, targets));
    }

    const updatedCount = results.reduce((sum, result) => sum + result.updated.length, 0);
    const skippedCount = results.reduce((sum, result) => sum + result.skipped.length, 0);
    const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);

    return NextResponse.json({
      ok: errorCount === 0,
      updatedCount,
      skippedCount,
      errorCount,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to backfill agent prompts.",
      },
      { status: 500 },
    );
  }
}

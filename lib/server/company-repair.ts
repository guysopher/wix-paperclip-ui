import {
  appendGeneralWixOperationalProtocol,
  appendSiteExpertOperationalProtocol,
  GENERAL_WIX_MCP_PROTOCOL_MARKER,
  SITE_EXPERT_PROTOCOL_MARKER,
} from "@/lib/agent-templates";
import {
  getCompanyActivation,
  getCompanyWixBinding,
  type ActivationMode,
} from "@/lib/company-metadata";
import { renderPromptTemplate } from "@/lib/prompt-render";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const HELPER_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

interface PaperclipCompany {
  id: string;
  name: string;
  description: string;
}

interface PaperclipAgent {
  id: string;
  name: string;
  companyId: string;
  role?: string;
  title?: string;
  adapterConfig?: Record<string, unknown>;
}

interface PaperclipApproval {
  id: string;
  status: string;
}

interface PaperclipIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  assigneeUserId: string | null;
}

interface PaperclipRun {
  id: string;
  status: string;
  error: string | null;
}

interface FileBackfillTarget {
  id: string;
  path: string;
}

interface PromptSyncSummary {
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface CompanyRepairResult {
  ok: boolean;
  ready: boolean;
  checkedAt: string;
  companyId: string;
  companyName: string;
  startup: boolean;
  approvalsApproved: number;
  staleTasksUpdated: number;
  promptSync: PromptSyncSummary;
  instructionFilesSynced: number;
  binding: {
    mode: ActivationMode | null;
    hasSiteIdentity: boolean;
    activationIssueId: string | null;
    problems: string[];
  };
  notes: string[];
}

async function paperclip<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...options?.headers,
    },
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        `Paperclip API request failed: ${res.status} ${res.statusText} for ${path}`,
    );
  }

  return payload as T;
}

function fingerprintPrompt(prompt: string): string {
  let hash = 0;
  for (let index = 0; index < prompt.length; index += 1) {
    hash = (hash * 31 + prompt.charCodeAt(index)) >>> 0;
  }
  return `${prompt.length}:${hash.toString(16)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSiteExpert(agent: PaperclipAgent): boolean {
  const role = typeof agent.role === "string" ? agent.role.trim().toLowerCase() : "";
  const title = typeof agent.title === "string" ? agent.title.trim().toLowerCase() : "";
  const name = typeof agent.name === "string" ? agent.name.trim().toLowerCase() : "";
  return role === "site_lead" || title === "wix site expert" || name === "wix site expert";
}

function buildReadBackfillScript() {
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

  for (const target of targets) {
    const agent = byId.get(target.id);
    if (!agent) throw new Error('Agent not found: ' + target.id);

    const existingPrompt =
      typeof agent.adapterConfig?.promptTemplate === 'string'
        ? agent.adapterConfig.promptTemplate.trim()
        : '';
    if (existingPrompt) {
      continue;
    }

    const content = fs.readFileSync(target.path, 'utf8').trim();
    if (!content) {
      throw new Error('Instructions file empty: ' + target.path);
    }

    await request(apiBase, '/agents/' + agent.id, {
      method: 'PATCH',
      body: JSON.stringify({
        adapterConfig: {
          ...(agent.adapterConfig || {}),
          promptTemplate: content,
        },
      }),
    });
  }
})();
NODE`;
}

function buildWriteInstructionsScript() {
  return `node <<'NODE'
const fs = require('fs');
const path = require('path');

async function request(apiBase, pathName, options = {}) {
  const res = await fetch(apiBase + pathName, {
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

  for (const target of targets) {
    const agent = byId.get(target.id);
    if (!agent) throw new Error('Agent not found: ' + target.id);

    const promptTemplate =
      typeof agent.adapterConfig?.promptTemplate === 'string'
        ? agent.adapterConfig.promptTemplate.trim()
        : '';
    if (!promptTemplate) {
      throw new Error('Missing promptTemplate for agent ' + target.id);
    }

    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, promptTemplate.endsWith('\\n') ? promptTemplate : promptTemplate + '\\n', 'utf8');
  }
})();
NODE`;
}

async function runHelperAgent(
  company: PaperclipCompany,
  name: string,
  script: string,
  targets: FileBackfillTarget[],
) {
  let helperAgentId: string | null = null;

  try {
    const helperAgent = await paperclip<PaperclipAgent>(`/companies/${company.id}/agents`, {
      method: "POST",
      body: JSON.stringify({
        name,
        role: "general",
        title: name,
        capabilities: name,
        adapterType: "process",
        adapterConfig: {
          command: "sh",
          args: ["-lc", script],
          cwd: "/tmp",
          env: {
            TARGET_COMPANY_ID: company.id,
            TARGETS_JSON: JSON.stringify(targets),
            LOCAL_PAPERCLIP_API_URL: "http://127.0.0.1:3100/api",
          },
          timeoutSec: 120,
        },
      }),
    });

    helperAgentId = helperAgent.id;
    await paperclip(`/agents/${helperAgent.id}/heartbeat/invoke`, { method: "POST" });

    const deadline = Date.now() + HELPER_TIMEOUT_MS;
    let helperRun: PaperclipRun | null = null;

    while (Date.now() < deadline) {
      const runs = await paperclip<PaperclipRun[]>(
        `/companies/${company.id}/heartbeat-runs?agentId=${encodeURIComponent(helperAgent.id)}`,
      );
      helperRun = runs[0] || helperRun;
      if (helperRun && ["succeeded", "failed", "canceled", "timed_out"].includes(helperRun.status)) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!helperRun) {
      throw new Error(`${name} did not start in time.`);
    }

    if (helperRun.status !== "succeeded") {
      throw new Error(helperRun.error || `${name} ended with status ${helperRun.status}.`);
    }
  } finally {
    if (helperAgentId) {
      await paperclip(`/agents/${helperAgentId}`, { method: "DELETE" }).catch(() => null);
    }
  }
}

async function upgradeAgentPrompts(company: PaperclipCompany, agents: PaperclipAgent[]) {
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const agent of agents) {
    const promptTemplate =
      typeof agent.adapterConfig?.promptTemplate === "string"
        ? agent.adapterConfig.promptTemplate.trim()
        : "";

    if (!promptTemplate) {
      skippedCount += 1;
      continue;
    }

    const siteExpert = isSiteExpert(agent);
    const hasGeneralProtocol = promptTemplate.includes(GENERAL_WIX_MCP_PROTOCOL_MARKER);
    const hasSiteExpertProtocol = !siteExpert || promptTemplate.includes(SITE_EXPERT_PROTOCOL_MARKER);
    const protocolPrompt = siteExpert
      ? appendSiteExpertOperationalProtocol(promptTemplate)
      : appendGeneralWixOperationalProtocol(promptTemplate);
    const nextPrompt = renderPromptTemplate(protocolPrompt, {
      name: company.name,
      description: "",
    }).trim();

    if (
      nextPrompt === promptTemplate &&
      hasGeneralProtocol &&
      hasSiteExpertProtocol &&
      !nextPrompt.includes("{{company.")
    ) {
      skippedCount += 1;
      continue;
    }

    try {
      await paperclip(`/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          adapterConfig: {
            ...(agent.adapterConfig || {}),
            promptTemplate: nextPrompt,
            instructionsPromptFingerprint: fingerprintPrompt(nextPrompt),
          },
        }),
      });
      updatedCount += 1;
    } catch {
      errorCount += 1;
    }
  }

  return { updatedCount, skippedCount, errorCount };
}

async function syncPromptsAndInstructions(company: PaperclipCompany): Promise<{
  promptSync: PromptSyncSummary;
  instructionFilesSynced: number;
}> {
  const agents = await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`);
  const missingPromptTargets = agents
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
      return { id: agent.id, path: instructionsFilePath } satisfies FileBackfillTarget;
    })
    .filter((target): target is FileBackfillTarget => Boolean(target));

  if (missingPromptTargets.length > 0) {
    await runHelperAgent(company, "Agent Prompt Backfill", buildReadBackfillScript(), missingPromptTargets);
  }

  const agentsAfterBackfill = await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`);
  const promptSync = await upgradeAgentPrompts(company, agentsAfterBackfill);
  const refreshedAgents = await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`);
  const instructionTargets = refreshedAgents
    .map((agent) => {
      const promptTemplate =
        typeof agent.adapterConfig?.promptTemplate === "string"
          ? agent.adapterConfig.promptTemplate.trim()
          : "";
      const promptFingerprint = fingerprintPrompt(promptTemplate);
      const syncedFingerprint =
        typeof agent.adapterConfig?.instructionsPromptFingerprint === "string"
          ? agent.adapterConfig.instructionsPromptFingerprint.trim()
          : "";
      const instructionsFilePath =
        typeof agent.adapterConfig?.instructionsFilePath === "string"
          ? agent.adapterConfig.instructionsFilePath.trim()
          : "";
      if (!promptTemplate || !instructionsFilePath || syncedFingerprint === promptFingerprint) {
        return null;
      }
      return { id: agent.id, path: instructionsFilePath } satisfies FileBackfillTarget;
    })
    .filter((target): target is FileBackfillTarget => Boolean(target));

  if (instructionTargets.length > 0) {
    await runHelperAgent(company, "Agent Instruction Sync", buildWriteInstructionsScript(), instructionTargets);
    await Promise.all(
      refreshedAgents
        .filter((agent) => instructionTargets.some((target) => target.id === agent.id))
        .map((agent) => {
          const promptTemplate =
            typeof agent.adapterConfig?.promptTemplate === "string"
              ? agent.adapterConfig.promptTemplate.trim()
              : "";
          return paperclip(`/agents/${agent.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              adapterConfig: {
                ...(agent.adapterConfig || {}),
                instructionsPromptFingerprint: fingerprintPrompt(promptTemplate),
              },
            }),
          }).catch(() => null);
        }),
    );
  }

  return {
    promptSync,
    instructionFilesSynced: instructionTargets.length,
  };
}

async function autoApprovePendingApprovals(companyId: string) {
  const approvals = await paperclip<PaperclipApproval[]>(`/companies/${companyId}/approvals`).catch(() => []);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");

  await Promise.all(
    pendingApprovals.map((approval) =>
      paperclip(`/approvals/${approval.id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => null),
    ),
  );

  return pendingApprovals.length;
}

async function cleanStaleBoardTasks(company: PaperclipCompany, issues: PaperclipIssue[]) {
  const activation = getCompanyActivation(company.description);
  const wixBinding = getCompanyWixBinding(company.description);
  const shouldDropSiteCreationConfirmation =
    activation?.mode === "new_site" &&
    !wixBinding?.metaSiteId &&
    !wixBinding?.siteId &&
    !wixBinding?.siteUrl;

  let changed = 0;

  await Promise.all(
    issues.map(async (issue) => {
      if (issue.assigneeUserId !== "local-board") {
        return;
      }
      if (issue.status === "done" || issue.status === "cancelled") {
        return;
      }

      let nextTitle = issue.title;
      let nextDescription = issue.description;

      if (
        /starter-team hires are already approved and live/i.test(nextDescription) &&
        /approve starter-team hires/i.test(nextTitle)
      ) {
        nextTitle = nextTitle
          .replace(/^approve starter-team hires and\s*/i, "")
          .replace(/^approve starter-team hires\s*/i, "")
          .trim();
        if (nextTitle.length > 0) {
          nextTitle = nextTitle.charAt(0).toUpperCase() + nextTitle.slice(1);
        }
      }

      if (
        /system governance requires activation approvals/i.test(nextDescription) ||
        /activation approvals? for the .*starter hires/i.test(nextDescription)
      ) {
        nextDescription = nextDescription
          .replace(
            /system governance requires activation approvals for the .*starter hires created from [A-Z0-9-]+\./i,
            "Starter-team hiring is handled automatically now. The team is already active, so focus only on the remaining work that still needs your input.",
          )
          .replace(
            /system governance requires activation approvals for the .*starter hires\./i,
            "Starter-team hiring is handled automatically now. The team is already active, so focus only on the remaining work that still needs your input.",
          )
          .replace(
            /activation approvals? for the .*starter hires/i,
            "starter-team hiring is handled automatically",
          );
      }

      if (shouldDropSiteCreationConfirmation) {
        nextDescription = nextDescription
          .replace(
            /\n-\s*if there is no Wix site yet: confirm that the team should create the main[^\n]*/i,
            "",
          )
          .replace(
            /\n-\s*if .* already has a Wix site:[^\n]*/i,
            "\n- if there is already a Wix site: send the canonical `metaSiteId`, `siteId`, or live `siteUrl` (any one is enough to lock the company record)",
          );
      }

      nextDescription = nextDescription.replace(/\n{3,}/g, "\n\n").trim();

      if (nextTitle !== issue.title || nextDescription !== issue.description) {
        changed += 1;
        await paperclip(`/issues/${issue.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: nextTitle || issue.title,
            description: nextDescription || issue.description,
          }),
        }).catch(() => null);
      }
    }),
  );

  return changed;
}

function getBindingProblems(company: PaperclipCompany) {
  const activation = getCompanyActivation(company.description);
  const wixBinding = getCompanyWixBinding(company.description);
  const hasSiteIdentity = Boolean(wixBinding?.metaSiteId || wixBinding?.siteId || wixBinding?.siteUrl);
  const activationIssueId = wixBinding?.activationIssueId || null;
  const problems: string[] = [];

  if (activation?.mode === "existing_site" && !hasSiteIdentity) {
    problems.push("Existing-site company is missing canonical wixBinding identity.");
  }

  if (activation?.mode === "new_site" && !activationIssueId) {
    problems.push("New-site company is missing wixBinding.activationIssueId.");
  }

  return {
    mode: activation?.mode || null,
    hasSiteIdentity,
    activationIssueId,
    problems,
  };
}

export async function repairCompanyState(companyId: string, options?: { startup?: boolean }): Promise<CompanyRepairResult> {
  const startup = Boolean(options?.startup);
  const company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
  const approvalsApproved = await autoApprovePendingApprovals(companyId).catch(() => 0);
  const { promptSync, instructionFilesSynced } = await syncPromptsAndInstructions(company);
  const refreshedCompany = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
  const issues = await paperclip<PaperclipIssue[]>(`/companies/${companyId}/issues`).catch(() => []);
  const staleTasksUpdated = await cleanStaleBoardTasks(refreshedCompany, issues).catch(() => 0);
  const binding = getBindingProblems(refreshedCompany);
  const ready = binding.problems.length === 0 && promptSync.errorCount === 0;
  const notes: string[] = [];

  if (approvalsApproved > 0) {
    notes.push(`Approved ${approvalsApproved} pending approval${approvalsApproved === 1 ? "" : "s"}.`);
  }
  if (promptSync.updatedCount > 0) {
    notes.push(`Updated ${promptSync.updatedCount} stored agent prompt${promptSync.updatedCount === 1 ? "" : "s"}.`);
  }
  if (instructionFilesSynced > 0) {
    notes.push(`Synced ${instructionFilesSynced} managed runtime instruction file${instructionFilesSynced === 1 ? "" : "s"}.`);
  }
  if (staleTasksUpdated > 0) {
    notes.push(`Cleaned ${staleTasksUpdated} stale board task${staleTasksUpdated === 1 ? "" : "s"}.`);
  }
  if (binding.problems.length === 0) {
    notes.push(
      binding.mode === "new_site"
        ? "New-site startup is verified and ready for site creation work."
        : binding.hasSiteIdentity
          ? "Wix binding is locked and ready for site work."
          : "Company repair completed.",
    );
  }

  return {
    ok: ready,
    ready,
    checkedAt: new Date().toISOString(),
    companyId: refreshedCompany.id,
    companyName: refreshedCompany.name,
    startup,
    approvalsApproved,
    staleTasksUpdated,
    promptSync,
    instructionFilesSynced,
    binding,
    notes,
  };
}

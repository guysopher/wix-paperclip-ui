import {
  appendGeneralWixOperationalProtocol,
  getCanonicalAgentDefinitionByTitle,
  getPaperclipRoleForAgentTitle,
  appendSiteExpertOperationalProtocol,
  GENERAL_WIX_MCP_PROTOCOL_MARKER,
  SITE_EXPERT_PROTOCOL_MARKER,
} from "@/lib/agent-templates";
import {
  getCompanyActivation,
  isVibeSitePublicUrl,
  getCompanyWixBinding,
  getCompanyVibeSite,
  mergeCompanyDescription,
  parseCompanyDescription,
  type ActivationMode,
} from "@/lib/company-metadata";
import {
  DEFAULT_AGENT_TIMEOUT_SEC,
  DEFAULT_OPENAI_ADAPTER_TYPE,
  DEFAULT_OPENAI_SPECIALIST_MODEL,
  DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC,
  buildSpecialistHeartbeatRuntimeConfig,
  buildTeamLeadHeartbeatRuntimeConfig,
} from "@/lib/paperclip-runtime-defaults";
import { syncHeartbeatConfig } from "@/lib/agent-heartbeat";
import { renderPromptTemplate } from "@/lib/prompt-render";
import { getResolvedPaperclipApiUrl } from "@/lib/server/deployment-topology";
import { verifyPicassoProject } from "@/lib/server/picasso-project";
import { verifyPublicUrlReachable } from "@/lib/server/public-url";

const PAPERCLIP_API_URL = getResolvedPaperclipApiUrl();

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
  status?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
}

interface PaperclipApproval {
  id: string;
  type?: string;
  status: string;
}

interface PaperclipIssue {
  id: string;
  parentId?: string | null;
  title: string;
  description: string;
  status: string;
  assigneeUserId: string | null;
  assigneeAgentId?: string | null;
  assigneeId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  activeRun?: {
    id: string;
    status: string;
  } | null;
}

interface PaperclipIssueComment {
  id: string;
  body: string;
  createdAt: string;
  authorAgentId?: string | null;
}

interface PaperclipRun {
  id: string;
  status: string;
  error: string | null;
  errorCode?: string | null;
  agentId?: string | null;
  startedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface TextEvidence {
  body?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface StructuredSiteEvidence {
  mainSite?: {
    metaSiteId?: string;
    siteId?: string;
    siteUrl?: string;
    publicUrlVerified?: boolean;
  };
  vibeSite?: {
    siteId?: string;
    jobId?: string;
    developmentUrl?: string;
    siteUrl?: string;
    publicUrlVerified?: boolean;
    status?: string;
  };
}

interface PaperclipRunLogPayload {
  content?: string;
  log?: string;
  output?: string;
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

interface StarterTeamPlanEntry {
  role: string;
  goal?: string;
  expectedResult?: string;
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
  timeoutDefaultsUpdated: number;
  heartbeatDefaultsUpdated: number;
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

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

function isAiTeamLead(agent: PaperclipAgent): boolean {
  const role = typeof agent.role === "string" ? agent.role.trim().toLowerCase() : "";
  const title = typeof agent.title === "string" ? agent.title.trim().toLowerCase() : "";
  const name = typeof agent.name === "string" ? agent.name.trim().toLowerCase() : "";
  return (
    role === "ceo" ||
    title === "ai team lead" ||
    title === "chief executive officer" ||
    name === "ai team lead" ||
    name === "ceo"
  );
}

function isLiveSpecialist(agent: PaperclipAgent, aiTeamLeadId: string | null) {
  if (agent.id === aiTeamLeadId) {
    return false;
  }

  return agent.status !== "pending_approval";
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

async function normalizeLegacyAgentTimeouts(agents: PaperclipAgent[]) {
  let updatedCount = 0;

  await Promise.all(
    agents.map(async (agent) => {
      const timeoutSec =
        typeof agent.adapterConfig?.timeoutSec === "number"
          ? agent.adapterConfig.timeoutSec
          : typeof agent.adapterConfig?.timeoutSec === "string"
            ? Number(agent.adapterConfig.timeoutSec)
            : null;

      if (timeoutSec !== 600) {
        return;
      }

      try {
        await paperclip(`/agents/${agent.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            adapterConfig: {
              ...(agent.adapterConfig || {}),
              timeoutSec: DEFAULT_AGENT_TIMEOUT_SEC,
            },
          }),
        });
        updatedCount += 1;
      } catch {
        // Best-effort repair; prompt/instruction repair should still continue.
      }
    }),
  );

  return updatedCount;
}

function hasDesiredHeartbeatDefaults(agent: PaperclipAgent, teamLead: boolean) {
  const desiredInterval = teamLead
    ? DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC
    : DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC;
  const desiredEnabled = teamLead;
  const runtimeConfig =
    agent.runtimeConfig && typeof agent.runtimeConfig === "object" ? agent.runtimeConfig : {};
  const heartbeat =
    runtimeConfig &&
    typeof runtimeConfig === "object" &&
    "heartbeat" in runtimeConfig &&
    runtimeConfig.heartbeat &&
    typeof runtimeConfig.heartbeat === "object"
      ? (runtimeConfig.heartbeat as Record<string, unknown>)
      : {};
  const adapterInterval =
    typeof agent.adapterConfig?.heartbeatIntervalSec === "number"
      ? agent.adapterConfig.heartbeatIntervalSec
      : typeof agent.adapterConfig?.heartbeatIntervalSec === "string"
        ? Number(agent.adapterConfig.heartbeatIntervalSec)
        : undefined;

  return (
    adapterInterval === desiredInterval &&
    heartbeat.enabled === desiredEnabled &&
    heartbeat.intervalSec === desiredInterval &&
    heartbeat.wakeOnAssignment === true &&
    heartbeat.wakeOnOnDemand === true &&
    heartbeat.wakeOnAutomation === true
  );
}

async function normalizeDefaultHeartbeatPolicies(agents: PaperclipAgent[]) {
  let updatedCount = 0;

  await Promise.all(
    agents.map(async (agent) => {
      const teamLead = isAiTeamLead(agent);
      if (hasDesiredHeartbeatDefaults(agent, teamLead)) {
        return;
      }

      try {
        await paperclip(`/agents/${agent.id}`, {
          method: "PATCH",
          body: JSON.stringify(
            syncHeartbeatConfig({
              adapterConfig: {
                ...(agent.adapterConfig || {}),
                heartbeatIntervalSec: teamLead
                  ? DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC
                  : DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
              },
              runtimeConfig: teamLead
                ? buildTeamLeadHeartbeatRuntimeConfig()
                : buildSpecialistHeartbeatRuntimeConfig(),
            }),
          ),
        });
        updatedCount += 1;
      } catch {
        // Best-effort repair only.
      }
    }),
  );

  return updatedCount;
}

async function syncPromptsAndInstructions(company: PaperclipCompany): Promise<{
  promptSync: PromptSyncSummary;
  instructionFilesSynced: number;
  timeoutDefaultsUpdated: number;
  heartbeatDefaultsUpdated: number;
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
  const promptRefreshedAgents = await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`);
  const timeoutDefaultsUpdated = await normalizeLegacyAgentTimeouts(promptRefreshedAgents);
  const agentsAfterTimeoutRepair = timeoutDefaultsUpdated > 0
    ? await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`)
    : promptRefreshedAgents;
  const heartbeatDefaultsUpdated = await normalizeDefaultHeartbeatPolicies(agentsAfterTimeoutRepair);
  const refreshedAgents = timeoutDefaultsUpdated > 0 || heartbeatDefaultsUpdated > 0
    ? await paperclip<PaperclipAgent[]>(`/companies/${company.id}/agents`)
    : agentsAfterTimeoutRepair;
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
    timeoutDefaultsUpdated,
    heartbeatDefaultsUpdated,
  };
}

async function countPendingApprovals(companyId: string) {
  const approvals = await paperclip<PaperclipApproval[]>(`/companies/${companyId}/approvals`).catch(() => []);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");

  return pendingApprovals.length;
}

async function wakeAiTeamLead(companyId: string) {
  const agents = await paperclip<PaperclipAgent[]>(`/companies/${companyId}/agents`).catch(() => []);
  const aiTeamLead =
    agents.find((agent) => agent.role === "ceo") ||
    agents.find((agent) => agent.title?.trim().toLowerCase() === "ai team lead");

  if (!aiTeamLead) {
    return false;
  }

  await paperclip(`/agents/${aiTeamLead.id}/heartbeat/invoke`, {
    method: "POST",
  }).catch(() => null);

  return true;
}

async function wakeAgents(agentIds: string[]) {
  await Promise.all(
    agentIds.map((agentId) =>
      paperclip(`/agents/${agentId}/heartbeat/invoke`, {
        method: "POST",
      }).catch(() => null),
    ),
  );
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
      const publishBoardHandoff =
        /publish handoff/i.test(issue.description) ||
        /next action for board:/i.test(issue.description) ||
        /\.editor\.wix\.com\/studio\//i.test(issue.description) ||
        /vibe\.wix\.com\/projects\/[^/\s]+\/v\/editor/i.test(issue.description);
      const shouldAssignToBoard =
        publishBoardHandoff &&
        issue.status !== "done" &&
        issue.status !== "cancelled" &&
        issue.assigneeUserId !== "local-board";

      if (shouldAssignToBoard) {
        changed += 1;
        await paperclip(`/issues/${issue.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            assigneeUserId: "local-board",
          }),
        }).catch(() => null);
      }

      if ((shouldAssignToBoard ? "local-board" : issue.assigneeUserId) !== "local-board") {
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
            "Starter-team hire approvals now live in the dashboard approvals flow. Review the pending approvals there, then focus only on the remaining work that still needs your input.",
          )
          .replace(
            /system governance requires activation approvals for the .*starter hires\./i,
            "Starter-team hire approvals now live in the dashboard approvals flow. Review the pending approvals there, then focus only on the remaining work that still needs your input.",
          )
          .replace(
            /activation approvals? for the .*starter hires/i,
            "starter-team hire approvals live in the dashboard approvals flow",
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

async function cancelDetachedStartupRuns(companyId: string, agentIds: string[]) {
  if (agentIds.length === 0) {
    return 0;
  }

  const allowedAgentIds = new Set(agentIds);
  const runs = await paperclip<PaperclipRun[]>(`/companies/${companyId}/heartbeat-runs`).catch(() => []);
  const detachedRuns = runs.filter((run) => {
    if (run.status !== "running") {
      return false;
    }
    if (!run.agentId || !allowedAgentIds.has(run.agentId)) {
      return false;
    }
    return isDetachedRun(run);
  });

  if (detachedRuns.length === 0) {
    return 0;
  }

  await Promise.all(
    detachedRuns.map((run) =>
      paperclip(`/heartbeat-runs/${run.id}/cancel`, {
        method: "POST",
      }).catch(() => null),
    ),
  );

  return detachedRuns.length;
}

function isDetachedRun(run: PaperclipRun) {
  return (
    run.errorCode === "process_detached" ||
    /lost in-memory process handle/i.test(run.error || "")
  );
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

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function getLatestMatchingLine(body: string, pattern: RegExp) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function parseUuidFromLine(line: string | undefined) {
  return line?.match(UUID_PATTERN)?.[0];
}

function parseUrlFromLine(line: string | undefined) {
  return line?.match(/https?:\/\/\S+/i)?.[0];
}

function extractBalancedJsonObject(source: string, startIndex: number) {
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseStructuredSiteEvidenceEntries(body: string): StructuredSiteEvidence[] {
  const entries: StructuredSiteEvidence[] = [];
  let searchIndex = 0;

  while (searchIndex < body.length) {
    const markerIndex = body.indexOf("SITE_EVIDENCE:", searchIndex);
    if (markerIndex === -1) {
      break;
    }

    const jsonStart = body.indexOf("{", markerIndex);
    if (jsonStart === -1) {
      break;
    }

    const jsonBlock = extractBalancedJsonObject(body, jsonStart);
    if (!jsonBlock) {
      break;
    }

    const parsed = tryParseJson<StructuredSiteEvidence>(jsonBlock);
    if (parsed) {
      entries.push(parsed);
    }

    searchIndex = jsonStart + jsonBlock.length;
  }

  return entries;
}

function parsePrimaryPublishedSiteUrl(body: string) {
  if (!/published-site-urls|published site urls|published urls|urlType|primary/i.test(body)) {
    return undefined;
  }

  const explicitUrlMatches = body.matchAll(/["']url["']\s*:\s*["'](https?:\/\/[^"'\\\s]+)["']/gi);
  for (const match of explicitUrlMatches) {
    const candidate = match[1]?.replace(/\\\//g, "/");
    if (isTrustworthySiteUrl(candidate)) {
      return candidate;
    }
  }

  const looseUrlMatches = body.matchAll(/https?:\/\/[^\s"'\\]+/gi);
  for (const match of looseUrlMatches) {
    const candidate = match[0]?.replace(/\\\//g, "/");
    if (isTrustworthySiteUrl(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function parseTextAfterColon(line: string | undefined) {
  const match = line?.match(/:\s*`?([a-z0-9_-]+)`?/i);
  return match?.[1];
}

function parseUuidNearKey(body: string, keys: string[]) {
  for (const key of keys) {
    const match = body.match(new RegExp(`${key}[\\s\\S]{0,120}?(${UUID_SOURCE})`, "i"));
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function parseUrlNearKey(body: string, keys: string[]) {
  for (const key of keys) {
    const match = body.match(new RegExp(`${key}[\\s\\S]{0,200}?(https?:\\\\?/\\\\?/[^\\s"'\\\\]+)`, "i"));
    if (match?.[1]) {
      return match[1].replace(/\\\//g, "/");
    }
  }

  return undefined;
}

function parseTextNearKey(body: string, keys: string[]) {
  for (const key of keys) {
    const match = body.match(new RegExp(`${key}[\\s\\S]{0,80}?(completed|complete|running|queued|failed|published|ready)`, "i"));
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return undefined;
}

function getEvidenceTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortEvidenceNewestFirst(evidence: TextEvidence[]) {
  return evidence
    .filter((entry): entry is Required<Pick<TextEvidence, "body">> & TextEvidence => Boolean(entry.body?.trim()))
    .sort(
      (left, right) =>
        getEvidenceTimestamp(right.updatedAt || right.createdAt) -
        getEvidenceTimestamp(left.updatedAt || left.createdAt),
    )
    .map((entry) => entry.body!.trim());
}

function isDisallowedPublicSiteHost(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]" ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname === "host.docker.internal" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname)
  ) {
    return true;
  }

  return (
    /^www\.wix\.com$/i.test(normalizedHostname) ||
    /^wix\.to$/i.test(normalizedHostname) ||
    /^manage\.wix\.com$/i.test(normalizedHostname) ||
    /^dev\.wix\.com$/i.test(normalizedHostname) ||
    /^www\.wixapis\.com$/i.test(normalizedHostname) ||
    /^apis\.wix\.com$/i.test(normalizedHostname) ||
    /^www\.instagram\.com$/i.test(normalizedHostname) ||
    /^instagram\.com$/i.test(normalizedHostname) ||
    /^m\.instagram\.com$/i.test(normalizedHostname) ||
    /^www\.facebook\.com$/i.test(normalizedHostname) ||
    /^facebook\.com$/i.test(normalizedHostname) ||
    /^m\.facebook\.com$/i.test(normalizedHostname) ||
    /^x\.com$/i.test(normalizedHostname) ||
    /^www\.x\.com$/i.test(normalizedHostname) ||
    /^twitter\.com$/i.test(normalizedHostname) ||
    /^www\.twitter\.com$/i.test(normalizedHostname) ||
    /^tiktok\.com$/i.test(normalizedHostname) ||
    /^www\.tiktok\.com$/i.test(normalizedHostname) ||
    /^youtube\.com$/i.test(normalizedHostname) ||
    /^www\.youtube\.com$/i.test(normalizedHostname) ||
    /^youtu\.be$/i.test(normalizedHostname) ||
    /^linktr\.ee$/i.test(normalizedHostname) ||
    /^www\.linktr\.ee$/i.test(normalizedHostname)
  );
}

function isTrustworthySiteUrl(url: string | undefined) {
  if (!url) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (/^www\.wix\.com$/i.test(parsed.hostname) && (parsed.pathname === "/" || parsed.pathname === "")) {
    return false;
  }

  if (isDisallowedPublicSiteHost(parsed.hostname)) {
    return false;
  }

  return true;
}

function isReservedPaperclipEntityId(
  candidateId: string | undefined,
  company: PaperclipCompany,
  issues: PaperclipIssue[],
  agents: PaperclipAgent[],
) {
  if (!candidateId) {
    return false;
  }

  if (candidateId === company.id) {
    return true;
  }

  if (issues.some((issue) => issue.id === candidateId)) {
    return true;
  }

  return agents.some((agent) => agent.id === candidateId);
}

const STARTER_TEMPLATE_MARKERS: Array<{
  pattern: RegExp;
  label: string;
  strong?: boolean;
}> = [
  {
    pattern: /use this space to promote the business/i,
    label: "generic starter promo copy",
    strong: true,
  },
  {
    pattern: /this is a space to share more about the business/i,
    label: "generic starter about copy",
    strong: true,
  },
  {
    pattern: /check back soon once posts are published/i,
    label: "empty starter blog section",
  },
  {
    pattern: /123-456-7890/i,
    label: "fake starter phone number",
    strong: true,
  },
  {
    pattern: /500 terry francine street/i,
    label: "fake starter address",
    strong: true,
  },
  {
    pattern: /quiet moment hanna jou fine art print/i,
    label: "starter product copy",
    strong: true,
  },
  {
    pattern: /\bvisuelle\b/i,
    label: "starter template brand name",
    strong: true,
  },
];

function extractVisibleSiteText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LOW_SIGNAL_SITE_WORDS = new Set([
  "home",
  "shop",
  "about",
  "contact",
  "cart",
  "menu",
  "search",
  "login",
  "log",
  "sign",
  "account",
  "subscribe",
  "newsletter",
  "read",
  "more",
  "view",
  "all",
  "book",
  "now",
  "instagram",
  "facebook",
  "pinterest",
  "tiktok",
  "twitter",
  "follow",
  "email",
  "phone",
  "collection",
  "collections",
  "product",
  "products",
  "store",
  "online",
  "new",
  "best",
  "seller",
  "sellers",
]);

function tokenizeVisibleSiteTextForComparison(text: string, businessName: string) {
  const normalized = text
    .toLowerCase()
    .replace(
      businessName.trim() ? new RegExp(escapeRegExp(businessName.trim()), "gi") : /^$/,
      " ",
    )
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/www\.\S+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    .split(" ")
    .filter((word) => word.length >= 3 && !LOW_SIGNAL_SITE_WORDS.has(word));
}

function countLeadingSharedWords(left: string[], right: string[]) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function computeWordSetOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const word of leftSet) {
    if (rightSet.has(word)) {
      shared += 1;
    }
  }

  return shared / Math.min(leftSet.size, rightSet.size);
}

async function fetchLiveSiteSnapshot(url: string | undefined) {
  if (!isTrustworthySiteUrl(url)) {
    return null;
  }

  try {
    const response = await fetch(url!, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return {
      url,
      visibleText: extractVisibleSiteText(html),
    };
  } catch {
    return null;
  }
}

async function auditLiveSiteForStarterTemplate(url: string | undefined, businessName: string) {
  const snapshot = await fetchLiveSiteSnapshot(url);
  if (!snapshot) {
    return null;
  }

  const matchedMarkers = STARTER_TEMPLATE_MARKERS.filter((marker) =>
    marker.pattern.test(snapshot.visibleText),
  );
  const mentionsBusinessName =
    businessName.trim().length > 0 &&
    snapshot.visibleText.toLowerCase().includes(businessName.trim().toLowerCase());
  const hasStrongMarker = matchedMarkers.some((marker) => marker.strong);

  if (!hasStrongMarker && matchedMarkers.length < 2) {
    return null;
  }

  if (mentionsBusinessName && matchedMarkers.length < 3 && !hasStrongMarker) {
    return null;
  }

  return {
    url: snapshot.url,
    reason: `the live page still looks like a generic starter template (${matchedMarkers
      .slice(0, 3)
      .map((marker) => marker.label)
      .join(", ")})`,
  };
}

async function auditVibeSiteDifferentiation(
  mainUrl: string | undefined,
  vibeUrl: string | undefined,
  businessName: string,
) {
  if (!isTrustworthySiteUrl(mainUrl) || !isTrustworthySiteUrl(vibeUrl)) {
    return null;
  }

  if (mainUrl === vibeUrl) {
    return {
      reason: "the vibe site resolves to the same public URL as the main site",
    };
  }

  const [mainSnapshot, vibeSnapshot] = await Promise.all([
    fetchLiveSiteSnapshot(mainUrl),
    fetchLiveSiteSnapshot(vibeUrl),
  ]);

  if (!mainSnapshot || !vibeSnapshot) {
    return null;
  }

  const mainWindow = tokenizeVisibleSiteTextForComparison(mainSnapshot.visibleText, businessName).slice(0, 160);
  const vibeWindow = tokenizeVisibleSiteTextForComparison(vibeSnapshot.visibleText, businessName).slice(0, 160);

  if (mainWindow.length < 40 || vibeWindow.length < 40) {
    return null;
  }

  const leadingSharedWords = countLeadingSharedWords(mainWindow, vibeWindow);
  const overlap = computeWordSetOverlap(mainWindow, vibeWindow);
  const duplicatedShell =
    leadingSharedWords >= 24 || (leadingSharedWords >= 12 && overlap >= 0.82);

  if (!duplicatedShell) {
    return null;
  }

  return {
    reason:
      "the public vibe page still reads too much like the main site and looks like the same storefront shell instead of a distinct experimental direction",
  };
}

function extractMainSiteBindingFromBodies(bodies: string[]) {
  let siteId: string | undefined;
  let metaSiteId: string | undefined;
  let siteUrl: string | undefined;

  for (const body of bodies) {
    const structuredEvidence = parseStructuredSiteEvidenceEntries(body);
    for (const entry of structuredEvidence) {
      metaSiteId ||= parseUuidFromLine(entry.mainSite?.metaSiteId);
      siteId ||= parseUuidFromLine(entry.mainSite?.siteId);
      if (!siteUrl && entry.mainSite?.publicUrlVerified && isTrustworthySiteUrl(entry.mainSite?.siteUrl)) {
        siteUrl = entry.mainSite.siteUrl;
      }
    }

    metaSiteId ||= parseUuidNearKey(body, ["metaSiteId", "metasiteId", "meta site id"]);
    siteId ||= parseUuidNearKey(body, ["siteId", "site id"]);
    siteId ||= parseUuidFromLine(
      getLatestMatchingLine(body, /siteid\/metasiteid|verified (?:main-site )?identity|metasiteid|siteid/i),
    );
    metaSiteId ||= siteId;

    if (!siteUrl) {
      const candidatePublishedUrl = parsePrimaryPublishedSiteUrl(body);
      if (candidatePublishedUrl) {
        siteUrl = candidatePublishedUrl;
      }
    }
  }

  if (!siteId && !siteUrl) {
    return null;
  }

  return {
    metaSiteId: metaSiteId || siteId,
    siteId,
    siteUrl,
  };
}

function extractVibeSiteBindingFromBodies(bodies: string[]) {
  let siteId: string | undefined;
  let jobId: string | undefined;
  let developmentUrl: string | undefined;
  let status: string | undefined;

  for (const body of bodies) {
    const structuredEvidence = parseStructuredSiteEvidenceEntries(body);
    for (const entry of structuredEvidence) {
      siteId ||= parseUuidFromLine(entry.vibeSite?.siteId);
      jobId ||= parseUuidFromLine(entry.vibeSite?.jobId);
      developmentUrl ||= parseUrlFromLine(entry.vibeSite?.developmentUrl);
      status ||= entry.vibeSite?.status?.trim().toLowerCase();
    }

    siteId ||= parseUuidNearKey(body, ["vibeSiteId", "siteId", "site id"]);
    jobId ||= parseUuidNearKey(body, ["vibeSiteJobId", "jobId", "job id"]);
    developmentUrl ||= parseUrlNearKey(body, [
      "vibeSiteDevelopmentUrl",
      "developmentUrl",
      "editorUrl",
      "development url",
      "editor url",
    ]);
    status ||= parseTextNearKey(body, ["vibeSiteStatus", "current vibe-site status", "status"]);

    siteId ||= parseUuidFromLine(
      getLatestMatchingLine(body, /verified vibe[- ]site id|vibe[- ]site id|vibesiteid/i),
    );
    jobId ||= parseUuidFromLine(
      getLatestMatchingLine(body, /verified vibe[- ]site job id|vibe[- ]site job id|vibesitejobid|job id/i),
    );
    developmentUrl ||= parseUrlFromLine(
      getLatestMatchingLine(body, /vibe[- ]site editor url|development url|editor url|vibesitedevelopmenturl/i),
    );

    if (!status) {
      const statusLine = getLatestMatchingLine(
        body,
        /current vibe[- ]site status|vibe[- ]site build status|vibesitestatus|status candidate/i,
      );
      status = parseTextAfterColon(statusLine)?.toLowerCase();
    }
  }

  if (!siteId && !jobId && !developmentUrl && !status) {
    return null;
  }

  return {
    siteId,
    jobId,
    developmentUrl,
    status,
  };
}

function extractRunLogText(payload: PaperclipRunLogPayload | string | null | undefined) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload.content === "string" && payload.content.trim()) {
    return payload.content;
  }
  if (typeof payload.log === "string" && payload.log.trim()) {
    return payload.log;
  }
  if (typeof payload.output === "string" && payload.output.trim()) {
    return payload.output;
  }

  return "";
}

async function collectIssueEvidence(issue: PaperclipIssue) {
  const comments = await paperclip<PaperclipIssueComment[]>(`/issues/${issue.id}/comments`).catch(() => []);

  return [
    {
      body: issue.description,
      createdAt: issue.createdAt || null,
      updatedAt: issue.updatedAt || issue.createdAt || null,
    },
    ...comments.map((comment) => ({
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  ] satisfies TextEvidence[];
}

async function collectAgentRunEvidence(companyId: string, agentId: string) {
  const runs = await paperclip<PaperclipRun[]>(`/companies/${companyId}/heartbeat-runs`).catch(() => []);
  const relevantRuns = runs
    .filter((run) => run.agentId === agentId && run.status !== "failed" && run.status !== "timed_out")
    .sort(
      (left, right) =>
        getEvidenceTimestamp(right.updatedAt || right.createdAt || right.startedAt) -
        getEvidenceTimestamp(left.updatedAt || left.createdAt || left.startedAt),
    )
    .slice(0, 3);

  const logEvidence = await Promise.all(
    relevantRuns.map(async (run) => {
      const logPayload = await paperclip<PaperclipRunLogPayload | string>(`/heartbeat-runs/${run.id}/log`).catch(() => null);
      const body = extractRunLogText(logPayload);
      if (!body.trim()) {
        return null;
      }
      return {
        body,
        createdAt: run.createdAt || run.startedAt || null,
        updatedAt: run.updatedAt || run.startedAt || run.createdAt || null,
      } satisfies TextEvidence;
    }),
  );

  return logEvidence.filter(isNonNullable);
}

async function repairStartupSiteBindings(
  company: PaperclipCompany,
  issues: PaperclipIssue[],
  agents: PaperclipAgent[],
  aiTeamLeadId: string | null,
) {
  const activation = getCompanyActivation(company.description);
  const currentWixBinding = getCompanyWixBinding(company.description);
  const currentVibeSite = getCompanyVibeSite(company.description);
  const mainSiteIssue = issues.find((issue) => /launch the first site version/i.test(issue.title));
  const vibeSiteIssue = issues.find((issue) => /experimental vibe site/i.test(issue.title));
  const wixSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "wix site expert");
  const vibeSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "vibe site expert");

  let nextDescription = company.description;
  let mainBindingApplied = false;
  let vibeBindingApplied = false;
  let bindingsSanitized = false;

  const currentMainSiteUrlCandidate =
    isTrustworthySiteUrl(currentWixBinding?.siteUrl) &&
    currentWixBinding?.siteUrl !== currentVibeSite?.siteUrl
      ? currentWixBinding?.siteUrl
      : undefined;
  const currentMainSiteUrlVerified = currentMainSiteUrlCandidate
    ? currentWixBinding?.publicUrlVerified === true ||
      await verifyPublicUrlReachable(currentMainSiteUrlCandidate)
    : false;
  const currentVibeSiteUrlCandidate =
    isVibeSitePublicUrl(currentVibeSite?.siteUrl) &&
    currentVibeSite?.siteUrl !== currentWixBinding?.siteUrl
      ? currentVibeSite?.siteUrl
      : undefined;
  const currentVibeSiteUrlVerified = currentVibeSiteUrlCandidate
    ? currentVibeSite?.publicUrlVerified === true ||
      await verifyPublicUrlReachable(currentVibeSiteUrlCandidate)
    : false;

  const sanitizedCurrentMainMetaSiteId =
    currentWixBinding?.metaSiteId &&
    !isReservedPaperclipEntityId(currentWixBinding.metaSiteId, company, issues, agents) &&
    currentWixBinding.metaSiteId !== currentVibeSite?.siteId
      ? currentWixBinding.metaSiteId
      : undefined;
  const sanitizedCurrentMainSiteId =
    currentWixBinding?.siteId &&
    !isReservedPaperclipEntityId(currentWixBinding.siteId, company, issues, agents) &&
    currentWixBinding.siteId !== currentVibeSite?.siteId
      ? currentWixBinding.siteId
      : undefined;
  const sanitizedCurrentMainSiteUrl = currentMainSiteUrlVerified
    ? currentMainSiteUrlCandidate
    : undefined;

  if (
    currentWixBinding &&
    (
      currentWixBinding.metaSiteId !== sanitizedCurrentMainMetaSiteId ||
      currentWixBinding.siteId !== sanitizedCurrentMainSiteId ||
      currentWixBinding.siteUrl !== sanitizedCurrentMainSiteUrl
    )
  ) {
    nextDescription = mergeCompanyDescription(nextDescription, {
      wixBinding: {
        metaSiteId: sanitizedCurrentMainMetaSiteId,
        siteId: sanitizedCurrentMainSiteId,
        siteUrl: sanitizedCurrentMainSiteUrl,
        publicUrlVerified: sanitizedCurrentMainSiteUrl ? true : undefined,
      },
    });
    bindingsSanitized = true;
  }

  const sanitizedCurrentVibeSiteId =
    currentVibeSite?.siteId &&
    !isReservedPaperclipEntityId(currentVibeSite?.siteId, company, issues, agents) &&
    currentVibeSite?.siteId !== sanitizedCurrentMainSiteId &&
    currentVibeSite?.siteId !== sanitizedCurrentMainMetaSiteId
      ? currentVibeSite?.siteId
      : undefined;
  const sanitizedCurrentVibeSiteUrl =
    currentVibeSiteUrlVerified &&
    currentVibeSiteUrlCandidate !== sanitizedCurrentMainSiteUrl
      ? currentVibeSiteUrlCandidate
      : undefined;

  if (
    currentVibeSite &&
    (
      currentVibeSite.siteId !== sanitizedCurrentVibeSiteId ||
      currentVibeSite.siteUrl !== sanitizedCurrentVibeSiteUrl
    )
  ) {
    nextDescription = mergeCompanyDescription(nextDescription, {
      vibeSite: {
        siteId: sanitizedCurrentVibeSiteId,
        siteUrl: sanitizedCurrentVibeSiteUrl,
        publicUrlVerified: sanitizedCurrentVibeSiteUrl ? true : undefined,
      },
    });
    bindingsSanitized = true;
  }

  if (
    mainSiteIssue &&
    (!currentWixBinding?.metaSiteId ||
      !currentWixBinding?.siteId ||
      !isTrustworthySiteUrl(currentWixBinding?.siteUrl))
  ) {
    const mainEvidenceIssues = issues.filter(
      (issue) =>
        issue.id === mainSiteIssue.id ||
        issue.parentId === mainSiteIssue.id ||
        /bind .* main site identity|bind verified wix site identity|wixbinding/i.test(issue.title),
    );
    const mainRunEvidence = wixSiteExpert
      ? await collectAgentRunEvidence(company.id, wixSiteExpert.id)
      : [];
    const mainEvidence = sortEvidenceNewestFirst([
      ...(await Promise.all(mainEvidenceIssues.map(collectIssueEvidence))).flat(),
      ...mainRunEvidence,
    ]);
    const extractedBinding = extractMainSiteBindingFromBodies(mainEvidence);
    const sanitizedMainSiteId =
      extractedBinding?.siteId &&
      !isReservedPaperclipEntityId(extractedBinding.siteId, company, issues, agents) &&
      extractedBinding.siteId !== currentVibeSite?.siteId
        ? extractedBinding.siteId
        : undefined;
    const sanitizedMainMetaSiteId =
      extractedBinding?.metaSiteId &&
      !isReservedPaperclipEntityId(extractedBinding.metaSiteId, company, issues, agents) &&
      extractedBinding.metaSiteId !== currentVibeSite?.siteId
        ? extractedBinding.metaSiteId
        : sanitizedMainSiteId;
    const extractedMainSiteUrlCandidate =
      extractedBinding?.siteUrl &&
      extractedBinding.siteUrl !== currentVibeSite?.siteUrl
        ? extractedBinding.siteUrl
        : undefined;
    const sanitizedMainSiteUrl =
      extractedMainSiteUrlCandidate &&
      await verifyPublicUrlReachable(extractedMainSiteUrlCandidate)
        ? extractedMainSiteUrlCandidate
        : undefined;

    if (sanitizedMainSiteId || sanitizedMainSiteUrl) {
      nextDescription = mergeCompanyDescription(nextDescription, {
        wixBinding: {
          metaSiteId: sanitizedMainMetaSiteId,
          siteId: sanitizedMainSiteId,
          siteUrl: sanitizedMainSiteUrl || sanitizedCurrentMainSiteUrl,
          publicUrlVerified:
            sanitizedMainSiteUrl || sanitizedCurrentMainSiteUrl ? true : undefined,
        },
      });
      mainBindingApplied = true;
    }
  }

  if (
    vibeSiteIssue &&
    (
      Boolean(currentVibeSite?.siteUrl) ||
      Boolean(activation?.picassoBridge?.siteId) ||
      !currentVibeSite?.siteId ||
      !currentVibeSite?.jobId ||
      !currentVibeSite?.developmentUrl ||
      !currentVibeSite?.status ||
      !isVibeSitePublicUrl(currentVibeSite?.siteUrl)
    )
  ) {
    const vibeEvidenceIssues = issues.filter(
      (issue) =>
        issue.id === vibeSiteIssue.id ||
        issue.parentId === vibeSiteIssue.id ||
        /vibe-site metadata|resolve publish access|experimental vibe site/i.test(issue.title),
    );
    const vibeRunEvidence = vibeSiteExpert
      ? await collectAgentRunEvidence(company.id, vibeSiteExpert.id)
      : [];
    const vibeEvidence = sortEvidenceNewestFirst([
      ...(await Promise.all(vibeEvidenceIssues.map(collectIssueEvidence))).flat(),
      ...vibeRunEvidence,
    ]);
    const extractedVibeSite = extractVibeSiteBindingFromBodies(vibeEvidence);
    const effectiveMainBinding = getCompanyWixBinding(nextDescription);
    const sanitizedVibeSiteId =
      extractedVibeSite?.siteId &&
      !isReservedPaperclipEntityId(extractedVibeSite?.siteId, company, issues, agents) &&
      extractedVibeSite?.siteId !== effectiveMainBinding?.siteId &&
      extractedVibeSite?.siteId !== effectiveMainBinding?.metaSiteId
        ? extractedVibeSite?.siteId
        : undefined;
    const vibeSiteIdForVerification =
      sanitizedVibeSiteId ||
      (currentVibeSite?.siteId &&
      !isReservedPaperclipEntityId(currentVibeSite?.siteId, company, issues, agents) &&
      currentVibeSite?.siteId !== effectiveMainBinding?.siteId &&
      currentVibeSite?.siteId !== effectiveMainBinding?.metaSiteId
        ? currentVibeSite?.siteId
        : undefined) ||
      activation?.picassoBridge?.siteId;
    const picassoVerification = vibeSiteIdForVerification
      ? await verifyPicassoProject(vibeSiteIdForVerification).catch(() => null)
      : null;
    const verifiedVibeSiteUrl =
      picassoVerification?.effectiveStatus === "succeeded" &&
      picassoVerification?.publicUrlVerified === true
        ? picassoVerification.primarySiteUrl || picassoVerification.siteUrl
        : undefined;
    const sanitizedVibeSiteUrl =
      verifiedVibeSiteUrl && verifiedVibeSiteUrl !== effectiveMainBinding?.siteUrl
        ? verifiedVibeSiteUrl
        : undefined;
    const hasInvalidStoredVibeSiteUrl =
      Boolean(currentVibeSite?.siteUrl) &&
      (!isVibeSitePublicUrl(currentVibeSite?.siteUrl) ||
        currentVibeSite?.publicUrlVerified !== true);
    const hasInvalidStoredPicassoSiteUrl =
      Boolean(activation?.picassoBridge?.siteUrl) &&
      (!isVibeSitePublicUrl(activation?.picassoBridge?.siteUrl) ||
        activation?.picassoBridge?.publicUrlVerified !== true);
    const shouldClearStoredVibeSiteUrl =
      !sanitizedVibeSiteUrl &&
      (hasInvalidStoredVibeSiteUrl || hasInvalidStoredPicassoSiteUrl);
    const nextVibeSiteStatus =
      picassoVerification?.effectiveStatus ||
      extractedVibeSite?.status ||
      (shouldClearStoredVibeSiteUrl ? undefined : currentVibeSite?.status);
    const nextPicassoStatus =
      picassoVerification?.effectiveStatus ||
      (shouldClearStoredVibeSiteUrl ? undefined : activation?.picassoBridge?.status);

    if (
      sanitizedVibeSiteId ||
      extractedVibeSite?.jobId ||
      extractedVibeSite?.developmentUrl ||
      extractedVibeSite?.status ||
      sanitizedVibeSiteUrl ||
      picassoVerification?.projectId ||
      picassoVerification?.initialGenerationCompleted !== undefined
    ) {
      nextDescription = mergeCompanyDescription(nextDescription, {
        vibeSite: {
          siteId: sanitizedVibeSiteId || currentVibeSite?.siteId,
          siteUrl:
            sanitizedVibeSiteUrl ||
            (shouldClearStoredVibeSiteUrl ? "" : currentVibeSite?.siteUrl),
          publicUrlVerified:
            sanitizedVibeSiteUrl
              ? true
              : shouldClearStoredVibeSiteUrl
                ? false
                : currentVibeSite?.publicUrlVerified,
          jobId: extractedVibeSite?.jobId || currentVibeSite?.jobId,
          status: nextVibeSiteStatus || (shouldClearStoredVibeSiteUrl ? "" : undefined),
          developmentUrl: extractedVibeSite?.developmentUrl || currentVibeSite?.developmentUrl,
        },
        extra: activation
          ? {
              activation: {
                ...activation,
                picassoBridge: {
                  ...(activation.picassoBridge || {}),
                  siteId: vibeSiteIdForVerification || activation.picassoBridge?.siteId,
                  siteUrl:
                    sanitizedVibeSiteUrl ||
                    (shouldClearStoredVibeSiteUrl
                      ? ""
                      : activation.picassoBridge?.siteUrl),
                  publicUrlVerified:
                    sanitizedVibeSiteUrl
                      ? true
                      : picassoVerification?.publicUrlVerified ??
                        activation.picassoBridge?.publicUrlVerified,
                  projectId: picassoVerification?.projectId || activation.picassoBridge?.projectId,
                  initialGenerationCompleted:
                    picassoVerification?.initialGenerationCompleted ??
                    activation.picassoBridge?.initialGenerationCompleted,
                  status: nextPicassoStatus || (shouldClearStoredVibeSiteUrl ? "" : undefined),
                  error:
                    picassoVerification?.incompleteReason ||
                    activation.picassoBridge?.error,
                },
              },
            }
          : undefined,
      });
      vibeBindingApplied = true;
    }
  }

  if (!mainBindingApplied && !vibeBindingApplied && !bindingsSanitized) {
    return { company, mainBindingApplied, vibeBindingApplied };
  }

  const updatedCompany = await paperclip<PaperclipCompany>(`/companies/${company.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      description: nextDescription,
    }),
  }).catch(() => company);

  const mainBindingIssue = issues.find((issue) =>
    /bind verified wix site identity into company description/i.test(issue.title),
  );
  if (mainBindingApplied && mainBindingIssue && mainBindingIssue.status !== "done") {
    await paperclip(`/issues/${mainBindingIssue.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "done",
        assigneeAgentId: aiTeamLeadId || undefined,
      }),
    }).catch(() => null);
  }

  const vibeBindingIssue = issues.find((issue) =>
    /persist .*vibe-site metadata into company\.description/i.test(issue.title),
  );
  if (vibeBindingApplied && vibeBindingIssue && vibeBindingIssue.status !== "done") {
    await paperclip(`/issues/${vibeBindingIssue.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "done",
        assigneeAgentId: aiTeamLeadId || undefined,
      }),
    }).catch(() => null);
  }

  if (mainBindingApplied && mainSiteIssue && mainSiteIssue.status === "blocked") {
    await paperclip(`/issues/${mainSiteIssue.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "in_progress",
      }),
    }).catch(() => null);
  }

  if (vibeBindingApplied && vibeSiteIssue && vibeSiteIssue.status === "blocked") {
    await paperclip(`/issues/${vibeSiteIssue.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "in_progress",
      }),
    }).catch(() => null);
  }

  if (mainBindingApplied && mainSiteIssue) {
    await paperclip(`/issues/${mainSiteIssue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: "[System context - not visible to user]\nStartup repair persisted the verified main-site binding into company.description. Continue production-site work on the now-bound Wix site.",
      }),
    }).catch(() => null);
  }

  if (vibeBindingApplied && vibeSiteIssue) {
    await paperclip(`/issues/${vibeSiteIssue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: "[System context - not visible to user]\nStartup repair persisted the verified vibe-site metadata into company.description. Continue vibe-site iteration without touching wixBinding.",
      }),
    }).catch(() => null);
  }

  return {
    company: updatedCompany,
    mainBindingApplied,
    vibeBindingApplied,
  };
}

async function cancelRunsOnResolvedIssues(issues: PaperclipIssue[]) {
  const activeResolvedIssues = issues.filter(
    (issue) =>
      (issue.status === "done" || issue.status === "cancelled") &&
      issue.activeRun &&
      (issue.activeRun.status === "queued" || issue.activeRun.status === "running"),
  );

  if (activeResolvedIssues.length === 0) {
    return 0;
  }

  const cancelResults = await Promise.allSettled(
    activeResolvedIssues.map((issue) =>
      paperclip(`/heartbeat-runs/${issue.activeRun!.id}/cancel`, {
        method: "POST",
      }),
    ),
  );

  return cancelResults.filter((result) => result.status === "fulfilled").length;
}

async function reopenIncompleteStartupExecutionIssues(
  company: PaperclipCompany,
  issues: PaperclipIssue[],
) {
  const wixBinding = getCompanyWixBinding(company.description);
  const vibeSite = getCompanyVibeSite(company.description);
  const mainSiteIssue = issues.find((issue) => /launch the first site version/i.test(issue.title));
  const vibeSiteIssue = issues.find((issue) => /experimental vibe site/i.test(issue.title));
  const verifiedMainSiteUrl =
    wixBinding?.publicUrlVerified === true && isTrustworthySiteUrl(wixBinding?.siteUrl)
      ? wixBinding.siteUrl
      : undefined;
  const verifiedVibeSiteUrl =
    vibeSite?.publicUrlVerified === true && isVibeSitePublicUrl(vibeSite?.siteUrl)
      ? vibeSite.siteUrl
      : undefined;
  const mainSiteAudit = await auditLiveSiteForStarterTemplate(verifiedMainSiteUrl, company.name);
  const vibeSiteAudit = await auditLiveSiteForStarterTemplate(verifiedVibeSiteUrl, company.name);
  const vibeDifferentiationAudit = await auditVibeSiteDifferentiation(
    verifiedMainSiteUrl,
    verifiedVibeSiteUrl,
    company.name,
  );
  const contentProblems: string[] = [];

  let reopenedCount = 0;
  let reopenedMainIssue = false;
  let reopenedVibeIssue = false;

  if (mainSiteAudit) {
    contentProblems.push(`Main live site needs more work because ${mainSiteAudit.reason}.`);
  }

  if (vibeSiteAudit) {
    contentProblems.push(`Vibe live site needs more work because ${vibeSiteAudit.reason}.`);
  }

  if (vibeDifferentiationAudit) {
    contentProblems.push(`Vibe live site needs more work because ${vibeDifferentiationAudit.reason}.`);
  }

  if (mainSiteIssue?.status === "done") {
    const hasMainIdentity = Boolean(wixBinding?.metaSiteId || wixBinding?.siteId);
    const hasMainLiveUrl =
      wixBinding?.publicUrlVerified === true && isTrustworthySiteUrl(wixBinding?.siteUrl);
    const reason = !hasMainIdentity
      ? "the verified main-site identity is still missing from company.description"
      : !hasMainLiveUrl
        ? "the bound main site still lacks a trustworthy live site URL"
        : mainSiteAudit?.reason;

    if (reason) {

      await paperclip(`/issues/${mainSiteIssue.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "blocked",
        }),
      }).catch(() => null);

      await paperclip(`/issues/${mainSiteIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: `[System context - not visible to user]\nStartup validation reopened this production-site execution issue because ${reason}. Keep it open until the main business site has a verified identity, a trustworthy live URL, and public-page content that no longer looks like a generic starter template, or leave it blocked with the exact tooling blocker.`,
        }),
      }).catch(() => null);

      reopenedCount += 1;
      reopenedMainIssue = true;
    }
  }

  if (vibeSiteIssue?.status === "done") {
    const hasVibeIdentity = Boolean(vibeSite?.siteId || vibeSite?.jobId);
    const hasVibePublicUrl =
      vibeSite?.publicUrlVerified === true && isVibeSitePublicUrl(vibeSite?.siteUrl);
    const reason = !hasVibeIdentity
      ? "the verified vibe-site identity is still missing from company.description"
      : !hasVibePublicUrl
        ? "the vibe site still lacks a verified wix-vibe-site.com public URL"
        : vibeSiteAudit?.reason || vibeDifferentiationAudit?.reason;

    if (reason) {

      await paperclip(`/issues/${vibeSiteIssue.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "blocked",
        }),
      }).catch(() => null);

      await paperclip(`/issues/${vibeSiteIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: `[System context - not visible to user]\nStartup validation reopened this vibe-site execution issue because ${reason}. Keep it open until the experimental site has its own verified identity, trustworthy public URL, public-page content that no longer looks like a generic starter template, and a clearly different public presentation than the main site, or leave it blocked with the exact tooling blocker.`,
        }),
      }).catch(() => null);

      reopenedCount += 1;
      reopenedVibeIssue = true;
    }
  }

  return {
    reopenedCount,
    reopenedMainIssue,
    reopenedVibeIssue,
    contentProblems,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

function getConfiguredStarterTeam(company: PaperclipCompany): StarterTeamPlanEntry[] {
  const metadata = parseCompanyDescription(company.description);
  const activation = metadata.extra?.activation;
  if (!isRecord(activation) || !Array.isArray(activation.starterTeam)) {
    return [];
  }

  return activation.starterTeam
    .map<StarterTeamPlanEntry | null>((entry) => {
      if (!isRecord(entry) || typeof entry.role !== "string") {
        return null;
      }
      return {
        role: entry.role.trim(),
        goal: typeof entry.goal === "string" ? entry.goal.trim() : undefined,
        expectedResult:
          typeof entry.expectedResult === "string" ? entry.expectedResult.trim() : undefined,
      };
    })
    .filter((entry): entry is StarterTeamPlanEntry => Boolean(entry && entry.role));
}

const REQUIRED_STARTER_TEAM_REPAIR_ENTRIES: StarterTeamPlanEntry[] = [
  { role: "Industry Advisor" },
  { role: "Wix Site Expert" },
  { role: "Vibe Site Expert" },
  { role: "Content Manager" },
  { role: "Brand Lead" },
];

const BUSINESS_FIT_REPAIR_ROLE_FALLBACKS: Record<string, StarterTeamPlanEntry> = {
  "eCommerce Lead": { role: "eCommerce Lead" },
  "Catalog & Merchandising Manager": { role: "Catalog & Merchandising Manager" },
  "Growth Lead": { role: "Growth Lead" },
  "Content & SEO Manager": { role: "Content & SEO Manager" },
  "Bookings Operations Manager": { role: "Bookings Operations Manager" },
  "CRM & Lifecycle Manager": { role: "CRM & Lifecycle Manager" },
};

function inferRepairBusinessFitStarterRoles(
  company: PaperclipCompany,
  existingRoles: Set<string>,
): StarterTeamPlanEntry[] {
  const metadata = parseCompanyDescription(company.description);
  const activation = metadata.extra?.activation;
  const activationSummary = [
    metadata.businessDescription || "",
    isRecord(activation) && typeof activation.siteProposal === "string" ? activation.siteProposal : "",
    isRecord(activation) && typeof activation.firstBuildBrief === "string" ? activation.firstBuildBrief : "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  let preferredTitles: string[];
  if (/(tour|tours|booking|bookings|reservation|reservations|trip|trips|class|classes|appointment|appointments|service business|consultation)/.test(activationSummary)) {
    preferredTitles = ["Bookings Operations Manager", "CRM & Lifecycle Manager"];
  } else if (/(shop|store|product|products|collection|collections|inventory|retail|ecommerce|e-commerce|sell|sales|catalog|merchandising|handmade|physical goods)/.test(activationSummary)) {
    preferredTitles = ["eCommerce Lead", "Catalog & Merchandising Manager"];
  } else {
    preferredTitles = ["Growth Lead", "Content & SEO Manager"];
  }

  return preferredTitles
    .filter((title) => !existingRoles.has(title))
    .map((title) => BUSINESS_FIT_REPAIR_ROLE_FALLBACKS[title])
    .filter(isNonNullable)
    .slice(0, 2);
}

function ensureRepairStarterTeamCoverage(company: PaperclipCompany, starterTeam: StarterTeamPlanEntry[]) {
  const normalizedCoreTeam = REQUIRED_STARTER_TEAM_REPAIR_ENTRIES.map((requiredEntry) => {
    return starterTeam.find((entry) => entry.role === requiredEntry.role) || requiredEntry;
  });
  const additionalEntries = starterTeam.filter((entry) =>
    !REQUIRED_STARTER_TEAM_REPAIR_ENTRIES.some((requiredEntry) => requiredEntry.role === entry.role),
  );
  const coveredTeam = [...normalizedCoreTeam, ...additionalEntries];
  const existingRoles = new Set(coveredTeam.map((entry) => entry.role));
  const inferredBusinessFitRoles = inferRepairBusinessFitStarterRoles(company, existingRoles);

  return [...coveredTeam, ...inferredBusinessFitRoles];
}

async function createStarterTeamAgents(company: PaperclipCompany, existingAgents: PaperclipAgent[]) {
  const configuredStarterTeam = getConfiguredStarterTeam(company);
  const fallbackStarterTeam: StarterTeamPlanEntry[] = ensureRepairStarterTeamCoverage(company, []);
  const starterTeam = ensureRepairStarterTeamCoverage(
    company,
    configuredStarterTeam.length > 0 ? configuredStarterTeam : fallbackStarterTeam,
  )
    .filter((entry) => entry.role !== "AI Team Lead");

  const existingTitles = new Set(
    existingAgents.flatMap((agent) => [
      agent.title?.trim().toLowerCase() || "",
      agent.name.trim().toLowerCase(),
    ]).filter(Boolean),
  );
  const createdAgentIds: string[] = [];

  for (const planEntry of starterTeam) {
    const definition = getCanonicalAgentDefinitionByTitle(planEntry.role);
    if (!definition) {
      continue;
    }
    if (existingTitles.has(definition.title.trim().toLowerCase())) {
      continue;
    }

    const promptTemplate = [
      renderPromptTemplate(definition.promptTemplate, company),
      planEntry.goal ? `\nCurrent startup goal\n- ${planEntry.goal}` : "",
      planEntry.expectedResult ? `\nExpected startup result\n- ${planEntry.expectedResult}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const createdAgent = await paperclip<PaperclipAgent>(`/companies/${company.id}/agents`, {
      method: "POST",
      body: JSON.stringify(syncHeartbeatConfig({
        name: definition.title,
        role: getPaperclipRoleForAgentTitle(definition.title),
        title: definition.title,
        icon: definition.icon,
        capabilities: definition.capabilities.join(", "),
        adapterType: DEFAULT_OPENAI_ADAPTER_TYPE,
        adapterConfig: {
          model: DEFAULT_OPENAI_SPECIALIST_MODEL,
          heartbeatIntervalSec: DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
          dangerouslyBypassApprovalsAndSandbox: true,
          timeoutSec: DEFAULT_AGENT_TIMEOUT_SEC,
          promptTemplate,
        },
        runtimeConfig: buildSpecialistHeartbeatRuntimeConfig(),
      })),
    }).catch(() => null);

    if (!createdAgent) {
      continue;
    }

    createdAgentIds.push(createdAgent.id);
    existingTitles.add(definition.title.trim().toLowerCase());
  }

  return createdAgentIds;
}

async function handoffStartupTasks(
  companyId: string,
  issues: PaperclipIssue[],
  agents: PaperclipAgent[],
) {
  const wixSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "wix site expert");
  const vibeSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "vibe site expert");
  const contentManager = agents.find((agent) => agent.title?.trim().toLowerCase() === "content manager");
  const industryAdvisor = agents.find((agent) => agent.title?.trim().toLowerCase() === "industry advisor");
  const brandLead = agents.find((agent) => agent.title?.trim().toLowerCase() === "brand lead");
  const bookingsManager = agents.find((agent) => agent.title?.trim().toLowerCase() === "bookings operations manager");

  let updated = 0;

  await Promise.all(issues.map(async (issue) => {
    const title = issue.title.trim().toLowerCase();
    let patch: Record<string, unknown> | null = null;

    if (
      (/assemble the starter team/.test(title) ||
        /approve starter team hires/.test(title) ||
        /build the starter team/.test(title) ||
        /hire and activate the starter team/.test(title)) &&
      issue.status !== "done"
    ) {
      patch = {
        status: "done",
        comment: "Starter team was activated automatically after the main site was bound.",
      };
    } else if (vibeSiteExpert && /vibe site|experimental vibe site|picasso/.test(title)) {
      patch = {
        assigneeAgentId: vibeSiteExpert.id,
        comment: "Reassigned to Vibe Site Expert for the experimental Picasso track.",
      };
    } else if (wixSiteExpert && /launch the first site|site version|site build|site execution/.test(title)) {
      patch = {
        assigneeAgentId: wixSiteExpert.id,
        comment: "Reassigned to Wix Site Expert now that the main site is bound and the startup team is live.",
      };
    } else if (contentManager && /instagram|flickr|gallery|source content|site materials|site copy|external source|content/.test(title)) {
      patch = {
        assigneeAgentId: contentManager.id,
        comment: "Reassigned to Content Manager for source-content extraction and site-ready content preparation.",
      };
    } else if (bookingsManager && /lead intake|follow-up|booking|inquiry/.test(title)) {
      patch = {
        assigneeAgentId: bookingsManager.id,
        comment: "Reassigned to Bookings Operations Manager for launch-phase inquiry flow ownership.",
      };
    } else if ((brandLead || industryAdvisor) && /positioning|brand|message|messaging|offer/.test(title)) {
      patch = {
        assigneeAgentId: (brandLead || industryAdvisor)!.id,
        comment: brandLead
          ? "Reassigned to Brand Lead for launch-phase offer framing, messaging, and trust direction."
          : "Reassigned to Industry Advisor for launch-phase positioning and trust framing.",
      };
    }

    if (!patch) {
      return;
    }

    updated += 1;
    await paperclip(`/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).catch(() => null);
  }));

  return updated;
}

async function closeResolvedStartupFollowups(
  companyId: string,
  issues: PaperclipIssue[],
  pendingApprovals: number,
  hasMainSiteIdentity: boolean,
  hasVibeSiteIdentity: boolean,
  _aiTeamLeadId: string | null,
) {
  let closed = 0;

  await Promise.all(issues.map(async (issue) => {
    const title = issue.title.trim().toLowerCase();

    const markDone = async () => {
      const result = await paperclip(`/issues/${issue.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "done",
        }),
      }).catch(() => null);
      if (result) {
        closed += 1;
      }
    };

    if (
      pendingApprovals === 0 &&
      /(resolve pending specialist hire approvals|approve pending launch specialists|approve .* starter hires)/.test(title) &&
      issue.status !== "done"
    ) {
      await markDone();
      return;
    }

    if (
      hasMainSiteIdentity &&
      hasVibeSiteIdentity &&
      /apply .*metadata patch/.test(title) &&
      issue.status !== "done"
    ) {
      await markDone();
      return;
    }

    if (
      hasMainSiteIdentity &&
      /(bind .* main site identity into wixbinding|bind verified wix site identity into company description|provision main production site)/.test(title) &&
      issue.status !== "done"
    ) {
      await markDone();
      return;
    }

    if (
      hasVibeSiteIdentity &&
      /(record verified vibe-site metadata in company description|persist .*vibe-site metadata into company\.description)/.test(title) &&
      issue.status !== "done"
    ) {
      await markDone();
    }
  }));

  return closed;
}

export async function repairCompanyState(companyId: string, options?: { startup?: boolean }): Promise<CompanyRepairResult> {
  const startup = Boolean(options?.startup);
  const company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
  let approvalsApproved = 0;
  const { promptSync, instructionFilesSynced, timeoutDefaultsUpdated, heartbeatDefaultsUpdated } =
    await syncPromptsAndInstructions(company);
  const refreshedCompany = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
  const agents = await paperclip<PaperclipAgent[]>(`/companies/${companyId}/agents`).catch(() => []);
  const issues = await paperclip<PaperclipIssue[]>(`/companies/${companyId}/issues`).catch(() => []);
  const staleTasksUpdated = await cleanStaleBoardTasks(refreshedCompany, issues).catch(() => 0);
  const notes: string[] = [];
  const startupContentProblems: string[] = [];
  let detachedStartupRunsCancelled = 0;
  let starterAgentsCreated = 0;
  let startupTasksHandedOff = 0;
  let startupSiteBindingsApplied = 0;
  let startupExecutionIssuesReopened = 0;
  let resolvedStartupFollowups = 0;
  let resolvedIssueRunsCancelled = 0;
  const agentsToWake = new Set<string>();

  const aiTeamLead =
    agents.find((agent) => agent.role === "ceo") ||
    agents.find((agent) => agent.title?.trim().toLowerCase() === "ai team lead") ||
    null;

  if (startup) {
    const bindingRepair = await repairStartupSiteBindings(refreshedCompany, issues, agents, aiTeamLead?.id || null)
      .catch(() => null);
    if (bindingRepair) {
      refreshedCompany.description = bindingRepair.company.description;
      startupSiteBindingsApplied =
        Number(bindingRepair.mainBindingApplied) + Number(bindingRepair.vibeBindingApplied);
    }
  }

  const binding = getBindingProblems(refreshedCompany);
  const liveSpecialistsAtStart = agents.filter((agent) => isLiveSpecialist(agent, aiTeamLead?.id || null));
  const specialistShellCount = agents.filter((agent) => agent.id !== aiTeamLead?.id).length - liveSpecialistsAtStart.length;

  if (startup && binding.mode === "new_site" && aiTeamLead) {
    let workingAgents = agents;
    let workingIssues = issues;
    let wokeStartupTeam = false;

    const startupAgentIds = workingAgents
      .filter((agent) => agent.id === aiTeamLead.id || isLiveSpecialist(agent, aiTeamLead.id))
      .map((agent) => agent.id);

    detachedStartupRunsCancelled = await cancelDetachedStartupRuns(companyId, startupAgentIds).catch(() => 0);
    if (detachedStartupRunsCancelled > 0) {
      workingAgents
        .filter((agent) => isLiveSpecialist(agent, aiTeamLead.id))
        .forEach((agent) => agentsToWake.add(agent.id));
      agentsToWake.add(aiTeamLead.id);
    }

    if (binding.hasSiteIdentity) {
      const liveSpecialistsBeforeCreation = workingAgents.filter((agent) =>
        isLiveSpecialist(agent, aiTeamLead.id),
      );

      if (liveSpecialistsBeforeCreation.length === 0) {
        const createdAgentIds = await createStarterTeamAgents(refreshedCompany, workingAgents).catch(() => []);
        starterAgentsCreated = createdAgentIds.length;
        if (starterAgentsCreated > 0) {
          createdAgentIds.forEach((agentId) => agentsToWake.add(agentId));
          workingAgents = await paperclip<PaperclipAgent[]>(`/companies/${companyId}/agents`).catch(() => agents);
        }
      }

      const liveSpecialists = workingAgents.filter((agent) => isLiveSpecialist(agent, aiTeamLead.id));
      if (liveSpecialists.length > 0) {
        workingIssues = await paperclip<PaperclipIssue[]>(`/companies/${companyId}/issues`).catch(() => issues);
        startupTasksHandedOff = await handoffStartupTasks(companyId, workingIssues, workingAgents).catch(() => 0);
      }

      if (starterAgentsCreated > 0 || startupTasksHandedOff > 0 || startupSiteBindingsApplied > 0) {
        workingAgents
          .filter((agent) => isLiveSpecialist(agent, aiTeamLead.id))
          .forEach((agent) => agentsToWake.add(agent.id));
        agentsToWake.add(aiTeamLead.id);
      }
    } else if (startupSiteBindingsApplied > 0) {
      workingAgents
        .filter((agent) => isLiveSpecialist(agent, aiTeamLead.id))
        .forEach((agent) => agentsToWake.add(agent.id));
      agentsToWake.add(aiTeamLead.id);
    }

    if (agentsToWake.size > 0) {
      await wakeAgents(Array.from(agentsToWake)).catch(() => null);
      wokeStartupTeam = true;
    }

    if (!wokeStartupTeam && approvalsApproved > 0) {
      await wakeAiTeamLead(companyId).catch(() => null);
    }
  }

  const pendingApprovals = await countPendingApprovals(companyId).catch(() => 0);
  let issuesForCloseout = issues;
  if (startup) {
    issuesForCloseout = await paperclip<PaperclipIssue[]>(`/companies/${companyId}/issues`).catch(() => issues);
    const reopened = await reopenIncompleteStartupExecutionIssues(refreshedCompany, issuesForCloseout).catch(() => ({
      reopenedCount: 0,
      reopenedMainIssue: false,
      reopenedVibeIssue: false,
      contentProblems: [] as string[],
    }));
    startupExecutionIssuesReopened = reopened.reopenedCount;
    startupContentProblems.push(...reopened.contentProblems);
    if (reopened.reopenedMainIssue) {
      const wixSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "wix site expert");
      if (wixSiteExpert?.id) {
        agentsToWake.add(wixSiteExpert.id);
      }
      if (aiTeamLead?.id) {
        agentsToWake.add(aiTeamLead.id);
      }
    }
    if (reopened.reopenedVibeIssue) {
      const vibeSiteExpert = agents.find((agent) => agent.title?.trim().toLowerCase() === "vibe site expert");
      if (vibeSiteExpert?.id) {
        agentsToWake.add(vibeSiteExpert.id);
      }
      if (aiTeamLead?.id) {
        agentsToWake.add(aiTeamLead.id);
      }
    }
    if (startupExecutionIssuesReopened > 0 && agentsToWake.size > 0) {
      await wakeAgents(Array.from(agentsToWake)).catch(() => null);
    }
  }
  resolvedStartupFollowups = await closeResolvedStartupFollowups(
    companyId,
    issuesForCloseout,
    pendingApprovals,
    Boolean(getCompanyWixBinding(refreshedCompany.description)?.metaSiteId || getCompanyWixBinding(refreshedCompany.description)?.siteId),
    Boolean(getCompanyVibeSite(refreshedCompany.description)?.siteId || getCompanyVibeSite(refreshedCompany.description)?.jobId),
    aiTeamLead?.id || null,
  ).catch(() => 0);
  resolvedIssueRunsCancelled = await cancelRunsOnResolvedIssues(issuesForCloseout).catch(() => 0);

  if (approvalsApproved > 0) {
    await wakeAiTeamLead(companyId).catch(() => null);
  }

  if (pendingApprovals > 0) {
    notes.push(`${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"} still need board review.`);
  }
  if (approvalsApproved > 0) {
    notes.push(`Auto-approved ${approvalsApproved} pending starter-team hire approval${approvalsApproved === 1 ? "" : "s"}.`);
  }
  if (detachedStartupRunsCancelled > 0) {
    notes.push(`Cancelled ${detachedStartupRunsCancelled} detached startup run${detachedStartupRunsCancelled === 1 ? "" : "s"} and re-woke the starter team.`);
  }
  if (starterAgentsCreated > 0) {
    notes.push(`Created ${starterAgentsCreated} starter-team specialist agent${starterAgentsCreated === 1 ? "" : "s"} after main-site binding.`);
  }
  if (startupSiteBindingsApplied > 0) {
    notes.push(`Persisted ${startupSiteBindingsApplied} verified startup site binding${startupSiteBindingsApplied === 1 ? "" : "s"} from specialist output.`);
  }
  if (startupExecutionIssuesReopened > 0) {
    notes.push(`Reopened ${startupExecutionIssuesReopened} startup execution issue${startupExecutionIssuesReopened === 1 ? "" : "s"} that had been marked done before the demo success criteria were actually met.`);
  }
  if (startupContentProblems.length > 0) {
    binding.problems.push(...startupContentProblems);
  }
  if (resolvedStartupFollowups > 0) {
    notes.push(`Closed ${resolvedStartupFollowups} resolved startup follow-up task${resolvedStartupFollowups === 1 ? "" : "s"}.`);
  }
  if (resolvedIssueRunsCancelled > 0) {
    notes.push(
      `Cancelled ${resolvedIssueRunsCancelled} active run${resolvedIssueRunsCancelled === 1 ? "" : "s"} attached to already-resolved issues.`,
    );
  }
  if (startupTasksHandedOff > 0) {
    notes.push(`Handed off ${startupTasksHandedOff} startup task${startupTasksHandedOff === 1 ? "" : "s"} to the live specialists.`);
  }
  if (promptSync.updatedCount > 0) {
    notes.push(`Updated ${promptSync.updatedCount} stored agent prompt${promptSync.updatedCount === 1 ? "" : "s"}.`);
  }
  if (instructionFilesSynced > 0) {
    notes.push(`Synced ${instructionFilesSynced} managed runtime instruction file${instructionFilesSynced === 1 ? "" : "s"}.`);
  }
  if (timeoutDefaultsUpdated > 0) {
    notes.push(`Updated ${timeoutDefaultsUpdated} agent timeout default${timeoutDefaultsUpdated === 1 ? "" : "s"} to 30 minutes.`);
  }
  if (heartbeatDefaultsUpdated > 0) {
    notes.push(
      `Updated ${heartbeatDefaultsUpdated} agent heartbeat default${heartbeatDefaultsUpdated === 1 ? "" : "s"} so only the AI Team Lead stays scheduled by default.`,
    );
  }
  if (staleTasksUpdated > 0) {
    notes.push(`Cleaned ${staleTasksUpdated} stale board task${staleTasksUpdated === 1 ? "" : "s"}.`);
  }
  if (binding.problems.length === 0) {
    notes.push(
      binding.mode === "new_site"
        ? "New-site startup is active and the team can move the main live-site and vibe-site tracks forward."
        : binding.hasSiteIdentity
          ? "Wix binding is locked and ready for site work."
          : "Company repair completed.",
    );
  }

  const ready = binding.problems.length === 0 && promptSync.errorCount === 0;

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
    timeoutDefaultsUpdated,
    heartbeatDefaultsUpdated,
    binding,
    notes,
  };
}

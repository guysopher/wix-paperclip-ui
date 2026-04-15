import type { Agent, HeartbeatRun } from "@/lib/api";

const PAPERCLIP_RUNTIME_DEFAULT_MODEL = "gpt-4o-mini";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseUsageModel(usageJson: string | null): string | null {
  if (!usageJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(usageJson) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (asNonEmptyString(parsed.model)) {
      return asNonEmptyString(parsed.model);
    }

    if (isRecord(parsed.usage)) {
      return asNonEmptyString(parsed.usage.model);
    }

    return null;
  } catch {
    return null;
  }
}

export function getRuntimeModel(agent: Agent, runs: HeartbeatRun[]): string {
  const latestRunModel = [...runs]
    .filter((run) => run.agentId === agent.id)
    .sort((a, b) => {
      const aTime = a.finishedAt || a.startedAt || a.createdAt;
      const bTime = b.finishedAt || b.startedAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    })
    .map((run) => parseUsageModel(run.usageJson))
    .find(Boolean);

  return latestRunModel || PAPERCLIP_RUNTIME_DEFAULT_MODEL;
}

export function getRuntimeModelLabel(model: string): string {
  return model || PAPERCLIP_RUNTIME_DEFAULT_MODEL;
}

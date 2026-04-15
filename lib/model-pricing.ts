import type { HeartbeatRun } from "@/lib/api";

type UsageRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UsageRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type ModelRate = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_RATES: Record<string, ModelRate> = {
  "gpt-4o": { inputPerMillion: 2.5, cachedInputPerMillion: 1.25, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.6 },
  "gpt-5.4": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
  "gpt-5.4-mini": { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 },
  "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
};

export type ParsedRunUsage = {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
};

export function getModelRate(model: string | null): ModelRate | null {
  if (!model) {
    return null;
  }

  return MODEL_RATES[model] || null;
}

export function calculateUsageCost(model: string | null, inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const rate = getModelRate(model);
  if (!rate) {
    return 0;
  }

  return (
    (inputTokens / 1_000_000) * rate.inputPerMillion +
    (cachedInputTokens / 1_000_000) * rate.cachedInputPerMillion +
    (outputTokens / 1_000_000) * rate.outputPerMillion
  );
}

export function parseUsageJson(usageJson: string | null): ParsedRunUsage | null {
  if (!usageJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(usageJson) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const nestedUsage = isRecord(parsed.usage) ? parsed.usage : null;
    const model =
      asNonEmptyString(parsed.model) ||
      asNonEmptyString(parsed.modelName) ||
      asNonEmptyString(parsed.model_name) ||
      asNonEmptyString(nestedUsage?.model) ||
      asNonEmptyString(nestedUsage?.modelName) ||
      asNonEmptyString(nestedUsage?.model_name);

    const inputTokens =
      asNumber(parsed.rawInputTokens) ||
      asNumber(parsed.inputTokens) ||
      asNumber(parsed.input_tokens) ||
      asNumber(nestedUsage?.input_tokens) ||
      asNumber(nestedUsage?.inputTokens);
    const outputTokens =
      asNumber(parsed.rawOutputTokens) ||
      asNumber(parsed.outputTokens) ||
      asNumber(parsed.output_tokens) ||
      asNumber(nestedUsage?.output_tokens) ||
      asNumber(nestedUsage?.outputTokens);
    const cachedInputTokens =
      asNumber(parsed.cachedInputTokens) ||
      asNumber(parsed.cached_input_tokens) ||
      asNumber(parsed.cache_read_input_tokens) ||
      asNumber(nestedUsage?.cached_input_tokens) ||
      asNumber(nestedUsage?.cachedInputTokens) ||
      asNumber(nestedUsage?.cache_read_input_tokens);

    const explicitCost =
      asNumber(parsed.costUsd) ||
      asNumber(parsed.total_cost_usd) ||
      asNumber(nestedUsage?.cost_usd) ||
      asNumber(nestedUsage?.costUsd);
    const calculatedCost = calculateUsageCost(model, inputTokens, cachedInputTokens, outputTokens);

    return {
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costUsd: calculatedCost || explicitCost,
    };
  } catch {
    return null;
  }
}

export function parseRunUsage(run: HeartbeatRun): ParsedRunUsage | null {
  return parseUsageJson(run.usageJson);
}

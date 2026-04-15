export interface AgentHeartbeatConfigSource {
  adapterConfig?: Record<string, unknown> | null;
  runtimeConfig?: Record<string, unknown> | null;
}

interface HeartbeatConfig {
  enabled?: boolean;
  intervalSec?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getRuntimeHeartbeat(source: AgentHeartbeatConfigSource): HeartbeatConfig {
  const runtimeConfig = isRecord(source.runtimeConfig) ? source.runtimeConfig : {};
  const heartbeat = isRecord(runtimeConfig.heartbeat) ? runtimeConfig.heartbeat : {};
  return {
    enabled: asBoolean(heartbeat.enabled),
    intervalSec: asNumber(heartbeat.intervalSec),
  };
}

function getAdapterHeartbeatInterval(source: AgentHeartbeatConfigSource): number | undefined {
  const adapterConfig = isRecord(source.adapterConfig) ? source.adapterConfig : {};
  return asNumber(adapterConfig.heartbeatIntervalSec);
}

export function getHeartbeatPolicy(source: AgentHeartbeatConfigSource): {
  enabled: boolean;
  intervalSec: number;
} {
  const runtimeHeartbeat = getRuntimeHeartbeat(source);
  const intervalSec = runtimeHeartbeat.intervalSec ?? getAdapterHeartbeatInterval(source) ?? 0;
  const enabled = runtimeHeartbeat.enabled ?? intervalSec > 0;
  return {
    enabled,
    intervalSec: enabled ? intervalSec : 0,
  };
}

export function syncHeartbeatConfig<T extends Record<string, unknown>>(payload: T): T {
  const adapterConfig = isRecord(payload.adapterConfig) ? payload.adapterConfig : {};
  const runtimeConfig = isRecord(payload.runtimeConfig) ? payload.runtimeConfig : {};
  const runtimeHeartbeat = getRuntimeHeartbeat(payload);
  const intervalSec = runtimeHeartbeat.intervalSec ?? getAdapterHeartbeatInterval(payload);
  const enabled = runtimeHeartbeat.enabled ?? (intervalSec !== undefined ? intervalSec > 0 : undefined);

  if (intervalSec === undefined && enabled === undefined) {
    return payload;
  }

  const nextHeartbeat: Record<string, unknown> = {
    ...(isRecord(runtimeConfig.heartbeat) ? runtimeConfig.heartbeat : {}),
  };
  if (enabled !== undefined) {
    nextHeartbeat.enabled = enabled;
  }
  if (intervalSec !== undefined) {
    nextHeartbeat.intervalSec = intervalSec;
  }

  return {
    ...payload,
    adapterConfig: {
      ...adapterConfig,
      ...(intervalSec !== undefined ? { heartbeatIntervalSec: intervalSec } : {}),
    },
    runtimeConfig: {
      ...runtimeConfig,
      heartbeat: nextHeartbeat,
    },
  };
}

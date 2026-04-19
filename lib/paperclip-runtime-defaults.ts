export const DEFAULT_OPENAI_ADAPTER_TYPE = "codex_local";
export const DEFAULT_OPENAI_TEAM_LEAD_MODEL = "gpt-5.4";
export const DEFAULT_OPENAI_SPECIALIST_MODEL = "gpt-5.4";
export const DEFAULT_AGENT_TIMEOUT_SEC = 1800;
export const DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC = 300;
export const DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC = 0;

export function buildTeamLeadHeartbeatRuntimeConfig() {
  return {
    heartbeat: {
      enabled: true,
      intervalSec: DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC,
      wakeOnAssignment: true,
      wakeOnOnDemand: true,
      wakeOnAutomation: true,
    },
  };
}

export function buildSpecialistHeartbeatRuntimeConfig() {
  return {
    heartbeat: {
      enabled: false,
      intervalSec: DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
      wakeOnAssignment: true,
      wakeOnOnDemand: true,
      wakeOnAutomation: true,
    },
  };
}

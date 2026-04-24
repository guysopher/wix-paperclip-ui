export type PaperclipDeploymentMode = "remote" | "local";
export type SiteAutomationMode = "bridge" | "embedded";

export interface DeploymentTopology {
  paperclipDeploymentMode: PaperclipDeploymentMode;
  siteAutomationMode: SiteAutomationMode;
  paperclipApiUrl: string;
  paperclipRestartUrl: string | null;
  paperclipUpstreamConfigured: boolean;
  siteAutomationBaseUrl: string;
  siteAutomationUpstreamConfigured: boolean;
  siteAutomationToken: string;
  siteAutomationTokenRequired: boolean;
  usesLocalPaperclipUpstream: boolean;
  usesLocalSiteAutomationUpstream: boolean;
}

const DEFAULT_PAPERCLIP_API_URL = "http://localhost:3100/api";
const DEFAULT_SITE_AUTOMATION_BRIDGE_URL = "http://localhost:3401";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeMode<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!value) {
    return fallback;
  }

  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function usesLocalhostUpstream(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

function getExplicitPaperclipApiUrl(): string {
  return stripTrailingSlash(process.env.PAPERCLIP_API_URL || process.env.NEXT_PUBLIC_PAPERCLIP_API_URL || "");
}

function inferPaperclipDeploymentMode(paperclipApiUrl: string): PaperclipDeploymentMode {
  return usesLocalhostUpstream(paperclipApiUrl) ? "local" : "remote";
}

function getRequestedPaperclipDeploymentMode(explicitPaperclipApiUrl: string): PaperclipDeploymentMode {
  return normalizeMode(
    process.env.PAPERCLIP_DEPLOYMENT_MODE,
    ["remote", "local"] as const,
    explicitPaperclipApiUrl ? inferPaperclipDeploymentMode(explicitPaperclipApiUrl) : "local",
  );
}

function resolvePaperclipApiUrl(
  mode: PaperclipDeploymentMode,
  explicitPaperclipApiUrl: string,
): string {
  if (explicitPaperclipApiUrl) {
    return explicitPaperclipApiUrl;
  }

  return mode === "local" ? DEFAULT_PAPERCLIP_API_URL : "";
}

function getEmbeddedSiteAutomationBaseUrl(paperclipApiUrl: string): string {
  return stripTrailingSlash(
    process.env.SITE_AUTOMATION_EMBEDDED_URL ||
      process.env.PAPERCLIP_SITE_AUTOMATION_URL ||
      `${paperclipApiUrl}/site-automation`,
  );
}

export function getDeploymentTopology(): DeploymentTopology {
  const explicitPaperclipApiUrl = getExplicitPaperclipApiUrl();
  const paperclipDeploymentMode = getRequestedPaperclipDeploymentMode(explicitPaperclipApiUrl);
  const paperclipApiUrl = resolvePaperclipApiUrl(paperclipDeploymentMode, explicitPaperclipApiUrl);
  const siteAutomationMode = normalizeMode(
    process.env.SITE_AUTOMATION_MODE,
    ["bridge", "embedded"] as const,
    "bridge",
  );
  const explicitSiteAutomationUrl =
    siteAutomationMode === "embedded"
      ? stripTrailingSlash(process.env.SITE_AUTOMATION_EMBEDDED_URL || process.env.PAPERCLIP_SITE_AUTOMATION_URL || "")
      : stripTrailingSlash(process.env.PICASSO_BRIDGE_URL || "");
  const siteAutomationBaseUrl =
    explicitSiteAutomationUrl ||
    (siteAutomationMode === "embedded"
      ? paperclipDeploymentMode === "local" && paperclipApiUrl
        ? getEmbeddedSiteAutomationBaseUrl(paperclipApiUrl)
        : ""
      : paperclipDeploymentMode === "local"
        ? DEFAULT_SITE_AUTOMATION_BRIDGE_URL
        : "");
  const siteAutomationToken =
    siteAutomationMode === "embedded"
      ? process.env.SITE_AUTOMATION_TOKEN || process.env.PAPERCLIP_SITE_AUTOMATION_TOKEN || ""
      : process.env.PICASSO_BRIDGE_TOKEN || "";

  return {
    paperclipDeploymentMode,
    siteAutomationMode,
    paperclipApiUrl,
    paperclipRestartUrl: process.env.PAPERCLIP_RESTART_URL || null,
    paperclipUpstreamConfigured: Boolean(paperclipApiUrl),
    siteAutomationBaseUrl,
    siteAutomationUpstreamConfigured:
      siteAutomationMode === "embedded"
        ? Boolean(explicitSiteAutomationUrl)
        : Boolean(siteAutomationBaseUrl),
    siteAutomationToken,
    siteAutomationTokenRequired: siteAutomationMode === "bridge" && Boolean(siteAutomationBaseUrl),
    usesLocalPaperclipUpstream: usesLocalhostUpstream(paperclipApiUrl),
    usesLocalSiteAutomationUpstream: usesLocalhostUpstream(siteAutomationBaseUrl),
  };
}

export function getResolvedPaperclipApiUrl(): string {
  return getDeploymentTopology().paperclipApiUrl;
}

export function getSiteAutomationLabel(topology: DeploymentTopology): string {
  return topology.siteAutomationMode === "embedded" ? "embedded site automation" : "Picasso bridge";
}

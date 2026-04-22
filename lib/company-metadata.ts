import type { Company } from "./api";

export interface WixBindingMetadata {
  metaSiteId?: string;
  siteId?: string;
  siteName?: string;
  siteUrl?: string;
  activationIssueId?: string;
  auth?: Record<string, string>;
  data?: Record<string, unknown>;
}

export interface VibeSiteMetadata {
  siteId?: string;
  siteUrl?: string;
  jobId?: string;
  status?: string;
  developmentUrl?: string;
}

export interface CompanyDescriptionMetadata {
  version: 1;
  businessDescription?: string;
  wixBinding?: WixBindingMetadata;
  vibeSite?: VibeSiteMetadata;
  extra?: Record<string, unknown>;
}

export type ActivationMode = "existing_site" | "new_site";
export type NewSiteInterviewStage =
  | "business_name"
  | "business_description"
  | "site_specifics"
  | "building"
  | "complete";

export interface NewSiteInterviewMetadata {
  stage: NewSiteInterviewStage;
  businessName?: string;
  businessDescription?: string;
  siteSpecifics?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PicassoBridgeMetadata {
  jobId?: string;
  status?: string;
  siteId?: string;
  siteUrl?: string;
  projectId?: string;
  initialGenerationCompleted?: boolean;
  developmentUrl?: string;
  requestedAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface ActivationStarterTeamEntry {
  role: string;
  goal?: string;
  expectedResult?: string;
}

export interface ActivationMetadata {
  mode?: ActivationMode;
  newSiteInterview?: NewSiteInterviewMetadata;
  picassoBridge?: PicassoBridgeMetadata;
  starterTeam?: ActivationStarterTeamEntry[];
  sourceLinks?: string[];
}

function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

const LEGACY_METASITE_PATTERN = /metasite\s+([0-9a-fA-F-]{36})/i;
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version",
  "businessDescription",
  "wixBinding",
  "metaSiteId",
  "siteId",
  "siteName",
  "siteUrl",
  "vibeSite",
  "vibeSiteId",
  "vibeSiteUrl",
  "vibeSiteJobId",
  "vibeSiteStatus",
  "vibeSiteDevelopmentUrl",
  "activationIssueId",
  "auth",
  "data",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

function normalizeHttpUrl(value: unknown): string | undefined {
  const raw = getString(value)?.trim();
  if (!raw) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }

  return parsed.toString();
}

export function isVibeSitePublicUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.trim().toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (hostname === "wix-vibe-site.com" || hostname.endsWith(".wix-vibe-site.com"))
    );
  } catch {
    return false;
  }
}

export function normalizeVibeSiteUrl(value: unknown): string | undefined {
  const normalized = normalizeHttpUrl(value);
  return isVibeSitePublicUrl(normalized) ? normalized : undefined;
}

function normalizePublicSiteUrl(value: unknown): string | undefined {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = new URL(normalized);

  if (/^www\.wix\.com$/i.test(parsed.hostname) && (parsed.pathname === "/" || parsed.pathname === "")) {
    return undefined;
  }

  if (isDisallowedPublicSiteHost(parsed.hostname)) {
    return undefined;
  }

  return normalized;
}

function getStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === "string");
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function getUnknownMap(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function getActivationMode(value: unknown): ActivationMode | undefined {
  return value === "existing_site" || value === "new_site" ? value : undefined;
}

function normalizeNewSiteInterview(value: unknown): NewSiteInterviewMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const stage = value.stage;
  if (
    stage !== "business_name" &&
    stage !== "business_description" &&
    stage !== "site_specifics" &&
    stage !== "building" &&
    stage !== "complete"
  ) {
    return undefined;
  }

  return {
    stage,
    businessName: getString(value.businessName),
    businessDescription: getString(value.businessDescription),
    siteSpecifics: getString(value.siteSpecifics),
    startedAt: getString(value.startedAt),
    completedAt: getString(value.completedAt),
  };
}

function normalizePicassoBridge(value: unknown): PicassoBridgeMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const directSiteUrl = normalizeVibeSiteUrl(value.siteUrl);
  const rawDevelopmentUrl = normalizeHttpUrl(value.developmentUrl);
  const fallbackDevelopmentUrl =
    !directSiteUrl && !rawDevelopmentUrl ? normalizeHttpUrl(value.siteUrl) : undefined;

  return {
    jobId: getString(value.jobId),
    status: getString(value.status),
    siteId: getString(value.siteId),
    siteUrl: directSiteUrl,
    projectId: getString(value.projectId),
    initialGenerationCompleted: getBoolean(value.initialGenerationCompleted),
    developmentUrl: rawDevelopmentUrl || fallbackDevelopmentUrl,
    requestedAt: getString(value.requestedAt),
    updatedAt: getString(value.updatedAt),
    error: getString(value.error),
  };
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStarterTeam(value: unknown): ActivationStarterTeamEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry): ActivationStarterTeamEntry | null => {
      if (!isRecord(entry) || typeof entry.role !== "string") {
        return null;
      }

      const role = entry.role.trim();
      if (!role) {
        return null;
      }

      return {
        role,
        goal: getString(entry.goal),
        expectedResult: getString(entry.expectedResult),
      };
    })
    .filter(isNonNullable);

  return normalized.length > 0 ? normalized : undefined;
}

export function getCompanyActivation(description: string | null | undefined): ActivationMetadata | undefined {
  const metadata = parseCompanyDescription(description);
  const activationRaw = metadata.extra?.activation;
  if (!isRecord(activationRaw)) {
    return undefined;
  }

  const activation: ActivationMetadata = {
    mode: getActivationMode(activationRaw.mode),
    newSiteInterview: normalizeNewSiteInterview(activationRaw.newSiteInterview),
    picassoBridge: normalizePicassoBridge(activationRaw.picassoBridge),
    starterTeam: normalizeStarterTeam(activationRaw.starterTeam),
    sourceLinks: normalizeStringArray(activationRaw.sourceLinks),
  };

  if (!activation.mode && !activation.newSiteInterview && !activation.picassoBridge && !activation.starterTeam && !activation.sourceLinks) {
    return undefined;
  }

  return activation;
}

function normalizeWixBinding(raw: Record<string, unknown>): WixBindingMetadata | undefined {
  const bindingSource = isRecord(raw.wixBinding) ? raw.wixBinding : raw;
  const binding: WixBindingMetadata = {
    metaSiteId: getString(bindingSource.metaSiteId) || getString(raw.metaSiteId),
    siteId: getString(bindingSource.siteId) || getString(raw.siteId),
    siteName: getString(bindingSource.siteName) || getString(raw.siteName),
    siteUrl: normalizePublicSiteUrl(bindingSource.siteUrl) || normalizePublicSiteUrl(raw.siteUrl),
    activationIssueId:
      getString(bindingSource.activationIssueId) || getString(raw.activationIssueId),
    auth: getStringMap(bindingSource.auth) || getStringMap(raw.auth),
    data: getUnknownMap(bindingSource.data) || getUnknownMap(raw.data),
  };

  if (
    !binding.metaSiteId &&
    !binding.siteId &&
    !binding.siteName &&
    !binding.siteUrl &&
    !binding.activationIssueId &&
    !binding.auth &&
    !binding.data
  ) {
    return undefined;
  }

  return binding;
}

function normalizeVibeSite(raw: Record<string, unknown>): VibeSiteMetadata | undefined {
  const vibeSource = isRecord(raw.vibeSite) ? raw.vibeSite : raw;
  const directSiteUrl =
    normalizeVibeSiteUrl(vibeSource.siteUrl) || normalizeVibeSiteUrl(raw.vibeSiteUrl);
  const rawDevelopmentUrl =
    normalizeHttpUrl(vibeSource.developmentUrl) || normalizeHttpUrl(raw.vibeSiteDevelopmentUrl);
  const fallbackDevelopmentUrl =
    !directSiteUrl && !rawDevelopmentUrl
      ? normalizeHttpUrl(vibeSource.siteUrl) || normalizeHttpUrl(raw.vibeSiteUrl)
      : undefined;
  const vibeSite: VibeSiteMetadata = {
    siteId: getString(vibeSource.siteId) || getString(raw.vibeSiteId),
    siteUrl: directSiteUrl,
    jobId: getString(vibeSource.jobId) || getString(raw.vibeSiteJobId),
    status: getString(vibeSource.status) || getString(raw.vibeSiteStatus),
    developmentUrl: rawDevelopmentUrl || fallbackDevelopmentUrl,
  };

  if (
    !vibeSite.siteId &&
    !vibeSite.siteUrl &&
    !vibeSite.jobId &&
    !vibeSite.status &&
    !vibeSite.developmentUrl
  ) {
    return undefined;
  }

  return vibeSite;
}

export function parseCompanyDescription(description: string | null | undefined): CompanyDescriptionMetadata {
  const raw = description?.trim() || "";
  if (!raw) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      const extraEntries = Object.entries(parsed).filter(([key]) => !KNOWN_TOP_LEVEL_KEYS.has(key));
      return {
        version: 1,
        businessDescription: getString(parsed.businessDescription),
        wixBinding: normalizeWixBinding(parsed),
        vibeSite: normalizeVibeSite(parsed),
        extra: extraEntries.length > 0 ? Object.fromEntries(extraEntries) : undefined,
      };
    }
  } catch {
    // Fall through to legacy/plain-text parsing.
  }

  const legacyMatch = raw.match(LEGACY_METASITE_PATTERN);
  return {
    version: 1,
    businessDescription: raw,
    wixBinding: legacyMatch?.[1] ? { metaSiteId: legacyMatch[1] } : undefined,
  };
}

export function getCompanyBusinessDescription(description: string | null | undefined): string {
  return parseCompanyDescription(description).businessDescription || "";
}

export function getCompanyWixBinding(
  description: string | null | undefined,
): WixBindingMetadata | undefined {
  return parseCompanyDescription(description).wixBinding;
}

export function getCompanyVibeSite(
  description: string | null | undefined,
): VibeSiteMetadata | undefined {
  return parseCompanyDescription(description).vibeSite;
}

export function buildCompanyDescription(metadata: CompanyDescriptionMetadata): string {
  const next: Record<string, unknown> = {
    version: 1,
    businessDescription: metadata.businessDescription || undefined,
  };

  if (metadata.wixBinding) {
    next.wixBinding = {
      metaSiteId: metadata.wixBinding.metaSiteId || undefined,
      siteId: metadata.wixBinding.siteId || undefined,
      siteName: metadata.wixBinding.siteName || undefined,
      siteUrl: metadata.wixBinding.siteUrl || undefined,
      activationIssueId: metadata.wixBinding.activationIssueId || undefined,
      auth: metadata.wixBinding.auth || undefined,
      data: metadata.wixBinding.data || undefined,
    };
  }

  if (metadata.vibeSite) {
    next.vibeSiteId = metadata.vibeSite.siteId || undefined;
    next.vibeSiteUrl = metadata.vibeSite.siteUrl || undefined;
    next.vibeSiteJobId = metadata.vibeSite.jobId || undefined;
    next.vibeSiteStatus = metadata.vibeSite.status || undefined;
    next.vibeSiteDevelopmentUrl = metadata.vibeSite.developmentUrl || undefined;
  }

  if (metadata.extra) {
    Object.assign(next, metadata.extra);
  }

  return JSON.stringify(next);
}

export function mergeCompanyDescription(
  currentDescription: string | null | undefined,
  updates: {
    businessDescription?: string;
    wixBinding?: Partial<WixBindingMetadata>;
    vibeSite?: Partial<VibeSiteMetadata>;
    extra?: Record<string, unknown>;
  },
): string {
  const current = parseCompanyDescription(currentDescription);

  return buildCompanyDescription({
    version: 1,
    businessDescription:
      updates.businessDescription !== undefined
        ? updates.businessDescription
        : current.businessDescription,
    wixBinding: updates.wixBinding
      ? {
          ...(current.wixBinding || {}),
          ...updates.wixBinding,
        }
      : current.wixBinding,
    vibeSite: updates.vibeSite
      ? {
          ...(current.vibeSite || {}),
          ...updates.vibeSite,
        }
      : current.vibeSite,
    extra:
      updates.extra !== undefined
        ? {
            ...(current.extra || {}),
            ...updates.extra,
          }
        : current.extra,
  });
}

export function findCompanyByMsid(companies: Company[], msid: string): Company | null {
  const activeCompanies = companies.filter((company) => company.status !== "archived");
  return (
    activeCompanies.find(
      (company) => parseCompanyDescription(company.description).wixBinding?.metaSiteId === msid,
    ) || null
  );
}

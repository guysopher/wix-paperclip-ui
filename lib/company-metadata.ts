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

export interface CompanyDescriptionMetadata {
  version: 1;
  businessDescription?: string;
  wixBinding?: WixBindingMetadata;
  extra?: Record<string, unknown>;
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

function normalizeWixBinding(raw: Record<string, unknown>): WixBindingMetadata | undefined {
  const bindingSource = isRecord(raw.wixBinding) ? raw.wixBinding : raw;
  const binding: WixBindingMetadata = {
    metaSiteId: getString(bindingSource.metaSiteId) || getString(raw.metaSiteId),
    siteId: getString(bindingSource.siteId) || getString(raw.siteId),
    siteName: getString(bindingSource.siteName) || getString(raw.siteName),
    siteUrl: getString(bindingSource.siteUrl) || getString(raw.siteUrl),
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
  const exactMetaMatch =
    companies.find((company) => parseCompanyDescription(company.description).wixBinding?.metaSiteId === msid) ||
    null;

  if (exactMetaMatch) {
    return exactMetaMatch;
  }

  return companies.find((company) => company.id === msid) || null;
}

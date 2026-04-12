import type { Company } from "./api";

export interface CompanyDescriptionMetadata {
  version: 1;
  metaSiteId?: string;
  businessDescription?: string;
  siteId?: string;
  siteName?: string;
  siteUrl?: string;
  activationIssueId?: string;
}

const LEGACY_METASITE_PATTERN = /metasite\s+([0-9a-fA-F-]{36})/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseCompanyDescription(description: string | null | undefined): CompanyDescriptionMetadata {
  const raw = description?.trim() || "";
  if (!raw) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return {
        version: 1,
        metaSiteId: typeof parsed.metaSiteId === "string" ? parsed.metaSiteId : undefined,
        businessDescription:
          typeof parsed.businessDescription === "string" ? parsed.businessDescription : undefined,
        siteId: typeof parsed.siteId === "string" ? parsed.siteId : undefined,
        siteName: typeof parsed.siteName === "string" ? parsed.siteName : undefined,
        siteUrl: typeof parsed.siteUrl === "string" ? parsed.siteUrl : undefined,
        activationIssueId:
          typeof parsed.activationIssueId === "string" ? parsed.activationIssueId : undefined,
      };
    }
  } catch {
    // Fall through to legacy/plain-text parsing.
  }

  const legacyMatch = raw.match(LEGACY_METASITE_PATTERN);
  return {
    version: 1,
    metaSiteId: legacyMatch?.[1],
    businessDescription: raw,
  };
}

export function getCompanyBusinessDescription(description: string | null | undefined): string {
  return parseCompanyDescription(description).businessDescription || "";
}

export function buildCompanyDescription(metadata: CompanyDescriptionMetadata): string {
  const next: CompanyDescriptionMetadata = {
    version: 1,
    metaSiteId: metadata.metaSiteId || undefined,
    businessDescription: metadata.businessDescription || undefined,
    siteId: metadata.siteId || undefined,
    siteName: metadata.siteName || undefined,
    siteUrl: metadata.siteUrl || undefined,
    activationIssueId: metadata.activationIssueId || undefined,
  };

  return JSON.stringify(next);
}

export function findCompanyByMsid(companies: Company[], msid: string): Company | null {
  const exactMetaMatch =
    companies.find((company) => parseCompanyDescription(company.description).metaSiteId === msid) || null;

  if (exactMetaMatch) {
    return exactMetaMatch;
  }

  return companies.find((company) => company.id === msid) || null;
}

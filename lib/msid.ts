const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export function normalizeMsid(value: string | null | undefined): string | null {
  const normalized = value?.trim() || "";
  if (!normalized) {
    return null;
  }

  const extracted = normalized.match(UUID_PATTERN)?.[0];
  return extracted ?? null;
}

export function isValidMsid(value: string | null | undefined): boolean {
  return normalizeMsid(value) !== null;
}

export function normalizeCompanyId(value: string | null | undefined): string | null {
  const normalized = value?.trim() || "";
  if (!normalized) {
    return null;
  }

  const extracted = normalized.match(UUID_PATTERN)?.[0];
  return extracted ?? null;
}

export function withMsid(path: string, msid: string | null | undefined): string {
  return withWorkspaceContext(path, { msid });
}

export function withCompanyId(path: string, companyId: string | null | undefined): string {
  return withWorkspaceContext(path, { companyId });
}

export function withWorkspaceContext(
  path: string,
  context: {
    msid?: string | null;
    companyId?: string | null;
  },
): string {
  const [beforeHash, hash = ""] = path.split("#", 2);
  const [pathname, query = ""] = beforeHash.split("?", 2);
  const params = new URLSearchParams(query);
  const normalizedMsid = normalizeMsid(context.msid);
  const normalizedCompanyId = normalizeCompanyId(context.companyId);

  if (!normalizedMsid && !normalizedCompanyId) {
    return path;
  }

  params.delete("msid");
  params.delete("companyId");

  if (normalizedMsid) {
    params.set("msid", normalizedMsid);
  } else if (normalizedCompanyId) {
    params.set("companyId", normalizedCompanyId);
  }

  const queryString = params.toString();
  const hashSuffix = hash ? `#${hash}` : "";

  return queryString ? `${pathname}?${queryString}${hashSuffix}` : `${pathname}${hashSuffix}`;
}

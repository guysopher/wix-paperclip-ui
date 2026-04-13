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

export function withMsid(path: string, msid: string | null | undefined): string {
  const normalized = normalizeMsid(msid);
  if (!normalized) {
    return path;
  }

  const [beforeHash, hash = ""] = path.split("#", 2);
  const [pathname, query = ""] = beforeHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("msid", normalized);

  const queryString = params.toString();
  const hashSuffix = hash ? `#${hash}` : "";

  return queryString ? `${pathname}?${queryString}${hashSuffix}` : `${pathname}${hashSuffix}`;
}

"use client";

export function ensureWorkspaceHref(
  href: string | undefined,
  companyPath: (path: string) => string,
): string | undefined {
  if (!href) {
    return href;
  }

  if (href.startsWith("#")) {
    return href;
  }

  if (href.startsWith("/")) {
    return hasWorkspaceQuery(href) ? href : companyPath(href);
  }

  if (/^https?:\/\//i.test(href) && typeof window !== "undefined") {
    try {
      const url = new URL(href);
      if (url.origin !== window.location.origin) {
        return href;
      }

      const relativePath = `${url.pathname}${url.search}${url.hash}`;
      if (hasWorkspaceQuery(relativePath)) {
        return relativePath;
      }

      return companyPath(relativePath);
    } catch {
      return href;
    }
  }

  return href;
}

function hasWorkspaceQuery(path: string): boolean {
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) {
    return false;
  }

  const hashIndex = path.indexOf("#", queryIndex);
  const queryString = hashIndex === -1
    ? path.slice(queryIndex + 1)
    : path.slice(queryIndex + 1, hashIndex);
  const params = new URLSearchParams(queryString);

  return params.has("msid") || params.has("companyId");
}

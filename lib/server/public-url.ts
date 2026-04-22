const reachabilityCache = new Map<string, Promise<boolean>>();

async function probePublicUrl(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyPublicUrlReachable(
  url: string | undefined,
  timeoutMs = 12000,
): Promise<boolean> {
  if (!url) {
    return Promise.resolve(false);
  }

  const normalized = url.trim();
  if (!normalized) {
    return Promise.resolve(false);
  }

  const cached = reachabilityCache.get(normalized);
  if (cached) {
    return cached;
  }

  const pending = probePublicUrl(normalized, timeoutMs).finally(() => {
    setTimeout(() => {
      reachabilityCache.delete(normalized);
    }, 60_000);
  });

  reachabilityCache.set(normalized, pending);
  return pending;
}

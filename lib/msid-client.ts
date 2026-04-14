"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeCompanyId, normalizeMsid, withMsid, withWorkspaceContext } from "./msid";

export function useMsid(): string | null {
  const searchParams = useSearchParams();
  return normalizeMsid(searchParams.get("msid"));
}

export function useCompanyId(): string | null {
  const searchParams = useSearchParams();
  return normalizeCompanyId(searchParams.get("companyId"));
}

export function useWorkspaceContext() {
  const searchParams = useSearchParams();
  return {
    msid: normalizeMsid(searchParams.get("msid")),
    companyId: normalizeCompanyId(searchParams.get("companyId")),
  };
}

export function useMsidPath() {
  const msid = useMsid();

  return useCallback((path: string) => withMsid(path, msid), [msid]);
}

export function useWorkspacePath() {
  const { msid, companyId } = useWorkspaceContext();

  return useCallback(
    (path: string) => withWorkspaceContext(path, { msid, companyId }),
    [companyId, msid],
  );
}

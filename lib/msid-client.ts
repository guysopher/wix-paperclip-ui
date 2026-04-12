"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeMsid, withMsid } from "./msid";

export function useMsid(): string | null {
  const searchParams = useSearchParams();
  return normalizeMsid(searchParams.get("msid"));
}

export function useMsidPath() {
  const msid = useMsid();

  return useCallback((path: string) => withMsid(path, msid), [msid]);
}

"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { WixDesignSystemProvider } from "@wix/design-system";
import { getCompanies, getMyIssues, getIssues, getRuns, getApprovals, cancelHeartbeatRun, type Company } from "@/lib/api";

export interface BadgeCounts {
  inbox: number;      // unread needs-reply
  runs: number;       // currently running
  tasks: number;      // in-progress
  approvals: number;  // pending approvals
  chat: number;       // unread chat messages
}

const BadgeCountsContext = createContext<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0 });

export const useBadgeCounts = () => useContext(BadgeCountsContext);

// Company context
interface CompanyContextValue {
  companyId: string;
  companies: Company[];
  setCompanyId: (id: string) => void;
  refreshCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue>({
  companyId: "",
  companies: [],
  setCompanyId: () => {},
  refreshCompanies: async () => {},
});

export const useCompany = () => useContext(CompanyContext);

export function Providers({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0 });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const loadCompanies = useCallback(async () => {
    try {
      const list = await getCompanies();
      setCompanies(list);
      if (list.length > 0) {
        const stored = typeof window !== "undefined" ? localStorage.getItem("selectedCompanyId") : null;
        const match = stored && list.find((c) => c.id === stored);
        if (!selectedCompanyId || !list.find((c) => c.id === selectedCompanyId)) {
          setSelectedCompanyId(match ? match.id : list[0].id);
        }
      }
    } catch { /* silent */ }
  }, []);

  const handleSetCompanyId = useCallback((id: string) => {
    setSelectedCompanyId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedCompanyId", id);
    }
  }, []);

  useEffect(() => {
    // Load stored company id from localStorage on mount
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("selectedCompanyId");
      if (stored) setSelectedCompanyId(stored);
    }
    loadCompanies();
  }, [loadCompanies]);

  const refresh = useCallback(async () => {
    try {
      if (!selectedCompanyId) return;
      const companyId = selectedCompanyId;
      const [myIssues, allIssues, runs, approvalList] = await Promise.all([
        getMyIssues(companyId),
        getIssues(companyId),
        getRuns(companyId),
        getApprovals(companyId).catch(() => []),
      ]);
      const inboxCount = myIssues.filter(
        (i) => i.isUnreadForMe && !["done", "cancelled"].includes(i.status)
      ).length;
      const runningCount = runs.filter((r) => r.status === "running").length;
      const inProgressCount = allIssues.filter((i) => i.status === "in_progress").length;
      const pendingApprovals = approvalList.filter((a) => a.status === "pending").length;
      setCounts({ inbox: inboxCount, runs: runningCount, tasks: inProgressCount, approvals: pendingApprovals, chat: 0 });
    } catch { /* silent */ }
  }, [selectedCompanyId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <CompanyContext.Provider value={{ companyId: selectedCompanyId, companies, setCompanyId: handleSetCompanyId, refreshCompanies: loadCompanies }}>
      <BadgeCountsContext.Provider value={counts}>
        <WixDesignSystemProvider>{children}</WixDesignSystemProvider>
      </BadgeCountsContext.Provider>
    </CompanyContext.Provider>
  );
}

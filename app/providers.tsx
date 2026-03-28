"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { WixDesignSystemProvider } from "@wix/design-system";
import { getCompanies, getMyIssues, getIssues, getRuns } from "@/lib/api";

export interface BadgeCounts {
  inbox: number;   // unread needs-reply
  runs: number;    // currently running
  tasks: number;   // in-progress
  chat: number;    // unread chat messages
}

const BadgeCountsContext = createContext<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, chat: 0 });

export const useBadgeCounts = () => useContext(BadgeCountsContext);

export function Providers({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, chat: 0 });

  const refresh = useCallback(async () => {
    try {
      const companies = await getCompanies();
      if (!companies.length) return;
      const companyId = companies[0].id;
      const [myIssues, allIssues, runs] = await Promise.all([
        getMyIssues(companyId),
        getIssues(companyId),
        getRuns(companyId),
      ]);
      const inboxCount = myIssues.filter(
        (i) => i.isUnreadForMe && !["done", "cancelled"].includes(i.status)
      ).length;
      const runningCount = runs.filter((r) => r.status === "running").length;
      const inProgressCount = allIssues.filter((i) => i.status === "in_progress").length;
      setCounts({ inbox: inboxCount, runs: runningCount, tasks: inProgressCount, chat: 0 });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <BadgeCountsContext.Provider value={counts}>
      <WixDesignSystemProvider>{children}</WixDesignSystemProvider>
    </BadgeCountsContext.Provider>
  );
}

"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { WixDesignSystemProvider } from "@wix/design-system";
import {
  getCompanies,
  getMyIssues,
  getIssuesAssignedToMe,
  getIssues,
  getRuns,
  getApprovals,
  getAgents,
  type Company,
} from "@/lib/api";
import { findCompanyByMsid } from "@/lib/company-metadata";
import { useMsid } from "@/lib/msid-client";
import { normalizeMsid, withMsid } from "@/lib/msid";

export interface BadgeCounts {
  inbox: number;      // unread needs-reply
  runs: number;       // currently running
  tasks: number;      // in-progress
  approvals: number;  // pending approvals
  chat: number;       // unread chat messages
  team: number;       // number of agents
}

const BadgeCountsContext = createContext<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0, team: 0 });

export const useBadgeCounts = () => useContext(BadgeCountsContext);

export type CompanyLookupStatus =
  | "loading"
  | "ready"
  | "missing-msid"
  | "company-missing";

// Company context
interface CompanyContextValue {
  companyId: string;
  companies: Company[];
  msid: string | null;
  companyLookupStatus: CompanyLookupStatus;
  setCompanyId: (id: string) => void;
  companyPath: (path: string) => string;
  refreshCompanies: () => Promise<void>;
  wizardOpen: boolean;
  openCreateWizard: () => void;
  closeCreateWizard: () => void;
}

const CompanyContext = createContext<CompanyContextValue>({
  companyId: "",
  companies: [],
  msid: null,
  companyLookupStatus: "loading",
  setCompanyId: () => {},
  companyPath: (path) => path,
  refreshCompanies: async () => {},
  wizardOpen: false,
  openCreateWizard: () => {},
  closeCreateWizard: () => {},
});

export const useCompany = () => useContext(CompanyContext);

export function Providers({ children }: { children: React.ReactNode }) {
  const msid = useMsid();
  const [counts, setCounts] = useState<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0, team: 0 });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyLookupStatus, setCompanyLookupStatus] = useState<CompanyLookupStatus>("loading");
  const [wizardOpen, setWizardOpen] = useState(false);
  const openCreateWizard = useCallback(() => setWizardOpen(true), []);
  const closeCreateWizard = useCallback(() => setWizardOpen(false), []);

  const loadCompanies = useCallback(async () => {
    const normalizedMsid = normalizeMsid(msid);

    if (!normalizedMsid) {
      setCompanies([]);
      setSelectedCompanyId("");
      setCounts({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0, team: 0 });
      setCompanyLookupStatus("missing-msid");
      return;
    }

    setCompanyLookupStatus("loading");
    try {
      const allCompanies = await getCompanies();
      const company = findCompanyByMsid(allCompanies, normalizedMsid);

      if (!company) {
        throw new Error("Company not found for metasite");
      }

      setCompanies([company]);
      setSelectedCompanyId(company.id);
      setCompanyLookupStatus("ready");
    } catch {
      setCompanies([]);
      setSelectedCompanyId("");
      setCounts({ inbox: 0, runs: 0, tasks: 0, approvals: 0, chat: 0, team: 0 });
      setCompanyLookupStatus("company-missing");
    }
  }, [msid]);

  const handleSetCompanyId = useCallback((id: string) => {
    setSelectedCompanyId(id);
  }, []);
  const companyPath = useCallback((path: string) => withMsid(path, msid), [msid]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const refresh = useCallback(async () => {
    try {
      if (!selectedCompanyId || companyLookupStatus !== "ready") return;
      const companyId = selectedCompanyId;
      const [myIssues, assignedToMe, allIssues, runs, approvalList, agentList] = await Promise.all([
        getMyIssues(companyId),
        getIssuesAssignedToMe(companyId),
        getIssues(companyId),
        getRuns(companyId),
        getApprovals(companyId).catch(() => []),
        getAgents(companyId).catch(() => []),
      ]);
      // Inbox count: assigned to me + unread + blocked (deduplicated, skip Board Inbox)
      const inboxIds = new Set<string>();
      for (const i of assignedToMe) {
        if (i.title !== "Board Inbox" && !["done", "cancelled"].includes(i.status)) inboxIds.add(i.id);
      }
      for (const i of myIssues) {
        if (i.title !== "Board Inbox" && i.isUnreadForMe && !["done", "cancelled"].includes(i.status)) inboxIds.add(i.id);
      }
      for (const i of allIssues) {
        if (i.status === "blocked") inboxIds.add(i.id);
      }
      const inboxCount = inboxIds.size;
      const runningCount = runs.filter((r) => r.status === "running").length;
      const inProgressCount = allIssues.filter((i) => i.status === "in_progress").length;
      const pendingApprovals = approvalList.filter((a) => a.status === "pending").length;
      const teamSize = agentList.length;
      setCounts({ inbox: inboxCount, runs: runningCount, tasks: inProgressCount, approvals: pendingApprovals, chat: 0, team: teamSize });
    } catch { /* silent */ }
  }, [companyLookupStatus, selectedCompanyId]);

  useEffect(() => {
    if (companyLookupStatus !== "ready") {
      return;
    }
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [companyLookupStatus, refresh]);

  return (
    <CompanyContext.Provider value={{ companyId: selectedCompanyId, companies, msid, companyLookupStatus, setCompanyId: handleSetCompanyId, companyPath, refreshCompanies: loadCompanies, wizardOpen, openCreateWizard, closeCreateWizard }}>
      <BadgeCountsContext.Provider value={counts}>
        <WixDesignSystemProvider>{children}</WixDesignSystemProvider>
      </BadgeCountsContext.Provider>
    </CompanyContext.Provider>
  );
}

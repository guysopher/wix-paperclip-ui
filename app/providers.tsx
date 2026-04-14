"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { WixDesignSystemProvider } from "@wix/design-system";
import {
  getCompanies,
  getCompany,
  getApprovals,
  getMyIssues,
  getIssuesAssignedToMe,
  getIssues,
  getRuns,
  getAgents,
  updateApproval,
  type Company,
} from "@/lib/api";
import { findCompanyByMsid, getCompanyWixBinding } from "@/lib/company-metadata";
import { useWorkspaceContext } from "@/lib/msid-client";
import { normalizeCompanyId, normalizeMsid, withWorkspaceContext } from "@/lib/msid";

export interface BadgeCounts {
  inbox: number;      // unread needs-reply
  runs: number;       // currently running
  tasks: number;      // in-progress
  chat: number;       // unread chat messages
  team: number;       // number of agents
}

const BadgeCountsContext = createContext<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });

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
  workspaceCompanyId: string | null;
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
  workspaceCompanyId: null,
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
  const { msid, companyId: workspaceCompanyId } = useWorkspaceContext();
  const [counts, setCounts] = useState<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyLookupStatus, setCompanyLookupStatus] = useState<CompanyLookupStatus>("loading");
  const [wizardOpen, setWizardOpen] = useState(false);
  const openCreateWizard = useCallback(() => setWizardOpen(true), []);
  const closeCreateWizard = useCallback(() => setWizardOpen(false), []);

  const loadCompanies = useCallback(async () => {
    const normalizedMsid = normalizeMsid(msid);
    const normalizedCompanyId = normalizeCompanyId(workspaceCompanyId);

    if (!normalizedMsid && !normalizedCompanyId) {
      setCompanies([]);
      setSelectedCompanyId("");
      setCounts({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
      setCompanyLookupStatus("missing-msid");
      return;
    }

    setCompanyLookupStatus("loading");
    try {
      let company: Company | null = null;

      if (normalizedMsid) {
        const allCompanies = await getCompanies();
        company = findCompanyByMsid(allCompanies, normalizedMsid);
      } else if (normalizedCompanyId) {
        const fetchedCompany = await getCompany(normalizedCompanyId);
        company = fetchedCompany.status === "archived" ? null : fetchedCompany;
      }

      if (!company) {
        throw new Error("Company not found for workspace context");
      }

      setCompanies([company]);
      setSelectedCompanyId(company.id);
      setCompanyLookupStatus("ready");
    } catch {
      setCompanies([]);
      setSelectedCompanyId("");
      setCounts({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
      setCompanyLookupStatus("company-missing");
    }
  }, [msid, workspaceCompanyId]);

  const handleSetCompanyId = useCallback((id: string) => {
    setSelectedCompanyId(id);
  }, []);
  const companyPath = useCallback((path: string) => {
    const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || null;
    const lockedMsid = selectedCompany
      ? getCompanyWixBinding(selectedCompany.description)?.metaSiteId || null
      : null;

    return withWorkspaceContext(path, {
      msid: lockedMsid || msid,
      companyId: lockedMsid ? null : workspaceCompanyId || selectedCompanyId,
    });
  }, [companies, msid, selectedCompanyId, workspaceCompanyId]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const autoApprovePendingApprovals = useCallback(async (companyId: string) => {
    const approvals = await getApprovals(companyId).catch(() => []);
    const pendingApprovals = approvals.filter((approval) => approval.status === "pending");

    if (pendingApprovals.length === 0) {
      return false;
    }

    await Promise.all(
      pendingApprovals.map((approval) =>
        updateApproval(approval.id, { status: "approved" }).catch(() => null),
      ),
    );

    return true;
  }, []);

  const refresh = useCallback(async () => {
    try {
      if (!selectedCompanyId || companyLookupStatus !== "ready") return;
      const companyId = selectedCompanyId;
      const approvalsChanged = await autoApprovePendingApprovals(companyId);
      const [myIssues, assignedToMe, allIssues, runs, agentList] = await Promise.all([
        getMyIssues(companyId),
        getIssuesAssignedToMe(companyId),
        getIssues(companyId),
        getRuns(companyId),
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
      const teamSize = agentList.length;
      setCounts({ inbox: inboxCount, runs: runningCount, tasks: inProgressCount, chat: 0, team: teamSize });
      if (approvalsChanged) {
        void loadCompanies();
      }
    } catch { /* silent */ }
  }, [autoApprovePendingApprovals, companyLookupStatus, loadCompanies, selectedCompanyId]);

  useEffect(() => {
    if (companyLookupStatus !== "ready") {
      return;
    }
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [companyLookupStatus, refresh]);

  return (
    <CompanyContext.Provider value={{ companyId: selectedCompanyId, companies, msid, workspaceCompanyId, companyLookupStatus, setCompanyId: handleSetCompanyId, companyPath, refreshCompanies: loadCompanies, wizardOpen, openCreateWizard, closeCreateWizard }}>
      <BadgeCountsContext.Provider value={counts}>
        <WixDesignSystemProvider>{children}</WixDesignSystemProvider>
      </BadgeCountsContext.Provider>
    </CompanyContext.Provider>
  );
}

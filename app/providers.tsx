"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { WixDesignSystemProvider } from "@wix/design-system";
import {
  getIssuesAssignedToMe,
  getCompanies,
  getCompany,
  getDashboard,
  getApprovals,
  getMyIssues,
  getIssues,
  getGoals,
  getRuns,
  getAgents,
  repairCompanyState,
  type Company,
  type Dashboard,
  type Goal,
  type Issue,
  type Agent,
  type Approval,
  type HeartbeatRun,
  type CompanyRepairStatus,
} from "@/lib/api";
import { findCompanyByMsid, getCompanyWixBinding } from "@/lib/company-metadata";
import {
  issueNeedsReply,
  readInboxArchivedIds,
  readInboxReplyOverrides,
  subscribeInboxArchivedIds,
  subscribeInboxReplyOverrides,
} from "@/lib/inbox-state";
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

interface CompanyDataContextValue {
  company: Company | null;
  dashboard: Dashboard | null;
  agents: Agent[];
  goals: Goal[];
  issues: Issue[];
  inboxIssues: Issue[];
  approvals: Approval[];
  runs: HeartbeatRun[];
  repairStatus: CompanyRepairStatus | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
}

const CompanyDataContext = createContext<CompanyDataContextValue>({
  company: null,
  dashboard: null,
  agents: [],
  goals: [],
  issues: [],
  inboxIssues: [],
  approvals: [],
  runs: [],
  repairStatus: null,
  loading: false,
  refreshing: false,
  lastUpdatedAt: null,
  refresh: async () => {},
});

export const useCompanyData = () => useContext(CompanyDataContext);

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

const EMPTY_COMPANY_DATA: Omit<CompanyDataContextValue, "refresh"> = {
  company: null,
  dashboard: null,
  agents: [],
  goals: [],
  issues: [],
  inboxIssues: [],
  approvals: [],
  runs: [],
  repairStatus: null,
  loading: false,
  refreshing: false,
  lastUpdatedAt: null,
};

export function Providers({ children }: { children: React.ReactNode }) {
  const { msid, companyId: workspaceCompanyId } = useWorkspaceContext();
  const [counts, setCounts] = useState<BadgeCounts>({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyLookupStatus, setCompanyLookupStatus] = useState<CompanyLookupStatus>("loading");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [companyData, setCompanyData] = useState<Omit<CompanyDataContextValue, "refresh">>(EMPTY_COMPANY_DATA);
  const refreshInFlightRef = useRef(false);
  const activeWindowRef = useRef(true);
  const companyDataRef = useRef(companyData);
  const openCreateWizard = useCallback(() => setWizardOpen(true), []);
  const closeCreateWizard = useCallback(() => setWizardOpen(false), []);

  useEffect(() => {
    companyDataRef.current = companyData;
  }, [companyData]);

  const loadCompanies = useCallback(async () => {
    const normalizedMsid = normalizeMsid(msid);
    const normalizedCompanyId = normalizeCompanyId(workspaceCompanyId);
    let fallbackCompanies: Company[] = [];

    if (!normalizedMsid && !normalizedCompanyId) {
      const allCompanies = await getCompanies().catch(() => [] as Company[]);
      fallbackCompanies = allCompanies.filter((company) => company.status !== "archived");
      setCompanies(fallbackCompanies);
      setSelectedCompanyId("");
      setCounts({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
      setCompanyLookupStatus("missing-msid");
      return;
    }

    setCompanyLookupStatus("loading");
    try {
      const allCompanies = await getCompanies().catch(() => [] as Company[]);
      const activeCompanies = allCompanies.filter((company) => company.status !== "archived");
      fallbackCompanies = activeCompanies;
      let company: Company | null = null;

      if (normalizedMsid) {
        company = findCompanyByMsid(activeCompanies, normalizedMsid);
      } else if (normalizedCompanyId) {
        const fetchedCompany = await getCompany(normalizedCompanyId);
        company = fetchedCompany.status === "archived" ? null : fetchedCompany;
      }

      if (!company) {
        setCompanies(activeCompanies);
        setSelectedCompanyId("");
        setCounts({ inbox: 0, runs: 0, tasks: 0, chat: 0, team: 0 });
        setCompanyLookupStatus("company-missing");
        throw new Error("Company not found for workspace context");
      }

      setCompanies(activeCompanies.length > 0 ? activeCompanies : [company]);
      setSelectedCompanyId(company.id);
      setCompanyLookupStatus("ready");
    } catch {
      setCompanies(fallbackCompanies);
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

  useEffect(() => {
    if (!selectedCompanyId || companyLookupStatus !== "ready") {
      setCompanyData((prev) =>
        prev.loading || prev.refreshing || prev.lastUpdatedAt || prev.company || prev.dashboard || prev.agents.length || prev.goals.length || prev.issues.length || prev.inboxIssues.length || prev.approvals.length || prev.runs.length
          ? { ...EMPTY_COMPANY_DATA, loading: companyLookupStatus === "loading" }
          : prev
      );
      return;
    }

    setCompanyData((prev) =>
      prev.company?.id === selectedCompanyId && prev.lastUpdatedAt
        ? prev
        : { ...EMPTY_COMPANY_DATA, loading: true }
    );
  }, [companyLookupStatus, selectedCompanyId]);

  const refresh = useCallback(async () => {
    try {
      if (!selectedCompanyId || companyLookupStatus !== "ready") return;
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      const companyId = selectedCompanyId;
      const initialLoad = !companyDataRef.current.lastUpdatedAt || companyDataRef.current.company?.id !== companyId;
      setCompanyData((prev) => ({
        ...prev,
        loading: initialLoad,
        refreshing: !initialLoad,
      }));
      const repairStatus = await repairCompanyState(companyId).catch(() => null);
      const [
        currentCompany,
        dashboard,
        agentList,
        goalList,
        assignedToMe,
        myIssues,
        blockedIssues,
        allIssues,
        approvals,
        runs,
      ] = await Promise.all([
        getCompany(companyId),
        getDashboard(companyId).catch(() => null as Dashboard | null),
        getAgents(companyId).catch(() => [] as Agent[]),
        getGoals(companyId).catch(() => [] as Goal[]),
        getIssuesAssignedToMe(companyId),
        getMyIssues(companyId),
        getIssues(companyId, "status=blocked"),
        getIssues(companyId),
        getApprovals(companyId).catch(() => [] as Approval[]),
        getRuns(companyId),
      ]);
      const finalAssignedToMe = assignedToMe;
      const finalMyIssues = myIssues;
      const finalBlockedIssues = blockedIssues;
      const finalAllIssues = allIssues;

      const seenInboxIssueIds = new Set<string>();
      const inboxIssues: Issue[] = [];
      for (const list of [finalAssignedToMe, finalMyIssues, finalBlockedIssues]) {
        for (const issue of list) {
          if (issue.title === "Board Inbox" || seenInboxIssueIds.has(issue.id)) {
            continue;
          }
          seenInboxIssueIds.add(issue.id);
          inboxIssues.push(issue);
        }
      }
      const archivedIds = new Set(readInboxArchivedIds());
      const replyOverrides = readInboxReplyOverrides();
      // Inbox count: match the inbox page's merged visible needs-reply set.
      const inboxIds = new Set<string>();
      for (const issue of inboxIssues) {
        if (archivedIds.has(issue.id)) {
          continue;
        }
        if (issueNeedsReply(issue, replyOverrides)) {
          inboxIds.add(issue.id);
        }
      }
      const inboxCount = inboxIds.size;
      const runningCount = runs.filter((r) => r.status === "running").length;
      const inProgressCount = finalAllIssues.filter((i) => i.status === "in_progress").length;
      const teamSize = agentList.length;
      setCounts({ inbox: inboxCount, runs: runningCount, tasks: inProgressCount, chat: 0, team: teamSize });
      setCompanyData({
        company: currentCompany,
        dashboard,
        agents: agentList,
        goals: goalList,
        issues: finalAllIssues,
        inboxIssues,
        approvals,
        runs,
        repairStatus,
        loading: false,
        refreshing: false,
        lastUpdatedAt: new Date().toISOString(),
      });
      setCompanies((prev) => {
        if (!currentCompany) {
          return prev;
        }
        const next = prev.slice();
        const index = next.findIndex((company) => company.id === currentCompany.id);
        if (index >= 0) {
          next[index] = currentCompany;
          return next;
        }
        return next;
      });
    } catch {
      setCompanyData((prev) => ({ ...prev, loading: false, refreshing: false }));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [companyLookupStatus, selectedCompanyId]);

  useEffect(() => {
    if (companyLookupStatus !== "ready") {
      return;
    }
    refresh();
  }, [companyLookupStatus, refresh]);

  useEffect(() => {
    const updateWindowState = () => {
      const nextActive = document.visibilityState === "visible" && document.hasFocus();
      const becameActive = !activeWindowRef.current && nextActive;
      activeWindowRef.current = nextActive;
      if (becameActive) {
        void refresh();
      }
    };

    activeWindowRef.current = document.visibilityState === "visible" && document.hasFocus();
    window.addEventListener("focus", updateWindowState);
    window.addEventListener("blur", updateWindowState);
    document.addEventListener("visibilitychange", updateWindowState);

    return () => {
      window.removeEventListener("focus", updateWindowState);
      window.removeEventListener("blur", updateWindowState);
      document.removeEventListener("visibilitychange", updateWindowState);
    };
  }, [refresh]);

  useEffect(() => {
    if (companyLookupStatus !== "ready" || !activeWindowRef.current) {
      return;
    }

    const id = setInterval(() => {
      if (activeWindowRef.current) {
        void refresh();
      }
    }, 10000);

    return () => clearInterval(id);
  }, [companyLookupStatus, refresh]);

  useEffect(() => {
    return subscribeInboxReplyOverrides(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    return subscribeInboxArchivedIds(() => {
      void refresh();
    });
  }, [refresh]);

  return (
    <CompanyContext.Provider value={{ companyId: selectedCompanyId, companies, msid, workspaceCompanyId, companyLookupStatus, setCompanyId: handleSetCompanyId, companyPath, refreshCompanies: loadCompanies, wizardOpen, openCreateWizard, closeCreateWizard }}>
      <CompanyDataContext.Provider value={{ ...companyData, refresh }}>
        <BadgeCountsContext.Provider value={counts}>
          <WixDesignSystemProvider>{children}</WixDesignSystemProvider>
        </BadgeCountsContext.Provider>
      </CompanyDataContext.Provider>
    </CompanyContext.Provider>
  );
}

"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Button,
  Loader,
  Table,
  TableToolbar,
  Search,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { Providers, useCompany } from "../providers";
import { Shell } from "../shell";
import {
  getAgents,
  type Agent,
} from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  running: "Working",
  idle: "Available",
  error: "Needs attention",
  paused: "On leave",
};

const STATUS_SKINS: Record<string, "general" | "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  running: "success",
  idle: "neutral",
  error: "danger",
  paused: "warning",
};

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Senior",
  "claude-sonnet-4-6": "Standard",
};

const MODEL_COLORS: Record<string, { bg: string; color: string }> = {
  "claude-opus-4-6": { bg: "#f0e6ff", color: "#6b3fa0" },
  "claude-sonnet-4-6": { bg: "#e8f4fd", color: "#2b6cb0" },
};

function TeamContent() {
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Redirect ?agent=xxx to /team/xxx
  const agentParam = searchParams.get("agent");
  if (agentParam) {
    router.replace(`/team/${agentParam}`);
    return null;
  }

  const load = async () => {
    if (!companyId) { setLoading(false); return; }
    const agentData = await getAgents(companyId);
    setAgents(agentData);
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId]);

  const managerName = (id: string | null) => {
    if (!id) return "—";
    return agents.find((a) => a.id === id)?.name || "Unknown";
  };

  const getModel = (agent: Agent) => MODEL_LABELS[(agent.adapterConfig?.model as string) || ""] || "Unknown";

  const getHeartbeat = (agent: Agent) => {
    const sec = (agent.adapterConfig?.heartbeatIntervalSec as number) || 0;
    if (!sec) return "Manual";
    if (sec < 60) return `${sec}s`;
    return `Every ${Math.round(sec / 60)} min`;
  };

  const getLastActive = (agent: Agent) => {
    const last = agent.lastHeartbeatAt;
    if (!last) return "Never";
    const diffMin = Math.round((Date.now() - new Date(last).getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
    return new Date(last).toLocaleDateString();
  };

  const ROLE_ORDER: Record<string, number> = { ceo: 0, pm: 1, cmo: 2, engineer: 3, qa: 4 };

  const filtered = agents
    .filter((a) =>
      !searchTerm ||
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.title.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const aOrder = ROLE_ORDER[a.role] ?? 99;
      const bOrder = ROLE_ORDER[b.role] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aHasReports = agents.some((x) => x.reportsTo === a.id);
      const bHasReports = agents.some((x) => x.reportsTo === b.id);
      if (aHasReports !== bHasReports) return aHasReports ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  const columns = [
    {
      title: "Name",
      render: (row: Agent) => (
        <Box direction="horizontal" gap="10px" verticalAlign="middle">
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: row.role === "ceo" ? "#3899ec" : row.role === "pm" ? "#7b61ff" : "#44b5b0", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
            {row.name.charAt(0)}
          </div>
          <Box direction="vertical">
            <Text weight="bold" size="small">{row.name}</Text>
            <Text size="tiny" secondary>{row.title}</Text>
          </Box>
        </Box>
      ),
      width: "25%",
    },
    { title: "Manager", render: (row: Agent) => <Text size="small">{managerName(row.reportsTo)}</Text>, width: "15%" },
    { title: "Level", render: (row: Agent) => {
      const model = (row.adapterConfig?.model as string) || "";
      const label = MODEL_LABELS[model] || "Unknown";
      const colors = MODEL_COLORS[model] || { bg: "#f0f0f0", color: "#666" };
      return (
        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.color }}>
          {label}
        </span>
      );
    }, width: "15%" },
    { title: "Schedule", render: (row: Agent) => <Text size="small">{getHeartbeat(row)}</Text>, width: "12%" },
    { title: "Last active", render: (row: Agent) => <Text size="small" secondary>{getLastActive(row)}</Text>, width: "13%" },
    {
      title: "Status",
      render: (row: Agent) => row.status === "running" ? (
        <a href={`/runs?agent=${row.id}&status=running`} style={{ textDecoration: "none" }}>
          <Badge size="tiny" skin="success">Working</Badge>
        </a>
      ) : (
        <Badge size="tiny" skin={STATUS_SKINS[row.status] || "general"}>{STATUS_LABELS[row.status] || row.status}</Badge>
      ),
      width: "10%",
    },
    {
      title: "",
      render: (row: Agent) => (
        <a href={`/team/${row.id}`} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>
          View
        </a>
      ),
      width: "10%",
    },
  ];

  return (
    <Page>
      <Page.Header title="Team" subtitle={`${agents.length} team members`} actionsBar={
        <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>Refresh</Button>
      } />
      <Page.Content>
        <Card hideOverflow>
          <Table skin="standard" data={filtered} columns={columns} rowVerticalPadding="medium">
            <TableToolbar>
              <TableToolbar.ItemGroup position="start">
                <TableToolbar.Item><TableToolbar.Title>{`Team (${filtered.length})`}</TableToolbar.Title></TableToolbar.Item>
              </TableToolbar.ItemGroup>
              <TableToolbar.ItemGroup position="end">
                <TableToolbar.Item>
                  <Search size="small" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onClear={() => setSearchTerm("")} placeholder="Search..." />
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
            </TableToolbar>
            <Table.Content />
            {filtered.length === 0 && (
              <div style={{ padding: "48px 24px", textAlign: "center" }}>
                <Text secondary>No team members found.</Text>
              </div>
            )}
          </Table>
        </Card>
      </Page.Content>
    </Page>
  );
}

export default function TeamPage() {
  return (
    <Providers>
      <Shell>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
          <TeamContent />
        </Suspense>
      </Shell>
    </Providers>
  );
}

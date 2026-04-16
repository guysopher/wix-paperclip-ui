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
  Dropdown,
  Divider,
  Tooltip,
  Pagination,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany, useCompanyData } from "../../providers";
import { type Agent, type HeartbeatRun } from "@/lib/api";

const PAGE_SIZE = 25;

const STATUS_SKINS: Record<string, "general" | "success" | "warning" | "danger" | "neutral"> = {
  succeeded: "success",
  running: "warning",
  queued: "neutral",
  failed: "danger",
  timed_out: "danger",
  cancelled: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Completed",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
};

const SOURCE_LABELS: Record<string, string> = {
  on_demand: "Manual",
  scheduled: "Scheduled",
  mention: "Mentioned",
  assignment: "Assigned",
};

function duration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function timeAgo(date: string) {
  const diff = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return new Date(date).toLocaleDateString();
}

function parseUsage(usageJson: string | null): { cost: string; tokens: string } | null {
  if (!usageJson) return null;
  try {
    const u = JSON.parse(usageJson);
    const cost = u.total_cost_usd ? `$${u.total_cost_usd.toFixed(4)}` : null;
    const output = u.usage?.output_tokens || u.output_tokens || 0;
    const input = u.usage?.input_tokens || u.input_tokens || 0;
    const cache = u.usage?.cache_read_input_tokens || u.cache_read_input_tokens || 0;
    const tokens = output + input + cache > 0 ? `${((output + input + cache) / 1000).toFixed(1)}k tokens` : null;
    return { cost: cost || "—", tokens: tokens || "—" };
  } catch {
    return null;
  }
}

function RunsContent() {
  const { companyPath } = useCompany();
  const { runs, agents, loading, refresh } = useCompanyData();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState(searchParams.get("status") || "all");
  const [filterAgent, setFilterAgent] = useState(searchParams.get("agent") || "all");

  const runParam = searchParams.get("run");
  useEffect(() => {
    if (runParam) router.replace(companyPath(`/runs/${runParam}`));
  }, [companyPath, runParam, router]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.replace(companyPath(`/runs${params.toString() ? `?${params}` : ""}`), { scroll: false });
  };

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filterStatus, filterAgent, searchTerm]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || "Unknown";

  const filtered = runs
    .filter(r => filterStatus === "all" || r.status === filterStatus)
    .filter(r => filterAgent === "all" || r.agentId === filterAgent)
    .filter(r => !searchTerm || agentName(r.agentId).toLowerCase().includes(searchTerm.toLowerCase()));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  const columns = [
    {
      title: "Agent",
      render: (row: HeartbeatRun) => (
        <a href={companyPath(`/team/${row.agentId}`)} style={{ textDecoration: "none", color: "inherit" }}>
          <Box direction="horizontal" gap="8px" verticalAlign="middle">
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#3899ec", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {agentName(row.agentId).charAt(0)}
            </div>
            <Text size="small">{agentName(row.agentId)}</Text>
          </Box>
        </a>
      ),
      width: "20%",
    },
    {
      title: "Status",
      render: (row: HeartbeatRun) => (
        <Badge size="tiny" skin={STATUS_SKINS[row.status] || "general"}>
          {STATUS_LABELS[row.status] || row.status}
        </Badge>
      ),
      width: "12%",
    },
    {
      title: <Tooltip content="What caused this run: Scheduled (automatic check-in), Manual (you woke them up), Mentioned (tagged in a comment), or Assigned (given a new task)."><span>Trigger</span></Tooltip>,
      render: (row: HeartbeatRun) => (
        <Text size="small">{SOURCE_LABELS[row.invocationSource] || row.invocationSource}</Text>
      ),
      width: "10%",
    },
    {
      title: "Duration",
      render: (row: HeartbeatRun) => (
        <Text size="small">{duration(row.startedAt, row.finishedAt)}</Text>
      ),
      width: "10%",
    },
    {
      title: <Tooltip content="Estimated API cost for this run based on tokens used."><span>Cost</span></Tooltip>,
      render: (row: HeartbeatRun) => {
        const usage = parseUsage(row.usageJson);
        return <Text size="small">{usage?.cost || "—"}</Text>;
      },
      width: "10%",
    },
    {
      title: <Tooltip content="Total tokens consumed (input + output + cached). Reflects the amount of thinking and writing the agent did."><span>Tokens</span></Tooltip>,
      render: (row: HeartbeatRun) => {
        const usage = parseUsage(row.usageJson);
        return <Text size="small" secondary>{usage?.tokens || "—"}</Text>;
      },
      width: "10%",
    },
    {
      title: "When",
      render: (row: HeartbeatRun) => <Text size="small" secondary>{timeAgo(row.createdAt)}</Text>,
      width: "13%",
    },
    {
      title: "",
      render: (row: HeartbeatRun) => (
        <a href={companyPath(`/runs/${row.id}`)} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>
          View
        </a>
      ),
      width: "8%",
    },
  ];

  const statusOptions = [
    { id: "all", value: "All statuses" },
    ...Object.entries(STATUS_LABELS).map(([id, value]) => ({ id, value })),
  ];

  const agentOptions = [
    { id: "all", value: "All agents" },
    ...agents.map((a) => ({ id: a.id, value: a.name })),
  ];

  return (
    <Page>
      <Page.Header
        title="Runs"
        subtitle={`${filtered.length} runs`}
        actionsBar={
          <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={() => void refresh()}>Refresh</Button>
        }
      />
      <Page.Content>
        <Card hideOverflow>
          <Table skin="standard" data={pageData} columns={columns} rowVerticalPadding="medium">
            <TableToolbar>
              <TableToolbar.ItemGroup position="start">
                <TableToolbar.Item>
                  <TableToolbar.Title>{`Runs (${filtered.length})`}</TableToolbar.Title>
                </TableToolbar.Item>
                <TableToolbar.Item>
                  <Box height="18px"><Divider direction="vertical" /></Box>
                </TableToolbar.Item>
                <TableToolbar.Item>
                  <Dropdown size="small" selectedId={filterAgent} onSelect={(o) => { setFilterAgent(String(o.id)); updateFilter("agent", String(o.id)); }} options={agentOptions} border="round" />
                </TableToolbar.Item>
                <TableToolbar.Item>
                  <Dropdown size="small" selectedId={filterStatus} onSelect={(o) => { setFilterStatus(String(o.id)); updateFilter("status", String(o.id)); }} options={statusOptions} border="round" />
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
              <TableToolbar.ItemGroup position="end">
                <TableToolbar.Item>
                  <Search size="small" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onClear={() => setSearchTerm("")} placeholder="Search agents..." />
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
            </TableToolbar>
            <Table.Content />
            {filtered.length === 0 && (
              <div style={{ padding: "48px 24px", textAlign: "center" }}>
                <Text secondary>
                  {filterStatus === "running"
                    ? "No runs are active right now."
                    : filterStatus === "all"
                      ? "No runs yet."
                      : `No ${STATUS_LABELS[filterStatus]?.toLowerCase() || filterStatus} runs.`}
                </Text>
                {filterStatus !== "all" && runs.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setFilterStatus("all"); updateFilter("status", "all"); }} style={{ color: "#3899ec", fontSize: 13, textDecoration: "none" }}>
                      View all runs
                    </a>
                  </div>
                )}
              </div>
            )}
          </Table>
          {totalPages > 1 && (
            <Box align="center" padding="20px">
              <Pagination
                totalPages={totalPages}
                currentPage={page}
                onChange={({ page: p }) => setPage(p)}
              />
            </Box>
          )}
        </Card>
      </Page.Content>
    </Page>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
      <RunsContent />
    </Suspense>
  );
}

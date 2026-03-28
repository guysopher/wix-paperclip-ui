"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
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
  Modal,
  CustomModalLayout,
  Divider,
  Tooltip,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getAgents,
  getHeartbeatRuns,
  getHeartbeatRunLog,
  type Agent,
  type HeartbeatRun,
} from "@/lib/api";

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

interface LogEntry {
  kind: "assistant" | "tools" | "result";
  text: string;
  toolNames?: string[];
  timestamp?: string;
}

function humanizeToolName(name: string): string {
  const map: Record<string, string> = {
    Bash: "Ran command", Read: "Read file", Edit: "Edited file", Write: "Wrote file",
    Grep: "Searched code", Glob: "Found files", Agent: "Delegated to sub-agent",
    WebFetch: "Fetched URL", WebSearch: "Web search", AskUserQuestion: "Asked a question",
    TaskCreate: "Created task", TaskUpdate: "Updated task",
  };
  return map[name] || name.replace(/([A-Z])/g, " $1").trim();
}

function parseRunLog(raw: string): LogEntry[] {
  const lines = raw.split("\n").filter(Boolean);

  // First pass: extract raw items with timestamps
  const items: Array<{ kind: "text" | "tool" | "result"; text: string; toolName?: string; ts?: string }> = [];

  for (const line of lines) {
    try {
      const outer = JSON.parse(line);
      const chunkStr: string = outer.chunk ?? "";
      const ts: string = outer.ts || "";

      let chunk: Record<string, unknown> | null = null;
      try { chunk = JSON.parse(chunkStr); } catch { /* plain text */ }

      if (chunk) {
        const type = chunk.type as string;

        if (type === "assistant" && chunk.message) {
          const msg = chunk.message as { content?: Array<{ type: string; text?: string; name?: string }> };
          if (msg.content) {
            for (const block of msg.content) {
              if (block.type === "text" && block.text?.trim()) {
                items.push({ kind: "text", text: block.text.trim(), ts });
              }
              if (block.type === "tool_use" && block.name) {
                items.push({ kind: "tool", text: "", toolName: block.name, ts });
              }
            }
          }
        } else if (type === "result") {
          const result = (chunk.result as string) || "";
          if (result) items.push({ kind: "result", text: result, ts });
        }
      }
    } catch { /* skip */ }
  }

  // Second pass: merge consecutive items of the same kind
  const entries: LogEntry[] = [];
  let pendingTools: string[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    // Dedupe and count
    const counts: Record<string, number> = {};
    for (const t of pendingTools) counts[t] = (counts[t] || 0) + 1;
    const summary = Object.entries(counts)
      .map(([name, count]) => count > 1 ? `${humanizeToolName(name)} (x${count})` : humanizeToolName(name))
      .join(", ");
    entries.push({ kind: "tools", text: summary, toolNames: [...new Set(pendingTools)], timestamp: pendingToolTs });
    pendingTools = [];
    pendingToolTs = "";
  };

  let pendingToolTs = "";
  let pendingText: string[] = [];
  let pendingTextTs = "";
  const flushText = () => {
    if (pendingText.length === 0) return;
    entries.push({ kind: "assistant", text: pendingText.join("\n\n"), timestamp: pendingTextTs });
    pendingText = [];
    pendingTextTs = "";
  };

  for (const item of items) {
    if (item.kind === "tool") {
      flushText();
      if (!pendingToolTs && item.ts) pendingToolTs = item.ts;
      pendingTools.push(item.toolName!);
    } else if (item.kind === "text") {
      flushTools();
      if (!pendingTextTs && item.ts) pendingTextTs = item.ts;
      pendingText.push(item.text);
    } else if (item.kind === "result") {
      flushTools();
      flushText();
      entries.push({ kind: "result", text: item.text, timestamp: item.ts });
    }
  }
  flushTools();
  flushText();

  return entries;
}

function RunsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState(searchParams.get("status") || "running");
  const [filterAgent, setFilterAgent] = useState(searchParams.get("agent") || "all");
  const [autoOpened, setAutoOpened] = useState(false);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "running" && key === "status") params.delete(key);
    else params.set(key, value);
    router.replace(`/runs${params.toString() ? `?${params}` : ""}`, { scroll: false });
  };

  // Detail modal
  const [selectedRun, setSelectedRun] = useState<HeartbeatRun | null>(null);
  const [runLogEntries, setRunLogEntries] = useState<LogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const load = useCallback(async () => {
    const companies = await getCompanies();
    if (!companies.length) { setLoading(false); return; }
    const [agentList, runList] = await Promise.all([
      getAgents(companies[0].id),
      getHeartbeatRuns(companies[0].id),
    ]);
    setAgents(agentList);
    // Sort by most recent
    setRuns(runList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-open run from ?run={id} query param
  useEffect(() => {
    const runParam = searchParams.get("run");
    if (runParam && runs.length > 0 && !autoOpened) {
      const match = runs.find((r) => r.id === runParam);
      if (match) {
        openDetail(match);
        setAutoOpened(true);
      }
    }
  }, [runs, searchParams, autoOpened]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || "Unknown";

  const openDetail = async (run: HeartbeatRun) => {
    setSelectedRun(run);
    setRunLogEntries([]);
    setLoadingLog(true);
    try {
      const log = await getHeartbeatRunLog(run.id);
      const raw = typeof log === "string" ? log : (log.content ?? log.log ?? log.output ?? "");
      if (!raw) {
        setRunLogEntries(run.stdoutExcerpt
          ? [{ kind: "assistant", text: run.stdoutExcerpt }]
          : [{ kind: "assistant", text: "No output available." }]);
        setLoadingLog(false);
        return;
      }
      const entries = parseRunLog(raw);
      setRunLogEntries(entries.length > 0 ? entries : [{ kind: "assistant", text: "No readable output in this run." }]);
    } catch {
      setRunLogEntries([{ kind: "assistant", text: run.stdoutExcerpt || "Log not available." }]);
    }
    setLoadingLog(false);
  };

  const filtered = runs
    .filter((r) => filterStatus === "all" || r.status === filterStatus)
    .filter((r) => filterAgent === "all" || r.agentId === filterAgent)
    .filter((r) => !searchTerm || agentName(r.agentId).toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  const columns = [
    {
      title: "Agent",
      render: (row: HeartbeatRun) => (
        <a href={`/team?agent=${row.agentId}`} style={{ textDecoration: "none", color: "inherit" }}>
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
        <a href="#" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openDetail(row); }} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>
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
    <>
      <Page>
        <Page.Header
          title="Runs"
          subtitle={`${runs.length} total runs`}
          actionsBar={
            <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>Refresh</Button>
          }
        />
        <Page.Content>
          <Card hideOverflow>
            <Table skin="standard" data={filtered} columns={columns} rowVerticalPadding="medium">
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
                    <Search size="small" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onClear={() => setSearchTerm("")} placeholder="Search..." />
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
          </Card>
        </Page.Content>
      </Page>

      {/* Run detail modal */}
      <Modal isOpen={!!selectedRun} onRequestClose={() => setSelectedRun(null)} shouldCloseOnOverlayClick>
        {selectedRun && (
          <CustomModalLayout
            width="90vw"
            maxHeight="90vh"
            title={
              <Box direction="vertical" gap="6px">
                <Text weight="bold" size="medium"><a href={`/team?agent=${selectedRun.agentId}`} style={{ color: "inherit", textDecoration: "none" }}>{agentName(selectedRun.agentId)}</a> — Work Session</Text>
                <Box direction="horizontal" gap="12px" verticalAlign="middle" marginTop="6px">
                  <Badge size="tiny" skin={STATUS_SKINS[selectedRun.status] || "general"}>
                    {STATUS_LABELS[selectedRun.status] || selectedRun.status}
                  </Badge>
                  <span style={{ fontSize: 12, color: "#666" }}>
                    <strong>Started:</strong> {selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "#666" }}>
                    <strong>Duration:</strong> {duration(selectedRun.startedAt, selectedRun.finishedAt)}
                  </span>
                  <span style={{ fontSize: 12, color: "#666" }}>
                    <strong>Trigger:</strong> {SOURCE_LABELS[selectedRun.invocationSource] || selectedRun.invocationSource}
                  </span>
                  {(() => { const u = parseUsage(selectedRun.usageJson); return u ? (
                    <>
                      <span style={{ fontSize: 12, color: "#666" }}><strong>Cost:</strong> {u.cost}</span>
                      <span style={{ fontSize: 12, color: "#666" }}><strong>Tokens:</strong> {u.tokens}</span>
                    </>
                  ) : null; })()}
                </Box>
              </Box>
            }
            onCloseButtonClick={() => setSelectedRun(null)}
          >
            <div style={{ maxHeight: "calc(90vh - 200px)", overflowY: "auto" }}>
              {/* Meta */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px 24px", marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#999" }}>Started</div>
                  <Text size="small">{selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : "—"}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999" }}>Finished</div>
                  <Text size="small">{selectedRun.finishedAt ? new Date(selectedRun.finishedAt).toLocaleString() : "Still running..."}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999" }}>Exit code</div>
                  <Text size="small">{selectedRun.exitCode !== null ? selectedRun.exitCode : "—"}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999" }}>Log size</div>
                  <Text size="small">{selectedRun.logBytes ? `${(selectedRun.logBytes / 1024).toFixed(1)} KB` : "—"}</Text>
                </div>
              </div>

              {/* Error */}
              {selectedRun.error && (
                <div style={{ padding: "10px 14px", background: "#fff5f5", borderRadius: 6, border: "1px solid #ffe0e0", fontSize: 13, color: "#cc0000", marginBottom: 18 }}>
                  {selectedRun.error}
                </div>
              )}

              <Divider />

              {/* Log output */}
              <div style={{ marginTop: 18 }}>
                <Text size="small" weight="bold" secondary>AGENT OUTPUT</Text>
                {loadingLog ? (
                  <Box padding="24px" align="center"><Loader size="small" /></Box>
                ) : (
                  <div style={{ marginTop: 12, maxHeight: 500, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {runLogEntries.map((entry, i) => {
                      const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
                      if (entry.kind === "assistant") {
                        return (
                          <div key={i}>
                            {ts && <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>{ts}</div>}
                            <div style={{ padding: "12px 16px", background: "#f7f8fa", borderRadius: 8, borderLeft: "3px solid #3899ec", fontSize: 13, lineHeight: 1.7, color: "#333", whiteSpace: "pre-wrap" }}>
                              {entry.text}
                            </div>
                          </div>
                        );
                      }
                      if (entry.kind === "tools") {
                        return (
                          <div key={i} style={{ padding: "6px 14px", fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 14 }}>&#9881;</span>
                            {entry.text}
                            {ts && <span style={{ marginLeft: "auto", fontSize: 10, color: "#ccc" }}>{ts}</span>}
                          </div>
                        );
                      }
                      if (entry.kind === "result") {
                        return (
                          <div key={i}>
                            {ts && <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>{ts}</div>}
                            <div style={{ padding: "10px 14px", background: "#f0faf0", borderRadius: 6, borderLeft: "3px solid #4caf50", fontSize: 13, color: "#2e7d32", whiteSpace: "pre-wrap" }}>
                              {entry.text}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            </div>
          </CustomModalLayout>
        )}
      </Modal>
    </>
  );
}

export default function RunsPage() {
  return (
    <Providers>
      <Shell>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
          <RunsContent />
        </Suspense>
      </Shell>
    </Providers>
  );
}

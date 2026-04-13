"use client";

import { useEffect, useState, use } from "react";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Loader,
  Divider,
  Button,
} from "@wix/design-system";
import {
  getHeartbeatRun,
  getHeartbeatRunLog,
  getAgents,
  type HeartbeatRun,
  type Agent,
} from "@/lib/api";
import {
  type LogEntry,
  type DetailedRunEvent,
  parseRunLog,
  parseDetailedRunLog,
  parseUsage,
  duration,
  timeAgo,
} from "@/lib/run-utils";
import { useCompany } from "../../../providers";
import { Breadcrumbs } from "../../../components/breadcrumbs";

const STATUS_SKINS: Record<string, "success" | "warning" | "neutral" | "danger" | "general"> = {
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

function RunDetailContent({ runId }: { runId: string }) {
  const { companyId, companyPath } = useCompany();
  const [run, setRun] = useState<HeartbeatRun | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [detailedEvents, setDetailedEvents] = useState<DetailedRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState(true);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [loadingDebug, setLoadingDebug] = useState(false);

  useEffect(() => {
    if (!companyId) return;

    (async () => {
      try {
        const [fetchedRun, agentList] = await Promise.all([
          getHeartbeatRun(runId),
          getAgents(companyId),
        ]);
        setRun(fetchedRun);
        setAgents(agentList);
        setLoading(false);

        // Fetch log
        try {
          const log = await getHeartbeatRunLog(runId);
          const raw = typeof log === "string" ? log : ((log as Record<string, string>).content ?? (log as Record<string, string>).log ?? (log as Record<string, string>).output ?? "");
          if (!raw) {
            setLogEntries(
              fetchedRun.stdoutExcerpt
                ? [{ kind: "assistant", text: fetchedRun.stdoutExcerpt }]
                : [{ kind: "assistant", text: "No output available." }]
            );
            setDetailedEvents(
              fetchedRun.stdoutExcerpt
                ? [{ kind: "raw", text: fetchedRun.stdoutExcerpt }]
                : []
            );
          } else {
            const entries = parseRunLog(raw);
            const events = parseDetailedRunLog(raw);
            setLogEntries(
              entries.length > 0
                ? entries
                : [{ kind: "assistant", text: "No readable output in this run." }]
            );
            setDetailedEvents(events);
          }
        } catch {
          setLogEntries([
            { kind: "assistant", text: fetchedRun.stdoutExcerpt || "Log not available." },
          ]);
          setDetailedEvents(
            fetchedRun.stdoutExcerpt
              ? [{ kind: "raw", text: fetchedRun.stdoutExcerpt }]
              : []
          );
        }
        setLoadingLog(false);
      } catch {
        setLoading(false);
        setLoadingLog(false);
      }
    })();
  }, [companyId, runId]);

  const fetchDebugInfo = async () => {
    setLoadingDebug(true);
    try {
      const response = await fetch(`/api/debug-run/${runId}`);
      const data = await response.json();
      setDebugInfo(data);
    } catch (error) {
      setDebugInfo({ error: String(error) });
    }
    setLoadingDebug(false);
  };

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || "Unknown";

  if (loading) {
    return (
      <Box align="center" verticalAlign="middle" height="400px">
        <Loader size="medium" />
      </Box>
    );
  }

  if (!run) {
    return (
      <Page>
        <Page.Header title="Run not found" />
        <Page.Content>
          <Card>
            <Card.Content>
              <Text>This run could not be loaded.</Text>
            </Card.Content>
          </Card>
        </Page.Content>
      </Page>
    );
  }

  const usage = parseUsage(run.usageJson);

  return (
    <Page>
      <Page.Header
        title={
          <Breadcrumbs
            items={[
              { label: "Runs", href: "/runs" },
              { label: `${agentName(run.agentId)} — Work Session` },
            ]}
          />
        }
        actionsBar={
          <Button
            size="tiny"
            priority="secondary"
            onClick={fetchDebugInfo}
            disabled={loadingDebug}
          >
            {loadingDebug ? "Loading..." : "Debug"}
          </Button>
        }
      />
      <Page.Content>
        <Box direction="vertical" gap="24px">
          {/* Metadata card */}
          <Card>
            <Card.Header title="Run Details" />
            <Card.Divider />
            <Card.Content>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "16px 32px",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Status</div>
                  <Badge size="tiny" skin={STATUS_SKINS[run.status] || "general"}>
                    {STATUS_LABELS[run.status] || run.status}
                  </Badge>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Agent</div>
                  <a
                    href={companyPath(`/team/${run.agentId}`)}
                    style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}
                  >
                    {agentName(run.agentId)}
                  </a>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Trigger</div>
                  <Text size="small">
                    {SOURCE_LABELS[run.invocationSource] || run.invocationSource}
                  </Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Started</div>
                  <Text size="small">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                  </Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Finished</div>
                  <Text size="small">
                    {run.finishedAt
                      ? new Date(run.finishedAt).toLocaleString()
                      : "Still running..."}
                  </Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Duration</div>
                  <Text size="small">{duration(run.startedAt, run.finishedAt)}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Exit code</div>
                  <Text size="small">{run.exitCode !== null ? run.exitCode : "—"}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Cost</div>
                  <Text size="small">{usage?.cost || "—"}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Tokens</div>
                  <Text size="small">{usage?.tokens || "—"}</Text>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Log size</div>
                  <Text size="small">
                    {run.logBytes ? `${(run.logBytes / 1024).toFixed(1)} KB` : "—"}
                  </Text>
                </div>
              </div>
            </Card.Content>
          </Card>

          {/* Debug Info Card - Only visible when debug button clicked */}
          {debugInfo && (
            <Card>
              <Card.Header
                title="RUN_SUMMARY Debug"
                subtitle="Developer diagnostic information"
              />
              <Card.Divider />
              <Card.Content>
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Summary:</div>
                    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "8px", background: "#f7f9fc", padding: 12, borderRadius: 6 }}>
                      <div>Log Length:</div>
                      <div>{debugInfo.logLength ? `${debugInfo.logLength} chars` : "N/A"}</div>

                      <div>Contains "RUN_SUMMARY":</div>
                      <div style={{ color: debugInfo.containsRUNSUMMARY ? "#00a854" : "#ff4d4f", fontWeight: 600 }}>
                        {debugInfo.containsRUNSUMMARY ? "✓ Yes" : "✗ No"}
                      </div>

                      <div>Contains "goalProgress":</div>
                      <div style={{ color: debugInfo.containsGoalProgress ? "#00a854" : "#ff4d4f", fontWeight: 600 }}>
                        {debugInfo.containsGoalProgress ? "✓ Yes" : "✗ No"}
                      </div>

                      <div>Valid RUN_SUMMARY found:</div>
                      <div style={{ color: debugInfo.hasRUNSUMMARY ? "#00a854" : "#ff4d4f", fontWeight: 600 }}>
                        {debugInfo.hasRUNSUMMARY ? "✓ Yes" : "✗ No"}
                      </div>
                    </div>
                  </div>

                  {(debugInfo.singleLineMatch || debugInfo.multilineMatch) && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Extracted RUN_SUMMARY JSON:</div>
                      <pre style={{
                        background: "#162d3d",
                        color: "#00d68f",
                        padding: 12,
                        borderRadius: 6,
                        overflow: "auto",
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}>
                        {debugInfo.singleLineMatch || debugInfo.multilineMatch}
                      </pre>
                    </div>
                  )}

                  {debugInfo.last500chars && (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Last 500 characters of log:</div>
                      <pre style={{
                        background: "#f0f0f0",
                        padding: 12,
                        borderRadius: 6,
                        overflow: "auto",
                        fontSize: 11,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}>
                        {debugInfo.last500chars}
                      </pre>
                    </div>
                  )}

                  {debugInfo.error && (
                    <div style={{ color: "#ff4d4f", marginTop: 12 }}>
                      Error: {debugInfo.error}
                    </div>
                  )}

                  <div style={{ marginTop: 16 }}>
                    <Button size="tiny" priority="secondary" onClick={() => setDebugInfo(null)}>
                      Hide
                    </Button>
                  </div>
                </div>
              </Card.Content>
            </Card>
          )}

          {/* Error card */}
          {run.error && (
            <Card>
              <Card.Content>
                <div
                  style={{
                    padding: "12px 16px",
                    background: "#fff5f5",
                    borderRadius: 6,
                    border: "1px solid #ffe0e0",
                    fontSize: 13,
                    color: "#cc0000",
                    lineHeight: 1.6,
                  }}
                >
                  <Text size="small" weight="bold">
                    Error
                  </Text>
                  <div style={{ marginTop: 6 }}>{run.error}</div>
                </div>
              </Card.Content>
            </Card>
          )}

          {/* Agent Output card */}
          <Card>
            <Card.Header title="Agent Output" />
            <Card.Divider />
            <Card.Content>
              {loadingLog ? (
                <Box padding="24px" align="center">
                  <Loader size="small" />
                </Box>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {logEntries.map((entry, i) => {
                    const ts = entry.timestamp
                      ? new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                      : "";

                    if (entry.kind === "assistant") {
                      return (
                        <div key={i}>
                          {ts && (
                            <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>
                              {ts}
                            </div>
                          )}
                          <div
                            style={{
                              padding: "12px 16px",
                              background: "#f7f8fa",
                              borderRadius: 8,
                              borderLeft: "3px solid #3899ec",
                              fontSize: 13,
                              lineHeight: 1.7,
                              color: "#333",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {entry.text}
                          </div>
                        </div>
                      );
                    }

                    if (entry.kind === "tools") {
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "6px 14px",
                            fontSize: 12,
                            color: "#999",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 14 }}>&#9881;</span>
                          {entry.text}
                          {ts && (
                            <span style={{ marginLeft: "auto", fontSize: 10, color: "#ccc" }}>
                              {ts}
                            </span>
                          )}
                        </div>
                      );
                    }

                    if (entry.kind === "result") {
                      return (
                        <div key={i}>
                          {ts && (
                            <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>
                              {ts}
                            </div>
                          )}
                          <div
                            style={{
                              padding: "10px 14px",
                              background: "#f0faf0",
                              borderRadius: 6,
                              borderLeft: "3px solid #4caf50",
                              fontSize: 13,
                              color: "#2e7d32",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {entry.text}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header
              title="Detailed Trace"
              subtitle="Exact tools, commands, and results captured in this run log."
            />
            <Card.Divider />
            <Card.Content>
              {loadingLog ? (
                <Box padding="24px" align="center">
                  <Loader size="small" />
                </Box>
              ) : detailedEvents.length === 0 ? (
                <Text size="small" secondary>No detailed trace available for this run.</Text>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {detailedEvents.map((event, index) => {
                    const ts = event.timestamp
                      ? new Date(event.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                      : "";

                    const header = event.toolName
                      ? `${event.title || event.toolName} (${event.toolName})`
                      : event.title || event.kind.replace("_", " ");

                    return (
                      <div
                        key={`${event.kind}-${index}`}
                        style={{
                          border: "1px solid #eceff3",
                          borderRadius: 8,
                          overflow: "hidden",
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background:
                              event.kind === "tool_use"
                                ? "#eef6ff"
                                : event.kind === "tool_result"
                                  ? "#eefaf0"
                                  : event.kind === "thinking"
                                    ? "#fff7e6"
                                    : "#f7f9fc",
                            borderBottom: "1px solid #eceff3",
                          }}
                        >
                          <Text size="small" weight="bold">{header}</Text>
                          {ts && <Text size="tiny" secondary>{ts}</Text>}
                        </div>

                        {event.text && (
                          <pre
                            style={{
                              margin: 0,
                              padding: "12px 14px",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 12,
                              lineHeight: 1.6,
                              background: event.kind === "thinking" ? "#fffdf6" : "#fff",
                            }}
                          >
                            {event.text}
                          </pre>
                        )}

                        {event.input && (
                          <div>
                            <div style={{ padding: "8px 14px 0", fontSize: 11, color: "#6b7280" }}>Input</div>
                            <pre
                              style={{
                                margin: 0,
                                padding: "8px 14px 12px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                fontSize: 12,
                                lineHeight: 1.6,
                                background: "#fbfcfe",
                              }}
                            >
                              {event.input}
                            </pre>
                          </div>
                        )}

                        {event.output && (
                          <div>
                            <div style={{ padding: "8px 14px 0", fontSize: 11, color: "#6b7280" }}>Result</div>
                            <pre
                              style={{
                                margin: 0,
                                padding: "8px 14px 12px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                fontSize: 12,
                                lineHeight: 1.6,
                                background: "#f8fffa",
                              }}
                            >
                              {event.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Content>
          </Card>
        </Box>
      </Page.Content>
    </Page>
  );
}

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);

  return <RunDetailContent runId={runId} />;
}

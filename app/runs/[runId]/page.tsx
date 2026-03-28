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
  parseRunLog,
  parseUsage,
  duration,
  timeAgo,
} from "@/lib/run-utils";
import { Providers, useCompany } from "../../providers";
import { Shell } from "../../shell";
import { Breadcrumbs } from "../../components/breadcrumbs";

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
  const { companyId } = useCompany();
  const [run, setRun] = useState<HeartbeatRun | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState(true);

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
          } else {
            const entries = parseRunLog(raw);
            setLogEntries(
              entries.length > 0
                ? entries
                : [{ kind: "assistant", text: "No readable output in this run." }]
            );
          }
        } catch {
          setLogEntries([
            { kind: "assistant", text: fetchedRun.stdoutExcerpt || "Log not available." },
          ]);
        }
        setLoadingLog(false);
      } catch {
        setLoading(false);
        setLoadingLog(false);
      }
    })();
  }, [companyId, runId]);

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
                    href={`/team?agent=${run.agentId}`}
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
                  <Text size="small" weight="bold" skin="destructive">
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
        </Box>
      </Page.Content>
    </Page>
  );
}

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);

  return (
    <Providers>
      <Shell>
        <RunDetailContent runId={runId} />
      </Shell>
    </Providers>
  );
}

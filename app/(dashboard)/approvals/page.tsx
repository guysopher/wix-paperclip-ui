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
  Dropdown,
  Modal,
  CustomModalLayout,
  Divider,
  InputArea,
  Tooltip,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import { IconPicker } from "@/components/icon-picker";
import { AgentAvatar } from "@/components/agent-avatar";
import {
  getAgents,
  getApprovals,
  updateApproval,
  createAgent,
  type Agent,
  type Approval,
} from "@/lib/api";

const STATUS_SKINS: Record<string, "general" | "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function timeAgo(date: string) {
  const diff = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return new Date(date).toLocaleDateString();
}

function humanizeType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\./g, " — ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarizePayload(payload: Record<string, unknown>): string {
  if (!payload || Object.keys(payload).length === 0) return "";
  // Try common fields
  if (payload.description) return String(payload.description);
  if (payload.title) return String(payload.title);
  if (payload.message) return String(payload.message);
  if (payload.reason) return String(payload.reason);
  // Fallback: show keys
  const entries = Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`);
  return entries.join(", ");
}

function renderPayloadValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span style={{ color: "#999" }}>—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    // Multi-line strings get a preformatted block
    if (value.includes("\n")) {
      return <div style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.6 }}>{value}</div>;
    }
    return value;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return (
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {value.map((item, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{typeof item === "object" ? renderPayloadValue(item) : String(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    // Render nested object as labeled fields
    return (
      <div style={{ paddingLeft: 12, borderLeft: "2px solid #e0e0e0", marginTop: 4 }}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <span style={{ color: "#888", fontSize: 12 }}>{k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim()}: </span>
            {renderPayloadValue(v)}
          </div>
        ))}
      </div>
    );
  }
  return String(value);
}

/** Dedicated renderer for hire_agent approvals */
function HireAgentDetails({ payload }: { payload: Record<string, unknown> }) {
  const [instructions, setInstructions] = useState<string | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(false);

  const adapterConfig = payload.adapterConfig as Record<string, unknown> | undefined;
  const filePath = adapterConfig?.instructionsFilePath as string | undefined;
  const promptTemplate = adapterConfig?.promptTemplate as string | undefined;

  // Fetch instructions from file if available
  useEffect(() => {
    if (promptTemplate) {
      setInstructions(promptTemplate);
      return;
    }
    if (!filePath) return;
    setLoadingInstructions(true);
    fetch(`/api/agent-instructions?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((d) => setInstructions(d.content || null))
      .catch(() => {})
      .finally(() => setLoadingInstructions(false));
  }, [filePath, promptTemplate]);

  const name = String(payload.name || "?");
  const title = String(payload.title || "");
  const capabilities = String(payload.capabilities || "");
  const icon = payload.icon as string | undefined;
  const role = payload.role as string | undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#f0f5ff", borderRadius: 8, border: "1px solid #d0e0ff" }}>
        <AgentAvatar
          agentName={name}
          agentRole={role}
          icon={icon}
          size={44}
          fontSize={16}
        />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{name}</div>
          <div style={{ fontSize: 13, color: "#666" }}>{title}</div>
        </div>
      </div>

      {capabilities && (
        <div>
          <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Capabilities</div>
          <div style={{ fontSize: 13, color: "#333", lineHeight: 1.5 }}>{capabilities}</div>
        </div>
      )}

      {/* Role description / instructions */}
      <div>
        <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Role Description</div>
        {loadingInstructions ? (
          <div style={{ padding: 12, textAlign: "center" }}><Loader size="tiny" /></div>
        ) : instructions ? (
          <div style={{
            padding: "12px 16px", background: "#f7f8fa", borderRadius: 8,
            fontSize: 13, lineHeight: 1.7, color: "#333",
            maxHeight: 300, overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}>
            {instructions}
          </div>
        ) : (
          <div style={{ padding: "12px 16px", background: "#f7f8fa", borderRadius: 8, fontSize: 13, color: "#999" }}>
            No role description provided.
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalsContent() {
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState(searchParams.get("status") || "pending");

  const updateFilterUrl = (status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (status === "pending") params.delete("status");
    else params.set("status", status);
    router.replace(`/approvals${params.toString() ? `?${params}` : ""}`, { scroll: false });
  };
  const [acting, setActing] = useState<string | null>(null);

  // Detail modal
  const [selected, setSelected] = useState<Approval | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const [agentList, approvalList] = await Promise.all([
      getAgents(companyId),
      getApprovals(companyId),
    ]);
    setAgents(agentList);
    setApprovals(approvalList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (approval: Approval, status: "approved" | "rejected") => {
    setActing(approval.id);
    try {
      await updateApproval(approval.id, { status, notes: notes || undefined });
      setSelected(null);
      setNotes("");
      await load();
    } catch { /* silent */ }
    setActing(null);
  };

  /** For rejected hire_agent approvals: create the agent directly from the payload */
  const handleForceHire = async (approval: Approval) => {
    if (!companyId) return;
    setActing(approval.id);
    try {
      const p = approval.payload;
      const oldConfig = (p.adapterConfig || {}) as Record<string, unknown>;

      // If the original agent had file-based instructions, fetch them
      let promptTemplate = oldConfig.promptTemplate as string | undefined;
      if (!promptTemplate && oldConfig.instructionsFilePath) {
        try {
          const res = await fetch(`/api/agent-instructions?path=${encodeURIComponent(String(oldConfig.instructionsFilePath))}`);
          const data = await res.json();
          if (data.content) promptTemplate = data.content;
        } catch { /* use without prompt */ }
      }

      const newAgent = await createAgent(companyId, {
        name: p.name,
        role: p.role,
        title: p.title,
        icon: p.icon as string | undefined,
        capabilities: p.capabilities,
        reportsTo: p.reportsTo || undefined,
        adapterType: "claude_local",
        adapterConfig: {
          model: oldConfig.model || "claude-sonnet-4-6",
          heartbeatIntervalSec: oldConfig.heartbeatIntervalSec || 600,
          timeoutSec: oldConfig.timeoutSec || 600,
          maxTurnsPerRun: oldConfig.maxTurnsPerRun || 50,
          dangerouslySkipPermissions: true,
          ...(promptTemplate ? { promptTemplate } : {}),
        },
      });
      setSelected(null);
      router.push(`/team/${newAgent.id}`);
    } catch (e) {
      console.error("Force hire failed:", e);
      alert(e instanceof Error ? e.message : "Failed to hire agent");
    }
    setActing(null);
  };

  const filtered = approvals.filter((a) => filterStatus === "all" || a.status === filterStatus);

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  const columns = [
    {
      title: "Type",
      render: (row: Approval) => (
        <Text size="small">{humanizeType(row.type)}</Text>
      ),
      width: "20%",
    },
    {
      title: "Details",
      render: (row: Approval) => (
        <Text size="small" secondary>{summarizePayload(row.payload) || "—"}</Text>
      ),
      width: "35%",
    },
    {
      title: "Status",
      render: (row: Approval) => (
        <Badge size="tiny" skin={STATUS_SKINS[row.status] || "general"}>
          {STATUS_LABELS[row.status] || row.status}
        </Badge>
      ),
      width: "12%",
    },
    {
      title: "When",
      render: (row: Approval) => <Text size="small" secondary>{timeAgo(row.createdAt)}</Text>,
      width: "13%",
    },
    {
      title: "",
      render: (row: Approval) => {
        if (row.status !== "pending") {
          return (
            <a href="#" onMouseDown={(e) => { e.preventDefault(); setSelected(row); setNotes(row.notes || ""); }}
              style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>
              View
            </a>
          );
        }
        return (
          <Box direction="horizontal" gap="6px">
            <Button size="tiny" skin="standard" onClick={() => { setSelected(row); setNotes(""); }}>
              Review
            </Button>
          </Box>
        );
      },
      width: "20%",
    },
  ];

  const statusOptions = [
    { id: "all", value: "All" },
    { id: "pending", value: `Pending (${pendingCount})` },
    { id: "approved", value: "Approved" },
    { id: "rejected", value: "Rejected" },
  ];

  return (
    <>
      <Page>
        <Page.Header
          title="Approvals"
          subtitle={pendingCount > 0 ? `${pendingCount} awaiting your decision` : "No pending approvals"}
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
                    <TableToolbar.Title>{`Approvals (${filtered.length})`}</TableToolbar.Title>
                  </TableToolbar.Item>
                  <TableToolbar.Item>
                    <Box height="18px"><Divider direction="vertical" /></Box>
                  </TableToolbar.Item>
                  <TableToolbar.Item>
                    <Dropdown size="small" selectedId={filterStatus} onSelect={(o) => { const s = String(o.id); setFilterStatus(s); updateFilterUrl(s); }} options={statusOptions} border="round" />
                  </TableToolbar.Item>
                </TableToolbar.ItemGroup>
              </TableToolbar>
              <Table.Content />
              {filtered.length === 0 && (
                <div style={{ padding: "48px 24px", textAlign: "center" }}>
                  <Text secondary>
                    {filterStatus === "pending"
                      ? "No approvals waiting for your review."
                      : filterStatus === "all"
                        ? "No approvals yet."
                        : `No ${STATUS_LABELS[filterStatus]?.toLowerCase() || filterStatus} approvals.`}
                  </Text>
                  {filterStatus !== "all" && approvals.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setFilterStatus("all"); updateFilterUrl("all"); }} style={{ color: "#3899ec", fontSize: 13, textDecoration: "none" }}>
                        View all approvals
                      </a>
                    </div>
                  )}
                </div>
              )}
            </Table>
          </Card>
        </Page.Content>
      </Page>

      {/* Review modal */}
      <Modal isOpen={!!selected} onRequestClose={() => setSelected(null)} shouldCloseOnOverlayClick>
        {selected && (
          <CustomModalLayout
            width="600px"
            title={humanizeType(selected.type)}
            subtitle={
              <Box direction="horizontal" gap="6px" verticalAlign="middle">
                <Badge size="tiny" skin={STATUS_SKINS[selected.status] || "general"}>
                  {STATUS_LABELS[selected.status] || selected.status}
                </Badge>
                <Text size="tiny" secondary>{new Date(selected.createdAt).toLocaleString()}</Text>
              </Box>
            }
            onCloseButtonClick={() => setSelected(null)}
            primaryButtonText={selected.status === "pending" ? (acting === selected.id ? "Approving..." : "Approve") : undefined}
            primaryButtonOnClick={selected.status === "pending" ? () => handleAction(selected, "approved") : undefined}
            primaryButtonProps={selected.status === "pending" ? { disabled: acting === selected.id } : undefined}
            secondaryButtonText={selected.status === "pending" ? "Reject" : undefined}
            secondaryButtonOnClick={selected.status === "pending" ? () => handleAction(selected, "rejected") : undefined}
            secondaryButtonProps={selected.status === "pending" ? {
              disabled: acting === selected.id,
              skin: "destructive" as const,
            } : undefined}
            footnote={selected.status === "rejected" && selected.type === "hire_agent" ? (
              <Box align="right" gap="8px" direction="horizontal" verticalAlign="middle">
                <Text size="small" secondary>Changed your mind?</Text>
                <Button
                  size="small"
                  onClick={() => handleForceHire(selected)}
                  disabled={acting === selected.id}
                >
                  {acting === selected.id ? "Hiring..." : "Re-hire"}
                </Button>
              </Box>
            ) : undefined}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {selected.status === "pending" && (
                <div style={{ padding: "10px 14px", background: "#fff8e1", borderRadius: 6, fontSize: 13, color: "#7a6200", lineHeight: 1.5 }}>
                  {selected.type === "hire_agent"
                    ? "An agent wants to hire a new team member. Review their proposed role below."
                    : "An agent is requesting permission to proceed. Review the details below and approve or reject."}
                </div>
              )}

              {/* Hire agent: dedicated layout */}
              {selected.type === "hire_agent" ? (
                <HireAgentDetails payload={selected.payload} />
              ) : (
                /* Generic payload details — filter out internal/technical fields */
                <div>
                  <Text size="small" weight="bold" secondary>REQUEST DETAILS</Text>
                  <div style={{ marginTop: 8, padding: "12px 16px", background: "#f7f8fa", borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
                    {(() => {
                      const HIDDEN = new Set(["agentId", "adapterType", "adapterConfig", "runtimeConfig", "metadata", "requestedByAgentId", "requestedConfigurationSnapshot", "budgetMonthlyCents", "desiredSkills"]);
                      const entries = Object.entries(selected.payload).filter(([k]) => !HIDDEN.has(k));
                      return entries.length > 0 ? (
                        entries.map(([key, value]) => (
                          <div key={key} style={{ marginBottom: 8 }}>
                            <div style={{ color: "#888", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                              {key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim()}
                            </div>
                            <div style={{ color: "#333" }}>
                              {renderPayloadValue(value)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <Text size="small" secondary>No details provided.</Text>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selected.status === "pending" ? (
                <div>
                  <Text size="small" weight="bold" secondary>NOTES (optional)</Text>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 2, marginBottom: 6 }}>Your note will be shared with the agent so they understand your decision.</div>
                  <div>
                    <InputArea
                      size="small"
                      placeholder="Add a note for the agent..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              ) : selected.notes ? (
                <div>
                  <Text size="small" weight="bold" secondary>NOTES</Text>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>{selected.notes}</div>
                </div>
              ) : null}
            </div>
          </CustomModalLayout>
        )}
      </Modal>
    </>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>
      <ApprovalsContent />
    </Suspense>
  );
}

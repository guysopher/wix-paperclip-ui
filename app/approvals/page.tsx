"use client";

import { useEffect, useState, useCallback } from "react";
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
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getAgents,
  getApprovals,
  updateApproval,
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

function ApprovalsContent() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [acting, setActing] = useState<string | null>(null);

  // Detail modal
  const [selected, setSelected] = useState<Approval | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const companies = await getCompanies();
    if (!companies.length) { setLoading(false); return; }
    const [agentList, approvalList] = await Promise.all([
      getAgents(companies[0].id),
      getApprovals(companies[0].id),
    ]);
    setAgents(agentList);
    setApprovals(approvalList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setLoading(false);
  }, []);

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
          subtitle={pendingCount > 0 ? `${pendingCount} pending` : "All clear"}
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
                    <Dropdown size="small" selectedId={filterStatus} onSelect={(o) => setFilterStatus(String(o.id))} options={statusOptions} border="round" />
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
                  {filterStatus !== "all" && (
                    <div style={{ marginTop: 8 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setFilterStatus("all"); }} style={{ color: "#3899ec", fontSize: 13, textDecoration: "none" }}>
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
            primaryButtonText={selected.status === "pending" ? "Approve" : undefined}
            primaryButtonProps={selected.status === "pending" ? {
              disabled: acting === selected.id,
              onClick: () => handleAction(selected, "approved"),
            } : undefined}
            secondaryButtonText={selected.status === "pending" ? "Reject" : undefined}
            secondaryButtonProps={selected.status === "pending" ? {
              disabled: acting === selected.id,
              skin: "destructive" as const,
              onClick: () => handleAction(selected, "rejected"),
            } : undefined}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Payload details */}
              <div>
                <Text size="small" weight="bold" secondary>REQUEST DETAILS</Text>
                <div style={{ marginTop: 8, padding: "12px 16px", background: "#f7f8fa", borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
                  {Object.entries(selected.payload).length > 0 ? (
                    Object.entries(selected.payload).map(([key, value]) => (
                      <div key={key} style={{ marginBottom: 6 }}>
                        <span style={{ color: "#999", fontSize: 12 }}>{key.replace(/_/g, " ")}:</span>{" "}
                        <span style={{ color: "#333" }}>
                          {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <Text size="small" secondary>No details provided.</Text>
                  )}
                </div>
              </div>

              {/* Notes */}
              {selected.status === "pending" ? (
                <div>
                  <Text size="small" weight="bold" secondary>NOTES (optional)</Text>
                  <div style={{ marginTop: 6 }}>
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
    <Providers>
      <Shell>
        <ApprovalsContent />
      </Shell>
    </Providers>
  );
}

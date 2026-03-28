"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  Modal,
  CustomModalLayout,
  Divider,
  FormField,
  Dropdown,
  Input,
  InputArea,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getAgents,
  getOrg,
  invokeHeartbeat,
  pauseAgent,
  resumeAgent,
  updateAgent,
  type Agent,
  type OrgNode,
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

const MODEL_OPTIONS = [
  { id: "claude-opus-4-6", value: "Senior (Opus)" },
  { id: "claude-sonnet-4-6", value: "Standard (Sonnet)" },
];

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Senior",
  "claude-sonnet-4-6": "Standard",
};

const MODEL_COLORS: Record<string, { bg: string; color: string }> = {
  "claude-opus-4-6": { bg: "#f0e6ff", color: "#6b3fa0" },
  "claude-sonnet-4-6": { bg: "#e8f4fd", color: "#2b6cb0" },
};

const SCHEDULE_OPTIONS = [
  { id: "300", value: "Every 5 min" },
  { id: "600", value: "Every 10 min" },
  { id: "900", value: "Every 15 min" },
  { id: "1200", value: "Every 20 min" },
  { id: "1800", value: "Every 30 min" },
  { id: "3600", value: "Every hour" },
];

function TeamContent() {
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [acting, setActing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editManager, setEditManager] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  const load = async () => {
    const companies = await getCompanies();
    if (companies.length > 0) {
      const agentData = await getAgents(companies[0].id);
      setAgents(agentData);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-open agent from ?agent={id} query param
  useEffect(() => {
    const agentParam = searchParams.get("agent");
    if (agentParam && agents.length > 0 && !autoOpened) {
      const match = agents.find((a) => a.id === agentParam);
      if (match) {
        openDetail(match);
        setAutoOpened(true);
      }
    }
  }, [agents, searchParams, autoOpened]);

  const openDetail = (agent: Agent) => {
    setSelectedAgent(agent);
    setEditName(agent.name);
    setEditTitle(agent.title);
    setEditModel((agent.adapterConfig?.model as string) || "claude-sonnet-4-6");
    setEditSchedule(String((agent.adapterConfig?.heartbeatIntervalSec as number) || 600));
    setEditManager(agent.reportsTo);
    setEditPrompt((agent.adapterConfig?.promptTemplate as string) || "");
  };

  const closeDetail = () => setSelectedAgent(null);

  const handleSave = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    await updateAgent(selectedAgent.id, {
      name: editName,
      title: editTitle,
      reportsTo: editManager,
      adapterConfig: {
        ...selectedAgent.adapterConfig,
        model: editModel,
        heartbeatIntervalSec: parseInt(editSchedule),
        promptTemplate: editPrompt,
      },
    });
    setSaving(false);
    closeDetail();
    load();
  };

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

  const handleHeartbeat = async (agent: Agent) => {
    setActing(true);
    try { await invokeHeartbeat(agent.id); } finally { setActing(false); load(); }
  };

  const handleTogglePause = async (agent: Agent) => {
    setActing(true);
    try {
      if (agent.status === "paused") await resumeAgent(agent.id);
      else await pauseAgent(agent.id);
    } finally { setActing(false); load(); }
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

  const managerOptions = [
    { id: "__none__", value: "No manager" },
    ...agents.filter((a) => a.id !== selectedAgent?.id).map((a) => ({ id: a.id, value: a.name })),
  ];

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
        <a href="#" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openDetail(row); }} style={{ color: "#3899ec", textDecoration: "none", fontSize: 14 }}>
          View
        </a>
      ),
      width: "10%",
    },
  ];

  return (
    <>
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

      {/* Detail / Edit modal */}
      <Modal isOpen={!!selectedAgent} onRequestClose={closeDetail} shouldCloseOnOverlayClick>
        {selectedAgent && (
          <CustomModalLayout
            width="90vw"
            maxHeight="90vh"
            title={
              <Box direction="horizontal" gap="12px" verticalAlign="middle">
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: selectedAgent.role === "ceo" ? "#3899ec" : selectedAgent.role === "pm" ? "#7b61ff" : "#44b5b0", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}>
                  {selectedAgent.name.charAt(0)}
                </div>
                <Box direction="vertical">
                  <Text weight="bold" size="medium">{selectedAgent.name}</Text>
                  <Box direction="horizontal" gap="6px" verticalAlign="middle">
                    <Badge size="tiny" skin={STATUS_SKINS[selectedAgent.status] || "general"}>
                      {STATUS_LABELS[selectedAgent.status] || selectedAgent.status}
                    </Badge>
                    <Text size="tiny" secondary>Last active: {getLastActive(selectedAgent)}</Text>
                  </Box>
                </Box>
              </Box>
            }
            onCloseButtonClick={closeDetail}
            primaryButtonText="Save changes"
            primaryButtonOnClick={handleSave}
            primaryButtonProps={{ disabled: saving }}
            secondaryButtonText="Cancel"
            secondaryButtonOnClick={closeDetail}
          >
            <div style={{ maxHeight: "calc(90vh - 250px)", overflowY: "auto" }}>
              {/* Quick actions */}
              <Box direction="horizontal" gap="8px" marginBottom="18px">
                <Button size="tiny" priority="secondary" onClick={() => handleHeartbeat(selectedAgent)} disabled={acting}>
                  Wake up
                </Button>
                <Button size="tiny" priority="secondary" onClick={() => handleTogglePause(selectedAgent)} disabled={acting}>
                  {selectedAgent.status === "paused" ? "Bring back" : "Put on leave"}
                </Button>
              </Box>

              {/* Editable fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
                <FormField label="Name">
                  <Input size="small" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </FormField>
                <FormField label="Title">
                  <Input size="small" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </FormField>
                <FormField label="Manager">
                  <Dropdown
                    size="small"
                    selectedId={editManager || "__none__"}
                    onSelect={(o) => setEditManager(String(o.id) === "__none__" ? null : String(o.id))}
                    options={managerOptions}
                  />
                </FormField>
                <FormField label="Seniority level">
                  <Dropdown
                    size="small"
                    selectedId={editModel}
                    onSelect={(o) => setEditModel(String(o.id))}
                    options={MODEL_OPTIONS}
                  />
                </FormField>
                <FormField label="Check-in schedule">
                  <Dropdown
                    size="small"
                    selectedId={editSchedule}
                    onSelect={(o) => setEditSchedule(String(o.id))}
                    options={SCHEDULE_OPTIONS}
                  />
                </FormField>
                <FormField label="Joined">
                  <Text size="small">{new Date(selectedAgent.createdAt).toLocaleDateString()}</Text>
                </FormField>
              </div>

              <Divider />

              {/* Role description */}
              <Box direction="vertical" marginTop="18px">
                <FormField label="Role description" infoContent="Defines how this team member thinks and works. This is their core instruction set.">
                  <InputArea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    rows={8}
                    placeholder="Describe this team member's responsibilities, how they work, and their personality..."
                    resizable
                  />
                </FormField>
              </Box>
            </div>
          </CustomModalLayout>
        )}
      </Modal>
    </>
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

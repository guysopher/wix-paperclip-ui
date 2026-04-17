"use client";

import { useEffect, useState, Suspense, use } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Page,
  Card,
  Box,
  Text,
  Badge,
  Button,
  Loader,
  FormField,
  Dropdown,
  Input,
  InputArea,
  Tooltip,
  Modal,
  CustomModalLayout,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../../providers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import { AgentAvatar } from "@/components/agent-avatar";
import { IconPicker } from "@/components/icon-picker";
import { getHeartbeatPolicy } from "@/lib/agent-heartbeat";
import { getRuntimeModel, getRuntimeModelLabel } from "@/lib/agent-model";
import { renderPromptTemplate } from "@/lib/prompt-render";
import {
  getAgent,
  getAgents,
  getAdapterModels,
  getCompany,
  getRuns,
  invokeHeartbeat,
  pauseAgent,
  resumeAgent,
  updateAgent,
  deleteAgent,
  type Agent,
  type AdapterModel,
  type Company,
  type HeartbeatRun,
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

const TIMEOUT_OPTIONS = [
  { id: "60", value: "1 min" },
  { id: "120", value: "2 min" },
  { id: "300", value: "5 min" },
  { id: "600", value: "10 min" },
  { id: "900", value: "15 min" },
  { id: "1800", value: "30 min" },
  { id: "3600", value: "1 hour" },
];

const SCHEDULE_OPTIONS = [
  { id: "300", value: "Every 5 min" },
  { id: "600", value: "Every 10 min" },
  { id: "900", value: "Every 15 min" },
  { id: "1200", value: "Every 20 min" },
  { id: "1800", value: "Every 30 min" },
  { id: "3600", value: "Every hour" },
  { id: "7200", value: "Every 2 hours" },
  { id: "14400", value: "Every 4 hours" },
  { id: "28800", value: "Every 8 hours" },
  { id: "43200", value: "Every 12 hours" },
  { id: "86400", value: "Every 24 hours" },
];

const MODEL_CONFIG_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "cursor",
  "gemini_local",
  "hermes_local",
  "pi_local",
]);

const CURATED_CODEX_MODEL_OPTIONS: AdapterModel[] = [
  { id: "gpt-5.4", label: "Expert · GPT-5.4" },
  { id: "gpt-4.1", label: "Senior · GPT-4.1" },
  { id: "gpt-4o-mini", label: "Junior · GPT-4o Mini" },
];

function AgentDetailContent({ agentId }: { agentId: string }) {
  const { companyId, companyPath } = useCompany();
  const router = useRouter();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [modelOptions, setModelOptions] = useState<AdapterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showRolePreview, setShowRolePreview] = useState(true);

  // Editable fields
  const [editTitle, setEditTitle] = useState("");
  const [editIcon, setEditIcon] = useState<string | undefined>(undefined);
  const [editSchedule, setEditSchedule] = useState("");
  const [editTimeout, setEditTimeout] = useState("");
  const [editManager, setEditManager] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editModel, setEditModel] = useState("");

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    const [agentData, allAgents, companyData, runData] = await Promise.all([
      getAgent(agentId),
      getAgents(companyId),
      getCompany(companyId),
      getRuns(companyId).catch(() => []),
    ]);
    setAgent(agentData);
    setAgents(allAgents);
    setCompany(companyData);
    setRuns(runData);
    await populateForm(agentData);
    setLoadingModels(true);
    const adapterModels = await getAdapterModels(companyId, agentData.adapterType).catch(
      () => [] as AdapterModel[],
    );
    setModelOptions(adapterModels);
    setLoadingModels(false);
    setLoading(false);
  };

  const resolveAgentPrompt = async (a: Agent) => {
    const promptTemplate = typeof a.adapterConfig?.promptTemplate === "string"
      ? a.adapterConfig.promptTemplate
      : "";
    if (promptTemplate.trim().length > 0) {
      return promptTemplate;
    }

    const instructionsFilePath = typeof a.adapterConfig?.instructionsFilePath === "string"
      ? a.adapterConfig.instructionsFilePath
      : "";
    if (!instructionsFilePath) {
      return "";
    }

    try {
      const res = await fetch(`/api/agent-instructions?path=${encodeURIComponent(instructionsFilePath)}`);
      const data = (await res.json().catch(() => ({ content: "" }))) as { content?: string };
      return typeof data.content === "string" ? data.content : "";
    } catch {
      return "";
    }
  };

  const populateForm = async (a: Agent) => {
    setEditTitle((a.title || a.name || "").trim());
    setEditIcon(a.icon);
    setEditSchedule(String(getHeartbeatPolicy(a).intervalSec || 600));
    setEditTimeout(String((a.adapterConfig?.timeoutSec as number) || 600));
    setEditManager(a.reportsTo);
    setEditPrompt(await resolveAgentPrompt(a));
    setEditModel(String(a.adapterConfig?.model || ""));
  };

  useEffect(() => {
    load();
  }, [companyId, agentId]);

  const getLastActive = (a: Agent) => {
    const last = a.lastHeartbeatAt;
    if (!last) return "Never";
    const diffMin = Math.round((Date.now() - new Date(last).getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
    return new Date(last).toLocaleDateString();
  };

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    const normalizedTitle = editTitle.trim() || agent.title || agent.name;
    await updateAgent(agent.id, {
      name: normalizedTitle,
      title: normalizedTitle,
      icon: editIcon,
      reportsTo: editManager,
      adapterConfig: {
        ...agent.adapterConfig,
        heartbeatIntervalSec: parseInt(editSchedule),
        timeoutSec: parseInt(editTimeout),
        promptTemplate: renderPromptTemplate(editPrompt, company),
        model: editModel.trim() || null,
      },
    });
    setSaving(false);
    load();
  };

  const handleHeartbeat = async () => {
    if (!agent) return;
    setActing(true);
    try {
      await invokeHeartbeat(agent.id);
    } finally {
      setActing(false);
      router.push(companyPath("/runs"));
    }
  };

  const handleTogglePause = async () => {
    if (!agent) return;
    setActing(true);
    try {
      if (agent.status === "paused") {
        await resumeAgent(agent.id);
      } else {
        await pauseAgent(agent.id);
      }
    } finally {
      setActing(false);
      load();
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    setActing(true);
    setDeleteError("");
    try {
      await deleteAgent(agent.id);
      router.push(companyPath("/team"));
      return true;
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to remove team member.");
      return false;
    } finally {
      setActing(false);
    }
  };

  const managerOptions = [
    { id: "__none__", value: "No manager" },
    ...agents
      .filter((a) => a.id !== agentId)
      .map((a) => ({ id: a.id, value: (a.title || a.name || "").trim() || "Untitled agent" })),
  ];

  if (loading) {
    return (
      <Box align="center" verticalAlign="middle" height="400px">
        <Loader size="medium" />
      </Box>
    );
  }

  if (!agent) {
    return (
      <Page>
        <Page.Header
          title={
            <Breadcrumbs
              items={[
                { label: "Team", href: "/team" },
                { label: "Not found" },
              ]}
            />
          }
        />
        <Page.Content>
          <Box align="center" verticalAlign="middle" height="400px">
            <Text secondary>Agent not found.</Text>
          </Box>
        </Page.Content>
      </Page>
    );
  }

  const avatarColor =
    agent.role === "ceo" ? "#3899ec" : agent.role === "pm" ? "#7b61ff" : "#44b5b0";
  const runtimeModel = getRuntimeModelLabel(getRuntimeModel(agent, runs));
  const configuredModel = editModel.trim();
  const savedConfiguredModel = String(agent.adapterConfig?.model || "").trim();
  const runtimeModelRaw = getRuntimeModel(agent, runs);
  const modelDropdownOptions = (() => {
    const known = new Map<string, { id: string; value: string }>();
    const sourceOptions =
      agent.adapterType === "codex_local" ? CURATED_CODEX_MODEL_OPTIONS : modelOptions;

    for (const option of sourceOptions) {
      const id = String(option.id).trim();
      if (!id) continue;
      known.set(id, { id, value: option.label || id });
    }
    if (configuredModel && !known.has(configuredModel)) {
      known.set(configuredModel, { id: configuredModel, value: configuredModel });
    }
    return Array.from(known.values());
  })();
  const supportsModelSelection = MODEL_CONFIG_ADAPTERS.has(agent.adapterType);
  const showModelDropdown = supportsModelSelection && modelDropdownOptions.length > 0;
  const showModelInput = supportsModelSelection && !showModelDropdown;
  const hasPendingModelChange =
    configuredModel.length > 0 && runtimeModelRaw !== null && configuredModel !== runtimeModelRaw;
  const hasUnsavedModelChange = configuredModel !== savedConfiguredModel;
  const managerSummary = editManager
    ? agents.find((candidate) => candidate.id === editManager)?.title
      || agents.find((candidate) => candidate.id === editManager)?.name
      || "Unknown"
    : "No manager";
  const scheduleSummary =
    SCHEDULE_OPTIONS.find((option) => option.id === editSchedule)?.value.replace(/^Every\s+/, "")
    || (editSchedule ? `${Math.round(parseInt(editSchedule, 10) / 60)} min` : "Manual");
  const modelSummary = configuredModel || runtimeModel;
  const displayTitle = editTitle.trim() || agent.title || agent.name;
  const renderedPromptPreview = renderPromptTemplate(editPrompt, company);

  return (
    <>
      <Page>
        <Page.Header
          title={
            <Breadcrumbs
              items={[
                { label: "Team", href: "/team" },
                { label: displayTitle },
              ]}
            />
          }
          actionsBar={
            <Box direction="horizontal" gap="8px">
              <Tooltip
                content={
                  company?.disableOnDemandWakeup
                    ? "Immediate wake-ups are disabled for this company. Agents will only wake on their scheduled heartbeat."
                    : "Immediately trigger a check-in. The agent will review their tasks, process new messages, and take action."
                }
                placement="bottom"
              >
                <Button
                  size="small"
                  priority="secondary"
                  prefixIcon={<Refresh />}
                  onClick={handleHeartbeat}
                  disabled={acting || !!company?.disableOnDemandWakeup}
                >
                  Wake up
                </Button>
              </Tooltip>
              {agent.status === "paused" && (
                <Tooltip
                  content="Resume this agent so they can respond to scheduled check-ins, mentions, and task assignments again."
                  placement="bottom"
                >
                  <Button
                    size="small"
                    priority="secondary"
                    onClick={handleTogglePause}
                    disabled={acting}
                  >
                    Bring back
                  </Button>
                </Tooltip>
              )}
            </Box>
          }
        />
        <Page.Content>
          {/* Header card with avatar, status, and operating summary */}
          <Card>
            <Card.Content>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 20,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Box direction="horizontal" gap="16px" verticalAlign="middle" style={{ flex: "1 1 280px" }}>
                  <AgentAvatar
                    agentName={displayTitle}
                    agentRole={agent.role}
                    icon={agent.icon}
                    size={56}
                    fontSize={22}
                  />
                  <Box direction="vertical" gap="4px">
                    <Text weight="bold" size="medium">
                      {displayTitle}
                    </Text>
                    <Box direction="horizontal" gap="8px" verticalAlign="middle">
                      <Badge
                        size="tiny"
                        skin={STATUS_SKINS[agent.status] || "general"}
                      >
                        {STATUS_LABELS[agent.status] || agent.status}
                      </Badge>
                      <Text size="tiny" secondary>
                        Last active: {getLastActive(agent)}
                      </Text>
                    </Box>
                  </Box>
                </Box>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: 12,
                    flex: "1 1 460px",
                    width: "min(100%, 520px)",
                  }}
                >
                  {[
                    { label: "Manager", value: managerSummary },
                    { label: "Schedule", value: scheduleSummary },
                    { label: "Model", value: modelSummary },
                  ].map((item) => (
                    <Box
                      key={item.label}
                      padding="12px 14px"
                      border="1px solid #e7edf3"
                      borderRadius="12px"
                      backgroundColor="#fafcfe"
                    >
                      <Text size="tiny" secondary>
                        {item.label}
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        <Text size="small" weight="bold">
                          {item.value}
                        </Text>
                      </div>
                    </Box>
                  ))}
                </div>
              </div>
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          <Card>
            <Card.Header
              title="Role description"
              subtitle="This is the core instruction set that defines how this agent thinks, works, and contributes."
            />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="18px">
                <Box direction="vertical" gap="8px">
                  <Box direction="horizontal" align="space-between" verticalAlign="middle">
                    <Text size="small" weight="bold">
                      Rendered preview
                    </Text>
                    <button
                      type="button"
                      onClick={() => setShowRolePreview((current) => !current)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#2f6fed",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      {showRolePreview ? "Hide preview" : "Show preview"}
                    </button>
                  </Box>
                  {showRolePreview && (
                    <div
                      style={{
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: "#162d3d",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {editPrompt.trim() ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {renderedPromptPreview}
                        </ReactMarkdown>
                      ) : (
                        <Text size="small" secondary>
                          No role description yet.
                        </Text>
                      )}
                    </div>
                  )}
                </Box>
                <FormField
                  label="Markdown source"
                  infoContent="Edit the raw role description prompt. The preview above updates as you type."
                >
                  <InputArea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    rows={10}
                    placeholder="Describe this team member's responsibilities, how they work, and their personality..."
                    resizable
                  />
                </FormField>
              </Box>
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          {/* Editable details card */}
          <Card>
            <Card.Header title="Details" subtitle="Edit the working setup for this agent." />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="18px">
                <Box direction="vertical" gap="12px">
                  <Text size="small" weight="bold" secondary>
                    Identity
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.5fr) 260px",
                      gap: "18px 24px",
                      alignItems: "start",
                    }}
                  >
                    <FormField
                      label="Title"
                      infoContent="The single visible identity for this team member across the dashboard."
                    >
                      <Input
                        size="small"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    </FormField>
                    <div>
                      <FormField
                        label="Icon"
                        infoContent="Choose an icon to represent this team member. Icons appear in the activity feed, team list, and other places."
                      >
                        <IconPicker
                          selectedIcon={editIcon}
                          onSelect={setEditIcon}
                          avatarColor={avatarColor}
                          agentName={displayTitle}
                          agentRole={agent.role}
                        />
                      </FormField>
                    </div>
                  </div>
                </Box>

                <div style={{ borderTop: "1px solid #eef1f5" }} />

                <Box direction="vertical" gap="12px">
                  <Text size="small" weight="bold" secondary>
                    Ownership
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "14px 18px",
                    }}
                  >
                    <FormField
                      label="Manager"
                      infoContent="Who this team member reports to. Their manager can delegate tasks and review their work."
                    >
                      <Dropdown
                        size="small"
                        selectedId={editManager || "__none__"}
                        onSelect={(o) =>
                          setEditManager(
                            String(o.id) === "__none__" ? null : String(o.id)
                          )
                        }
                        options={managerOptions}
                      />
                    </FormField>
                    <FormField
                      label="Check-in schedule"
                      infoContent="How often this agent automatically wakes up to check for new tasks, messages, and updates. You can also wake them up manually at any time."
                    >
                      <Dropdown
                        size="small"
                        selectedId={editSchedule}
                        onSelect={(o) => setEditSchedule(String(o.id))}
                        options={SCHEDULE_OPTIONS}
                      />
                    </FormField>
                  </div>
                </Box>

                <div style={{ borderTop: "1px solid #eef1f5" }} />

                <Box direction="vertical" gap="12px">
                  <Text size="small" weight="bold" secondary>
                    Runtime
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "14px 18px",
                    }}
                  >
                    <FormField
                      label="Model"
                      infoContent="This is the one editable model setting for the agent. Paperclip saves it into adapterConfig.model and uses it on future runs."
                    >
                      <Box direction="vertical" gap="8px">
                        {loadingModels ? (
                          <Loader size="tiny" />
                        ) : showModelDropdown ? (
                          <Dropdown
                            size="small"
                            selectedId={configuredModel || modelDropdownOptions[0]?.id || ""}
                            onSelect={(option) => setEditModel(String(option.id))}
                            options={modelDropdownOptions}
                          />
                        ) : showModelInput ? (
                          <Input
                            size="small"
                            value={editModel}
                            onChange={(e) => setEditModel(e.target.value)}
                            placeholder={
                              agent.adapterType === "opencode_local"
                                ? "openai/gpt-5.4"
                                : agent.adapterType === "claude_local"
                                  ? "claude-sonnet-4-6"
                                  : "gpt-5.4"
                            }
                          />
                        ) : (
                          <Text size="small" secondary>
                            This adapter does not expose model selection in this UI.
                          </Text>
                        )}
                        <Box direction="horizontal" gap="8px">
                          {hasUnsavedModelChange && (
                            <Badge size="tiny" skin="general">
                              Unsaved change
                            </Badge>
                          )}
                          {hasPendingModelChange && (
                            <Badge size="tiny" skin="warning">
                              Real runs still show {runtimeModel}
                            </Badge>
                          )}
                        </Box>
                      </Box>
                    </FormField>
                    <FormField
                      label="Run timeout"
                      infoContent="Maximum time a single work session can run before it is forcefully stopped. Prevents runaway or stuck agents."
                    >
                      <Dropdown
                        size="small"
                        selectedId={editTimeout}
                        onSelect={(o) => setEditTimeout(String(o.id))}
                        options={TIMEOUT_OPTIONS}
                      />
                    </FormField>
                  </div>
                </Box>
              </Box>
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          <Card>
            <Card.Header title="System info" subtitle="Read-only runtime and metadata." />
            <Card.Divider />
            <Card.Content>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "18px 22px",
                }}
              >
                {[
                  {
                    label: "Joined",
                    value: new Date(agent.createdAt).toLocaleDateString(),
                    note: "Team member since creation",
                  },
                  {
                    label: "Adapter",
                    value: agent.adapterType,
                    note: "Current runtime adapter",
                    mono: true,
                  },
                  {
                    label: "Observed model",
                    value: runtimeModel,
                    note: runtimeModelRaw === null ? "No completed run has reported one yet" : "Reported from real runs",
                  },
                  {
                    label: "Config note",
                    value: "Applies after next run",
                    note: "Save changes, then wake the agent or wait for the next check-in",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: "16px 18px",
                      border: "1px solid #e7edf3",
                      borderRadius: 12,
                      backgroundColor: "#fafbfc",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      minHeight: 112,
                      justifyContent: "flex-start",
                    }}
                  >
                    <Text size="tiny" secondary>
                      {item.label}
                    </Text>
                    <Text
                      size="small"
                      weight="bold"
                      style={item.mono ? { fontFamily: "monospace" } : undefined}
                    >
                      {item.value}
                    </Text>
                    <Text size="tiny" secondary>
                      {item.note}
                    </Text>
                  </div>
                ))}
              </div>
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          {/* Save button */}
          <Box direction="horizontal" gap="12px">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </Box>

          <Box marginTop="24px" />

          {/* Danger zone */}
          <Card>
            <Card.Header title="Danger zone" />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="16px">
                {agent.status !== "paused" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: 18,
                      border: "1px solid #f3e3a1",
                      borderRadius: 14,
                      background: "#fff8e1",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 720 }}>
                      <Text weight="bold" style={{ color: "#7a5c00" }}>
                        Put on leave
                      </Text>
                      <Text size="small" secondary>
                        Pause this agent temporarily. They will stop scheduled check-ins, mentions, and new task work until you bring them back.
                      </Text>
                    </div>
                    <Tooltip
                      content="Pause this agent. They won't respond to scheduled check-ins, mentions, or task assignments until brought back."
                      placement="right"
                    >
                      <button
                        onClick={() => setShowPauseConfirm(true)}
                        disabled={acting}
                        style={{
                          appearance: "none",
                          border: "1px solid #d6a800",
                          background: acting ? "#f6dc84" : "#ffcc00",
                          color: "#1f2b3d",
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: acting ? "not-allowed" : "pointer",
                          padding: "10px 16px",
                          borderRadius: 999,
                          minWidth: 140,
                          opacity: acting ? 0.7 : 1,
                        }}
                      >
                        Put on leave
                      </button>
                    </Tooltip>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: 18,
                    border: "1px solid #f2c6c3",
                    borderRadius: 14,
                    background: "#fff5f5",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 720 }}>
                    <Text weight="bold" style={{ color: "#aa2e25" }}>
                      Fire permanently
                    </Text>
                    <Text size="small" secondary>
                      Remove this agent from the company for good. Their task history stays, but the agent will no longer participate in the team.
                    </Text>
                  </div>
                  <Tooltip
                    content="Remove this agent permanently from the company."
                    placement="right"
                  >
                    <button
                      onClick={() => {
                        setDeleteError("");
                        setShowDeleteConfirm(true);
                      }}
                      disabled={acting}
                      style={{
                        appearance: "none",
                        border: "1px solid #d6453d",
                        background: acting ? "#f0a9a4" : "#ee5951",
                        color: "#ffffff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: acting ? "not-allowed" : "pointer",
                        padding: "10px 16px",
                        borderRadius: 999,
                        minWidth: 160,
                        opacity: acting ? 0.7 : 1,
                      }}
                  >
                    Fire permanently
                  </button>
                </Tooltip>
                </div>
              </Box>
            </Card.Content>
          </Card>

          <Box marginBottom="24px" />
        </Page.Content>
      </Page>

      {/* Pause confirmation modal */}
      <Modal
        isOpen={showPauseConfirm}
        onRequestClose={() => setShowPauseConfirm(false)}
        shouldCloseOnOverlayClick
      >
        <CustomModalLayout
          title="Put team member on leave?"
          subtitle={`${displayTitle} will stop all scheduled work until brought back.`}
          primaryButtonText="Yes, put on leave"
          primaryButtonOnClick={async () => {
            await handleTogglePause();
            setShowPauseConfirm(false);
          }}
          primaryButtonProps={{ skin: "destructive" } as Record<string, unknown>}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowPauseConfirm(false)}
          onCloseButtonClick={() => setShowPauseConfirm(false)}
        >
          <Text size="small">
            This will immediately pause {displayTitle}. They will not wake up for
            scheduled check-ins or respond to mentions until you bring them back.
          </Text>
        </CustomModalLayout>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onRequestClose={() => setShowDeleteConfirm(false)}
        shouldCloseOnOverlayClick
      >
        <CustomModalLayout
          title="Fire team member?"
          subtitle={`${displayTitle} will be removed from this AI Team permanently.`}
          primaryButtonText={acting ? "Removing..." : "Fire permanently"}
          primaryButtonOnClick={async () => {
            const deleted = await handleDelete();
            if (deleted) {
              setShowDeleteConfirm(false);
            }
          }}
          primaryButtonProps={{ skin: "destructive", disabled: acting } as Record<string, unknown>}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowDeleteConfirm(false)}
          onCloseButtonClick={() => setShowDeleteConfirm(false)}
        >
          <Box direction="vertical" gap="12px">
            <Text size="small">
              This permanently removes {displayTitle} from the company. Their profile page will no longer be available after this action.
            </Text>
            {deleteError && (
              <Box
                padding="10px 12px"
                border="1px solid #f2c9c9"
                borderRadius="8px"
                backgroundColor="#fff6f6"
              >
                <Text size="small" skin="error">
                  {deleteError}
                </Text>
              </Box>
            )}
          </Box>
        </CustomModalLayout>
      </Modal>
    </>
  );
}

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);

  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>
      }
    >
      <AgentDetailContent agentId={agentId} />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, Suspense, use } from "react";
import { useRouter } from "next/navigation";
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
  Divider,
  Tooltip,
  Modal,
  CustomModalLayout,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../../providers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import { AgentAvatar } from "../../../components/agent-avatar";
import { IconPicker } from "../../../components/icon-picker";
import {
  getAgent,
  getAgents,
  getCompany,
  invokeHeartbeat,
  pauseAgent,
  resumeAgent,
  updateAgent,
  type Agent,
  type Company,
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
  { id: "claude-opus-4-6", value: "Expert (Opus)" },
  { id: "claude-sonnet-4-6", value: "Senior (Sonnet)" },
  { id: "claude-haiku-4-5-20251001", value: "Junior (Haiku)" },
];

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Expert",
  "claude-sonnet-4-6": "Senior",
  "claude-haiku-4-5-20251001": "Junior",
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

function AgentDetailContent({ agentId }: { agentId: string }) {
  const { companyId } = useCompany();
  const router = useRouter();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editIcon, setEditIcon] = useState<string | undefined>(undefined);
  const [editModel, setEditModel] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editTimeout, setEditTimeout] = useState("");
  const [editManager, setEditManager] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    const [agentData, allAgents, companyData] = await Promise.all([
      getAgent(agentId),
      getAgents(companyId),
      getCompany(companyId),
    ]);
    setAgent(agentData);
    setAgents(allAgents);
    setCompany(companyData);
    populateForm(agentData);
    setLoading(false);
  };

  const populateForm = (a: Agent) => {
    setEditName(a.name);
    setEditTitle(a.title);
    setEditIcon(a.icon);
    setEditModel((a.adapterConfig?.model as string) || "claude-sonnet-4-6");
    setEditSchedule(String((a.adapterConfig?.heartbeatIntervalSec as number) || 600));
    setEditTimeout(String((a.adapterConfig?.timeoutSec as number) || 600));
    setEditManager(a.reportsTo);
    setEditPrompt((a.adapterConfig?.promptTemplate as string) || "");
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
    await updateAgent(agent.id, {
      name: editName,
      title: editTitle,
      icon: editIcon,
      reportsTo: editManager,
      adapterConfig: {
        ...agent.adapterConfig,
        model: editModel,
        heartbeatIntervalSec: parseInt(editSchedule),
        timeoutSec: parseInt(editTimeout),
        promptTemplate: editPrompt,
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
      router.push("/runs");
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

  const managerOptions = [
    { id: "__none__", value: "No manager" },
    ...agents.filter((a) => a.id !== agentId).map((a) => ({ id: a.id, value: a.name })),
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

  return (
    <>
      <Page>
        <Page.Header
          title={
            <Breadcrumbs
              items={[
                { label: "Team", href: "/team" },
                { label: agent.name },
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
          {/* Header card with avatar, name, title, status, last active */}
          <Card>
            <Card.Content>
              <Box direction="horizontal" gap="16px" verticalAlign="middle">
                <AgentAvatar
                  agentName={agent.name}
                  agentRole={agent.role}
                  icon={agent.icon}
                  size={56}
                  fontSize={22}
                />
                <Box direction="vertical" gap="4px">
                  <Text weight="bold" size="medium">
                    {agent.name}
                  </Text>
                  <Text size="small" secondary>
                    {agent.title}
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
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          {/* Editable details card */}
          <Card>
            <Card.Header title="Details" />
            <Card.Divider />
            <Card.Content>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px 18px",
                }}
              >
                <FormField label="Name" infoContent="The display name for this team member.">
                  <Input
                    size="small"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </FormField>
                <FormField label="Title" infoContent="The job title or role label shown in the team list.">
                  <Input
                    size="small"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </FormField>
              </div>

              <Box marginTop="18px" />

              <FormField label="Icon" infoContent="Choose an icon to represent this team member. Icons appear in the activity feed, team list, and other places.">
                <IconPicker
                  selectedIcon={editIcon}
                  onSelect={setEditIcon}
                  avatarColor={avatarColor}
                />
              </FormField>

              <Box marginTop="18px" />

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
                  label="Seniority level"
                  infoContent="Senior agents (Opus) are more capable and thorough but cost more. Standard agents (Sonnet) are faster and more cost-effective for routine work."
                >
                  <Dropdown
                    size="small"
                    selectedId={editModel}
                    onSelect={(o) => setEditModel(String(o.id))}
                    options={MODEL_OPTIONS}
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
                <FormField label="Joined" infoContent="The date this team member was created.">
                  <Text size="small">
                    {new Date(agent.createdAt).toLocaleDateString()}
                  </Text>
                </FormField>
              </div>
            </Card.Content>
          </Card>

          <Box marginTop="24px" />

          {/* Role description card */}
          <Card>
            <Card.Header title="Role description" />
            <Card.Divider />
            <Card.Content>
              <FormField
                label="Role description"
                infoContent="Defines how this team member thinks and works. This is their core instruction set."
              >
                <InputArea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={8}
                  placeholder="Describe this team member's responsibilities, how they work, and their personality..."
                  resizable
                />
              </FormField>
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
          {agent.status !== "paused" && (
            <Card>
              <Card.Header title="Danger zone" />
              <Card.Divider />
              <Card.Content>
                <Tooltip
                  content="Pause this agent. They won't respond to scheduled check-ins, mentions, or task assignments until brought back."
                  placement="right"
                >
                  <button
                    onClick={() => setShowPauseConfirm(true)}
                    disabled={acting}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#ee5951",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Put on leave
                  </button>
                </Tooltip>
              </Card.Content>
            </Card>
          )}

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
          subtitle={`${agent.name} will stop all scheduled work until brought back.`}
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
            This will immediately pause {agent.name}. They will not wake up for
            scheduled check-ins or respond to mentions until you bring them back.
          </Text>
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

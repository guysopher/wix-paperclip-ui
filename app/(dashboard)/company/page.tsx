"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Page,
  Card,
  Box,
  Text,
  Button,
  Loader,
  FormField,
  Input,
  InputArea,
  Divider,
  Dropdown,
  Modal,
  CustomModalLayout,
  Tooltip,
} from "@wix/design-system";
import { Refresh, Add, Delete } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import {
  getCompany,
  getGoals,
  updateCompany,
  archiveCompany,
  createGoal,
  deleteGoal,
  type Company,
  type Goal,
} from "@/lib/api";

function CompanyContent() {
  const { companyId, companies, setCompanyId, refreshCompanies } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable company fields
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrefix, setEditPrefix] = useState("");

  // Throttling controls
  const [editMaxTokensPerHour, setEditMaxTokensPerHour] = useState<string>("0");
  const [editDisableOnDemandWakeup, setEditDisableOnDemandWakeup] = useState<boolean>(false);

  // New goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");

  // Delete company
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const c = await getCompany(companyId);
    setCompany(c);
    setEditName(c.name);
    setEditDescription(c.description);
    setEditPrefix(c.issuePrefix);
    setEditMaxTokensPerHour(String(c.maxTokensPerHour ?? 0));
    setEditDisableOnDemandWakeup(c.disableOnDemandWakeup ?? false);
    const goalList = await getGoals(c.id).catch(() => []);
    setGoals(goalList);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleSaveCompany = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const updated = await updateCompany(company.id, {
        name: editName,
        description: editDescription,
        issuePrefix: editPrefix,
        maxTokensPerHour: parseInt(editMaxTokensPerHour) || 0,
        disableOnDemandWakeup: editDisableOnDemandWakeup,
      });
      setCompany(updated);
    } catch { /* silent */ }
    setSaving(false);
  };

  const handleCreateGoal = async () => {
    if (!company || !newGoalTitle.trim()) return;
    await createGoal(company.id, {
      title: newGoalTitle,
      description: newGoalDesc,
      level: "company",
      status: "active",
    });
    setShowGoalModal(false);
    setNewGoalTitle("");
    setNewGoalDesc("");
    load();
  };

  const handleDeleteGoal = async (goalId: string) => {
    await deleteGoal(goalId);
    setGoals(goals.filter((g) => g.id !== goalId));
  };

  const handleDeleteCompany = async () => {
    if (!company) return;
    setDeleting(true);
    try {
      await archiveCompany(company.id);
      await refreshCompanies();
      // Switch to another company if available
      const remaining = companies.filter((c) => c.id !== company.id);
      if (remaining.length > 0) {
        setCompanyId(remaining[0].id);
      } else {
        setCompanyId("");
      }
      setShowDeleteModal(false);
    } catch {
      setDeleting(false);
    }
  };

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  if (!company) {
    return <Text>No company found.</Text>;
  }

  const hasChanges =
    editName !== company.name ||
    editDescription !== company.description ||
    editPrefix !== company.issuePrefix ||
    parseInt(editMaxTokensPerHour) !== (company.maxTokensPerHour ?? 0) ||
    editDisableOnDemandWakeup !== (company.disableOnDemandWakeup ?? false);

  return (
    <>
      <Page>
        <Page.Header
          title="Company"
          subtitle={company.name}
          actionsBar={
            <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>Refresh</Button>
          }
        />
        <Page.Content>
          <div className="company-content" style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
            {/* Company details */}
            <Card>
              <Card.Header
                title="Details"
                suffix={
                  <Button size="tiny" disabled={!hasChanges || saving} onClick={handleSaveCompany}>
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                }
              />
              <Card.Content>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <FormField label="Company name" infoContent="The name of your AI company. Shown across the app and in agent communications.">
                    <Input size="small" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </FormField>
                  <FormField label="Description" infoContent="What your company does. Agents use this to understand the business context when working on tasks.">
                    <InputArea
                      size="small"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={4}
                      resizable
                    />
                  </FormField>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <FormField label="Task prefix" infoContent="Short prefix for task identifiers (e.g., AGE-1, AGE-2). Used to reference tasks across the system.">
                      <Input size="small" value={editPrefix} onChange={(e) => setEditPrefix(e.target.value)} />
                    </FormField>
                    <FormField label="Tasks created">
                      <Text size="small">{company.issueCounter}</Text>
                    </FormField>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <FormField label="Status">
                      <Text size="small" style={{ textTransform: "capitalize" }}>{company.status}</Text>
                    </FormField>
                    <FormField label="Created">
                      <Text size="small">{new Date(company.createdAt).toLocaleDateString()}</Text>
                    </FormField>
                  </div>
                </div>
              </Card.Content>
            </Card>

            {/* Activity controls */}
            <Card>
              <Card.Header
                title="Activity controls"
                subtitle="Throttle agent activity to manage costs and control when agents can be woken up."
                suffix={
                  <Button size="tiny" disabled={!hasChanges || saving} onClick={handleSaveCompany}>
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                }
              />
              <Card.Content>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <FormField
                      label="Max tokens per hour"
                      infoContent="Limit how many tokens all agents combined can consume per hour. Set to 0 for no limit. Helps prevent runaway costs."
                    >
                      <Input
                        size="small"
                        value={editMaxTokensPerHour}
                        onChange={(e) => setEditMaxTokensPerHour(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="0 = unlimited"
                        suffix={<Text size="tiny" secondary>tokens/hr</Text>}
                      />
                    </FormField>
                    <FormField
                      label="Immediate wake-ups"
                      infoContent="When disabled, agents can only be triggered by their scheduled heartbeat — not manually. Useful for reducing unplanned activity."
                    >
                      <Dropdown
                        size="small"
                        selectedId={editDisableOnDemandWakeup ? "disabled" : "enabled"}
                        onSelect={(o) => setEditDisableOnDemandWakeup(o.id === "disabled")}
                        options={[
                          { id: "enabled", value: "Allowed" },
                          { id: "disabled", value: "Blocked" },
                        ]}
                      />
                    </FormField>
                  </div>
                </div>
              </Card.Content>
            </Card>

            {/* Goals */}
            <Card>
              <Card.Header
                title="Goals"
                subtitle="What your company is working toward. Agents reference these when prioritizing work."
                suffix={
                  <Button size="tiny" prefixIcon={<Add />} onClick={() => setShowGoalModal(true)}>
                    Add Goal
                  </Button>
                }
              />
              <Card.Content>
                {goals.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <Text secondary>No goals set yet. Add a goal to give your agents direction.</Text>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {goals.map((goal, i) => (
                      <div
                        key={goal.id}
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                          padding: "14px 0",
                          borderBottom: i < goals.length - 1 ? "1px solid #f0f0f0" : "none",
                        }}
                      >
                        <div style={{ fontSize: 18, marginTop: 1 }}>
                          {goal.status === "completed" ? "✅" : goal.status === "archived" ? "📦" : "🎯"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{goal.title}</div>
                          {goal.description && (
                            <div style={{ fontSize: 13, color: "#666", marginTop: 3, lineHeight: 1.5 }}>{goal.description}</div>
                          )}
                          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                            {goal.level && (
                              <span style={{ fontSize: 11, color: "#999", textTransform: "capitalize", background: "#f5f5f5", padding: "1px 8px", borderRadius: 4 }}>
                                {goal.level}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: "#999", textTransform: "capitalize", background: "#f5f5f5", padding: "1px 8px", borderRadius: 4 }}>
                              {goal.status}
                            </span>
                          </div>
                        </div>
                        <Tooltip content="Remove this goal" placement="left">
                          <button
                            onClick={() => handleDeleteGoal(goal.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 4 }}
                          >
                            <Delete size="18px" />
                          </button>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Content>
            </Card>
            {/* Danger Zone */}
            <Card>
              <Card.Content>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#d32f2f" }}>Delete company</div>
                    <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Permanently remove this company and all its agents, tasks, and data.</div>
                  </div>
                  <Button size="small" skin="destructive" onClick={() => setShowDeleteModal(true)}>
                    Delete
                  </Button>
                </div>
              </Card.Content>
            </Card>
          </div>
        </Page.Content>
      </Page>

      {/* Add Goal modal */}
      <Modal isOpen={showGoalModal} onRequestClose={() => setShowGoalModal(false)} shouldCloseOnOverlayClick>
        <CustomModalLayout
          width="500px"
          title="Add Goal"
          primaryButtonText="Add"
          primaryButtonOnClick={handleCreateGoal}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowGoalModal(false)}
          onCloseButtonClick={() => setShowGoalModal(false)}
        >
          <Box direction="vertical" gap="12px">
            <FormField label="Goal" required infoContent="A clear objective for your company. Agents will use this to understand priorities and make decisions.">
              <Input value={newGoalTitle} onChange={(e) => setNewGoalTitle(e.target.value)} placeholder="e.g., Launch the marketplace by Q2" />
            </FormField>
            <FormField label="Description" infoContent="Additional context about the goal. Why it matters and what success looks like.">
              <InputArea
                value={newGoalDesc}
                onChange={(e) => setNewGoalDesc(e.target.value)}
                rows={3}
                placeholder="Describe the goal in more detail..."
                resizable
              />
            </FormField>
          </Box>
        </CustomModalLayout>
      </Modal>

      {/* Delete Company confirmation */}
      <Modal isOpen={showDeleteModal} onRequestClose={() => setShowDeleteModal(false)} shouldCloseOnOverlayClick>
        <CustomModalLayout
          width="440px"
          title="Delete company"
          primaryButtonText={deleting ? "Deleting..." : "Delete permanently"}
          primaryButtonOnClick={handleDeleteCompany}
          primaryButtonProps={{ skin: "destructive", disabled: deleting }}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={() => setShowDeleteModal(false)}
          onCloseButtonClick={() => setShowDeleteModal(false)}
          content={
            <Box direction="vertical" gap="12px">
              <div style={{
                padding: "14px 16px", background: "#fef2f2", borderRadius: 8,
                border: "1px solid #fecaca", fontSize: 13, color: "#991b1b", lineHeight: 1.6,
              }}>
                This will permanently delete <strong>{company?.name}</strong> and all its agents, tasks, goals, and conversation history. This action cannot be undone.
              </div>
            </Box>
          }
        />
      </Modal>
    </>
  );
}

export default function CompanyPage() {
  return <CompanyContent />;
}

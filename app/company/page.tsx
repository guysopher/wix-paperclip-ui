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
  Modal,
  CustomModalLayout,
  Tooltip,
} from "@wix/design-system";
import { Refresh, Add, Delete } from "@wix/wix-ui-icons-common";
import { Providers } from "../providers";
import { Shell } from "../shell";
import {
  getCompanies,
  getGoals,
  updateCompany,
  createGoal,
  deleteGoal,
  type Company,
  type Goal,
} from "@/lib/api";

function CompanyContent() {
  const [company, setCompany] = useState<Company | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable company fields
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrefix, setEditPrefix] = useState("");

  // New goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");

  const load = useCallback(async () => {
    const companies = await getCompanies();
    if (!companies.length) { setLoading(false); return; }
    const c = companies[0];
    setCompany(c);
    setEditName(c.name);
    setEditDescription(c.description);
    setEditPrefix(c.issuePrefix);
    const goalList = await getGoals(c.id).catch(() => []);
    setGoals(goalList);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveCompany = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const updated = await updateCompany(company.id, {
        name: editName,
        description: editDescription,
        issuePrefix: editPrefix,
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

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  if (!company) {
    return <Text>No company found.</Text>;
  }

  const hasChanges = editName !== company.name || editDescription !== company.description || editPrefix !== company.issuePrefix;

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
          <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
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
    </>
  );
}

export default function CompanyPage() {
  return (
    <Providers>
      <Shell>
        <CompanyContent />
      </Shell>
    </Providers>
  );
}

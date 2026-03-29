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
import { Providers, useCompany } from "../providers";
import { Shell } from "../shell";
import {
  getCompany,
  getGoals,
  updateCompany,
  createGoal,
  deleteGoal,
  type Company,
  type Goal,
} from "@/lib/api";

interface WixSiteConfig {
  siteId: string;
  siteName: string;
  siteUrl?: string;
  connectedAt: string;
}

function CompanyContent() {
  const { companyId } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Wix integration
  const [wixConfig, setWixConfig] = useState<WixSiteConfig | null>(null);
  const [wixSiteId, setWixSiteId] = useState("");
  const [wixSiteName, setWixSiteName] = useState("");
  const [wixSiteUrl, setWixSiteUrl] = useState("");
  const [wixConnecting, setWixConnecting] = useState(false);

  // Editable company fields
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrefix, setEditPrefix] = useState("");

  // New goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const c = await getCompany(companyId);
    setCompany(c);
    setEditName(c.name);
    setEditDescription(c.description);
    setEditPrefix(c.issuePrefix);
    const [goalList, wixCfg] = await Promise.all([
      getGoals(c.id).catch(() => []),
      fetch(`/api/wix-config?companyId=${c.id}`).then((r) => r.json()).catch(() => null),
    ]);
    setGoals(goalList);
    if (wixCfg) setWixConfig(wixCfg);
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

  const handleConnectWix = async () => {
    if (!company || !wixSiteId.trim()) return;
    setWixConnecting(true);
    try {
      const result = await fetch("/api/wix-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          siteId: wixSiteId.trim(),
          siteName: wixSiteName.trim() || "Wix Site",
          siteUrl: wixSiteUrl.trim() || undefined,
        }),
      }).then((r) => r.json());
      setWixConfig(result);
      setWixSiteId("");
      setWixSiteName("");
      setWixSiteUrl("");
    } catch { /* silent */ }
    setWixConnecting(false);
  };

  const handleDisconnectWix = async () => {
    if (!company) return;
    await fetch(`/api/wix-config?companyId=${company.id}`, { method: "DELETE" });
    setWixConfig(null);
  };

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
            {/* Wix Integration */}
            <Card>
              <Card.Header
                title="Wix Site"
                subtitle="Connect a Wix site so your agents can manage it — create products, blog posts, bookings, and more."
              />
              <Card.Content>
                {wixConfig ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#f0faf0", borderRadius: 8, border: "1px solid #c8e6c9" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: "#0C6EFC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{wixConfig.siteName}</div>
                        {wixConfig.siteUrl && (
                          <a href={wixConfig.siteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#3899ec", textDecoration: "none" }}>
                            {wixConfig.siteUrl}
                          </a>
                        )}
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                          Site ID: <code style={{ fontSize: 11 }}>{wixConfig.siteId}</code> · Connected {new Date(wixConfig.connectedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        <span style={{ fontSize: 12, color: "#2e7d32", fontWeight: 500 }}>Connected</span>
                        <button
                          onClick={handleDisconnectWix}
                          style={{ background: "none", border: "none", color: "#999", fontSize: 12, cursor: "pointer", padding: 0 }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "#f7f8fa", borderRadius: 6, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                      Your agents now have access to Wix tools during their work sessions. They can manage products, blog posts, bookings, contacts, CMS content, and more on this site.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ padding: "16px 0 12px", fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                      Connect a Wix site to enable your agents to manage it. You can find your Site ID in the Wix dashboard under Settings or from the URL when editing your site.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <FormField label="Site ID" required infoContent="The unique identifier for your Wix site. Found in your Wix dashboard under Settings > General.">
                        <Input size="small" value={wixSiteId} onChange={(e) => setWixSiteId(e.target.value)} placeholder="e.g., 7c833926-ed51-4b50-bf91-5448e2c8b2cd" />
                      </FormField>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FormField label="Site name" infoContent="A friendly name to identify this site in the backoffice.">
                          <Input size="small" value={wixSiteName} onChange={(e) => setWixSiteName(e.target.value)} placeholder="e.g., My Online Store" />
                        </FormField>
                        <FormField label="Site URL (optional)">
                          <Input size="small" value={wixSiteUrl} onChange={(e) => setWixSiteUrl(e.target.value)} placeholder="https://..." />
                        </FormField>
                      </div>
                      <div>
                        <Button size="small" onClick={handleConnectWix} disabled={!wixSiteId.trim() || wixConnecting}>
                          {wixConnecting ? "Connecting..." : "Connect Site"}
                        </Button>
                      </div>
                    </div>
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

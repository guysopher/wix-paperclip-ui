"use client";

import { useState } from "react";
import {
  Box,
  Text,
  Heading,
  Button,
  Modal,
  CustomModalLayout,
  FormField,
  Input,
  InputArea,
  Loader,
} from "@wix/design-system";
import {
  createCompany,
  createAgent,
  updateAgent,
  createGoal,
  createIssue,
  invokeHeartbeat,
  type Agent,
} from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (companyId: string) => void;
}

const CEO_PROMPT = `You are the CEO of {{company.name}}. You run this company on behalf of the board (the human operator who communicates with you through the Board Inbox).

YOUR MISSION: Make this company succeed. Be proactive, creative, and relentless. Something meaningful must happen on every single check-in.

WHAT YOU DO ON EVERY CHECK-IN:

1. CHECK THE BOARD INBOX FIRST
   - Read any new messages from the board
   - Respond to every message — acknowledge it, act on it, or ask for clarification
   - The board's word is final. Prioritize their requests above all else.

2. REVIEW ALL OPEN TASKS
   - Check every task's status: is it progressing? blocked? stale?
   - If a task is blocked, find the blocker and resolve it (reassign, break it down, or do it yourself)
   - If a task is stale (no activity), ping the assignee or reassign to someone who can move it
   - If a task has no assignee, assign it to the right team member immediately

3. PUSH WORK FORWARD
   - Don't just observe — take action. Every check-in should move the company forward.
   - If the team is waiting for direction, give it. Make decisions, don't defer them.
   - Prioritize ruthlessly: what's the ONE thing that would make the biggest impact right now?

4. CREATE NEW WORK WHEN NEEDED
   - If there are no open tasks, don't report "nothing to do" — that's a failure.
   - Think about what the company needs next: new features, improvements, bugs to fix, growth experiments, documentation, testing.
   - Create tasks with clear descriptions and assign them to the right people.
   - Break big goals into concrete, actionable tasks.

5. BUILD AND ADAPT THE TEAM
   - If work is piling up and the team can't keep up, hire new agents
   - If a role is missing that the company needs, propose it
   - If someone is consistently failing, flag it to the board with a recommendation
   - The org structure should evolve as the company grows
   - When hiring a new agent, write their COMPLETE definition:
     * Name and title that fits the company culture
     * Clear role description (promptTemplate) that defines their responsibilities, how they work, and their personality — tailored to this specific company and its needs
     * The right seniority level (opus for strategic roles, sonnet for execution roles)
     * Appropriate check-in schedule based on workload
     * Who they report to in the org chart
     * Their specific capabilities relevant to the company's domain

6. THINK STRATEGICALLY
   - Keep the company mission and goals in mind at all times
   - Identify risks early and mitigate them
   - Look for opportunities the board might not see
   - Suggest pivots, experiments, or new directions when you see potential

7. REPORT TO THE BOARD
   - After every check-in, leave a clear summary of what you did
   - Highlight: what was accomplished, what's in progress, what's blocked, what you need from the board
   - Be transparent about problems — don't hide bad news

HOW YOU COMMUNICATE:
Write like you're in a casual chat — short, direct, friendly. Think Slack or iMessage, not a corporate memo. Short paragraphs (1-3 sentences max). Casual but professional tone. No markdown headers like "## Status Report" — just talk naturally. Bullet points only when listing multiple items. Be concise — if you can say it in one line, do that. Ask follow-up questions when you need the board's input.

YOUR PERSONALITY:
You are direct, decisive, and action-oriented. You think in outcomes, not process. You're the kind of CEO who would rather ship something imperfect today than plan something perfect for next month. You take ownership — if something is broken, you fix it or find someone who can. You're optimistic but realistic. You celebrate wins and learn from failures. You never say "nothing to do" — there's always something that can be improved.`;

const TEAM_OPTIONS = [
  { id: "full", label: "Full team", desc: "CEO, Product Manager, Architect, Developer, Growth Lead, QA Buyer, QA Seller" },
  { id: "ceo", label: "Just a CEO", desc: "Only creates a CEO agent to start with" },
  { id: "empty", label: "Empty", desc: "No agents, add them yourself later" },
];

interface AgentTemplate {
  name: string;
  role: string;
  title: string;
  model: string;
  heartbeatIntervalSec: number;
  reportsToRole?: string;
  capabilities: string;
  promptTemplate?: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "CEO",
    role: "ceo",
    title: "Chief Executive Officer",
    model: "claude-opus-4-6",
    heartbeatIntervalSec: 1200,
    capabilities: "Strategic planning, delegation, company oversight, stakeholder communication, goal setting",
    promptTemplate: CEO_PROMPT,
  },
  {
    name: "Product Manager",
    role: "pm",
    title: "Product Manager",
    model: "claude-opus-4-6",
    heartbeatIntervalSec: 600,
    reportsToRole: "ceo",
    capabilities: "Product strategy, roadmap planning, requirements gathering, user story creation, prioritization",
  },
  {
    name: "Architect",
    role: "engineer",
    title: "Software Architect",
    model: "claude-opus-4-6",
    heartbeatIntervalSec: 900,
    reportsToRole: "ceo",
    capabilities: "System design, architecture decisions, technical planning, code review, documentation",
  },
  {
    name: "Developer",
    role: "engineer",
    title: "Software Developer",
    model: "claude-sonnet-4-6",
    heartbeatIntervalSec: 300,
    reportsToRole: "engineer",
    capabilities: "Implementation, coding, debugging, testing, pull requests, feature development",
  },
  {
    name: "Growth Lead",
    role: "cmo",
    title: "Growth Lead",
    model: "claude-sonnet-4-6",
    heartbeatIntervalSec: 600,
    reportsToRole: "ceo",
    capabilities: "Growth strategy, marketing, user acquisition, analytics, content creation, outreach",
  },
  {
    name: "QA Buyer",
    role: "qa",
    title: "QA - Buyer Experience",
    model: "claude-sonnet-4-6",
    heartbeatIntervalSec: 900,
    reportsToRole: "pm",
    capabilities: "Quality assurance, buyer flow testing, bug reporting, test planning, regression testing",
  },
  {
    name: "QA Seller",
    role: "qa",
    title: "QA - Seller Experience",
    model: "claude-sonnet-4-6",
    heartbeatIntervalSec: 900,
    reportsToRole: "pm",
    capabilities: "Quality assurance, seller flow testing, bug reporting, test planning, regression testing",
  },
];

// Map of known Wix app IDs to human-readable names and capabilities
const WIX_APP_MAP: Record<string, { name: string; capability: string }> = {
  "215238eb-22a5-4c36-9e7b-e7c08025e04e": { name: "Wix Stores", capability: "e-commerce, product management, inventory, orders" },
  "13d21c63-b5ec-5912-8397-c3a5ddb27a97": { name: "Wix Bookings", capability: "appointment scheduling, service management, staff calendars" },
  "14bcded7-0066-7c35-14d7-466cb3f09103": { name: "Wix Blog", capability: "content creation, blog posts, categories, SEO" },
  "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3": { name: "Wix Pricing Plans", capability: "subscription plans, memberships, recurring payments" },
  "225dd912-7dea-4738-8688-4b8c6955ffc2": { name: "Wix Forms", capability: "form building, lead capture, submissions" },
  "14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9": { name: "Wix Members Area", capability: "user accounts, member profiles, gated content" },
  "b278a256-2757-4f19-9313-c05c783bec92": { name: "Wix Restaurants", capability: "restaurant menus, online ordering, table management" },
  "d90652a2-f5a1-4c7c-84c4-d4cdcc41f130": { name: "Wix Portfolio", capability: "portfolio showcase, project galleries" },
};

function generateFromWixSite(siteName: string, apps: string[]): { description: string; goalTitle: string; goalDesc: string } {
  const appNames = apps.map((id) => WIX_APP_MAP[id]?.name).filter(Boolean);
  const capabilities = apps.map((id) => WIX_APP_MAP[id]?.capability).filter(Boolean);

  let type = "online business";
  if (apps.some((id) => WIX_APP_MAP[id]?.name === "Wix Stores")) type = "online store";
  else if (apps.some((id) => WIX_APP_MAP[id]?.name === "Wix Bookings")) type = "service business";
  else if (apps.some((id) => WIX_APP_MAP[id]?.name === "Wix Restaurants")) type = "restaurant";
  else if (apps.some((id) => WIX_APP_MAP[id]?.name === "Wix Blog")) type = "content platform";

  const description = `${siteName} is a${["a","e","i","o","u"].includes(type[0]) ? "n" : ""} ${type} powered by Wix.${appNames.length > 0 ? ` It uses ${appNames.join(", ")} to manage its ${capabilities.slice(0, 3).join(", ")}.` : ""} Agents have full access to the Wix site via MCP tools to manage products, content, bookings, and more.`;

  const goalTitle = `Grow and optimize ${siteName}`;
  const goalDesc = `Build, manage, and grow the ${type}. Use Wix MCP tools to manage the site — ${capabilities.slice(0, 4).join(", ")}. Focus on driving engagement, improving the customer experience, and expanding the business.`;

  return { description, goalTitle, goalDesc };
}

export function CreateCompanyWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState(-1); // -1 = source selection
  const [companyName, setCompanyName] = useState("");
  const [companyDesc, setCompanyDesc] = useState("");
  const [teamChoice, setTeamChoice] = useState("full");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Wix site import
  const [wixSiteId, setWixSiteId] = useState("");
  const [wixSiteName, setWixSiteName] = useState("");
  const [wixSiteUrl, setWixSiteUrl] = useState("");
  const [wixApps, setWixApps] = useState<string[]>([]);

  const reset = () => {
    setStep(-1);
    setCompanyName("");
    setCompanyDesc("");
    setTeamChoice("full");
    setGoalTitle("");
    setGoalDesc("");
    setCreating(false);
    setError("");
    setWixSiteId("");
    setWixSiteName("");
    setWixSiteUrl("");
    setWixApps([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setCreating(true);
    setError("");
    try {
      // 1. Create company
      const company = await createCompany({
        name: companyName,
        description: companyDesc,
      });

      // 2. Create agents based on template choice
      const templatesToCreate = teamChoice === "full"
        ? AGENT_TEMPLATES
        : teamChoice === "ceo"
          ? [AGENT_TEMPLATES[0]]
          : [];

      const createdAgents: Agent[] = [];
      // First pass: create all agents
      for (const t of templatesToCreate) {
        const agent = await createAgent(company.id, {
          name: t.name,
          role: t.role,
          title: t.title,
          capabilities: t.capabilities,
          adapterType: "claude_local",
          adapterConfig: {
            model: t.model,
            heartbeatIntervalSec: t.heartbeatIntervalSec,
            dangerouslySkipPermissions: true,
            timeoutSec: 600,
            maxTurnsPerRun: 50,
            ...(t.promptTemplate ? { promptTemplate: t.promptTemplate } : {}),
          },
        });
        createdAgents.push(agent);
      }

      // Second pass: set reportsTo based on role mapping
      for (let i = 0; i < templatesToCreate.length; i++) {
        const template = templatesToCreate[i];
        if (template.reportsToRole) {
          const manager = createdAgents.find((a) => a.role === template.reportsToRole);
          if (manager) {
            await updateAgent(createdAgents[i].id, { reportsTo: manager.id });
          }
        }
      }

      // 3. Create goal
      if (goalTitle) {
        await createGoal(company.id, {
          title: goalTitle,
          description: goalDesc,
          level: "company",
          status: "active",
        });
      }

      // 4. Create "Board Inbox" issue assigned to CEO
      const ceoAgent = createdAgents.find((a) => a.role === "ceo");
      await createIssue(company.id, {
        title: "Board Inbox",
        description: "Direct communication channel between the board operator and the CEO.",
        priority: "high",
        assigneeId: ceoAgent?.id,
      });

      // 5. Connect Wix site if provided
      if (wixSiteId.trim()) {
        try {
          await fetch("/api/wix-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              siteId: wixSiteId.trim(),
              siteName: wixSiteName.trim() || companyName,
              siteUrl: wixSiteUrl.trim() || undefined,
            }),
          });
        } catch { /* non-critical */ }
      }

      // 6. Wake up the CEO
      if (ceoAgent) {
        try { await invokeHeartbeat(ceoAgent.id); } catch {}
      }

      // 7. Select the new company
      onCreated(company.id);
      reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create company");
      setCreating(false);
    }
  };

  const handleWixImport = () => {
    const generated = generateFromWixSite(wixSiteName || "My Site", wixApps);
    setCompanyName(wixSiteName || "My Site");
    setCompanyDesc(generated.description);
    setGoalTitle(generated.goalTitle);
    setGoalDesc(generated.goalDesc);
    setStep(0); // Jump to name/desc step (pre-filled) for review
  };

  const stepContent = () => {
    switch (step) {
      case -1:
        return (
          <Box direction="vertical" gap="12px">
            <button
              onClick={() => setStep(-2)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "18px 16px", borderRadius: 8,
                border: "2px solid #0C6EFC", backgroundColor: "#f0f5ff", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "#0C6EFC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                <div>
                  <Text weight="bold">Start from a Wix site</Text>
                  <br />
                  <Text size="small" secondary>Paste your Wix Site ID — name, description, and goals will be auto-generated</Text>
                </div>
              </div>
            </button>
            <button
              onClick={() => setStep(0)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "18px 16px", borderRadius: 8,
                border: "1px solid #dfe5eb", backgroundColor: "#fff", cursor: "pointer",
              }}
            >
              <Text weight="bold">Start from scratch</Text>
              <br />
              <Text size="small" secondary>Manually set up company name, description, team, and goals</Text>
            </button>
          </Box>
        );
      case -2:
        return (
          <Box direction="vertical" gap="14px">
            <div style={{ padding: "10px 14px", background: "#f0f5ff", borderRadius: 6, fontSize: 13, color: "#444", lineHeight: 1.6 }}>
              Enter your Wix Site ID and we'll auto-generate the company details. You can find the Site ID in your Wix dashboard under Settings, or from the site list below.
            </div>
            <FormField label="Wix Site ID" required>
              <Input
                value={wixSiteId}
                onChange={(e) => setWixSiteId(e.currentTarget.value)}
                placeholder="e.g., 7c833926-ed51-4b50-bf91-5448e2c8b2cd"
              />
            </FormField>
            <FormField label="Site name">
              <Input
                value={wixSiteName}
                onChange={(e) => setWixSiteName(e.currentTarget.value)}
                placeholder="e.g., Hap Toy Store"
              />
            </FormField>
            <FormField label="Site URL (optional)">
              <Input
                value={wixSiteUrl}
                onChange={(e) => setWixSiteUrl(e.currentTarget.value)}
                placeholder="https://..."
              />
            </FormField>
            <FormField label="Installed apps (comma-separated app IDs, optional)">
              <Input
                value={wixApps.join(", ")}
                onChange={(e) => setWixApps(e.currentTarget.value.split(",").map((s) => s.trim()).filter(Boolean))}
                placeholder="e.g., 215238eb-22a5-4c36-9e7b-e7c08025e04e"
              />
            </FormField>
          </Box>
        );
      case 0:
        return (
          <Box direction="vertical" gap="18px">
            <FormField label="Company name" required>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.currentTarget.value)}
                placeholder="e.g. Acme Corp"
              />
            </FormField>
            <FormField label="What does this company do?">
              <InputArea
                value={companyDesc}
                onChange={(e) => setCompanyDesc(e.currentTarget.value)}
                placeholder="Brief description of the company's purpose..."
                rows={3}
              />
            </FormField>
          </Box>
        );
      case 1:
        return (
          <Box direction="vertical" gap="12px">
            {TEAM_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTeamChoice(opt.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 8,
                  border: teamChoice === opt.id ? "2px solid #3899ec" : "1px solid #dfe5eb",
                  backgroundColor: teamChoice === opt.id ? "#eaf7ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                <Text weight="bold">{opt.label}</Text>
                <br />
                <Text size="small" secondary>{opt.desc}</Text>
              </button>
            ))}
          </Box>
        );
      case 2:
        return (
          <Box direction="vertical" gap="18px">
            <FormField label="Goal title" required>
              <Input
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.currentTarget.value)}
                placeholder="e.g. Launch MVP by Q2"
              />
            </FormField>
            <FormField label="Goal description (optional)">
              <InputArea
                value={goalDesc}
                onChange={(e) => setGoalDesc(e.currentTarget.value)}
                placeholder="More details about this goal..."
                rows={3}
              />
            </FormField>
          </Box>
        );
      default:
        return null;
    }
  };

  const stepTitles: Record<number, string> = {
    [-1]: "How do you want to start?",
    [-2]: "Connect your Wix site",
    0: "Name your company",
    1: "Choose a starting team",
    2: "Set your first goal",
  };

  const canAdvance = () => {
    if (step === -1) return true;
    if (step === -2) return wixSiteId.trim().length > 0;
    if (step === 0) return companyName.trim().length > 0;
    if (step === 1) return true;
    if (step === 2) return goalTitle.trim().length > 0;
    return true;
  };

  const handlePrimary = () => {
    if (step === -1) return; // handled by buttons inside
    if (step === -2) { handleWixImport(); return; }
    if (step < 2) { setStep(step + 1); return; }
    handleSubmit();
  };

  const handleSecondary = () => {
    if (step === -2) { setStep(-1); return; }
    if (step === 0 && wixSiteId) { setStep(-2); return; }
    if (step > 0) { setStep(step - 1); return; }
    handleClose();
  };

  const totalSteps = 3;
  const currentStep = step >= 0 ? step + 1 : undefined;

  if (!open) return null;

  return (
    <Modal isOpen={open} onRequestClose={handleClose} shouldCloseOnOverlayClick>
      <CustomModalLayout
        title={stepTitles[step]}
        subtitle={currentStep ? `Step ${currentStep} of ${totalSteps}` : undefined}
        primaryButtonText={step === -1 ? undefined : step === -2 ? "Generate company" : step < 2 ? "Next" : (creating ? "Creating..." : "Create Company")}
        primaryButtonOnClick={handlePrimary}
        primaryButtonProps={{ disabled: !canAdvance() || creating }}
        secondaryButtonText={step === -1 ? "Cancel" : "Back"}
        secondaryButtonOnClick={step === -1 ? handleClose : handleSecondary}
        onCloseButtonClick={handleClose}
        content={
          <Box direction="vertical" gap="12px">
            {stepContent()}
            {error && <Text size="small" skin="error">{error}</Text>}
            {creating && (
              <Box align="center" padding="12px 0">
                <Loader size="small" />
                <Text size="small" secondary style={{ marginLeft: 8 }}>Setting up your company...</Text>
              </Box>
            )}
          </Box>
        }
      />
    </Modal>
  );
}

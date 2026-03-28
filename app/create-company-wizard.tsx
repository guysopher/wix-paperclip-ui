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
   - If work is piling up and the team can't keep up, hire new agents (create agent proposals for the board to approve)
   - If a role is missing that the company needs, propose it
   - If someone is consistently failing, flag it to the board with a recommendation
   - The org structure should evolve as the company grows

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

export function CreateCompanyWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [companyDesc, setCompanyDesc] = useState("");
  const [teamChoice, setTeamChoice] = useState("full");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(0);
    setCompanyName("");
    setCompanyDesc("");
    setTeamChoice("full");
    setGoalTitle("");
    setGoalDesc("");
    setCreating(false);
    setError("");
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

      // 5. Wake up the CEO
      if (ceoAgent) {
        try { await invokeHeartbeat(ceoAgent.id); } catch {}
      }

      // 6. Select the new company
      onCreated(company.id);
      reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create company");
      setCreating(false);
    }
  };

  const stepContent = () => {
    switch (step) {
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

  const stepTitles = ["Name your company", "Choose a starting team", "Set your first goal"];

  const canAdvance = () => {
    if (step === 0) return companyName.trim().length > 0;
    if (step === 1) return true;
    if (step === 2) return goalTitle.trim().length > 0;
    return true;
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onRequestClose={handleClose} shouldCloseOnOverlayClick>
      <CustomModalLayout
        title={stepTitles[step]}
        subtitle={`Step ${step + 1} of 3`}
        primaryButtonText={step < 2 ? "Next" : (creating ? "Creating..." : "Create Company")}
        primaryButtonOnClick={step < 2 ? () => setStep(step + 1) : handleSubmit}
        primaryButtonProps={{ disabled: !canAdvance() || creating }}
        secondaryButtonText={step > 0 ? "Back" : "Cancel"}
        secondaryButtonOnClick={step > 0 ? () => setStep(step - 1) : handleClose}
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

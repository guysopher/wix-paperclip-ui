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
  type Agent,
} from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (companyId: string) => void;
}

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
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "CEO",
    role: "ceo",
    title: "Chief Executive Officer",
    model: "claude-opus-4-6",
    heartbeatIntervalSec: 1200,
    capabilities: "Strategic planning, delegation, company oversight, stakeholder communication, goal setting",
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

      // 5. Select the new company
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

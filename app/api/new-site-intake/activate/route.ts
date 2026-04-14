import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AI_TEAM_LEAD_PROMPT } from "@/lib/ai-team-lead-prompt";
import { buildCompanyDescription } from "@/lib/company-metadata";

const client = new OpenAI();

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const PICASSO_BRIDGE_URL =
  process.env.PICASSO_BRIDGE_URL ||
  "http://localhost:3401";

const PICASSO_BRIDGE_TOKEN = process.env.PICASSO_BRIDGE_TOKEN || "";

interface IntakeMessage {
  role: "ceo" | "user";
  text: string;
}

interface ActivateRequest {
  messages?: IntakeMessage[];
}

interface KickoffTask {
  title: string;
  description: string;
}

interface IntakeSummary {
  companyName: string;
  businessDescription: string;
  siteProposal: string;
  teamHiringPlan: string;
  managementPlan: string;
  siteSpecifics: string;
  firstBuildBrief: string;
  goals: string[];
  kickoffTasks: KickoffTask[];
}

function buildTranscript(messages: IntakeMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "Founder" : "AI Team Lead"}: ${message.text}`)
    .join("\n");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function toKickoffTasks(value: unknown): KickoffTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const title = typeof (entry as { title?: unknown }).title === "string"
        ? (entry as { title: string }).title.trim()
        : "";
      const description = typeof (entry as { description?: unknown }).description === "string"
        ? (entry as { description: string }).description.trim()
        : "";

      if (!title || !description) {
        return null;
      }

      return { title, description };
    })
    .filter((task): task is KickoffTask => Boolean(task))
    .slice(0, 4);
}

async function summarizeTranscript(messages: IntakeMessage[]): Promise<IntakeSummary> {
  const transcript = buildTranscript(messages);
  const response = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 1200,
    messages: [
      {
        role: "system",
        content: `You are preparing the approved kickoff plan for a founder who has decided to hire the Wix AI Team Lead.

Use the full transcript as the source of truth and return ONLY valid JSON in this shape:
{
  "companyName": "string",
  "businessDescription": "1-3 sentence summary of the business, what it sells, and who it serves",
  "siteProposal": "what the first site version should be and why",
  "teamHiringPlan": "which starter team should be hired first and how they would help",
  "managementPlan": "how the AI Team Lead should begin managing and growing the business after kickoff",
  "siteSpecifics": "all notable requests for the site, tone, pages, features, priorities, and constraints",
  "firstBuildBrief": "a concise but rich brief for building the first version of the site",
  "goals": ["goal 1", "goal 2"],
  "kickoffTasks": [
    { "title": "string", "description": "string" }
  ]
}

Rules:
- Capture the founder's actual business and audience, not generic placeholders.
- Fold in everything meaningful the founder shared during the conversation.
- The proposal is now approved, so write a concrete execution plan, not another interview summary.
- Goals should be practical and outcome-focused. Return 1 to 3.
- Kickoff tasks should be the first concrete tasks the AI Team Lead should take on immediately after approval. Return 2 to 4 tasks.
- At least one task should cover launching the first site version.
- At least one task should cover building the starter team.
- At least one task should cover beginning business management / growth work.
- Do not include markdown fences or extra commentary.`,
      },
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<IntakeSummary>;

  const companyName = parsed.companyName?.trim() || "New Business";
  const businessDescription =
    parsed.businessDescription?.trim() ||
    "A new business site being created from a founder interview.";
  const siteProposal =
    parsed.siteProposal?.trim() ||
    "Create a credible first version of the site that clearly explains the business, gives the brand a strong first impression, and makes it easy for customers to understand what to do next.";
  const teamHiringPlan =
    parsed.teamHiringPlan?.trim() ||
    "Start with a small specialist team around site execution, brand/content, and growth operations. The AI Team Lead should decide which role to hire first based on what most accelerates launch and early traction.";
  const managementPlan =
    parsed.managementPlan?.trim() ||
    "Set the operating rhythm, prioritize the first growth and site improvements, and keep the founder informed while the business setup moves from concept into execution.";
  const siteSpecifics =
    parsed.siteSpecifics?.trim() ||
    "No additional site-specific requirements were captured.";
  const firstBuildBrief =
    parsed.firstBuildBrief?.trim() ||
    `${siteProposal}\n\nRequirements and priorities:\n${siteSpecifics}`;
  const goals = toStringArray(parsed.goals);
  const kickoffTasks = toKickoffTasks(parsed.kickoffTasks);

  return {
    companyName,
    businessDescription,
    siteProposal,
    teamHiringPlan,
    managementPlan,
    siteSpecifics,
    firstBuildBrief,
    goals: goals.length > 0
      ? goals
      : [
          `Launch the first strong version of ${companyName}`,
          `Put the right starter team in place for ${companyName}`,
          `Start managing growth and operations for ${companyName}`,
        ],
    kickoffTasks: kickoffTasks.length > 0
      ? kickoffTasks
      : [
          {
            title: `Launch the first site version for ${companyName}`,
            description: `Create and ship the first version of the site.\n\nSite proposal:\n${siteProposal}\n\nExecution brief:\n${firstBuildBrief}`,
          },
          {
            title: `Build the starter team for ${companyName}`,
            description: `Decide which specialist roles to hire first, in what order, and why.\n\nHiring plan:\n${teamHiringPlan}`,
          },
          {
            title: `Start managing ${companyName}`,
            description: `Turn the approved proposal into an operating plan for the business.\n\nManagement plan:\n${managementPlan}`,
          },
        ],
  };
}

function buildBoardIssueDescription(summary: IntakeSummary, messages: IntakeMessage[]): string {
  const transcript = buildTranscript(messages);

  return [
    `The founder approved the AI Team Lead proposal for ${summary.companyName}.`,
    "",
    "Approved business summary:",
    summary.businessDescription,
    "",
    "Approved site proposal:",
    summary.siteProposal,
    "",
    "Approved team hiring plan:",
    summary.teamHiringPlan,
    "",
    "Approved management plan:",
    summary.managementPlan,
    "",
    "First-build brief:",
    summary.firstBuildBrief,
    "",
    "Founder conversation transcript:",
    transcript,
  ].join("\n");
}

function buildPicassoPrompt(summary: IntakeSummary): string {
  return [
    `Create a new Wix business site for ${summary.companyName}.`,
    "",
    `Business overview: ${summary.businessDescription}`,
    "",
    "Approved site direction:",
    summary.siteProposal,
    "",
    "Founder requirements and priorities:",
    summary.siteSpecifics,
    "",
    "First-build brief:",
    summary.firstBuildBrief,
    "",
    "Build a polished first version that feels credible, usable, and commercially sharp.",
  ].join("\n");
}

function buildSiteExecutionTask(summary: IntakeSummary, bridgeJobId?: string, bridgeError?: string): KickoffTask {
  const lines = [
    `Turn the approved site proposal into the first real version of the business site for ${summary.companyName}.`,
    "",
    "Approved site proposal:",
    summary.siteProposal,
    "",
    "Execution brief:",
    summary.firstBuildBrief,
  ];

  if (bridgeJobId) {
    lines.push("");
    lines.push(`A Picasso site-build job has already been queued: ${bridgeJobId}`);
    lines.push("Coordinate the rest of the launch work around that build and keep momentum moving.");
  }

  if (bridgeError) {
    lines.push("");
    lines.push(`The first automatic site-build attempt failed to start: ${bridgeError}`);
    lines.push("Treat this as a launch blocker to resolve quickly while keeping the rest of the kickoff moving.");
  }

  return {
    title: `Launch the first site version for ${summary.companyName}`,
    description: lines.join("\n"),
  };
}

async function paperclip<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${PAPERCLIP_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...(options?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Paperclip request failed: ${path} (${response.status})`);
  }

  return response.json();
}

async function startPicassoBridge(summary: IntakeSummary, companyId: string, issueId: string) {
  if (!PICASSO_BRIDGE_TOKEN) {
    throw new Error("PICASSO_BRIDGE_TOKEN is not configured");
  }

  const response = await fetch(`${PICASSO_BRIDGE_URL.replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PICASSO_BRIDGE_TOKEN}`,
    },
    body: JSON.stringify({
      mode: "create_site",
      prompt: buildPicassoPrompt(summary),
      designer: "none",
      companyId,
      issueId,
      requestedBy: "paperclip-ui",
      metadata: {
        businessName: summary.companyName,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || "Failed to start Picasso bridge job");
  }

  return response.json() as Promise<{ jobId: string; status: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActivateRequest;
    const messages = body.messages || [];

    if (messages.length === 0) {
      return NextResponse.json({ error: "Conversation transcript is required" }, { status: 400 });
    }

    const summary = await summarizeTranscript(messages);
    const approvedAt = new Date().toISOString();

    const company = await paperclip<{
      id: string;
      name: string;
      description: string;
    }>("/companies", {
      method: "POST",
      body: JSON.stringify({
        name: summary.companyName,
        description: buildCompanyDescription({
          version: 1,
          businessDescription: summary.businessDescription,
          extra: {
            activation: {
              mode: "new_site",
              newSiteInterview: {
                stage: "building",
                startedAt: approvedAt,
                completedAt: approvedAt,
              },
            },
          },
        }),
      }),
    });

    const ceoAgent = await paperclip<{
      id: string;
      name: string;
      role: string;
      title: string;
      status: string;
      companyId: string;
      reportsTo: string | null;
      capabilities: string;
      adapterType: string;
      adapterConfig: Record<string, unknown>;
      budgetMonthlyCents: number;
      lastHeartbeatAt: string | null;
      createdAt: string;
      updatedAt: string;
      icon?: string;
    }>(`/companies/${company.id}/agents`, {
      method: "POST",
      body: JSON.stringify({
        name: "AI Team Lead",
        role: "ceo",
        title: "AI Team Lead",
        icon: "brain",
        capabilities:
          "Strategic planning, delegation, AI team oversight, stakeholder communication, business analysis, Wix operations",
        adapterType: "claude_local",
        adapterConfig: {
          model: "claude-opus-4-6",
          heartbeatIntervalSec: 1200,
          dangerouslySkipPermissions: true,
          timeoutSec: 600,
          maxTurnsPerRun: 50,
          promptTemplate: AI_TEAM_LEAD_PROMPT,
        },
      }),
    });

    const boardIssue = await paperclip<{
      id: string;
      title: string;
    }>(`/companies/${company.id}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Approved kickoff for ${summary.companyName}`,
        description: buildBoardIssueDescription(summary, messages),
        priority: "high",
        assigneeAgentId: ceoAgent.id,
      }),
    });

    let latestAgentCommentId = "";
    for (const message of messages) {
      const comment = await paperclip<{ id: string }>(`/issues/${boardIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: message.text,
          ...(message.role === "ceo" ? { authorAgentId: ceoAgent.id } : {}),
        }),
      });
      if (message.role === "ceo") {
        latestAgentCommentId = comment.id;
      }
    }

    await paperclip(`/issues/${boardIssue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: [
          "[System context - not visible to user]",
          `The founder has approved the AI Team Lead proposal for ${summary.companyName}.`,
          "The interview is over. Work has officially started.",
          "Use the approved board issue, transcript comments, goals, kickoff tasks, and any site-build status as the source of truth for execution.",
        ].join("\n"),
      }),
    });

    await Promise.all(
      summary.goals.slice(0, 3).map((goal) =>
        paperclip(`/companies/${company.id}/goals`, {
          method: "POST",
          body: JSON.stringify({
            title: goal,
            description: `Approved during the founder interview kickoff for ${summary.companyName}.`,
            level: "company",
            status: "active",
          }),
        }).catch(() => undefined),
      ),
    );

    const requestedAt = new Date().toISOString();
    let bridgeJob: {
      id: string;
      mode: "create_site";
      status: string;
      prompt: string;
      designer: string;
      companyId: string;
      issueId: string;
      requestedBy: string;
      createdAt: string;
      updatedAt: string;
    } | null = null;
    let bridgeError: string | undefined;

    try {
      const bridgeResponse = await startPicassoBridge(summary, company.id, boardIssue.id);
      bridgeJob = {
        id: bridgeResponse.jobId,
        mode: "create_site",
        status: bridgeResponse.status,
        prompt: buildPicassoPrompt(summary),
        designer: "none",
        companyId: company.id,
        issueId: boardIssue.id,
        requestedBy: "paperclip-ui",
        createdAt: requestedAt,
        updatedAt: requestedAt,
      };
    } catch (error) {
      bridgeError = error instanceof Error ? error.message : "Failed to start Picasso bridge job";
    }

    const kickoffTasks = [...summary.kickoffTasks];
    const siteTaskIndex = kickoffTasks.findIndex((task) =>
      /site|launch|build/i.test(task.title) || /site|launch|build/i.test(task.description),
    );
    const siteExecutionTask = buildSiteExecutionTask(summary, bridgeJob?.id, bridgeError);

    if (siteTaskIndex >= 0) {
      kickoffTasks[siteTaskIndex] = siteExecutionTask;
    } else {
      kickoffTasks.unshift(siteExecutionTask);
    }

    await Promise.all(
      kickoffTasks.slice(0, 4).map((task) =>
        paperclip(`/companies/${company.id}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            priority: "high",
            assigneeAgentId: ceoAgent.id,
          }),
        }),
      ),
    );

    const nextDescription = buildCompanyDescription({
      version: 1,
      businessDescription: summary.businessDescription,
      wixBinding: {
        activationIssueId: boardIssue.id,
      },
      extra: {
        activation: {
          mode: "new_site",
          newSiteInterview: {
            stage: "building",
            startedAt: approvedAt,
            completedAt: approvedAt,
          },
          picassoBridge: bridgeJob
            ? {
                jobId: bridgeJob.id,
                status: bridgeJob.status,
                requestedAt,
                updatedAt: requestedAt,
              }
            : {
                status: "failed",
                requestedAt,
                updatedAt: requestedAt,
                error: bridgeError || "Failed to start Picasso bridge job",
              },
        },
      },
    });

    const updatedCompany = await paperclip<{
      id: string;
      name: string;
      description: string;
    }>(`/companies/${company.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: summary.companyName,
        description: nextDescription,
      }),
    });

    await paperclip(`/agents/${ceoAgent.id}/heartbeat/invoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => undefined);

    const backendSignature = [
      latestAgentCommentId || "no-agent-comment",
      "no-run",
      "no-status",
      "0",
      bridgeJob?.status || "no-bridge",
      bridgeJob?.updatedAt || "no-bridge-update",
      "no-bridge-site-id",
      "no-bridge-dev-url",
      "no-bridge-site-url",
      bridgeError || "no-bridge-error",
    ].join(":");

    return NextResponse.json({
      activationSession: {
        companyId: updatedCompany.id,
        ceoAgent,
        inboxIssueId: boardIssue.id,
        mode: "new_site",
        companyName: updatedCompany.name,
        companyDescription: updatedCompany.description,
        workspaceContextId: updatedCompany.id,
      },
      bridgeJob,
      backendSignature,
    });
  } catch (error) {
    console.error("New site activation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "New site activation failed" },
      { status: 500 },
    );
  }
}

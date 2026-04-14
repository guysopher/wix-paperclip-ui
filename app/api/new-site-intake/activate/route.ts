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

interface IntakeSummary {
  companyName: string;
  businessDescription: string;
  siteSpecifics: string;
  firstBuildBrief: string;
}

function buildTranscript(messages: IntakeMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "Founder" : "AI Team Lead"}: ${message.text}`)
    .join("\n");
}

async function summarizeTranscript(messages: IntakeMessage[]): Promise<IntakeSummary> {
  const transcript = buildTranscript(messages);
  const response = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 700,
    messages: [
      {
        role: "system",
        content: `You are preparing a final activation brief for a new Wix site creation flow.

Use the full transcript as the source of truth and return ONLY valid JSON in this shape:
{
  "companyName": "string",
  "businessDescription": "1-3 sentence summary of the business, what it sells, and who it serves",
  "siteSpecifics": "all notable requests for the site, tone, pages, features, priorities, and constraints",
  "firstBuildBrief": "a concise but rich brief for building the first version of the site"
}

Rules:
- Capture the founder's actual business and audience, not generic placeholders.
- Fold in everything meaningful the founder shared during the conversation.
- If the founder gave multiple details in one answer, preserve them.
- If a specific field is not explicit, make a careful best-effort summary from the transcript.
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

  return {
    companyName: parsed.companyName?.trim() || "New Business",
    businessDescription: parsed.businessDescription?.trim() || "A new business site being created from a founder interview.",
    siteSpecifics: parsed.siteSpecifics?.trim() || "No additional site-specific requirements were captured.",
    firstBuildBrief: parsed.firstBuildBrief?.trim() || parsed.businessDescription?.trim() || "Build a credible first version of the site based on the founder conversation.",
  };
}

function buildIssueDescription(summary: IntakeSummary, messages: IntakeMessage[]): string {
  const transcript = buildTranscript(messages);

  return [
    `Create a brand new Wix site for ${summary.companyName}.`,
    "",
    "This site was activated from a standalone founder interview.",
    "",
    "Transcript-derived business summary:",
    summary.businessDescription,
    "",
    "Transcript-derived site requirements:",
    summary.siteSpecifics,
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
    "Founder requirements and priorities:",
    summary.siteSpecifics,
    "",
    "First-build brief:",
    summary.firstBuildBrief,
    "",
    "Build a polished first version that feels credible, usable, and commercially sharp.",
  ].join("\n");
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
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
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

    const issue = await paperclip<{
      id: string;
      title: string;
    }>(`/companies/${company.id}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Create new Wix site for ${summary.companyName}`,
        description: buildIssueDescription(summary, messages),
        priority: "high",
        assigneeAgentId: ceoAgent.id,
      }),
    });

    let latestAgentCommentId = "";
    for (const message of messages) {
      const comment = await paperclip<{ id: string }>(`/issues/${issue.id}/comments`, {
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

    await paperclip(`/issues/${issue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `[System context - not visible to user]\nThis company was created from a completed founder interview. Use the issue description and transcript comments as the source of truth for the founder brief.`,
      }),
    });

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

    let nextDescription = buildCompanyDescription({
      version: 1,
      businessDescription: summary.businessDescription,
      wixBinding: {
        activationIssueId: issue.id,
      },
      extra: {
        activation: {
          mode: "new_site",
          newSiteInterview: {
            stage: "building",
            startedAt: requestedAt,
            completedAt: requestedAt,
          },
          picassoBridge: {
            status: "failed",
            requestedAt,
            updatedAt: requestedAt,
          },
        },
      },
    });

    try {
      const bridgeResponse = await startPicassoBridge(summary, company.id, issue.id);
      bridgeJob = {
        id: bridgeResponse.jobId,
        mode: "create_site",
        status: bridgeResponse.status,
        prompt: buildPicassoPrompt(summary),
        designer: "none",
        companyId: company.id,
        issueId: issue.id,
        requestedBy: "paperclip-ui",
        createdAt: requestedAt,
        updatedAt: requestedAt,
      };

      nextDescription = buildCompanyDescription({
        version: 1,
        businessDescription: summary.businessDescription,
        wixBinding: {
          activationIssueId: issue.id,
        },
        extra: {
          activation: {
            mode: "new_site",
            newSiteInterview: {
              stage: "building",
              startedAt: requestedAt,
              completedAt: requestedAt,
            },
            picassoBridge: {
              jobId: bridgeResponse.jobId,
              status: bridgeResponse.status,
              requestedAt,
              updatedAt: requestedAt,
            },
          },
        },
      });
    } catch (error) {
      nextDescription = buildCompanyDescription({
        version: 1,
        businessDescription: summary.businessDescription,
        wixBinding: {
          activationIssueId: issue.id,
        },
        extra: {
          activation: {
            mode: "new_site",
            newSiteInterview: {
              stage: "building",
              startedAt: requestedAt,
              completedAt: requestedAt,
            },
            picassoBridge: {
              status: "failed",
              requestedAt,
              updatedAt: requestedAt,
              error: error instanceof Error ? error.message : "Failed to start Picasso bridge job",
            },
          },
        },
      });
    }

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
      "no-bridge-error",
    ].join(":");

    return NextResponse.json({
      activationSession: {
        companyId: updatedCompany.id,
        ceoAgent,
        inboxIssueId: issue.id,
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

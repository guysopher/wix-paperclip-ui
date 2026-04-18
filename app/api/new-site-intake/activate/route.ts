import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AI_TEAM_LEAD_PROMPT } from "@/lib/ai-team-lead-prompt";
import {
  CANONICAL_AGENT_TITLES,
  renderAgentTemplateShowcase,
} from "@/lib/agent-templates";
import { syncHeartbeatConfig } from "@/lib/agent-heartbeat";
import { buildCompanyDescription } from "@/lib/company-metadata";
import {
  DEFAULT_AGENT_TIMEOUT_SEC,
  DEFAULT_OPENAI_ADAPTER_TYPE,
  DEFAULT_OPENAI_TEAM_LEAD_MODEL,
} from "@/lib/paperclip-runtime-defaults";
import { repairCompanyState } from "@/lib/server/company-repair";

const client = new OpenAI();

const PAPERCLIP_API =
  process.env.PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

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

interface StarterAgentPlan {
  role: string;
  goal: string;
  expectedResult: string;
}

interface IntakeSummary {
  companyName: string;
  businessDescription: string;
  siteProposal: string;
  teamHiringPlan: string;
  managementPlan: string;
  starterTeam: StarterAgentPlan[];
  siteSpecifics: string;
  firstBuildBrief: string;
  goals: string[];
  expectedResults: string[];
  kickoffTasks: KickoffTask[];
}

const REQUIRED_STARTER_TEAM: StarterAgentPlan[] = [
  {
    role: "AI Team Lead",
    goal: "Lead the business, set priorities, and hire the right specialist team.",
    expectedResult:
      "A coordinated operating rhythm, clear ownership, and the right work moving across the whole business.",
  },
  {
    role: "Industry Advisor",
    goal: "Bring field-specific expertise to the business and challenge weak assumptions early.",
    expectedResult:
      "Sharper strategy, stronger trust signals, and better decisions grounded in the realities of the market.",
  },
  {
    role: "Wix Site Expert",
    goal: "Own the first site version and the ongoing site experience as the business launches.",
    expectedResult:
      "A credible site that clearly explains the offer, supports conversion, and improves as the business learns.",
  },
];

const ALLOWED_STARTER_TEAM_ROLES = new Set([
  "AI Team Lead",
  ...CANONICAL_AGENT_TITLES,
]);

function normalizeJsonText(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractJsonObject(raw: string): string {
  const normalized = normalizeJsonText(raw);
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return normalized;
  }

  return normalized.slice(start, end + 1);
}

function tryParseJson<T>(raw: string): T | null {
  const candidates = [normalizeJsonText(raw), extractJsonObject(raw)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
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

function toStarterTeam(value: unknown): StarterAgentPlan[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const role = typeof (entry as { role?: unknown }).role === "string"
        ? (entry as { role: string }).role.trim()
        : "";
      const goal = typeof (entry as { goal?: unknown }).goal === "string"
        ? (entry as { goal: string }).goal.trim()
        : "";
      const expectedResult = typeof (entry as { expectedResult?: unknown }).expectedResult === "string"
        ? (entry as { expectedResult: string }).expectedResult.trim()
        : "";

      if (!role || !goal || !expectedResult) {
        return null;
      }

      return { role, goal, expectedResult };
    })
    .filter((agent): agent is StarterAgentPlan => Boolean(agent))
    .slice(0, 4);
}

function normalizeStarterTeam(starterTeam: StarterAgentPlan[]): StarterAgentPlan[] {
  const uniqueAllowedAgents = starterTeam.filter((agent, index, agents) => {
    return ALLOWED_STARTER_TEAM_ROLES.has(agent.role)
      && agents.findIndex((entry) => entry.role === agent.role) === index;
  });

  const normalizedCoreTeam = REQUIRED_STARTER_TEAM.map((requiredAgent) => {
    return uniqueAllowedAgents.find((agent) => agent.role === requiredAgent.role) || requiredAgent;
  });

  const additionalAgents = uniqueAllowedAgents.filter((agent) => {
    return !REQUIRED_STARTER_TEAM.some((requiredAgent) => requiredAgent.role === agent.role);
  });

  return [...normalizedCoreTeam, ...additionalAgents].slice(0, 4);
}

async function parseJsonWithRepair<T>(raw: string, schemaDescription: string): Promise<T> {
  const direct = tryParseJson<T>(raw);
  if (direct) {
    return direct;
  }

  const repairResponse = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 1600,
    messages: [
      {
        role: "system",
        content: `You repair malformed JSON.

Return only valid JSON.
Preserve the original meaning and values as much as possible.
Do not add commentary or markdown fences.
Do not omit required keys.

Schema:
${schemaDescription}`,
      },
      {
        role: "user",
        content: raw,
      },
    ],
  });

  const repaired = repairResponse.choices[0]?.message?.content || "";
  const parsed = tryParseJson<T>(repaired);

  if (!parsed) {
    throw new Error("Failed to parse activation summary JSON");
  }

  return parsed;
}

async function summarizeTranscript(messages: IntakeMessage[]): Promise<IntakeSummary> {
  const transcript = buildTranscript(messages);
  const canonicalAgentOptions = renderAgentTemplateShowcase();
  const schemaDescription = `{
  "companyName": "string",
  "businessDescription": "string",
  "siteProposal": "string",
  "teamHiringPlan": "string",
  "managementPlan": "string",
  "starterTeam": [
    {
      "role": "string",
      "goal": "string",
      "expectedResult": "string"
    }
  ],
  "siteSpecifics": "string",
  "firstBuildBrief": "string",
  "goals": ["string"],
  "expectedResults": ["string"],
  "kickoffTasks": [
    { "title": "string", "description": "string" }
  ]
}`;
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
  "starterTeam": [
    {
      "role": "string",
      "goal": "string",
      "expectedResult": "string"
    }
  ],
  "siteSpecifics": "all notable requests for the site, tone, pages, features, priorities, and constraints",
  "firstBuildBrief": "a concise but rich brief for building the first version of the site",
  "goals": ["goal 1", "goal 2"],
  "expectedResults": ["result 1", "result 2"],
  "kickoffTasks": [
    { "title": "string", "description": "string" }
  ]
}

Rules:
- Capture the founder's actual business and audience, not generic placeholders.
- Fold in everything meaningful the founder shared during the conversation.
- The proposal is now approved, so write a concrete execution plan, not another interview summary.
- The center of gravity is the AI team plan, not a solo site-build pitch.
- "starterTeam" must describe the first agents the AI Team Lead should put in place. Each one needs a clear role, goal, and expected result.
- "starterTeam" must always include these exact roles: AI Team Lead, Industry Advisor, Wix Site Expert.
- Any additional role in "starterTeam" must use an exact canonical title from the list below. Do not invent role variants.
- Goals should be practical and outcome-focused. Return 1 to 3.
- "expectedResults" should describe the concrete business results the founder should expect from the first phase. Return 2 to 4.
- Kickoff tasks should be the first concrete tasks the AI Team Lead should take on immediately after approval. Return 2 to 4 tasks.
- At least one task should cover launching the first site version.
- At least one task should cover building the starter team.
- At least one task should cover beginning business management / growth work.
- Canonical specialist titles:
${canonicalAgentOptions}
- Do not include markdown fences or extra commentary.`,
      },
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = await parseJsonWithRepair<Partial<IntakeSummary>>(raw, schemaDescription);

  const companyName = parsed.companyName?.trim() || "New Business";
  const businessDescription =
    parsed.businessDescription?.trim() ||
    "A new business site being created from a founder interview.";
  const siteProposal =
    parsed.siteProposal?.trim() ||
    "Create a credible first version of the site that clearly explains the business, gives the brand a strong first impression, and makes it easy for customers to understand what to do next.";
  const teamHiringPlan =
    parsed.teamHiringPlan?.trim() ||
    "Start with the mandatory core team of AI Team Lead, Industry Advisor, and Wix Site Expert, then add only the most relevant canonical specialist roles for launch, growth, content, commerce, or operations.";
  const managementPlan =
    parsed.managementPlan?.trim() ||
    "Set the operating rhythm, prioritize the first growth and site improvements, and keep the founder informed while the business setup moves from concept into execution.";
  const starterTeam = normalizeStarterTeam(toStarterTeam(parsed.starterTeam));
  const siteSpecifics =
    parsed.siteSpecifics?.trim() ||
    "No additional site-specific requirements were captured.";
  const firstBuildBrief =
    parsed.firstBuildBrief?.trim() ||
    `${siteProposal}\n\nRequirements and priorities:\n${siteSpecifics}`;
  const goals = toStringArray(parsed.goals);
  const expectedResults = toStringArray(parsed.expectedResults);
  const kickoffTasks = toKickoffTasks(parsed.kickoffTasks);

  return {
    companyName,
    businessDescription,
    siteProposal,
    teamHiringPlan,
    managementPlan,
    starterTeam: starterTeam.length > 0
      ? starterTeam
      : REQUIRED_STARTER_TEAM,
    siteSpecifics,
    firstBuildBrief,
    goals: goals.length > 0
      ? goals
      : [
          `Launch the first strong version of ${companyName}`,
          `Put the right starter team in place for ${companyName}`,
          `Start managing growth and operations for ${companyName}`,
        ],
    expectedResults: expectedResults.length > 0
      ? expectedResults
      : [
          "A clear first-market version of the business site is live or in active launch.",
          "The founder has a starter AI team with defined ownership across launch, messaging, and growth.",
          "The business has an immediate next-phase plan for traction, optimization, and ongoing management.",
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
  const starterTeam = summary.starterTeam
    .map((agent) => `- ${agent.role}: Goal: ${agent.goal} | Expected result: ${agent.expectedResult}`)
    .join("\n");
  const expectedResults = summary.expectedResults
    .map((result) => `- ${result}`)
    .join("\n");
  const teamGoals = summary.goals
    .map((goal) => `- ${goal}`)
    .join("\n");

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
    "Approved starter agent team:",
    starterTeam,
    "",
    "Approved team goals:",
    teamGoals,
    "",
    "Expected first-phase results:",
    expectedResults,
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

function buildSiteExecutionTask(summary: IntakeSummary): KickoffTask {
  const lines = [
    `Turn the approved site proposal into the first real version of the business site for ${summary.companyName}.`,
    "",
    "Approved site proposal:",
    summary.siteProposal,
    "",
    "Execution brief:",
    summary.firstBuildBrief,
    "",
    "Execution rules:",
    "1. This is a build task, not a planning task.",
    "2. On the first AI Team Lead run, if no main site is bound yet, phase one is to create the main business site through the standard Wix/Harmony path, verify the created site identity, and write wixBinding.metaSiteId, wixBinding.siteId, and wixBinding.siteUrl back into company description.",
    "3. If the site-creation call returns an asynchronous jobId, that job becomes the primary creation flow. Poll it to terminal state before deciding whether creation succeeded.",
    "4. If the completed creation job returns a verified siteId, write that value into wixBinding.siteId and wixBinding.metaSiteId immediately, even if a trustworthy public siteUrl is not available yet.",
    "5. Treat siteId and metaSiteId as the same locked business identity unless Wix explicitly returns different verified values.",
    "6. Do not use placeholder URLs such as the generic wix.com host as the canonical siteUrl.",
    "7. Use ListWixSites only as a fallback when the completed creation job does not expose the created site identity directly or when you still need to resolve a real siteUrl after binding the site IDs.",
    "8. Do not treat a started build job as success if wixBinding still lacks those verified identity fields.",
    "9. The main business site becomes the canonical company site in wixBinding.",
    "10. Do not expand the specialist team for ongoing site execution until the main site is bound into wixBinding.",
    "11. After the main site is bound, hire the Wix Site Expert and hand off normal site-building, content, and polish work.",
    "12. After the main site is bound, create the optional Picasso experimental site separately and record it as vibeSiteId, vibeSiteUrl, vibeSiteJobId, vibeSiteStatus, and vibeSiteDevelopmentUrl.",
    "13. Never overwrite wixBinding with vibe-site data.",
    "14. Keep the main site and any experimental vibe site clearly distinguished in comments and handoffs.",
    "15. Do not complete this task with architecture-only recommendations if no main site is bound yet. The only acceptable non-build outcome is a concrete tooling failure after real creation attempts.",
  ];

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
      body: JSON.stringify(syncHeartbeatConfig({
        name: "AI Team Lead",
        role: "ceo",
        title: "AI Team Lead",
        icon: "brain",
        capabilities:
          "Strategic planning, delegation, AI team oversight, stakeholder communication, business analysis, Wix operations",
        adapterType: DEFAULT_OPENAI_ADAPTER_TYPE,
        adapterConfig: {
          model: DEFAULT_OPENAI_TEAM_LEAD_MODEL,
          heartbeatIntervalSec: 1200,
          dangerouslyBypassApprovalsAndSandbox: true,
          timeoutSec: DEFAULT_AGENT_TIMEOUT_SEC,
          promptTemplate: AI_TEAM_LEAD_PROMPT,
        },
      })),
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

    const kickoffTasks = [...summary.kickoffTasks];
    const siteTaskIndex = kickoffTasks.findIndex((task) =>
      /site|launch|build/i.test(task.title) || /site|launch|build/i.test(task.description),
    );
    const siteExecutionTask = buildSiteExecutionTask(summary);

    if (siteTaskIndex >= 0) {
      kickoffTasks[siteTaskIndex] = siteExecutionTask;
    } else {
      kickoffTasks.unshift(siteExecutionTask);
    }

    const kickoffTasksToCreate = kickoffTasks.slice(0, 4);

    const createdKickoffTasks = await Promise.all(
      kickoffTasksToCreate.map((task) =>
        paperclip<{ id: string; title: string }>(`/companies/${company.id}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            priority: task.title === siteExecutionTask.title ? "critical" : "high",
            assigneeAgentId: ceoAgent.id,
          }),
        }),
      ),
    );

    const siteExecutionIssue = createdKickoffTasks.find((issue) => issue.title === siteExecutionTask.title)
      || createdKickoffTasks[kickoffTasksToCreate.findIndex((task) => task.title === siteExecutionTask.title)];

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
          starterTeam: summary.starterTeam,
          siteProposal: summary.siteProposal,
          firstBuildBrief: summary.firstBuildBrief,
          managementPlan: summary.managementPlan,
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

    const repairResult = await repairCompanyState(updatedCompany.id, { startup: true });
    if (!repairResult.ready) {
      throw new Error(
        repairResult.binding.problems[0] ||
          "Company startup verification failed before the first run.",
      );
    }

    if (siteExecutionIssue) {
      await paperclip(`/issues/${siteExecutionIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: [
            "[System context - not visible to user]",
            "Startup directive: the first run must provision and bind the main Wix site before expanding the specialist team.",
            "Create the main site, verify wixBinding.metaSiteId/siteId/siteUrl, write them back into company description, and only then move to staffing handoff or optional vibe-site work.",
          ].join("\n"),
        }),
      }).catch(() => undefined);
    }

    await paperclip(`/agents/${ceoAgent.id}/heartbeat/invoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => undefined);

    const backendSignature = [
      "no-agent-comment",
      "no-run",
      "no-status",
      "0",
      "no-bridge",
      "no-bridge-update",
      "no-bridge-site-id",
      "no-bridge-dev-url",
      "no-bridge-site-url",
      "no-bridge-error",
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
        workspaceContextType: "companyId",
      },
      bridgeJob: null,
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

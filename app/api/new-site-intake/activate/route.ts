import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AI_TEAM_LEAD_PROMPT } from "@/lib/ai-team-lead-prompt";
import {
  CANONICAL_AGENT_TITLES,
  getCanonicalAgentDefinitionByTitle,
  getPaperclipRoleForAgentTitle,
  renderAgentTemplateShowcase,
} from "@/lib/agent-templates";
import { syncHeartbeatConfig } from "@/lib/agent-heartbeat";
import { buildCompanyDescription } from "@/lib/company-metadata";
import { renderPromptTemplate } from "@/lib/prompt-render";
import {
  DEFAULT_AGENT_TIMEOUT_SEC,
  DEFAULT_OPENAI_ADAPTER_TYPE,
  DEFAULT_OPENAI_SPECIALIST_MODEL,
  DEFAULT_OPENAI_TEAM_LEAD_MODEL,
  DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC,
  buildSpecialistHeartbeatRuntimeConfig,
  buildTeamLeadHeartbeatRuntimeConfig,
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
  selectedTeamTitles?: string[];
}

interface KickoffTask {
  title: string;
  description: string;
}

interface KickoffTaskSpec extends KickoffTask {
  assigneeTitle: string;
  priority: "critical" | "high";
}

interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string;
  status: string;
  adapterType: string;
  adapterConfig?: Record<string, unknown>;
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
  sourceLinks: string[];
  siteSpecifics: string;
  firstBuildBrief: string;
  goals: string[];
  expectedResults: string[];
  kickoffTasks: KickoffTask[];
}

const STARTER_TEAM_LIMIT = 8;

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
  {
    role: "Vibe Site Expert",
    goal: "Own the experimental Picasso site as a parallel creative track for the launch.",
    expectedResult:
      "A separate vibe site with its own metadata that never overwrites the main business site.",
  },
  {
    role: "Content Manager",
    goal: "Extract founder-provided source material and turn it into launch-ready site content.",
    expectedResult:
      "Site-ready copy and assets pulled from real external sources such as websites, Instagram, Flickr, blogs, or galleries.",
  },
  {
    role: "Brand Lead",
    goal: "Translate the founder's taste and story into a strong brand direction the whole team can execute against.",
    expectedResult:
      "A sharper visual and verbal brand system that keeps the main site and the vibe site coherent and distinctive.",
  },
];

const REQUIRED_STARTUP_AGENT_TITLES = [
  "Industry Advisor",
  "Wix Site Expert",
  "Vibe Site Expert",
  "Content Manager",
  "Brand Lead",
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

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+/gi;
const SOCIAL_HANDLE_PATTERN = /\b(instagram|insta|flickr|facebook|tiktok|pinterest|youtube|etsy)\b\s*(?:account|handle|page|profile)?\s*[:\-]\s*@?([A-Za-z0-9._-]{2,})/gi;
const EXPLICIT_HANDLE_PATTERN = /(^|\s)@([A-Za-z0-9._-]{2,})\b/g;
const INVALID_SOCIAL_HANDLES = new Set(["http", "https", "www"]);

function cleanCapturedLink(value: string): string {
  return value.trim().replace(/[),.!?;:]+$/g, "");
}

function extractSourceLinks(messages: IntakeMessage[]): string[] {
  const links = new Set<string>();

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const text = message.text;

    for (const match of text.matchAll(URL_PATTERN)) {
      const cleaned = cleanCapturedLink(match[0]);
      if (cleaned) {
        links.add(cleaned);
      }
    }

    for (const match of text.matchAll(SOCIAL_HANDLE_PATTERN)) {
      const platform = match[1]?.toLowerCase();
      const handle = match[2]?.trim();
      if (!platform || !handle || match[0].includes("://")) {
        continue;
      }

      const normalizedHandle = handle.toLowerCase();
      if (INVALID_SOCIAL_HANDLES.has(normalizedHandle)) {
        continue;
      }

      if (platform === "instagram" || platform === "insta") {
        links.add(`https://www.instagram.com/${handle}`);
      } else {
        links.add(`${platform}: ${handle}`);
      }
    }

    for (const match of text.matchAll(EXPLICIT_HANDLE_PATTERN)) {
      const handle = match[2]?.trim();
      if (handle) {
        links.add(`@${handle}`);
      }
    }
  }

  return Array.from(links).slice(0, 8);
}

function renderSourceLinks(lines: string[]): string[] {
  if (lines.length === 0) {
    return ["No explicit public source links were captured from the founder transcript."];
  }

  return lines.map((line) => `- ${line}`);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, STARTER_TEAM_LIMIT);
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
    .slice(0, STARTER_TEAM_LIMIT);
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
    .slice(0, STARTER_TEAM_LIMIT);
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

  return [...normalizedCoreTeam, ...additionalAgents].slice(0, STARTER_TEAM_LIMIT);
}

const BUSINESS_FIT_STARTER_ROLE_FALLBACKS: Record<string, StarterAgentPlan> = {
  "eCommerce Lead": {
    role: "eCommerce Lead",
    goal: "Turn the founder's collection and offer into a storefront that is easy to shop and easy to buy from.",
    expectedResult:
      "A commerce strategy that improves conversion, prioritizes the right catalog structure, and keeps launch focused on sales.",
  },
  "Catalog & Merchandising Manager": {
    role: "Catalog & Merchandising Manager",
    goal: "Shape the product mix, collections, and merchandising structure so the offer feels curated instead of scattered.",
    expectedResult:
      "A clearer shopping journey with stronger collections, better product framing, and a more convincing first purchase path.",
  },
  "Growth Lead": {
    role: "Growth Lead",
    goal: "Build the first repeatable acquisition and growth priorities around the founder's current traffic sources.",
    expectedResult:
      "A practical plan for audience growth, demand capture, and channel priorities beyond the initial launch push.",
  },
  "Content & SEO Manager": {
    role: "Content & SEO Manager",
    goal: "Turn the business story and source material into discoverable, search-friendly content that compounds over time.",
    expectedResult:
      "A stronger organic footprint with pages and content that support discovery, trust, and conversion.",
  },
  "Bookings Operations Manager": {
    role: "Bookings Operations Manager",
    goal: "Make the service or tour experience easy to understand, book, and operationally deliver.",
    expectedResult:
      "A cleaner bookings flow with clearer offers, fewer scheduling bottlenecks, and stronger operational readiness.",
  },
  "CRM & Lifecycle Manager": {
    role: "CRM & Lifecycle Manager",
    goal: "Set up lifecycle follow-up so leads, guests, or customers do not go cold after first contact.",
    expectedResult:
      "Better lead handling, repeat engagement, and follow-up flows that support growth without manual chasing.",
  },
};

function inferBusinessFitStarterRoles(context: string, existingRoles: Set<string>): StarterAgentPlan[] {
  const normalizedContext = context.toLowerCase();

  let preferredTitles: string[];
  if (/(tour|tours|booking|bookings|reservation|reservations|trip|trips|class|classes|appointment|appointments|service business|consultation)/.test(normalizedContext)) {
    preferredTitles = ["Bookings Operations Manager", "CRM & Lifecycle Manager"];
  } else if (/(shop|store|product|products|collection|collections|inventory|retail|ecommerce|e-commerce|sell|sales|catalog|merchandising|handmade|physical goods)/.test(normalizedContext)) {
    preferredTitles = ["eCommerce Lead", "Catalog & Merchandising Manager"];
  } else {
    preferredTitles = ["Growth Lead", "Content & SEO Manager"];
  }

  return preferredTitles
    .filter((title) => !existingRoles.has(title))
    .map((title) => BUSINESS_FIT_STARTER_ROLE_FALLBACKS[title])
    .filter(Boolean)
    .slice(0, 2);
}

function ensureStarterTeamCoverage(
  starterTeam: StarterAgentPlan[],
  businessDescription: string,
  siteProposal: string,
): StarterAgentPlan[] {
  const normalizedStarterTeam = normalizeStarterTeam(starterTeam);
  const existingRoles = new Set(normalizedStarterTeam.map((entry) => entry.role));
  const inferredBusinessFitRoles = inferBusinessFitStarterRoles(
    `${businessDescription}\n${siteProposal}`,
    existingRoles,
  );
  return normalizeStarterTeam([...normalizedStarterTeam, ...inferredBusinessFitRoles]);
}

function uniqueTitles(titles: string[]): string[] {
  return Array.from(new Set(titles.map((title) => title.trim()).filter(Boolean)));
}

function filterStarterTeamBySelection(
  starterTeam: StarterAgentPlan[],
  selectedTeamTitles: string[],
): StarterAgentPlan[] {
  if (selectedTeamTitles.length === 0) {
    return starterTeam;
  }

  const allowedTitles = new Set(selectedTeamTitles);
  return starterTeam.filter((entry) => entry.role === "AI Team Lead" || allowedTitles.has(entry.role));
}

async function parseJsonWithRepair<T>(raw: string, schemaDescription: string): Promise<T> {
  const direct = tryParseJson<T>(raw);
  if (direct) {
    return direct;
  }

  const repairResponse = await client.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2600,
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
    max_completion_tokens: 2600,
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
- "starterTeam" must always include these exact roles: AI Team Lead, Industry Advisor, Wix Site Expert, Vibe Site Expert, Content Manager, Brand Lead.
- "starterTeam" must also include 1 to 2 additional canonical specialist roles that fit the business type, business model, and current growth needs.
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
  const parsed = await parseJsonWithRepair<Partial<IntakeSummary>>(raw, schemaDescription).catch(
    () => ({} as Partial<IntakeSummary>),
  );

  const companyName = parsed.companyName?.trim() || "New Business";
  const businessDescription =
    parsed.businessDescription?.trim() ||
    "A new business site being created from a founder interview.";
  const siteProposal =
    parsed.siteProposal?.trim() ||
    "Create a credible first version of the site that clearly explains the business, gives the brand a strong first impression, and makes it easy for customers to understand what to do next.";
  const teamHiringPlan =
    parsed.teamHiringPlan?.trim() ||
    "Start with the mandatory core team of AI Team Lead, Industry Advisor, Wix Site Expert, Vibe Site Expert, Content Manager, and Brand Lead, then add 1 to 2 additional canonical specialist roles that match the business model, launch plan, and growth needs.";
  const managementPlan =
    parsed.managementPlan?.trim() ||
    "Set the operating rhythm, prioritize the first growth and site improvements, and keep the founder informed while the business setup moves from concept into execution.";
  const starterTeam = ensureStarterTeamCoverage(
    toStarterTeam(parsed.starterTeam),
    businessDescription,
    siteProposal,
  );
  const siteSpecifics =
    parsed.siteSpecifics?.trim() ||
    "No additional site-specific requirements were captured.";
  const sourceLinks = extractSourceLinks(messages);
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
    sourceLinks,
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
            title: `Create the experimental vibe site for ${companyName}`,
            description: `Create the parallel experimental vibe site.\n\nExecution brief:\n${firstBuildBrief}`,
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
    "Captured source links and accounts:",
    ...renderSourceLinks(summary.sourceLinks),
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
    "Captured source links and accounts:",
    ...renderSourceLinks(summary.sourceLinks),
    "",
    "Execution brief:",
    summary.firstBuildBrief,
    "",
    "Execution rules:",
    "1. This is a build task, not a planning task.",
    "2. This is the production-site track. Create the main business site through the standard Wix/Harmony path, verify the created site identity, and write wixBinding.metaSiteId, wixBinding.siteId, and wixBinding.siteUrl back into company description.",
    "3. If the site-creation call returns an asynchronous jobId, that job becomes the primary creation flow. Poll it to terminal state before deciding whether creation succeeded.",
    "4. If the completed creation job returns a verified siteId, write that value into wixBinding.siteId and wixBinding.metaSiteId immediately, even if a trustworthy public siteUrl is not available yet.",
    "5. Treat siteId and metaSiteId as the same locked business identity unless Wix explicitly returns different verified values.",
    "6. Do not use placeholder URLs such as the generic wix.com host as the canonical siteUrl.",
    "7. If the completed creation job reports `isPublished: false`, an unpublished site state, or a `published-site-urls` lookup returns an empty `urls` array, publish the verified site first through the documented Wix publish endpoint and then repeat the published-site-urls lookup.",
    "8. If create or publish only returns a placeholder host or dashboard URL, do one explicit published-site-urls style lookup on the verified site id before you report siteUrl as unresolved.",
    "9. Use ListWixSites only as a fallback when the completed creation job does not expose the created site identity directly or when you still need to resolve a real siteUrl after binding the site IDs.",
    "10. Do not treat a started build job as success if wixBinding still lacks those verified identity fields.",
    "11. The main business site becomes the canonical company site in wixBinding.",
    "12. Never overwrite wixBinding with vibe-site data.",
    "13. Keep the main site and any experimental vibe site clearly distinguished in comments and handoffs.",
    "14. Do not complete this task with architecture-only recommendations if no main site is bound yet. The only acceptable non-build outcome is a concrete tooling failure after real creation attempts.",
    "15. If the founder provided any public source URL, inspect that exact source directly and use it to place real copy, imagery, or collection content on the main site after binding. Do not stop at empty shell creation.",
    "16. Do not create board tasks asking for basic launch copy, imagery, or starter content while the founder-provided public source links still contain usable material. Only ask for exact missing facts that block a specific Wix mutation such as pricing, policy, or inventory values.",
    "17. After each meaningful publish or placement pass, inspect the live public URL directly. If the page still shows generic starter-template content, unrelated template brand names, fake contact info, or placeholder copy such as 'Use this space to promote the business', the task is still incomplete.",
    "18. Replace the bound site's starter-template identity and placeholder sections with founder-source-derived Sweet Marley content before you mark this task done.",
    "19. Do not mark this task done until the bound main site has a real non-placeholder site URL and the public page no longer reads like a generic Wix starter template, unless a concrete tooling blocker is clearly reported.",
  ];

  return {
    title: `Launch the first site version for ${summary.companyName}`,
    description: lines.join("\n"),
  };
}

function buildVibeSiteExecutionTask(summary: IntakeSummary): KickoffTask {
  const lines = [
    `Create the experimental vibe site for ${summary.companyName} as a separate Picasso track.`,
    "",
    "Approved site proposal:",
    summary.siteProposal,
    "",
    "Captured source links and accounts:",
    ...renderSourceLinks(summary.sourceLinks),
    "",
    "Execution brief:",
    summary.firstBuildBrief,
    "",
    "Execution rules:",
    "1. This is the vibe-site track, not the production-site track.",
    "2. Start the experimental Picasso site in parallel with the main site whenever tooling allows.",
    "3. Use the Picasso-capable builder surface exposed in the runtime and treat returned job or operation ids as asynchronous work that must be polled to terminal state.",
    "4. Record all verified results in vibeSiteId, vibeSiteUrl, vibeSiteJobId, vibeSiteStatus, and vibeSiteDevelopmentUrl.",
    "5. Never write vibe-site data into wixBinding.",
    "6. Use the founder-provided public source links as the content seed for the vibe site too. Adapt the real business material into the experimental direction instead of leaving the vibe site as a generic shell.",
    "7. If the completed vibe-site job reports `isPublished: false`, an unpublished state, or a `published-site-urls` lookup returns an empty `urls` array, publish the verified vibe site first through the documented Wix publish endpoint and then repeat the published-site-urls lookup.",
    "8. If the builder or publish flow only returns a placeholder host or development/editor URL, do one explicit published-site-urls style lookup on the verified vibe-site id before you report vibeSiteUrl as unresolved.",
    "9. Resolve a real non-placeholder vibeSiteUrl when tooling exposes one. If only a development/editor URL is available, record it but keep pushing on public URL resolution or clearly document the blocker.",
    "10. If Picasso creates a site container or returns a verified site id but then stalls in app-spec generation, job polling, or developer-machine startup without producing a real site pass, keep the task active, record the verified ids/status, and report the exact builder stall instead of counting that run as success.",
    "11. After each meaningful publish or placement pass, inspect the public vibe-site URL directly. If it still shows generic starter-template content, unrelated template brand names, fake contact info, or placeholder copy such as 'Use this space to promote the business', the task is still incomplete.",
    "12. Compare the public vibe site directly against the current public main site. If the vibe site still feels like the same storefront shell, same section stack, same headline structure, or same plain commerce presentation, the task is still incomplete even if both URLs are valid.",
    "13. The vibe site must be materially more expressive than the main site in tone, section framing, and overall creative direction while still staying faithful to the real business.",
    "14. Replace the experimental site's starter-template identity and placeholder sections with founder-source-derived Sweet Marley content before you mark this task done.",
    "15. Do not mark this task done until a real vibe site exists with its own different verified site id, real public URL, public-page content that no longer reads like a generic Wix starter template, and a clearly more distinct creative direction than the main site, or a concrete tooling blocker is clearly reported.",
  ];

  return {
    title: `Create the experimental vibe site for ${summary.companyName}`,
    description: lines.join("\n"),
  };
}

async function createStarterTeamAgents(
  companyId: string,
  companyName: string,
  starterTeam: StarterAgentPlan[],
  aiTeamLeadId: string,
) {
  const createdAgents = new Map<string, PaperclipAgent>();
  const failures: Array<{ title: string; reason: string }> = [];

  for (const planEntry of starterTeam) {
    if (planEntry.role === "AI Team Lead") {
      continue;
    }

    const definition = getCanonicalAgentDefinitionByTitle(planEntry.role);
    if (!definition) {
      continue;
    }

    const promptTemplate = [
      renderPromptTemplate(definition.promptTemplate, {
        name: companyName,
        description: "",
      }),
      planEntry.goal ? `\nCurrent startup goal\n- ${planEntry.goal}` : "",
      planEntry.expectedResult ? `\nExpected startup result\n- ${planEntry.expectedResult}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const createdAgent = await paperclip<PaperclipAgent>(`/companies/${companyId}/agents`, {
      method: "POST",
      body: JSON.stringify(syncHeartbeatConfig({
        name: definition.title,
        role: getPaperclipRoleForAgentTitle(definition.title),
        title: definition.title,
        icon: definition.icon,
        capabilities: definition.capabilities.join(", "),
        reportsTo: aiTeamLeadId,
        adapterType: DEFAULT_OPENAI_ADAPTER_TYPE,
        adapterConfig: {
          model: DEFAULT_OPENAI_SPECIALIST_MODEL,
          heartbeatIntervalSec: DEFAULT_SPECIALIST_HEARTBEAT_INTERVAL_SEC,
          dangerouslyBypassApprovalsAndSandbox: true,
          timeoutSec: DEFAULT_AGENT_TIMEOUT_SEC,
          promptTemplate,
        },
        runtimeConfig: buildSpecialistHeartbeatRuntimeConfig(),
      })),
    }).catch((error) => {
      failures.push({
        title: definition.title,
        reason: error instanceof Error ? error.message : "Unknown starter-team creation error",
      });
      return null;
    });

    if (createdAgent) {
      createdAgents.set(definition.title, createdAgent);
    }
  }

  return { createdAgents, failures };
}

function buildManagementTask(summary: IntakeSummary): KickoffTaskSpec {
  return {
    title: `Start managing ${summary.companyName}`,
    description: [
      `Turn the approved proposal into a live operating plan for ${summary.companyName}.`,
      "",
      "Management plan:",
      summary.managementPlan,
      "",
      "Immediate business goals:",
      ...summary.goals.map((goal) => `- ${goal}`),
      "",
      "Expected first-phase results:",
      ...summary.expectedResults.map((result) => `- ${result}`),
    ].join("\n"),
    assigneeTitle: "AI Team Lead",
    priority: "high",
  };
}

function buildIndustryAdvisorTask(summary: IntakeSummary): KickoffTaskSpec {
  return {
    title: `Define market positioning and trust signals for ${summary.companyName}`,
    description: [
      `Establish the category positioning, trust signals, and market framing for ${summary.companyName}.`,
      "",
      "Business summary:",
      summary.businessDescription,
      "",
      "Site proposal context:",
      summary.siteProposal,
      "",
      "Industry-advisor goal:",
      summary.starterTeam.find((entry) => entry.role === "Industry Advisor")?.goal ||
        "Bring field-specific expertise to the launch so the offer feels credible and grounded in real customer expectations.",
    ].join("\n"),
    assigneeTitle: "Industry Advisor",
    priority: "high",
  };
}

function buildContentManagerTask(summary: IntakeSummary): KickoffTaskSpec {
  return {
    title: `Turn external source content into launch-ready site materials for ${summary.companyName}`,
    description: [
      `Collect and adapt the best founder-provided source content for ${summary.companyName} so both the production site and the experimental vibe site can launch with real business materials instead of placeholders.`,
      "",
      "Business summary:",
      summary.businessDescription,
      "",
      "Approved site proposal:",
      summary.siteProposal,
      "",
      "Captured source links and accounts:",
      ...renderSourceLinks(summary.sourceLinks),
      "",
      "Known source-material notes:",
      summary.siteSpecifics || "No structured source list yet. Start by checking the founder transcript and any referenced public sources.",
      "",
      "Execution rules:",
      "1. If the founder has provided a website, Instagram, Flickr, gallery, blog, or other public source, inspect that exact source first and extract the best reusable content before creating any board ask for starter assets.",
      "2. Turn that source material into site-ready copy, bios, FAQs, service descriptions, testimonials, galleries, captions, collection text, and product-supporting content for both the main site and the vibe site.",
      "3. Prefer placing the approved content directly onto the real business site in wixBinding and the separate vibe site when the relevant Wix tools are available. If direct placement is blocked, leave explicit placement-ready packages for both tracks.",
      "4. Coordinate with Wix Site Expert for main-site placement, Vibe Site Expert for vibe-site placement, and Brand Lead on tone when needed.",
      "5. Do not invent product facts or create board tasks for basic copy/image harvesting while the founder-provided public source still has unused material. Only escalate exact missing facts that block a specific mutation.",
      "6. Your handoff is incomplete unless the receiving issue thread contains the actual critical copy, source URLs, and placement instructions. Do not rely on a workspace-local filename as the only artifact.",
      "7. If a source is private, inaccessible, or unclear, report the concrete blocker instead of inventing content.",
    ].join("\n"),
    assigneeTitle: "Content Manager",
    priority: "high",
  };
}

function buildBrandLeadTask(summary: IntakeSummary): KickoffTaskSpec {
  return {
    title: `Define the brand direction for ${summary.companyName}`,
    description: [
      `Turn the founder's taste and story into a clear brand direction for ${summary.companyName}.`,
      "",
      "Business summary:",
      summary.businessDescription,
      "",
      "Approved site proposal:",
      summary.siteProposal,
      "",
      "First-build brief:",
      summary.firstBuildBrief,
      "",
      "Execution rules:",
      "1. Define the core tone, promise, and visual direction the whole team should follow.",
      "2. Make the live site feel distinctive, warm, and credible rather than generic or template-like.",
      "3. Give the Wix Site Expert and Content Manager clear guidance on homepage story, offer framing, and trust-building direction.",
      "4. Coordinate with Vibe Site Expert so the experimental site can push into a more expressive direction without duplicating the production site.",
    ].join("\n"),
    assigneeTitle: "Brand Lead",
    priority: "high",
  };
}

function buildDeterministicKickoffTasks(summary: IntakeSummary): KickoffTaskSpec[] {
  return [
    {
      ...buildSiteExecutionTask(summary),
      assigneeTitle: "Wix Site Expert",
      priority: "critical",
    },
    {
      ...buildVibeSiteExecutionTask(summary),
      assigneeTitle: "Vibe Site Expert",
      priority: "critical",
    },
    buildContentManagerTask(summary),
    buildIndustryAdvisorTask(summary),
    buildBrandLeadTask(summary),
    buildManagementTask(summary),
  ];
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
    const selectedTeamTitles = Array.isArray(body.selectedTeamTitles)
      ? uniqueTitles(
          body.selectedTeamTitles.filter((title): title is string => typeof title === "string"),
        )
      : [];

    if (messages.length === 0) {
      return NextResponse.json({ error: "Conversation transcript is required" }, { status: 400 });
    }

    const summarized = await summarizeTranscript(messages);
    const summary: IntakeSummary = {
      ...summarized,
      starterTeam: filterStarterTeamBySelection(summarized.starterTeam, selectedTeamTitles),
    };
    const approvedAt = new Date().toISOString();

    const company = await paperclip<{
      id: string;
      name: string;
      description: string;
    }>("/companies", {
      method: "POST",
      body: JSON.stringify({
        name: summary.companyName,
        requireBoardApprovalForNewAgents: false,
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
          heartbeatIntervalSec: DEFAULT_TEAM_LEAD_HEARTBEAT_INTERVAL_SEC,
          dangerouslyBypassApprovalsAndSandbox: true,
          timeoutSec: DEFAULT_AGENT_TIMEOUT_SEC,
          promptTemplate: AI_TEAM_LEAD_PROMPT,
        },
        runtimeConfig: buildTeamLeadHeartbeatRuntimeConfig(),
      })),
    });

    const { createdAgents: starterAgents, failures: starterAgentFailures } = await createStarterTeamAgents(
      company.id,
      summary.companyName,
      summary.starterTeam,
      ceoAgent.id,
    );

    const requiredStartupAgentTitles = REQUIRED_STARTUP_AGENT_TITLES.filter((title) =>
      summary.starterTeam.some((entry) => entry.role === title),
    );
    const missingRequiredStartupAgents = requiredStartupAgentTitles.filter(
      (title) => !starterAgents.has(title),
    );

    if (missingRequiredStartupAgents.length > 0) {
      const details = starterAgentFailures
        .filter((failure) => missingRequiredStartupAgents.includes(failure.title))
        .map((failure) => `${failure.title}: ${failure.reason}`)
        .join("; ");

      throw new Error(
        `Failed to create required startup specialists: ${missingRequiredStartupAgents.join(", ")}${details ? ` (${details})` : ""}`,
      );
    }

    const wixSiteExpert = starterAgents.get("Wix Site Expert") || null;
    const vibeSiteExpert = starterAgents.get("Vibe Site Expert") || null;
    const contentManager = starterAgents.get("Content Manager") || null;
    const industryAdvisor = starterAgents.get("Industry Advisor") || null;
    const brandLead = starterAgents.get("Brand Lead") || null;

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

    const kickoffTasksToCreate = buildDeterministicKickoffTasks(summary);
    const siteExecutionTask = kickoffTasksToCreate[0];
    const vibeSiteExecutionTask = kickoffTasksToCreate[1];

    const createdKickoffTasks = await Promise.all(
      kickoffTasksToCreate.map((task) =>
        paperclip<{ id: string; title: string }>(`/companies/${company.id}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            priority: task.priority,
            assigneeAgentId:
              task.assigneeTitle === "Wix Site Expert"
                ? (wixSiteExpert?.id || ceoAgent.id)
                : task.assigneeTitle === "Vibe Site Expert"
                  ? (vibeSiteExpert?.id || ceoAgent.id)
                  : task.assigneeTitle === "Content Manager"
                    ? (contentManager?.id || ceoAgent.id)
                  : task.assigneeTitle === "Industry Advisor"
                    ? (industryAdvisor?.id || ceoAgent.id)
                    : task.assigneeTitle === "Brand Lead"
                      ? (brandLead?.id || ceoAgent.id)
                    : ceoAgent.id,
          }),
        }),
      ),
    );

    const siteExecutionIssue = createdKickoffTasks.find((issue) => issue.title === siteExecutionTask.title) || null;
    const vibeSiteExecutionIssue = createdKickoffTasks.find((issue) => issue.title === vibeSiteExecutionTask.title) || null;

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
          sourceLinks: summary.sourceLinks,
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

    const repairResult = await repairCompanyState(updatedCompany.id, { startup: true }).catch(() => null);
    if (repairResult && !repairResult.ready) {
      console.warn("New-site startup repair completed with warnings:", repairResult);
    }

    await paperclip(`/issues/${boardIssue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: [
          "[System context - not visible to user]",
          "Starter-team activation completed at kickoff.",
          `Created agents: ${Array.from(starterAgents.keys()).join(", ") || "none"}.`,
          starterAgentFailures.length > 0
            ? `Non-blocking starter-team creation failures: ${starterAgentFailures.map((failure) => `${failure.title}: ${failure.reason}`).join("; ")}.`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    }).catch(() => undefined);

    if (siteExecutionIssue) {
      await paperclip(`/issues/${siteExecutionIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: [
            "[System context - not visible to user]",
            "Startup directive: this is the production-site track.",
            "Create and bind the main Wix site first. Verify wixBinding.metaSiteId, wixBinding.siteId, and wixBinding.siteUrl, write them back into company description, and keep wixBinding reserved for the real business site only.",
          ].join("\n"),
        }),
      }).catch(() => undefined);
    }

    if (vibeSiteExecutionIssue) {
      await paperclip(`/issues/${vibeSiteExecutionIssue.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: [
            "[System context - not visible to user]",
            "Startup directive: this is the experimental vibe-site track.",
            "Create the Picasso vibe site in parallel where tooling allows, record all verified results in vibeSiteId, vibeSiteUrl, vibeSiteJobId, vibeSiteStatus, and vibeSiteDevelopmentUrl, and never write vibe-site data into wixBinding.",
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

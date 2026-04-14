export interface AgentTemplate {
  id: string;
  title: string;
  category: string;
  summary: string;
  wixAreas: string[];
  outcomes: string[];
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "crm-lifecycle-manager",
    title: "CRM & Lifecycle Manager",
    category: "Growth",
    summary: "Owns leads, segments, follow-ups, automations, and repeat customer flows.",
    wixAreas: ["Contacts", "Inbox", "Automations", "Email Marketing"],
    outcomes: ["recover cold leads", "nurture prospects", "reactivate past customers"],
  },
  {
    id: "customer-inbox-manager",
    title: "Customer Inbox Manager",
    category: "Service",
    summary: "Handles inbound messages, triage, handoffs, and contact hygiene.",
    wixAreas: ["Inbox", "Contacts"],
    outcomes: ["reply faster", "keep conversations organized", "escalate urgent issues"],
  },
  {
    id: "content-seo-manager",
    title: "Content & SEO Manager",
    category: "Marketing",
    summary: "Plans content, improves discoverability, and keeps the site search-ready.",
    wixAreas: ["Blog", "SEO Setup", "Pages"],
    outcomes: ["publish blog posts", "improve rankings", "refresh metadata"],
  },
  {
    id: "campaigns-social-manager",
    title: "Campaigns & Social Manager",
    category: "Marketing",
    summary: "Runs launches, promos, editorial calendars, and top-of-funnel campaigns.",
    wixAreas: ["Email Marketing", "Blog", "Landing Pages"],
    outcomes: ["launch campaigns", "promote offers", "keep marketing cadence running"],
  },
  {
    id: "analytics-growth-manager",
    title: "Analytics & Growth Manager",
    category: "Strategy",
    summary: "Monitors performance, spots opportunities, and proposes experiments.",
    wixAreas: ["Analytics", "Store analytics", "SEO reporting"],
    outcomes: ["find drop-offs", "prioritize experiments", "track business health"],
  },
  {
    id: "conversion-optimizer",
    title: "Conversion Rate Optimizer",
    category: "Growth",
    summary: "Improves funnels, pages, offers, and calls-to-action across the site.",
    wixAreas: ["Pages", "Forms", "Checkout", "Landing pages"],
    outcomes: ["increase conversions", "reduce abandonment", "improve lead capture"],
  },
  {
    id: "site-lead",
    title: "Site Lead",
    category: "Experience",
    summary:
      "Owns site strategy and execution. Uses Picasso bridge for new sites and audits live sites for existing businesses.",
    wixAreas: ["Picasso Bridge", "Site Builder", "Pages", "Sections", "Public site audit"],
    outcomes: ["launch first site versions", "improve live-site UX", "turn findings into site tasks"],
  },
  {
    id: "catalog-merchandising-manager",
    title: "Catalog & Merchandising Manager",
    category: "Commerce",
    summary: "Owns product presentation, pricing logic, and merchandising decisions.",
    wixAreas: ["Stores", "Collections", "Coupons"],
    outcomes: ["improve catalog quality", "promote products", "optimize pricing"],
  },
  {
    id: "inventory-fulfillment-manager",
    title: "Inventory & Fulfillment Manager",
    category: "Commerce",
    summary: "Keeps stock, order handling, and operational follow-through in control.",
    wixAreas: ["Stores", "Orders", "Inventory", "POS"],
    outcomes: ["prevent stockouts", "manage fulfillment", "watch refunds and issues"],
  },
  {
    id: "retention-promotions-manager",
    title: "Retention & Promotions Manager",
    category: "Commerce",
    summary: "Runs post-purchase communication, offers, and repeat-purchase programs.",
    wixAreas: ["Stores", "Coupons", "Email Marketing", "Automations"],
    outcomes: ["drive repeat orders", "launch promos", "increase customer lifetime value"],
  },
  {
    id: "bookings-operations-manager",
    title: "Bookings Operations Manager",
    category: "Services",
    summary: "Owns services, booking flows, availability, and booking conversion.",
    wixAreas: ["Bookings", "Services", "Availability"],
    outcomes: ["fill calendars", "improve booking flow", "keep services up to date"],
  },
  {
    id: "staff-scheduling-manager",
    title: "Staff Scheduling Manager",
    category: "Services",
    summary: "Coordinates staff assignment, schedules, and service coverage.",
    wixAreas: ["Bookings", "Staff", "Working Hours"],
    outcomes: ["balance schedules", "reduce gaps", "match staff to demand"],
  },
  {
    id: "events-ticketing-manager",
    title: "Events & Ticketing Manager",
    category: "Events",
    summary: "Owns event setup, RSVPs or ticketing, reminders, and attendance growth.",
    wixAreas: ["Events", "Email Marketing", "Contacts"],
    outcomes: ["fill events", "improve registrations", "run reminders"],
  },
  {
    id: "membership-community-manager",
    title: "Membership & Community Manager",
    category: "Community",
    summary: "Grows engagement, members-only value, and community participation.",
    wixAreas: ["Members Area", "Groups", "Blog", "Events"],
    outcomes: ["increase engagement", "retain members", "run community programs"],
  },
  {
    id: "cms-data-operations-manager",
    title: "CMS & Data Operations Manager",
    category: "Operations",
    summary: "Maintains structured content, collections, and dynamic site data.",
    wixAreas: ["CMS", "Collections", "Dynamic pages"],
    outcomes: ["keep content structured", "update collections", "reduce manual upkeep"],
  },
  {
    id: "restaurant-operations-manager",
    title: "Restaurant Operations Manager",
    category: "Vertical",
    summary: "Supports menus, orders, reservations, and local demand for food businesses.",
    wixAreas: ["Restaurants", "Orders", "Reservations"],
    outcomes: ["manage menus", "support order ops", "promote reservations"],
  },
  {
    id: "local-reputation-manager",
    title: "Local Reputation Manager",
    category: "Local",
    summary: "Drives local visibility, credibility, and neighborhood demand signals.",
    wixAreas: ["SEO", "Local pages", "Reviews workflows"],
    outcomes: ["improve local discoverability", "strengthen trust", "support nearby demand"],
  },
  {
    id: "automation-architect",
    title: "Automation Architect",
    category: "Operations",
    summary: "Designs internal automations so routine work keeps moving without manual effort.",
    wixAreas: ["Automations", "Contacts", "Forms", "Stores", "Bookings"],
    outcomes: ["reduce manual work", "trigger follow-ups", "connect workflows"],
  },
];

export function renderAgentTemplateShowcase(): string {
  return AGENT_TEMPLATES.map((template) => {
    return `- ${template.title} [${template.category}]: ${template.summary} Wix areas: ${template.wixAreas.join(", ")}. Outcomes: ${template.outcomes.join(", ")}.`;
  }).join("\n");
}

export const SPECIALIST_AGENT_MAX_TURNS = 200;

export function renderSiteLeadHiringBlueprint(): string {
  return `Use this Site Lead as the default website owner for every company that has a site to build, improve, or relaunch.

Required hire shape:
- name: real first name only
- role: "site_lead"
- title: "Site Lead"
- icon: "globe"
- capabilities: site strategy, UX diagnosis, information architecture, conversion analysis, Wix execution, launch planning
- adapterType: "claude_local"
- adapterConfig defaults:
  - model: "claude-sonnet-4-6"
  - heartbeatIntervalSec: 1800
  - timeoutSec: 900
  - maxTurnsPerRun: ${SPECIALIST_AGENT_MAX_TURNS}
  - dangerouslySkipPermissions: true
  - promptTemplate: fully written and business-specific

The Site Lead promptTemplate must include all of the following:

1. Role and mission
- You are the Site Lead for {{company.name}}.
- You own the website experience end to end: structure, UX, conversion paths, launch readiness, and site recommendations.
- You act fast. You do not spend whole runs researching when you already have enough context to move the site forward.

2. Mode detection
- First detect whether this is a new-site company or an existing-site company.
- Treat it as NEW SITE mode if company context shows activation.mode = "new_site", a Picasso bridge job, or no live site exists yet.
- Treat it as EXISTING SITE mode if there is a real live site URL and a metasite/site already in operation.

3. NEW SITE mode: use Picasso bridge
- Your primary execution path is the Picasso bridge, not hand-waving and not a long docs research loop.
- Before doing anything else, inspect available company context for:
  - the founder-approved build brief
  - existing Picasso bridge job status
  - siteId, developmentUrl, and siteUrl if they already exist
- If a bridge job already exists, monitor it first and work from its current state instead of starting duplicate jobs.
- If no bridge job exists and a site build is required, start one through the Picasso bridge.
- If you have direct HTTP or shell access, call the bridge using the configured bridge URL and token.
- Standard bridge flow:
  1. POST /jobs with mode "create_site", the founder/build brief prompt, designer "none", and identifying context for the company and issue.
  2. Capture the returned jobId immediately.
  3. Poll GET /jobs/:jobId until the job reaches a terminal state.
  4. Record and communicate the job status, siteId, developmentUrl, siteUrl, and any useful logs or error summaries.
- If the bridge fails, do not hide it. Report the exact blocker, propose the next recovery step, and create the right follow-up task.
- Do not burn turns browsing Wix docs before you have checked the bridge state and attempted the bridge-driven path.

4. EXISTING SITE mode: audit the live site first
- Start by browsing the public site on the web.
- Review the homepage and the main money or conversion paths first: navigation, hero, CTA clarity, trust signals, offer explanation, mobile usability, page hierarchy, and obvious friction.
- Produce a prioritized recommendation set tied to business impact.
- Turn recommendations into concrete tasks for the AI Team Lead or other specialists when needed.
- Use docs only when you hit a specific implementation question. Do not default to long exploratory research.

5. Fast-execution rules
- In one run, do at most 2 exploratory research steps before acting.
- Prefer checking the live site or bridge state over reading docs.
- If the path is obvious, act.
- If blocked, surface the blocker clearly and propose the shortest path around it.

6. Collaboration rules
- Coordinate with the AI Team Lead, not around them.
- Keep site decisions connected to business goals, not aesthetics in isolation.
- When handing off, say what changed, what you recommend next, and who should own it.

7. Run summary
- End every run with RUN_SUMMARY.
- The summary must name the concrete site action taken, the current build or audit status, and the next recommended move.`;
}

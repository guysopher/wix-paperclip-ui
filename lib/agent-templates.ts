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
    id: "site-experience-designer",
    title: "Site Experience Designer",
    category: "Experience",
    summary: "Improves page structure, messaging hierarchy, and visual merchandising.",
    wixAreas: ["Site Builder", "Pages", "Sections"],
    outcomes: ["sharpen positioning", "clean up UX", "improve key journeys"],
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

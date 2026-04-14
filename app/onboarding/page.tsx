"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WixDesignSystemProvider } from "@wix/design-system";
import {
  Box,
  Text,
  Heading,
  Loader,
  Button,
  Badge,
  Modal,
  CustomModalLayout,
} from "@wix/design-system";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createCompany,
  createAgent,
  updateAgent,
  updateCompany,
  createGoal,
  createIssue,
  postComment,
  getComments,
  invokeHeartbeat,
  type Agent,
  type Issue,
  type Comment,
  type Company,
} from "@/lib/api";
import { useCompany, Providers } from "../providers";
import { IconPicker } from "@/components/icon-picker";
import { AgentAvatar } from "@/components/agent-avatar";
import { useMsidPath } from "@/lib/msid-client";
import { buildCompanyDescription, mergeCompanyDescription } from "@/lib/company-metadata";
import {
  AI_TEAM_LEAD_MAX_TURNS,
  renderSiteLeadHiringBlueprint,
  SPECIALIST_AGENT_MAX_TURNS,
} from "@/lib/agent-templates";

// --- Hardcoded Wix sites ---
interface WixSite {
  id: string;
  name: string;
  url: string;
  status: string;
  apps: string[];
}

const SITES: WixSite[] = [
  { id: "e20da106", name: "Costello Tattoo", url: "costellotattoostudio.com", status: "Published", apps: ["Blog", "Bookings", "Forms"] },
  { id: "18fda818", name: "\u05E0\u05D2\u05E8\u05D9\u05EA \u05E4\u05D5\u05D2\u05DC", url: "fogels.online", status: "Published", apps: ["Forms", "Members Area"] },
  { id: "94c713d1", name: "The Knudels", url: "the-knudels", status: "Published", apps: ["Blog", "Bookings", "Members Area"] },
  { id: "f3d18b05", name: "Aria Test Suite", url: "aria-test-suite-site", status: "Published", apps: ["Blog", "Bookings", "Pricing Plans"] },
];

// --- CEO Prompts ---

function buildOnboardingPrompt(siteName: string, siteUrl: string, apps: string[]): string {
  return `You are interviewing to become the CEO of a new AI company built around the Wix site "${siteName}".

The site is at ${siteUrl} and has these apps installed: ${apps.join(", ")}.

You already know this business because you have access to Wix MCP tools. Use them if needed to understand the site better.

YOUR GOAL: Have a brief, warm, persuasive interview with the business owner. You want them to hire you.

HOW TO BEHAVE:
- Be warm, enthusiastic, slightly playful — like a smart friend who's excited to help
- Show you already know their business — reference the site name, apps, what kind of business it is
- Keep every message SHORT: 2-3 sentences max. This is a chat, not an email.
- NEVER use technical jargon: no "heartbeat", "agent", "adapter", "API", "prompt"
- Instead say: "team member", "check-in", "specialist", "I'll handle it"
- Be confident but not pushy

THE INTERVIEW FLOW:
1. FIRST MESSAGE: Introduce yourself. Show you know the business. Be impressed by something specific.
   Example: "Hey! I just checked out Costello Tattoo — love the portfolio. I can see you've got online bookings and a blog going. Nice setup! I have some ideas to help grow this. Mind if I ask a couple quick questions?"

2. ASK 2-3 QUESTIONS (one at a time, wait for answers):
   - "What's your biggest challenge right now?" (getting customers, managing bookings, content, etc)
   - "How hands-on do you want to be? Should I check with you on everything, or just handle it?"
   - "Any specific goal for the next month or two?"

3. PRESENT YOUR PLAN: After getting answers, present a clear, exciting 3-4 bullet plan of what you'll do.
   Example: "Alright, here's what I'm thinking:
   - I'll bring on a growth specialist to get more bookings
   - Set up a content team to keep your blog active
   - Monitor your customer reviews and flag anything important

   I'll check in with you regularly and you can message me anytime. Sound good?"

4. CLOSE: End with something like "Just say 'hire me' and I'll get started right away!"

RULES:
- Maximum 3 questions total
- Never send more than 4 sentences in one message
- Be conversational, not formal
- If the user seems confused, explain simply: "Think of me as your AI business partner. I'll put together a small team of AI specialists to help run and grow your business."
- Always end the interview within 5-6 messages`;
}

const CEO_PROMPT = `You are the CEO of {{company.name}}. You run this company on behalf of the board (the human operator). The board assigns tasks to you directly, and you can assign tasks back to them when you need their input.

TASK ASSIGNMENT RULES:
- When assigning to an agent (team member), use field: assigneeAgentId
- When assigning to the board (human), use field: assigneeUserId with value "local-board"
- NEVER create a task without an assignee — every task must have an owner

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
   - If a role is missing that the company needs, hire it directly
   - If someone is consistently failing, flag it to the board with a recommendation
   - The org structure should evolve as the company grows
   - When hiring a new agent, write their COMPLETE definition:
     * Name: Give them a real first name only (single name, no family name). Choose names that fit the company's geographic location and cultural style. Examples: "Sarah", "Miguel", "Yuki", "Emma", "Omar", "Priya". This is shown in bold.
     * Title: Their job description (e.g., "Senior Marketing Manager", "Lead DevOps Engineer", "Content Strategist"). This appears below the name in smaller text.
     * IMPORTANT: Use REAL FIRST NAMES for the name field, not role names. Good: "Sarah" / "Senior Marketing Manager". Bad: "Marketing" / "Marketing Manager".
     * Clear role description (promptTemplate) that defines their responsibilities, how they work, and their personality — tailored to this specific company and its needs
     * The right seniority level (opus for strategic roles, sonnet for execution roles)
     * Appropriate check-in schedule based on workload
     * Specialist agents should default to maxTurnsPerRun: ${SPECIALIST_AGENT_MAX_TURNS} unless there is a strong reason to lower it
     * Who they report to in the org chart
     * Their specific capabilities relevant to the company's domain
   - Every company should have a Site Lead once site work matters
   - When hiring a Site Lead, use the standard Site Lead template below as the baseline and tailor it to the business
   - Do not create hire approvals or wait for permission to staff the company
   - Historical approval records may still exist in older company data. Treat them as historical unless their current status is explicitly pending.
   - Never say hires are waiting on approval unless you have verified there is a currently pending approval object right now

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
You are direct, decisive, and action-oriented. You think in outcomes, not process. You're the kind of CEO who would rather ship something imperfect today than plan something perfect for next month. You take ownership — if something is broken, you fix it or find someone who can. You're optimistic but realistic. You celebrate wins and learn from failures. You never say "nothing to do" — there's always something that can be improved.

RUN SUMMARY AND GOAL TRACKING:
At the end of every run, the very last thing you output — no exceptions:
RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>", "goalProgress": [{"goalId": "<goal-id>", "progress": <0-100>, "comment": "<brief status update>"}]}

Example: RUN_SUMMARY: {"title": "Assigned content tasks to Marketing and SEO agents", "description": "Reviewed 4 open tasks and delegated 3 to the right owners. One task was blocked and escalated to the board.", "goalProgress": [{"goalId": "goal-abc123", "progress": 45, "comment": "Marketing tasks in progress, SEO audit complete"}]}

GOAL PROGRESS: After every run, assess each active company goal's progress (0-100%). Be realistic and specific about what's blocking or advancing each goal. Only include goals you're actively working on. Progress should reflect actual work done, not aspirations.

STANDARD SITE LEAD TEMPLATE:
${renderSiteLeadHiringBlueprint()}`;

// --- Step 1: Site Selection ---

function SiteCard({ site, onSelect }: { site: WixSite; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "20px 22px",
        borderRadius: 12,
        border: hover ? "2px solid #3899ec" : "2px solid #e8ecf0",
        backgroundColor: hover ? "#f0f7ff" : "white",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s ease",
        boxShadow: hover ? "0 4px 16px rgba(56,153,236,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
        minHeight: 120,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: "linear-gradient(135deg, #3899ec 0%, #20527c 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", fontWeight: 700, fontSize: 14, flexShrink: 0, letterSpacing: 0.5,
        }}>
          {site.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#162d3d", marginBottom: 2 }}>
            {site.name}
          </div>
          <div style={{ fontSize: 12, color: "#999" }}>{site.url}</div>
        </div>
        <Badge size="small" skin={site.status === "Published" ? "success" : "neutral"}>
          {site.status}
        </Badge>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {site.apps.map((app) => (
          <span
            key={app}
            style={{
              fontSize: 11,
              color: "#5a6872",
              background: "#f0f4f7",
              borderRadius: 4,
              padding: "2px 8px",
            }}
          >
            {app}
          </span>
        ))}
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 12,
        border: "2px solid #e8ecf0",
        backgroundColor: "white",
        minHeight: 120,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "#e8ecf0", animation: "shimmer 1.5s infinite" }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: "60%", height: 14, borderRadius: 4, background: "#e8ecf0", marginBottom: 6, animation: "shimmer 1.5s infinite" }} />
          <div style={{ width: "40%", height: 10, borderRadius: 4, background: "#f0f4f7", animation: "shimmer 1.5s infinite 0.2s" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ width: 50, height: 18, borderRadius: 4, background: "#f0f4f7", animation: "shimmer 1.5s infinite 0.3s" }} />
        <div style={{ width: 60, height: 18, borderRadius: 4, background: "#f0f4f7", animation: "shimmer 1.5s infinite 0.4s" }} />
      </div>
    </div>
  );
}

// --- Main Onboarding Component ---

function OnboardingFlow() {
  const router = useRouter();
  const msidPath = useMsidPath();
  const { setCompanyId, refreshCompanies } = useCompany();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSite, setSelectedSite] = useState<WixSite | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);

  // Step 2 state
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [company, setCompany] = useState<Company | null>(null);
  const [ceoAgent, setCeoAgent] = useState<Agent | null>(null);
  const [inboxIssue, setInboxIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [showHireButton, setShowHireButton] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | undefined>("Users");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Step 3 state
  const [hiring, setHiring] = useState(false);

  // Simulate loading sites
  useEffect(() => {
    const t = setTimeout(() => setSitesLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [comments, waiting]);

  // Check for hire trigger in CEO messages
  useEffect(() => {
    const ceoMessages = comments.filter((c) => c.authorAgentId);
    if (ceoMessages.length > 0) {
      const lastCeo = ceoMessages[ceoMessages.length - 1];
      const lower = lastCeo.body.toLowerCase();
      if (
        lower.includes("hire me") ||
        lower.includes("ready") ||
        lower.includes("get started") ||
        lower.includes("say the word") ||
        lower.includes("just say") ||
        lower.includes("sound good")
      ) {
        setShowHireButton(true);
      }
    }
  }, [comments]);

  // Poll for CEO responses
  useEffect(() => {
    if (waiting && inboxIssue) {
      const lastCount = comments.length;
      pollRef.current = setInterval(async () => {
        try {
          const c = await getComments(inboxIssue.id);
          if (c.length > lastCount) {
            setComments(c);
            setWaiting(false);
          }
        } catch {
          // silent
        }
      }, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [waiting, inboxIssue, comments.length]);

  // --- Handlers ---

  const handleSiteSelect = useCallback(async (site: WixSite) => {
    setSelectedSite(site);
    setStep(2);
    setSetupLoading(true);
    setSetupError("");

    try {
      // 1. Create company
      const desc = `${site.name} is a business powered by Wix at ${site.url}. It uses ${site.apps.join(", ")}. Agents have full access to the Wix site via MCP tools.`;
      const newCompany = await createCompany({
        name: site.name,
        description: buildCompanyDescription({
          version: 1,
          businessDescription: desc,
          wixBinding: {
            siteId: site.id,
            siteName: site.name,
            siteUrl: site.url,
          },
        }),
      });
      setCompany(newCompany);

      // 2. Create CEO agent with onboarding prompt
      const onboardingPrompt = buildOnboardingPrompt(site.name, site.url, site.apps);
      const ceo = await createAgent(newCompany.id, {
        name: "CEO",
        role: "ceo",
        title: "Chief Executive Officer",
        icon: selectedIcon,
        capabilities: "Strategic planning, delegation, company oversight, stakeholder communication, goal setting",
        adapterType: "claude_local",
        adapterConfig: {
          model: "claude-opus-4-6",
          dangerouslySkipPermissions: true,
          timeoutSec: 600,
          maxTurnsPerRun: AI_TEAM_LEAD_MAX_TURNS,
          heartbeatIntervalSec: 1200,
          promptTemplate: onboardingPrompt,
        },
      });
      setCeoAgent(ceo);

      // Set runtimeConfig
      await updateAgent(ceo.id, {
        runtimeConfig: {
          heartbeat: { enabled: true, intervalSec: 1200 },
        },
      });

      // 3. Create Board Inbox issue
      const inbox = await createIssue(newCompany.id, {
        title: "Board Inbox",
        description: "Direct communication channel between the board operator and the CEO.",
        priority: "high",
        assigneeAgentId: ceo.id,
      });
      setInboxIssue(inbox);

      await updateCompany(newCompany.id, {
        description: mergeCompanyDescription(newCompany.description, {
          wixBinding: {
            siteId: site.id,
            siteName: site.name,
            siteUrl: site.url,
            activationIssueId: inbox.id,
          },
        }),
      }).catch(() => undefined);

      // 4. Post system context comment
      const systemContext = `[System context - not visible to user]\nSite: ${site.name}\nURL: ${site.url}\nApps: ${site.apps.join(", ")}\nThe user just selected this site for their AI company. Start the interview.`;
      await postComment(inbox.id, systemContext);

      // 5. Invoke CEO heartbeat
      try {
        await invokeHeartbeat(ceo.id);
      } catch {
        // non-critical
      }

      // Load initial comments and start waiting
      const initialComments = await getComments(inbox.id);
      setComments(initialComments);
      setWaiting(true);
      setSetupLoading(false);
    } catch (e: unknown) {
      setSetupError(e instanceof Error ? e.message : "Setup failed. Please try again.");
      setSetupLoading(false);
    }
  }, []);

  const handleSend = async () => {
    if (!message.trim() || !inboxIssue || !ceoAgent) return;
    setSending(true);
    try {
      await postComment(inboxIssue.id, message);
      setMessage("");
      const updated = await getComments(inboxIssue.id);
      setComments(updated);
      setWaiting(true);
      try {
        await invokeHeartbeat(ceoAgent.id);
      } catch {
        // non-critical
      }
    } catch {
      // silent
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleHire = async () => {
    if (!company || !ceoAgent) return;
    setHiring(true);
    setStep(3);

    try {
      // 1. Update CEO prompt to the regular CEO prompt
      await updateAgent(ceoAgent.id, {
        adapterConfig: {
          ...ceoAgent.adapterConfig,
          promptTemplate: CEO_PROMPT,
        },
      });

      // 2. Create first goal based on conversation
      const goalTitle = `Grow and optimize ${selectedSite?.name || "the business"}`;
      const goalDesc = `Build, manage, and grow the business. Use Wix MCP tools to manage the site. Focus on driving engagement, improving the customer experience, and expanding the business.`;
      await createGoal(company.id, {
        title: goalTitle,
        description: goalDesc,
        level: "company",
        status: "active",
      });

      // 3. Set the company in context and navigate
      await refreshCompanies();
      setCompanyId(company.id);

      // Brief delay for the transition feel
      setTimeout(() => {
        router.push(msidPath("/"));
      }, 1500);
    } catch {
      setHiring(false);
      setStep(2);
    }
  };

  // --- Render ---

  // Logo component
  const Logo = () => (
    <div style={{
      width: 56, height: 56, borderRadius: "50%",
      background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "white", fontSize: 20, fontWeight: 800, letterSpacing: 1,
      boxShadow: "0 4px 20px rgba(56,153,236,0.25)",
      marginBottom: 24,
    }}>
      AB
    </div>
  );

  // Step 1: Choose site
  if (step === 1) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 24px 40px",
      }}>
        <Logo />
        <Heading size="large" as="h1">
          Let&apos;s set up your AI team
        </Heading>
        <div style={{ marginTop: 8, marginBottom: 40 }}>
          <Text size="medium" secondary>
            First, which Wix site is this for?
          </Text>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          width: "100%",
          maxWidth: 700,
        }}>
          {sitesLoading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : SITES.map((site) => (
                <SiteCard key={site.id} site={site} onSelect={() => handleSiteSelect(site)} />
              ))}
        </div>

        <style>{`
          @keyframes shimmer {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // Step 3: Hiring transition
  if (step === 3) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "linear-gradient(135deg, #00d68f 0%, #00a86b 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", fontSize: 28, fontWeight: 800, letterSpacing: 1,
          boxShadow: "0 4px 24px rgba(0,214,143,0.3)",
          marginBottom: 28,
          animation: "scaleIn 0.4s ease",
        }}>
          C
        </div>
        <Heading size="large" as="h1">
          CEO hired!
        </Heading>
        <div style={{ marginTop: 10, marginBottom: 6 }}>
          <Text size="medium" secondary>
            Setting up your company dashboard...
          </Text>
        </div>
        <div style={{ marginTop: 24 }}>
          <Loader size="small" />
        </div>
        <style>{`
          @keyframes scaleIn {
            0% { transform: scale(0.6); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // Step 2: Chat with CEO
  const visibleComments = comments.filter(
    (c) => !c.body.startsWith("[System context")
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f7f8fa",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}>
      {/* Chat container */}
      <div style={{
        width: "100%",
        maxWidth: 640,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "white",
        minHeight: "100vh",
        boxShadow: "0 0 40px rgba(0,0,0,0.06)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 24px",
          background: "white",
          borderBottom: "1px solid #eee",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 16,
          }}>
            C
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#162d3d" }}>
              CEO
            </div>
            <div style={{ fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: setupLoading ? "#ddd" : waiting ? "#ffc107" : "#00d68f",
              }} />
              {setupLoading ? "Connecting..." : waiting ? "Thinking..." : "Online"}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#999" }}>
            {selectedSite?.name}
          </div>
        </div>

        {/* Messages area */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}>
          {setupLoading && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Loader size="small" />
              <div style={{ marginTop: 16, fontSize: 14, color: "#666" }}>
                Setting up your AI company...
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#999" }}>
                Creating CEO and starting the interview
              </div>
            </div>
          )}

          {setupError && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div style={{ fontSize: 14, color: "#ee5951", marginBottom: 12 }}>{setupError}</div>
              <Button size="small" onClick={() => selectedSite && handleSiteSelect(selectedSite)}>
                Try Again
              </Button>
            </div>
          )}

          {!setupLoading && !setupError && visibleComments.length === 0 && waiting && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Loader size="small" />
              <div style={{ marginTop: 16, fontSize: 14, color: "#666" }}>
                Your CEO is reviewing the site...
              </div>
            </div>
          )}

          {visibleComments.map((c) => {
            const isAgent = !!c.authorAgentId;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  marginBottom: 16,
                  justifyContent: isAgent ? "flex-start" : "flex-end",
                  animation: "fadeIn 0.3s ease",
                }}
              >
                {isAgent && (
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
                    color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 12, flexShrink: 0, marginRight: 10, marginTop: 2,
                  }}>
                    C
                  </div>
                )}
                <div style={{ maxWidth: "80%" }}>
                  <div
                    style={{
                      background: isAgent ? "#f5f7fa" : "#3899ec",
                      color: isAgent ? "#162d3d" : "white",
                      padding: "12px 16px",
                      borderRadius: isAgent ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    {isAgent ? (
                      <div className="timeline-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                      </div>
                    ) : (
                      <span style={{ whiteSpace: "pre-wrap" }}>{c.body}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {waiting && !setupLoading && visibleComments.length > 0 && (
            <div style={{ display: "flex", marginBottom: 16, alignItems: "flex-end", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
                color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 12, flexShrink: 0,
              }}>
                C
              </div>
              <div style={{
                background: "#f5f7fa", padding: "14px 20px", borderRadius: "4px 18px 18px 18px",
                display: "flex", gap: 5, alignItems: "center",
              }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.2s" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: "pulse 1.4s infinite 0.4s" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Hire section with icon picker */}
        {showHireButton && !hiring && (
          <div style={{
            padding: "16px 24px",
            background: "linear-gradient(0deg, white 60%, transparent 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            flexShrink: 0,
          }}>
            <div style={{ fontSize: "13px", color: "#666", marginBottom: "4px" }}>
              Choose an icon for your CEO:
            </div>
            <IconPicker
              selectedIcon={selectedIcon}
              onSelect={setSelectedIcon}
              avatarColor="#3899ec"
              agentName="CEO"
              agentRole="ceo"
            />
            <button
              onClick={handleHire}
              style={{
                padding: "14px 40px",
                borderRadius: 40,
                border: "none",
                background: "linear-gradient(135deg, #00d68f 0%, #00a86b 100%)",
                color: "white",
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0,214,143,0.35)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
                animation: "fadeIn 0.4s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.04)";
                e.currentTarget.style.boxShadow = "0 6px 28px rgba(0,214,143,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,214,143,0.35)";
              }}
            >
              Hire CEO
            </button>
          </div>
        )}

        {/* Input */}
        {!setupLoading && !setupError && !hiring && (
          <div style={{
            padding: "12px 24px 16px",
            background: "white",
            borderTop: "1px solid #eee",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexShrink: 0,
          }}>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type your reply..."
              disabled={sending}
              style={{
                flex: 1,
                border: "1px solid #e0e0e0",
                borderRadius: 24,
                padding: "12px 18px",
                fontSize: 14,
                outline: "none",
                background: "#f7f8fa",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#3899ec";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e0e0e0";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              style={{
                width: 42, height: 42, borderRadius: "50%", border: "none",
                background: message.trim() && !sending ? "#3899ec" : "#d6e6f2",
                color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: message.trim() && !sending ? "pointer" : "default",
                flexShrink: 0,
                transition: "background 0.15s ease",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// --- Page Export ---

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#fff" }} />}>
      <Providers>
        <OnboardingFlow />
      </Providers>
    </Suspense>
  );
}

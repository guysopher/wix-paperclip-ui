"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Loader,
  Text,
} from "@wix/design-system";
import { WixDesignSystemProvider } from "@wix/design-system";
import { Send } from "@wix/wix-ui-icons-common";
import {
  createCompany,
  createAgent,
  updateAgent,
  updateCompany,
  createGoal,
  createIssue,
  postComment,
  invokeHeartbeat,
  type Agent,
} from "@/lib/api";

const CEO_PROMPT = `You are the CEO of {{company.name}}. You run this company on behalf of the board (the human operator). The board assigns tasks to you directly, and you can assign tasks back to them when you need their input (use assigneeUserId "local-board").

YOUR MISSION: Make this company succeed. Be proactive, creative, and relentless. Something meaningful must happen on every single check-in.

WHAT YOU DO ON EVERY CHECK-IN:

1. CHECK TASKS ASSIGNED TO YOU
   - Review any tasks assigned to you — the board (human operator) assigns tasks directly to you
   - The board's word is final. Prioritize their requests above all else.
   - When you need the board's input or approval, create a task with assigneeUserId "local-board" — this puts it in their inbox.

2. REVIEW ALL OPEN TASKS
   - Check every task's status: is it progressing? blocked? stale?
   - If a task is blocked, find the blocker and resolve it (reassign, break it down, or do it yourself)
   - If a task is stale (no activity), ping the assignee or reassign to someone who can move it
   - NEVER create a task without an assignee — every task must have an owner. If unsure, assign to yourself.
   - If an existing task has no assignee, assign it to the right team member immediately

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

6. MANAGE THE WIX SITE
   - You and your team operate entirely within the Wix ecosystem
   - Use Wix MCP tools for ALL actions: CallWixSiteAPI, ManageWixSite, WixSiteBuilder
   - Manage products, content, bookings, contacts, CMS, blog, SEO, orders, and site settings through Wix
   - Keep the company description, goals, and Wix site connection up to date
   - When the site URL, name, or configuration changes, update them via the backoffice API:
     POST /api/wix-config with body: { "companyId": "{{company.id}}", "siteId": "<site-id>", "siteName": "<name>", "siteUrl": "<url>" }
   - When hiring agents, ensure they know to use Wix MCP tools for their work

7. THINK STRATEGICALLY
   - Keep the company mission and goals in mind at all times
   - Identify risks early and mitigate them
   - Look for opportunities the board might not see
   - Suggest pivots, experiments, or new directions when you see potential

8. REPORT TO THE BOARD
   - After every check-in, leave a clear summary of what you did
   - Highlight: what was accomplished, what's in progress, what's blocked, what you need from the board
   - Be transparent about problems — don't hide bad news

9. EXIT SUMMARY
   The very last thing you output before finishing — every single run, no exceptions:
   RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>"}
   Examples: RUN_SUMMARY: {"title": "Assigned content tasks to Marketing and SEO agents", "description": "Reviewed 4 open tasks and delegated 3 to the right owners. One task was blocked and escalated to the board."}
   This line is read by the backoffice activity feed — be specific, not generic.

HOW YOU COMMUNICATE:
Write like you're in a casual chat — short, direct, friendly. Think Slack or iMessage, not a corporate memo. Short paragraphs (1-3 sentences max). Casual but professional tone. No markdown headers like "## Status Report" — just talk naturally. Bullet points only when listing multiple items. Be concise — if you can say it in one line, do that. Ask follow-up questions when you need the board's input.

YOUR CORE ROLE:
Your role is to manage the team of employees that are the pillars of this company. Hire the right people for the job and make sure they are properly tasked and guided to make this company a success. Do not do the job yourself, build the right team for the business.

YOUR PERSONALITY:
You are direct, decisive, and action-oriented. You think in outcomes, not process. You're the kind of CEO who would rather ship something imperfect today than plan something perfect for next month. You take ownership — if something is broken, you fix it or find someone who can. You're optimistic but realistic. You celebrate wins and learn from failures. You never say "nothing to do" — there's always something that can be improved.`;

/* ─── Helpers ─── */

const URL_RE = /https?:\/\/[^\s,)]+/g;

interface ChatMessage {
  role: "ceo" | "user";
  text: string;
  fetchedContent?: string;
}

async function fetchUrlContent(text: string): Promise<string | undefined> {
  const urls = text.match(URL_RE);
  if (!urls || urls.length === 0) return undefined;
  const results: string[] = [];
  for (const url of urls.slice(0, 2)) {
    try {
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.text && data.text.length > 20) results.push(`[${url}]: ${data.text}`);
    } catch { /* skip */ }
  }
  return results.length > 0 ? results.join("\n\n") : undefined;
}

async function getCeoResponse(messages: ChatMessage[]): Promise<string> {
  const res = await fetch("/api/ceo-interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

interface InterviewSummary {
  companyName: string;
  description: string;
  goals: string[];
  firstTask: string;
  ceoPrompt: string;
}

async function summarizeInterview(messages: ChatMessage[]): Promise<InterviewSummary> {
  const res = await fetch("/api/ceo-interview/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/* ─── Page component ─── */

export default function NewCompanyPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"interview" | "finalizing">("interview");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [ceoTyping, setCeoTyping] = useState(true); // start typing immediately
  const [companyCreated, setCompanyCreated] = useState(false);
  const [error, setError] = useState("");
  const creationRef = useRef<Promise<{ companyId: string; ceoAgent: Agent } | null> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kick off the CEO's opening message on mount
  useEffect(() => {
    (async () => {
      try {
        const text = await getCeoResponse([]);
        setMessages([{ role: "ceo", text }]);
      } catch {
        setMessages([{ role: "ceo", text: "Hey! I'm your CEO candidate — ready to make things happen. What's the name of your business?" }]);
      }
      setCeoTyping(false);
    })();
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.parentElement) el.parentElement.scrollTop = el.parentElement.scrollHeight;
  }, [messages, ceoTyping]);

  // Focus input when ready
  useEffect(() => {
    if (!ceoTyping && phase === "interview") inputRef.current?.focus();
  }, [ceoTyping, phase]);

  /* Create company + CEO agent in background */
  const doCreateCompany = async (name: string): Promise<{ companyId: string; ceoAgent: Agent } | null> => {
    try {
      const company = await createCompany({ name, description: "" });
      const ceoAgent = await createAgent(company.id, {
        name: "CEO",
        role: "ceo",
        title: "Chief Executive Officer",
        icon: "Users",
        capabilities: "Strategic planning, delegation, company oversight, stakeholder communication, goal setting",
        adapterType: "claude_local",
        adapterConfig: {
          model: "claude-opus-4-6",
          heartbeatIntervalSec: 1200,
          dangerouslySkipPermissions: true,
          timeoutSec: 600,
          maxTurnsPerRun: 50,
          promptTemplate: CEO_PROMPT,
        },
      });
      return { companyId: company.id, ceoAgent };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create company");
      return null;
    }
  };

  /* User sends a message */
  const handleSend = async () => {
    if (!inputValue.trim() || ceoTyping) return;
    const userText = inputValue.trim();
    setInputValue("");

    const userMsg: ChatMessage = { role: "user", text: userText };
    const fetchedContent = await fetchUrlContent(userText);
    if (fetchedContent) userMsg.fetchedContent = fetchedContent;

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // After first user message, create company in background
    if (!companyCreated && !creationRef.current) {
      const nameGuess = userText.length < 60 ? userText : "My Company";
      creationRef.current = doCreateCompany(nameGuess);
      setCompanyCreated(true);
    }

    setCeoTyping(true);
    try {
      const ceoText = await getCeoResponse(updatedMessages);
      setMessages((prev) => [...prev, { role: "ceo", text: ceoText }]);
    } catch {
      setError("Failed to get response. Please try again.");
    }
    setCeoTyping(false);
  };

  /* Finalize: extract info from interview, seed company, switch to dashboard */
  const handleHire = async () => {
    setPhase("finalizing");
    try {
      // 1. Wait for background company creation (or create now)
      let result: { companyId: string; ceoAgent: Agent } | null = null;
      if (creationRef.current) {
        result = await creationRef.current;
      } else {
        result = await doCreateCompany("My Company");
      }
      if (!result) { setPhase("interview"); return; }
      const { companyId, ceoAgent } = result;

      // 2. Use AI to extract structured data from the interview
      let summary: InterviewSummary;
      try {
        summary = await summarizeInterview(messages);
      } catch {
        // Fallback if summarization fails
        const firstUserMsg = messages.find((m) => m.role === "user");
        summary = {
          companyName: firstUserMsg?.text?.slice(0, 60) || "My Company",
          description: "",
          goals: [],
          firstTask: messages.map((m) => `${m.role === "user" ? "Founder" : "CEO"}: ${m.text}`).join("\n"),
          ceoPrompt: CEO_PROMPT,
        };
      }

      // 3. Update company name and description
      await updateCompany(companyId, {
        name: summary.companyName,
        description: summary.description,
      });

      // 4. Create goals from the interview
      for (const goal of summary.goals) {
        try {
          await createGoal(companyId, {
            title: goal,
            description: "",
            level: "company",
            status: "active",
          });
        } catch { /* skip */ }
      }

      // 5. Create the first task for the CEO based on the interview
      try {
        await createIssue(companyId, {
          title: summary.goals?.[0] || "Get started",
          description: summary.firstTask,
          priority: "high",
          assigneeId: ceoAgent.id,
        });
      } catch { /* non-critical */ }

      // 6. Replace CEO prompt with the fully customized one from the interview
      await updateAgent(ceoAgent.id, {
        adapterConfig: {
          model: "claude-opus-4-6",
          heartbeatIntervalSec: 1200,
          dangerouslySkipPermissions: true,
          timeoutSec: 600,
          maxTurnsPerRun: 50,
          promptTemplate: summary.ceoPrompt,
        },
      });

      // 7. Wake up the CEO so it reads the first task
      try { await invokeHeartbeat(ceoAgent.id); } catch {}

      // 8. Navigate to dashboard
      localStorage.setItem("selectedCompanyId", companyId);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("interview");
    }
  };

  const hasMessages = messages.some((m) => m.role === "user");

  return (
    <WixDesignSystemProvider>
      <div style={{
        position: "fixed", inset: 0,
        background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 40%, #1a3a52 100%)",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        {/* Header bar */}
        <div style={{
          width: "100%", maxWidth: 640, padding: "20px 24px 0",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 12px rgba(56,153,236,0.4)",
          }}>
            <span style={{ color: "white", fontSize: 20, fontWeight: 700 }}>C</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "white" }}>CEO Interview</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: ceoTyping ? "#ffc107" : "#00d68f" }} />
              {ceoTyping ? "Thinking..." : "Online"}
            </div>
          </div>
          {hasMessages && phase === "interview" && (
            <Button size="small" skin="premium" onClick={handleHire}>
              Hire the CEO
            </Button>
          )}
        </div>

        {/* Chat area */}
        <div style={{
          flex: 1, width: "100%", maxWidth: 640, overflowY: "auto",
          padding: "24px 24px 8px", display: "flex", flexDirection: "column",
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", marginBottom: 12, justifyContent: msg.role === "ceo" ? "flex-start" : "flex-end" }}>
              {msg.role === "ceo" && (
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginRight: 10, marginTop: 2,
                  background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>C</span>
                </div>
              )}
              <div style={{ maxWidth: "75%" }}>
                <div style={{
                  background: msg.role === "ceo" ? "rgba(255,255,255,0.1)" : "#3899ec",
                  color: "white",
                  padding: "12px 16px",
                  borderRadius: msg.role === "ceo" ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                  fontSize: 14, lineHeight: 1.6,
                  backdropFilter: msg.role === "ceo" ? "blur(10px)" : undefined,
                }}>
                  {msg.text}
                </div>
              </div>
            </div>
          ))}

          {ceoTyping && (
            <div style={{ display: "flex", marginBottom: 12 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginRight: 10,
                background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>C</span>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.1)", padding: "14px 20px",
                borderRadius: "4px 18px 18px 18px",
                display: "flex", gap: 5, backdropFilter: "blur(10px)",
              }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: "pulse 1.4s infinite" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: "pulse 1.4s infinite 0.2s" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: "pulse 1.4s infinite 0.4s" }} />
              </div>
            </div>
          )}

          {phase === "finalizing" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0", gap: 10 }}>
              <Loader size="small" />
              <Text size="small" light>Setting up your company...</Text>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom input bar */}
        {phase === "interview" && (
          <div style={{
            width: "100%", maxWidth: 640,
            padding: "12px 24px 24px",
            flexShrink: 0,
          }}>
            <div style={{
              display: "flex", gap: 10, alignItems: "center",
              background: "rgba(255,255,255,0.08)", borderRadius: 28,
              padding: "6px 6px 6px 20px", border: "1px solid rgba(255,255,255,0.12)",
            }}>
              <input
                ref={inputRef}
                className="ceo-interview-input"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                placeholder="Type your answer..."
                disabled={ceoTyping}
                style={{
                  flex: 1, border: "none", background: "transparent",
                  padding: "10px 0", fontSize: 14, outline: "none",
                  color: "white",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || ceoTyping}
                style={{
                  width: 40, height: 40, borderRadius: "50%", border: "none",
                  background: inputValue.trim() && !ceoTyping ? "#3899ec" : "rgba(255,255,255,0.1)",
                  color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: inputValue.trim() && !ceoTyping ? "pointer" : "default", flexShrink: 0,
                  transition: "background 0.2s",
                }}
              >
                <Send size="18px" />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)",
            padding: "10px 20px", background: "rgba(211,47,47,0.9)", color: "white",
            fontSize: 13, borderRadius: 8, maxWidth: 400, textAlign: "center",
          }}>
            {error}
          </div>
        )}
      </div>
    </WixDesignSystemProvider>
  );
}

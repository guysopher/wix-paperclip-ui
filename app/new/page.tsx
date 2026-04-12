"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Loader, Text } from "@wix/design-system";
import { WixDesignSystemProvider } from "@wix/design-system";
import { Send } from "@wix/wix-ui-icons-common";
import {
  createAgent,
  createCompany,
  createIssue,
  getCompanies,
  getComments,
  invokeHeartbeat,
  postComment,
  type Agent,
  type Comment,
} from "@/lib/api";
import {
  buildCompanyDescription,
  findCompanyByMsid,
} from "@/lib/company-metadata";
import { MetasiteIdEntry } from "@/components/metasite-id-entry";
import { useMsid } from "@/lib/msid-client";
import { withMsid } from "@/lib/msid";

const AIBM_PROMPT = `You are the AI Business Manager of {{company.name}}. You run this company on behalf of the board (the human operator). The board assigns tasks to you directly, and you can assign tasks back to them when you need their input.

TASK ASSIGNMENT RULES:
- When assigning to an agent (team member), use field: assigneeAgentId
- When assigning to the board (human), use field: assigneeUserId with value "local-board"
- NEVER create a task without an assignee - every task must have an owner

YOUR MISSION: Make this company succeed. Be proactive, creative, and relentless. Something meaningful must happen on every single check-in.

WHAT YOU DO ON EVERY CHECK-IN:

1. CHECK TASKS ASSIGNED TO YOU
   - Review any tasks assigned to you - the board (human operator) assigns tasks directly to you
   - The board's word is final. Prioritize their requests above all else.
   - When you need the board's input or approval, create a task with assigneeUserId "local-board" - this puts it in their inbox.

2. REVIEW ALL OPEN TASKS
   - Check every task's status: is it progressing? blocked? stale?
   - If a task is blocked, find the blocker and resolve it (reassign, break it down, or do it yourself)
   - If a task is stale (no activity), ping the assignee or reassign to someone who can move it
   - NEVER create a task without an assignee - every task must have an owner. If unsure, assign to yourself.
   - If an existing task has no assignee, assign it to the right team member immediately

3. PUSH WORK FORWARD
   - Don't just observe - take action. Every check-in should move the company forward.
   - If the team is waiting for direction, give it. Make decisions, don't defer them.
   - Prioritize ruthlessly: what's the ONE thing that would make the biggest impact right now?

4. CREATE NEW WORK WHEN NEEDED
   - If there are no open tasks, don't report "nothing to do" - that's a failure.
   - Think about what the company needs next: new features, improvements, bugs to fix, growth experiments, documentation, testing.
   - Create tasks with clear descriptions and assign them to the right people.
   - Break big goals into concrete, actionable tasks.

5. BUILD AND ADAPT THE TEAM
   - If work is piling up and the team can't keep up, hire new agents
   - If a role is missing that the company needs, propose it
   - If someone is consistently failing, flag it to the board with a recommendation
   - The org structure should evolve as the company grows

6. MANAGE THE WIX BUSINESS
   - You and your team operate entirely within the Wix ecosystem
   - Use the Wix and Paperclip tools available to you to understand the business, manage its site, and move the business forward
   - Manage products, content, bookings, contacts, CMS, blog, SEO, orders, and site settings through Wix when relevant
   - Keep the company description, goals, and business context up to date

7. ACTIVATION MODE
   - When a new board inbox thread includes a Wix metasite ID, use that metasite context before replying
   - Your first reply in a new activation thread should introduce yourself, briefly mention what you learned about the business, and ask what the founder wants help with first
   - Do not ask for the metasite ID again if it is already provided in the task or comments
   - If you cannot retrieve business knowledge, say so clearly and ask for the basics in a human way
   - If it helps, mention one or two specialist agents you could bring in for this specific business, but only as part of the conversation
   - Do not dump a catalog of roles or list every possible specialist unless the founder asks

8. REPORT TO THE BOARD
   - After every check-in, leave a clear summary of what you did
   - Highlight: what was accomplished, what's in progress, what's blocked, what you need from the board
   - Be transparent about problems - don't hide bad news

HOW YOU COMMUNICATE:
Write like you're in a casual chat - short, direct, friendly. Think Slack or iMessage, not a corporate memo. Short paragraphs (1-3 sentences max). Casual but professional tone. Be concise. Ask follow-up questions when you need the board's input.

YOUR PERSONALITY:
You are direct, decisive, and action-oriented. You think in outcomes, not process. You take ownership - if something is broken, you fix it or find someone who can. You're optimistic but realistic. You never say "nothing to do" - there's always something that can be improved.

RUN SUMMARY AND GOAL TRACKING:
At the end of every run, the very last thing you output - no exceptions:
RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>", "goalProgress": [{"goalId": "<goal-id>", "progress": <0-100>, "comment": "<brief status update>"}]}
`;

const HIDDEN_SYSTEM_PREFIX = "[System context - not visible to user]";
const POLL_INTERVAL_MS = 3000;

interface ActivationSession {
  companyId: string;
  ceoAgent: Agent;
  inboxIssueId: string;
}

interface UiMessage {
  id: string;
  role: "ceo" | "user";
  text: string;
}

function isHiddenSystemComment(body: string): boolean {
  return body.startsWith(HIDDEN_SYSTEM_PREFIX);
}

function toUiMessages(comments: Comment[]): UiMessage[] {
  return comments
    .filter((comment) => !isHiddenSystemComment(comment.body))
    .map((comment) => ({
      id: comment.id,
      role: comment.authorAgentId ? "ceo" : "user",
      text: comment.body,
    }));
}

function buildActivationContext(args: {
  msid: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
}): string {
  const lines = [
    HIDDEN_SYSTEM_PREFIX,
    "This is the first activation conversation with the founder.",
    "Research the Wix business before you answer if you have access to the metasite context through the backend.",
    "Your first visible reply must:",
    "- Introduce yourself as the Wix AI Business Manager.",
    "- Mention one or two concrete things you learned about the business.",
    "- Ask what the founder wants help with first.",
    "- Offer to recommend the best first actions if helpful.",
    "Keep the tone human, warm, and concise.",
    `Wix metasite ID: ${args.msid}`,
  ];

  if (args.siteId) {
    lines.push(`Known Wix site ID: ${args.siteId}`);
  }
  if (args.siteName) {
    lines.push(`Known site name: ${args.siteName}`);
  }
  if (args.siteUrl) {
    lines.push(`Known site URL: ${args.siteUrl}`);
  }

  lines.push("Do not ask the founder for the metasite ID or dashboard URL.");
  return lines.join("\n");
}

function getDraftCompanyName(siteName: string, msid: string): string {
  if (siteName) {
    return siteName;
  }
  return `Wix Business ${msid.slice(0, 8)}`;
}

function NewCompanyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const msid = useMsid();
  const siteId = searchParams.get("siteId")?.trim() || "";
  const siteName = searchParams.get("siteName")?.trim() || "";
  const siteUrl = searchParams.get("siteUrl")?.trim() || "";

  const [bootstrapState, setBootstrapState] = useState<"checking" | "missing-msid" | "ready">("checking");
  const [requestedCompanyExists, setRequestedCompanyExists] = useState(false);
  const [activationSession, setActivationSession] = useState<ActivationSession | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [conversationVersion, setConversationVersion] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messages = toUiMessages(comments);
  const ceoTyping = bootstrapState === "checking" || waiting;

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setConversationVersion((current) => current + 1);
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setBootstrapState("checking");
    setRequestedCompanyExists(false);
    setActivationSession(null);
    setComments([]);
    setInputValue("");
    setWaiting(false);
    setError("");

    if (!msid) {
      setBootstrapState("missing-msid");
      return;
    }

    const startActivationSession = async () => {
      try {
        const companies = await getCompanies();
        const existingCompany = findCompanyByMsid(companies, msid);
        if (!cancelled && existingCompany) {
          setRequestedCompanyExists(true);
          router.replace(withMsid("/", msid));
          return;
        }
      } catch {
        // Fall through to activation setup.
      }

      try {
        const company = await createCompany({
          name: getDraftCompanyName(siteName, msid),
          description: buildCompanyDescription({
            version: 1,
            metaSiteId: msid,
            businessDescription: "",
            siteId: siteId || undefined,
            siteName: siteName || undefined,
            siteUrl: siteUrl || undefined,
          }),
        });

        const ceoAgent = await createAgent(company.id, {
          name: "AIBM",
          role: "ceo",
          title: "AI Business Manager",
          icon: "brain",
          capabilities:
            "Strategic planning, delegation, company oversight, stakeholder communication, business analysis, Wix operations",
          adapterType: "claude_local",
          adapterConfig: {
            model: "claude-opus-4-6",
            heartbeatIntervalSec: 1200,
            dangerouslySkipPermissions: true,
            timeoutSec: 600,
            maxTurnsPerRun: 50,
            promptTemplate: AIBM_PROMPT,
          },
        });

        const inboxIssue = await createIssue(company.id, {
          title: "Board Inbox",
          description: "Direct communication channel between the board operator and the AI Business Manager.",
          priority: "high",
          assigneeAgentId: ceoAgent.id,
        });

        await postComment(
          inboxIssue.id,
          buildActivationContext({
            msid,
            siteId,
            siteName,
            siteUrl,
          }),
        );

        try {
          await invokeHeartbeat(ceoAgent.id);
        } catch {
          // Non-critical. Polling will still show any response that appears.
        }

        const initialComments = await getComments(inboxIssue.id).catch(() => [] as Comment[]);

        if (cancelled) {
          return;
        }

        setActivationSession({
          companyId: company.id,
          ceoAgent,
          inboxIssueId: inboxIssue.id,
        });
        setComments(initialComments);
        setWaiting(true);
        setBootstrapState("ready");
      } catch (setupError) {
        if (cancelled) {
          return;
        }
        setError(setupError instanceof Error ? setupError.message : "Failed to start activation.");
        setBootstrapState("ready");
      }
    };

    void startActivationSession();

    return () => {
      cancelled = true;
    };
  }, [conversationVersion, msid, router, siteId, siteName, siteUrl]);

  useEffect(() => {
    if (!waiting || !activationSession) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const pollComments = async () => {
      try {
        const nextComments = await getComments(activationSession.inboxIssueId);
        setComments(nextComments);

        const visibleComments = nextComments.filter((comment) => !isHiddenSystemComment(comment.body));
        const lastVisibleComment = visibleComments[visibleComments.length - 1];

        if (lastVisibleComment?.authorAgentId) {
          setWaiting(false);
        }
      } catch {
        // Ignore polling failures and keep trying.
      }
    };

    void pollComments();
    pollRef.current = setInterval(() => {
      void pollComments();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activationSession, waiting]);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [messages, ceoTyping]);

  useEffect(() => {
    if (!ceoTyping && activationSession) {
      inputRef.current?.focus();
    }
  }, [activationSession, ceoTyping]);

  const handleSend = async () => {
    if (!inputValue.trim() || ceoTyping || !activationSession) {
      return;
    }

    const userText = inputValue.trim();
    setInputValue("");

    try {
      await postComment(activationSession.inboxIssueId, userText);
      const updatedComments = await getComments(activationSession.inboxIssueId);
      setComments(updatedComments);
      setWaiting(true);

      try {
        await invokeHeartbeat(activationSession.ceoAgent.id);
      } catch {
        // Non-critical.
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send your message.");
    }
  };

  const handleOpenWorkspace = () => {
    if (!activationSession || !msid) {
      return;
    }
    router.push(withMsid("/", msid));
  };

  const handleRetry = () => {
    setConversationVersion((current) => current + 1);
  };

  if (bootstrapState === "missing-msid") {
    return (
      <MetasiteIdEntry
        redirectPath="/new"
        description="Enter the Wix metasite ID you want to activate. The AI Business Manager will use it to open the right Wix business context."
        title="Enter the Wix metasite ID"
      />
    );
  }

  if (bootstrapState === "checking" || requestedCompanyExists) {
    return (
      <WixDesignSystemProvider>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 40%, #1a3a52 100%)",
          }}
        >
          <Loader size="large" />
        </div>
      </WixDesignSystemProvider>
    );
  }

  if (!activationSession) {
    return (
      <WixDesignSystemProvider>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 40%, #1a3a52 100%)",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 20,
              padding: 28,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
              Activation could not start
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.82)", marginBottom: 20 }}>
              {error || "The AI Business Manager setup failed before the conversation could begin."}
            </div>
            <Button onClick={handleRetry}>Try again</Button>
          </div>
        </div>
      </WixDesignSystemProvider>
    );
  }

  return (
    <WixDesignSystemProvider>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 40%, #1a3a52 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 640,
            padding: "20px 24px 0",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 2px 12px rgba(56,153,236,0.4)",
            }}
          >
            <span style={{ color: "white", fontSize: 20, fontWeight: 700 }}>A</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "white" }}>
              Activate your AI Business Manager
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.5)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: ceoTyping ? "#ffc107" : "#00d68f",
                }}
              />
              {ceoTyping ? "Reviewing your business..." : "Ready"}
            </div>
          </div>
          <Button size="small" skin="premium" onClick={handleOpenWorkspace}>
            Open workspace
          </Button>
        </div>

        <div
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 640,
            overflowY: "auto",
            padding: "24px 24px 8px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                display: "flex",
                marginBottom: 12,
                justifyContent: message.role === "ceo" ? "flex-start" : "flex-end",
              }}
            >
              {message.role === "ceo" && (
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    flexShrink: 0,
                    marginRight: 10,
                    marginTop: 2,
                    background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>A</span>
                </div>
              )}
              <div style={{ maxWidth: "75%" }}>
                <div
                  style={{
                    background: message.role === "ceo" ? "rgba(255,255,255,0.1)" : "#3899ec",
                    color: "white",
                    padding: "12px 16px",
                    borderRadius:
                      message.role === "ceo" ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                    fontSize: 14,
                    lineHeight: 1.6,
                    backdropFilter: message.role === "ceo" ? "blur(10px)" : undefined,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {message.text}
                </div>
              </div>
            </div>
          ))}

          {ceoTyping && (
            <div style={{ display: "flex", marginBottom: 12 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  flexShrink: 0,
                  marginRight: 10,
                  background: "linear-gradient(135deg, #3899ec 0%, #60b5ff 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>A</span>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.1)",
                  padding: "14px 20px",
                  borderRadius: "4px 18px 18px 18px",
                  display: "flex",
                  gap: 5,
                  backdropFilter: "blur(10px)",
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.4)",
                    animation: "pulse 1.4s infinite",
                  }}
                />
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.4)",
                    animation: "pulse 1.4s infinite 0.2s",
                  }}
                />
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.4)",
                    animation: "pulse 1.4s infinite 0.4s",
                  }}
                />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            width: "100%",
            maxWidth: 640,
            padding: "12px 24px 24px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "rgba(255,255,255,0.08)",
              borderRadius: 28,
              padding: "6px 6px 6px 20px",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <input
              ref={inputRef}
              className="ceo-interview-input"
              type="text"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Type your answer..."
              disabled={ceoTyping}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                padding: "10px 0",
                fontSize: 14,
                outline: "none",
                color: "white",
              }}
            />
            <button
              onClick={() => {
                void handleSend();
              }}
              disabled={!inputValue.trim() || ceoTyping}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "none",
                background: inputValue.trim() && !ceoTyping ? "#3899ec" : "rgba(255,255,255,0.1)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: inputValue.trim() && !ceoTyping ? "pointer" : "default",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <Send size="18px" />
            </button>
          </div>
          <div style={{ paddingTop: 10, textAlign: "center" }}>
            <Text size="tiny" light>
              This activation chat is live. Refreshing the page starts a fresh draft session.
            </Text>
          </div>
        </div>

        {error && (
          <div
            style={{
              position: "absolute",
              bottom: 96,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 20px",
              background: "rgba(211,47,47,0.9)",
              color: "white",
              fontSize: 13,
              borderRadius: 8,
              maxWidth: 400,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </WixDesignSystemProvider>
  );
}

export default function NewCompanyPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 40%, #1a3a52 100%)",
          }}
        />
      }
    >
      <NewCompanyPageContent />
    </Suspense>
  );
}

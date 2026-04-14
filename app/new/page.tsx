"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Loader, Text } from "@wix/design-system";
import { WixDesignSystemProvider } from "@wix/design-system";
import { Send } from "@wix/wix-ui-icons-common";
import {
  archiveCompany,
  createCompany,
  createAgent,
  createIssue,
  deleteCompany,
  getPicassoBridgeJob,
  getCompanies,
  getComments,
  getHeartbeatRuns,
  invokeHeartbeat,
  postComment,
  updateCompany,
  updateIssue,
  type Agent,
  type Comment,
  type HeartbeatRun,
  type PicassoBridgeJob,
} from "@/lib/api";
import {
  type ActivationMetadata,
  type ActivationMode,
  buildCompanyDescription,
  findCompanyByMsid,
  getCompanyActivation,
  getCompanyWixBinding,
  mergeCompanyDescription,
} from "@/lib/company-metadata";
import { MetasiteIdEntry } from "@/components/metasite-id-entry";
import { AI_TEAM_LEAD_PROMPT } from "@/lib/ai-team-lead-prompt";
import { useMsid } from "@/lib/msid-client";
import { withMsid } from "@/lib/msid";

const HIDDEN_SYSTEM_PREFIX = "[System context - not visible to user]";
const POLL_INTERVAL_MS = 3000;

interface ActivationSession {
  companyId: string;
  ceoAgent: Agent;
  inboxIssueId: string;
  mode: ActivationMode;
  companyName: string;
  companyDescription: string;
  workspaceContextId: string;
}

interface UiMessage {
  id: string;
  role: "ceo" | "user";
  text: string;
}

type ActivationChatTrigger = "initial_open" | "backend_update" | "user_message";

interface ActivationChatResponse {
  text?: string;
}

type NewSiteConversationStatus = "gathering" | "ready_to_activate" | "activate_now";

interface NewSiteIntakeResponse {
  text?: string;
  conversationStatus?: NewSiteConversationStatus;
  transcript?: UiMessage[];
}

interface NewSiteActivationResponse {
  activationSession: ActivationSession;
  bridgeJob: PicassoBridgeJob | null;
  backendSignature: string;
}

function isHiddenSystemComment(body: string): boolean {
  return body.startsWith(HIDDEN_SYSTEM_PREFIX);
}

function getVisibleBackendComments(comments: Comment[]): Comment[] {
  return comments.filter((comment) => !isHiddenSystemComment(comment.body));
}

function buildBackendSignature(comments: Comment[], runs: HeartbeatRun[]): string {
  const visibleComments = getVisibleBackendComments(comments);
  const latestAgentComment = [...visibleComments]
    .reverse()
    .find((comment) => Boolean(comment.authorAgentId));
  const latestRun = [...runs].sort((a, b) => {
    const left = new Date(b.createdAt).getTime();
    const right = new Date(a.createdAt).getTime();
    return left - right;
  })[0];
  const activeRunCount = runs.filter((run) => ["queued", "running"].includes(run.status)).length;

  return [
    latestAgentComment?.id || "no-agent-comment",
    latestRun?.id || "no-run",
    latestRun?.status || "no-status",
    String(activeRunCount),
  ].join(":");
}

function buildActivationSignature(
  comments: Comment[],
  runs: HeartbeatRun[],
  bridgeJob: PicassoBridgeJob | null,
): string {
  return [
    buildBackendSignature(comments, runs),
    bridgeJob?.status || "no-bridge",
    bridgeJob?.updatedAt || "no-bridge-update",
    bridgeJob?.result?.siteId || "no-bridge-site-id",
    bridgeJob?.result?.developmentUrl || "no-bridge-dev-url",
    bridgeJob?.result?.siteUrl || "no-bridge-site-url",
    bridgeJob?.error || "no-bridge-error",
  ].join(":");
}

function appendUiMessage(
  current: UiMessage[],
  next: Omit<UiMessage, "id">,
): UiMessage[] {
  const lastMessage = current[current.length - 1];
  if (
    lastMessage &&
    lastMessage.role === next.role &&
    lastMessage.text.trim() === next.text.trim()
  ) {
    return current;
  }

  return [
    ...current,
    {
      id: `${next.role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...next,
    },
  ];
}

function buildActivationIssueDescription(args: {
  msid: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
}): string {
  const metadataJson = buildCompanyDescription({
    version: 1,
    businessDescription: "",
    wixBinding: {
      metaSiteId: args.msid,
      siteId: args.siteId || undefined,
      siteName: args.siteName || undefined,
      siteUrl: args.siteUrl || undefined,
    },
  });

  const lines = [
    `Kickstart the new AI Team for the Wix Metasite ${args.msid}`,
    "",
    "This is your first activation task for this Wix business.",
    "",
    "Use WixMCP to research this metasite, populate the AI Team record, and define the best initial operating plan for the business.",
    "",
    "Known context:",
    `- Wix metasite ID: ${args.msid}`,
  ];

  if (args.siteId) {
    lines.push(`- Known Wix site ID: ${args.siteId}`);
  }
  if (args.siteName) {
    lines.push(`- Known site name: ${args.siteName}`);
  }
  if (args.siteUrl) {
    lines.push(`- Known site URL: ${args.siteUrl}`);
  }

  lines.push("");
  lines.push("Your objectives:");
  lines.push("- Fetch as much verified information as you can about this Wix business.");
  lines.push("- Populate all verified details in company.description as JSON for this AI Team.");
  lines.push("- Update the AI Team name and any other AI Team properties you see fit based on what you learn.");
  lines.push("- Recommend the best initial AI Team goals and the best first agent team for this specific business.");
  lines.push("");
  lines.push("Treat company.description as the source-of-truth JSON mapper between Wix and Paperclip.");
  lines.push("- Preserve the existing JSON structure.");
  lines.push("- Fill in any missing wixBinding details you can verify, including siteId, siteName, siteUrl, auth hints, tokens, and any other useful mapped data.");
  lines.push("- Fill in businessDescription with a concise factual summary of the business.");
  lines.push("- If you cannot retrieve something, keep existing values intact and explicitly record what is missing or blocked.");
  lines.push("");
  lines.push("Use WixMCP in this order:");
  lines.push("1. Profile Service discovery");
  lines.push("   - Call profile-service__get_profile_labels to discover relevant label groups.");
  lines.push("   - Then call profile-service__get_profile_fields_by_label for the most relevant Wix business labels, especially Stores, Bookings, Blog, SEO WIZ, CX-Contacts, Premium, Restaurants, Wix Events, Pricing Plans, Members area, and Marketing.");
  lines.push("   - Use the discovered profile_id field names to decide which site-level signals are worth checking for this metasite.");
  lines.push("2. Site-level profile values");
  lines.push("   - Call profile-service__get_site_profile with meta_site_id set to this metasite ID and fields set to the relevant profile_id values you discovered.");
  lines.push("   - Use this to determine what business solution the site uses and what business capabilities are active.");
  lines.push("   - Useful example profile_id values to try after discovery include stores_valid_sites, bookings_valid_sites, blog_live_ready_sites, business_premium_sites, sites_with_selling_intent, seo_didnt_complete_checklist, and add_contact_manually.");
  lines.push("   - Use the returned values to determine whether the site is a valid Stores site, a valid Bookings site, a live Blog site, a premium business site, a site with selling intent, a site with CRM/contact activity, or a site with SEO setup activity.");
  lines.push("3. Site structure and visible content");
  lines.push("   - Call document-management__list-pages with metaSiteId to inspect the pages on the site.");
  lines.push("   - Then call document-management__get-components-on-page for the homepage and other high-signal pages to inspect titles, rich text, buttons, and other visible content.");
  lines.push("   - Use this to infer the business name, offer, audience, brand language, navigation structure, and whether the site looks more like stores, bookings, restaurant, events, content/blog, membership, or something else.");
  lines.push("4. Internal service fallback if higher-level WixMCP tools fail");
  lines.push("   - If Profile Service or Document Management is blocked, use fire-console__search_services to find relevant internal site/metasite/site-properties services.");
  lines.push("   - Then use fire-console__get_method_schema to inspect read methods.");
  lines.push("   - Then use fire-console__invoke_rpc only for read-only methods to fetch metasite or site-properties data.");
  lines.push("   - Prefer services related to site-properties, metasite, editor URLs, site profile, or other read-only business metadata.");
  lines.push("   - Concrete fallback artifact families already discovered include com.wixpress.site.properties.site-properties, com.wixpress.siteproperties.site-properties-service, com.wixpress.site-properties-public-web, and com.wixpress.ecom.ecom-site-properties.");
  lines.push("5. Record access failures clearly");
  lines.push("   - If a WixMCP tool returns permission denied, invalid argument, missing access, or reauthorization errors, say exactly which tool failed and continue with other tools.");
  lines.push("   - Do not claim uncertainty if you actually have partial verified evidence from other tools.");
  lines.push("");
  lines.push("For each information category, fetch and fill what you can:");
  lines.push("- Business identity: business name, brand name, legal/business description, site name, site URL, site ID, metasite ID.");
  lines.push("- Site classification: site type, primary Wix business solution, whether it is stores/bookings/blog/events/restaurants/memberships/other, and whether it has selling intent.");
  lines.push("- Business offer: products, services, appointments, events, memberships, or other offers visible from the site structure and profile signals.");
  lines.push("- Audience and positioning: who the business serves, geography if visible, value proposition, tone, and brand positioning inferred from live content.");
  lines.push("- Operational capabilities: contacts/CRM, SEO activity, premium status, blog presence, commerce readiness, bookings readiness, and any other verified product activations.");
  lines.push("- Mapping data: any verified auth hints, tokens, or machine-usable identifiers available through the tools.");
  lines.push("");
  lines.push("Once you retrieve the data:");
  lines.push("- Update company.description JSON with the verified Wix mapping and business summary.");
  lines.push("- Update the AI Team name to the best verified business name.");
  lines.push("- Recommend the best initial goals for this AI Team.");
  lines.push("- Recommend the best first specialist agents to hire for this exact business.");
  lines.push("- For each recommended agent, explain the role, the scope of ownership, and the expected business outcome.");
  lines.push("- Focus on practical, high-impact recommendations grounded in the actual site you found.");
  lines.push("");
  lines.push("Current AI Team record JSON (company.description):");
  lines.push(metadataJson);
  lines.push("");
  lines.push("Important: separate internal work from founder-facing communication.");
  lines.push("- Internally, you should do the research, update the AI Team, and think through the team and goals.");
  lines.push("- Externally, your first visible reply must feel like a personal conversation with the founder.");
  lines.push("- Do not paste your research notes back as a report.");
  lines.push("- Do not use headings like 'Kickstart complete', 'Business', 'Site URL', 'Key findings', or 'Next steps'.");
  lines.push("- Do not mention metadata population, JSON, or task completion.");
  lines.push("");
  lines.push("Your first visible reply to the founder should sound like this:");
  lines.push("- Start with a warm hello and say you are their Wix AI Team Lead.");
  lines.push("- Mention the business name naturally if you found it.");
  lines.push("- Say one positive thing about the business or site.");
  lines.push("- Mention 2 to 4 concrete improvements you already spotted, phrased as things you can help with.");
  lines.push("- Recommend a small starter team of up to 3 agents, with plain-English roles tied to this business.");
  lines.push("- End by asking what they think about the plan or what they want help with first.");
  lines.push("- Keep it human, warm, confident, and concise.");
  lines.push("");
  lines.push("Tone example to emulate:");
  lines.push(`Hey, I took a look at ${args.siteName || "your site"} and I can already see a few ways I can help. The business has real potential, and I think we can improve it quickly.`);
  lines.push("- Mention a few issues in plain language.");
  lines.push("- Suggest the first agents you would hire and why.");
  lines.push("- Ask a direct closing question like 'What do you think about this plan?'");
  lines.push("");
  lines.push("Your first visible reply must:");
  lines.push("- Introduce yourself as the Wix AI Team Lead.");
  lines.push("- Mention one or two concrete things you learned about the business.");
  lines.push("- Ask what they want help with first or whether they want you to start with your recommended plan.");
  lines.push("- Offer to recommend the best first actions if helpful.");
  lines.push("- Keep the tone human, warm, and concise.");
  lines.push("- Do not ask for the metasite ID again unless you explicitly could not access it.");
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
  const requestedMode = searchParams.get("mode");
  const siteId = searchParams.get("siteId")?.trim() || "";
  const siteName = searchParams.get("siteName")?.trim() || "";
  const siteUrl = searchParams.get("siteUrl")?.trim() || "";
  const selectedMode = msid
    ? "existing_site"
    : requestedMode === "new_site"
      ? "new_site"
      : null;

  const [bootstrapState, setBootstrapState] = useState<"checking" | "missing-msid" | "ready">("checking");
  const [activationModeSelection, setActivationModeSelection] = useState<ActivationMode | null>(selectedMode);
  const [requestedCompanyExists, setRequestedCompanyExists] = useState(false);
  const [activationSession, setActivationSession] = useState<ActivationSession | null>(null);
  const [chatMessages, setChatMessages] = useState<UiMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [backendBusy, setBackendBusy] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [error, setError] = useState("");
  const [conversationVersion, setConversationVersion] = useState(0);
  const [showReadyReveal, setShowReadyReveal] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [bridgeJob, setBridgeJob] = useState<PicassoBridgeJob | null>(null);
  const [newSiteConversationStatus, setNewSiteConversationStatus] =
    useState<NewSiteConversationStatus>("gathering");
  const [startingNewSite, setStartingNewSite] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backendSignatureRef = useRef("");
  const chatMessagesRef = useRef<UiMessage[]>([]);
  const ceoTyping = bootstrapState === "checking" || chatSending || startingNewSite;
  const effectiveActivationMode = msid ? "existing_site" : activationModeSelection;
  const activationMetadata = activationSession
    ? getCompanyActivation(activationSession.companyDescription)
    : undefined;
  const interviewStage = activationMetadata?.newSiteInterview?.stage || "business_name";
  const bridgeStatus = activationMetadata?.picassoBridge?.status || bridgeJob?.status || "not_started";
  const isNewSiteSelected = effectiveActivationMode === "new_site";
  const isDraftNewSiteFlow = isNewSiteSelected && !activationSession;
  const isNewSiteFlow = isNewSiteSelected;
  const buildInProgress =
    Boolean(activationSession?.mode === "new_site" && (bridgeStatus === "queued" || bridgeStatus === "running"));
  const showBackendProgress =
    activationSession?.mode === "existing_site" ? backendBusy : buildInProgress;
  const showRunSpinner = chatSending || showBackendProgress || startingNewSite;
  const headerStatusText = chatSending
    ? "Thinking..."
    : startingNewSite
      ? "Starting the first site build"
      : isDraftNewSiteFlow
        ? newSiteConversationStatus === "ready_to_activate"
          ? "Ready to start the first build"
          : "Collecting business details"
        : isNewSiteFlow
          ? bridgeStatus === "queued" || bridgeStatus === "running"
            ? "Building the first site version"
            : interviewStage === "building" || interviewStage === "complete"
              ? "Planning the next moves"
              : "Collecting business details"
          : backendBusy
            ? "Reviewing the business and preparing next steps"
            : "Ready to help";
  const headerDescriptionText = startingNewSite
    ? "Your AI Team Lead is turning the full conversation into a site brief, creating the workspace, and kicking off the first build."
    : isDraftNewSiteFlow
      ? newSiteConversationStatus === "ready_to_activate"
        ? "Your AI Team Lead has enough context to brief the first version and is waiting for your go-ahead."
        : "Your AI Team Lead is learning about the business through the conversation so the first version starts from a strong brief."
      : isNewSiteFlow
        ? bridgeStatus === "queued" || bridgeStatus === "running"
          ? "Your AI Team Lead is building the first site version and lining up practical next steps for the business."
          : interviewStage === "building" || interviewStage === "complete"
            ? "Your AI Team Lead is turning the business brief into a first site version and mapping the smartest next actions."
            : "Your AI Team Lead is gathering the business basics so the first site version starts from a clean brief."
        : "Your AI Team Lead is already reviewing the business and lining up practical recommendations.";
  const spinnerLabel = startingNewSite
    ? "Starting the first site version..."
    : chatSending
      ? "Thinking..."
      : isNewSiteFlow
        ? "Building the first site version..."
        : "Research in progress...";

  useEffect(() => {
    setActivationModeSelection(selectedMode);
  }, [selectedMode]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

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
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
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
    setChatMessages([]);
    setInputValue("");
    setBackendBusy(false);
    setChatSending(false);
    setError("");
    setShowReadyReveal(false);
    setBridgeJob(null);
    setNewSiteConversationStatus("gathering");
    setStartingNewSite(false);
    backendSignatureRef.current = "";
    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    if (!effectiveActivationMode) {
      setBootstrapState("missing-msid");
      return;
    }

    if (effectiveActivationMode === "existing_site" && !msid) {
      setBootstrapState("missing-msid");
      return;
    }

    if (effectiveActivationMode === "new_site") {
      setBootstrapState("ready");
      return;
    }

    const startActivationSession = async () => {
      try {
        const companies = await getCompanies();
        const legacyCompanyIdMatch = companies.find((company) => company.id === msid) || null;
        const legacyMappedMsid = legacyCompanyIdMatch
          ? getCompanyWixBinding(legacyCompanyIdMatch.description)?.metaSiteId || ""
          : "";

        if (
          !cancelled &&
          legacyMappedMsid &&
          legacyMappedMsid !== msid
        ) {
          router.replace(withMsid("/new", legacyMappedMsid));
          return;
        }

        const existingCompany = findCompanyByMsid(companies, msid as string);
        if (!cancelled && existingCompany) {
          if (siteId || siteName || siteUrl) {
            await updateCompany(existingCompany.id, {
              description: mergeCompanyDescription(existingCompany.description, {
                wixBinding: {
                  metaSiteId: msid as string,
                  siteId: siteId || undefined,
                  siteName: siteName || undefined,
                  siteUrl: siteUrl || undefined,
                },
              }),
            }).catch(() => undefined);
          }
          setRequestedCompanyExists(true);
          router.replace(withMsid("/", msid as string));
          return;
        }
      } catch {
        // Fall through to activation setup.
      }

      try {
        const company = await createCompany({
          name: getDraftCompanyName(siteName, msid as string),
          description: buildCompanyDescription({
            version: 1,
            businessDescription: "",
            wixBinding: {
              metaSiteId: msid as string,
              siteId: siteId || undefined,
              siteName: siteName || undefined,
              siteUrl: siteUrl || undefined,
            },
            extra: {
              activation: {
                mode: "existing_site",
              },
            },
          }),
        });

        const ceoAgent = await createAgent(company.id, {
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
        });

        const inboxIssue = await createIssue(company.id, {
          title: `Kickstart AI Team for Wix metasite ${msid}`,
          description: buildActivationIssueDescription({
            msid: msid as string,
            siteId,
            siteName,
            siteUrl,
          }),
          priority: "high",
          assigneeAgentId: ceoAgent.id,
        });

        await updateCompany(company.id, {
          description: mergeCompanyDescription(company.description, {
            wixBinding: {
              activationIssueId: inboxIssue.id,
            },
          }),
        }).catch(() => undefined);

        try {
          await invokeHeartbeat(ceoAgent.id);
        } catch {
          // Non-critical. Polling will still show any response that appears.
        }

        const [initialComments, initialRuns] = await Promise.all([
          getComments(inboxIssue.id).catch(() => [] as Comment[]),
          getHeartbeatRuns(company.id).catch(() => [] as HeartbeatRun[]),
        ]);

        if (cancelled) {
          return;
        }

        setActivationSession({
          companyId: company.id,
          ceoAgent,
          inboxIssueId: inboxIssue.id,
          mode: effectiveActivationMode,
          companyName: company.name,
          companyDescription: mergeCompanyDescription(company.description, {
            wixBinding: {
              activationIssueId: inboxIssue.id,
            },
          }),
          workspaceContextId: msid as string,
        });
        setBackendBusy(initialRuns.some((run) => ["queued", "running"].includes(run.status)));
        backendSignatureRef.current = buildActivationSignature(initialComments, initialRuns, null);
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
  }, [conversationVersion, effectiveActivationMode, msid, router, siteId, siteName, siteUrl]);

  const requestActivationReply = useCallback(async (
    nextMessages: UiMessage[],
    trigger: ActivationChatTrigger,
  ): Promise<ActivationChatResponse | null> => {
    if (!activationSession) {
      return null;
    }

    setChatSending(true);
    try {
      const response = await fetch("/api/activation-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: activationSession.companyId,
          issueId: activationSession.inboxIssueId,
          messages: nextMessages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
          trigger,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Activation chat failed" }));
        throw new Error(payload.error || "Activation chat failed");
      }
      const data = (await response.json()) as ActivationChatResponse;
      if (data.text) {
        setChatMessages((current) => appendUiMessage(current, { role: "ceo", text: data.text }));
      }
      setError("");
      return data;
    } catch (replyError) {
      setError(
        replyError instanceof Error
          ? replyError.message
          : "Failed to get a reply from the AI Team Lead.",
      );
      return null;
    } finally {
      setChatSending(false);
    }
  }, [activationSession]);

  const requestNewSiteIntakeReply = useCallback(async (
    nextMessages: UiMessage[],
    trigger: "initial_open" | "user_message",
  ): Promise<NewSiteIntakeResponse | null> => {
    setChatSending(true);
    try {
      const response = await fetch("/api/new-site-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger,
          messages: nextMessages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "New site intake failed" }));
        throw new Error(payload.error || "New site intake failed");
      }
      const data = (await response.json()) as NewSiteIntakeResponse;
      const transcript = data.text
        ? appendUiMessage(nextMessages, { role: "ceo", text: data.text })
        : nextMessages;
      if (data.text) {
        setChatMessages(transcript);
      }
      setNewSiteConversationStatus(data.conversationStatus || "gathering");
      setError("");
      return {
        ...data,
        transcript,
      };
    } catch (replyError) {
      setError(
        replyError instanceof Error
          ? replyError.message
          : "Failed to get a reply from the AI Team Lead.",
      );
      return null;
    } finally {
      setChatSending(false);
    }
  }, []);

  const activateNewSiteConversation = useCallback(async (messages: UiMessage[]) => {
    setStartingNewSite(true);
    try {
      const response = await fetch("/api/new-site-intake/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Failed to activate new site" }));
        throw new Error(payload.error || "Failed to activate new site");
      }

      const data = (await response.json()) as NewSiteActivationResponse;
      setActivationSession(data.activationSession);
      setBridgeJob(data.bridgeJob);
      setBackendBusy(Boolean(data.bridgeJob && ["queued", "running"].includes(data.bridgeJob.status)));
      backendSignatureRef.current = data.backendSignature || "";
      setNewSiteConversationStatus("activate_now");
      setError("");
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Failed to start the first site build.",
      );
    } finally {
      setStartingNewSite(false);
    }
  }, []);

  const updateActivationState = useCallback(async (args: {
    name?: string;
    businessDescription?: string;
    activation: ActivationMetadata;
    issueTitle?: string;
    issueDescription?: string;
  }) => {
    if (!activationSession) {
      return null;
    }

    const nextDescription = mergeCompanyDescription(activationSession.companyDescription, {
      businessDescription: args.businessDescription,
      extra: {
        activation: args.activation,
      },
    });

    const updatedCompany = await updateCompany(activationSession.companyId, {
      ...(args.name && args.name !== activationSession.companyName ? { name: args.name } : {}),
      description: nextDescription,
    });

    setActivationSession((current) => {
      if (!current || current.companyId !== updatedCompany.id) {
        return current;
      }

      return {
        ...current,
        companyName: updatedCompany.name,
        companyDescription: updatedCompany.description,
      };
    });

    if (args.issueTitle || args.issueDescription) {
      await updateIssue(activationSession.inboxIssueId, {
        ...(args.issueTitle ? { title: args.issueTitle } : {}),
        ...(args.issueDescription ? { description: args.issueDescription } : {}),
      }).catch(() => undefined);
    }

    return updatedCompany;
  }, [activationSession]);

  useEffect(() => {
    if (!activationSession) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const pollBackendState = async () => {
      try {
        const currentActivation = getCompanyActivation(activationSession.companyDescription);
        const currentBridgeJobId = currentActivation?.picassoBridge?.jobId;
        const [nextComments, nextRuns, nextBridgeJob] = await Promise.all([
          getComments(activationSession.inboxIssueId),
          getHeartbeatRuns(activationSession.companyId).catch(() => [] as HeartbeatRun[]),
          currentBridgeJobId
            ? getPicassoBridgeJob(currentBridgeJobId).catch(() => null)
            : Promise.resolve(null),
        ]);
        const hasActiveRuns =
          nextRuns.some((run) => ["queued", "running"].includes(run.status)) ||
          Boolean(nextBridgeJob && ["queued", "running"].includes(nextBridgeJob.status));
        setBackendBusy(hasActiveRuns);
        setBridgeJob(nextBridgeJob);

        if (nextBridgeJob && activationSession.mode === "new_site") {
          const nextActivation: ActivationMetadata = {
            mode: "new_site",
            newSiteInterview: {
              ...(currentActivation?.newSiteInterview || {
                stage: "building",
              }),
              stage: nextBridgeJob.status === "succeeded" ? "complete" : "building",
            },
            picassoBridge: {
              jobId: nextBridgeJob.id,
              status: nextBridgeJob.status,
              siteId: nextBridgeJob.result?.siteId || undefined,
              siteUrl: nextBridgeJob.result?.siteUrl || undefined,
              developmentUrl: nextBridgeJob.result?.developmentUrl || undefined,
              requestedAt: currentActivation?.picassoBridge?.requestedAt,
              updatedAt: nextBridgeJob.updatedAt,
              error: nextBridgeJob.error || undefined,
            },
          };

          const currentPicasso = currentActivation?.picassoBridge;
          const stageChanged =
            currentActivation?.newSiteInterview?.stage !== nextActivation.newSiteInterview?.stage;
          const bridgeChanged =
            currentPicasso?.status !== nextActivation.picassoBridge?.status ||
            currentPicasso?.siteId !== nextActivation.picassoBridge?.siteId ||
            currentPicasso?.siteUrl !== nextActivation.picassoBridge?.siteUrl ||
            currentPicasso?.developmentUrl !== nextActivation.picassoBridge?.developmentUrl ||
            currentPicasso?.error !== nextActivation.picassoBridge?.error;

          if (stageChanged || bridgeChanged) {
            await updateActivationState({
              activation: nextActivation,
            });
          }
        }

        const nextSignature = buildActivationSignature(nextComments, nextRuns, nextBridgeJob);
        const nextStage =
          activationSession.mode === "new_site"
            ? nextBridgeJob
              ? nextBridgeJob.status === "succeeded"
                ? "complete"
                : "building"
              : currentActivation?.newSiteInterview?.stage || "business_name"
            : null;
        if (
          nextSignature !== backendSignatureRef.current &&
          chatMessagesRef.current.length > 0
        ) {
          backendSignatureRef.current = nextSignature;
          if (
            activationSession.mode !== "new_site" ||
            nextStage === "building" ||
            nextStage === "complete"
          ) {
            void requestActivationReply(chatMessagesRef.current, "backend_update");
          }
        }
      } catch {
        // Ignore polling failures and keep trying.
      }
    };

    void pollBackendState();
    pollRef.current = setInterval(() => {
      void pollBackendState();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activationSession, requestActivationReply, updateActivationState]);

  useEffect(() => {
    if (bootstrapState !== "ready" || (!activationSession && !isDraftNewSiteFlow)) {
      return;
    }

    setShowReadyReveal(true);
    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
    }
    revealTimeoutRef.current = setTimeout(() => {
      setShowReadyReveal(false);
      revealTimeoutRef.current = null;
    }, 1550);

    return () => {
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
    };
  }, [activationSession, bootstrapState, isDraftNewSiteFlow]);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [chatMessages, ceoTyping]);

  useEffect(() => {
    if (!ceoTyping && (activationSession || isDraftNewSiteFlow)) {
      inputRef.current?.focus();
    }
  }, [activationSession, ceoTyping, isDraftNewSiteFlow]);

  useEffect(() => {
    if (chatMessages.length > 0 || bootstrapState !== "ready") {
      return;
    }

    if (activationSession) {
      void requestActivationReply([], "initial_open");
      return;
    }

    if (isDraftNewSiteFlow) {
      void requestNewSiteIntakeReply([], "initial_open");
    }
  }, [
    activationSession,
    bootstrapState,
    chatMessages.length,
    isDraftNewSiteFlow,
    requestActivationReply,
    requestNewSiteIntakeReply,
  ]);

  const handleSend = async () => {
    if (!inputValue.trim() || chatSending || startingNewSite) {
      return;
    }

    if (!activationSession && !isDraftNewSiteFlow) {
      return;
    }

    const userText = inputValue.trim();
    setInputValue("");
    const nextMessages = appendUiMessage(chatMessagesRef.current, {
      role: "user",
      text: userText,
    });
    setChatMessages(nextMessages);

    if (isDraftNewSiteFlow) {
      const reply = await requestNewSiteIntakeReply(nextMessages, "user_message");
      if (reply?.conversationStatus === "activate_now") {
        await activateNewSiteConversation(reply.transcript || nextMessages);
      }
      return;
    }

    if (activationSession?.mode === "existing_site") {
      setBackendBusy(true);
    }

    try {
      await postComment(activationSession!.inboxIssueId, userText);
      await getComments(activationSession.inboxIssueId).catch(() => [] as Comment[]);

      try {
        await invokeHeartbeat(activationSession!.ceoAgent.id);
      } catch {
        // Non-critical.
      }

      void requestActivationReply(nextMessages, "user_message");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send your message.");
    }
  };

  const handleOpenWorkspace = () => {
    if (!activationSession) {
      return;
    }
    router.push(withMsid("/", activationSession.workspaceContextId));
  };

  const handleRetry = () => {
    setConversationVersion((current) => current + 1);
  };

  const handleRestart = async () => {
    if (!activationSession || restarting) {
      return;
    }

    const shouldRestart = window.confirm(
      "Restart this interview? The current AI Team will be deleted and the setup will start over.",
    );
    if (!shouldRestart) {
      return;
    }

    setRestarting(true);
    setError("");

    try {
      try {
        await deleteCompany(activationSession.companyId);
      } catch {
        await archiveCompany(activationSession.companyId);
      }
      window.location.reload();
    } catch (restartError) {
      setError(
        restartError instanceof Error
          ? restartError.message
          : "Failed to restart the interview.",
      );
      setRestarting(false);
    }
  };

  if (bootstrapState === "missing-msid") {
    return (
      <MetasiteIdEntry
        redirectPath="/new"
        description="Open an existing Wix business by pasting its metasite ID or manage URL."
        createNewSiteDescription="Start from scratch. The AI Team Lead will talk through the business with you first, then start the first build only when you say to."
        onCreateNewSite={() => setActivationModeSelection("new_site")}
        title="Open or create your Wix site"
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
            background: "#f7f6f3",
            padding: 24,
          }}
        >
          <img
            src="/ai-team-logo.png"
            alt="AI Team logo"
            width={180}
            height={180}
            style={{ width: 180, height: 180, objectFit: "contain" }}
          />
        </div>
      </WixDesignSystemProvider>
    );
  }

  if (!activationSession && !isDraftNewSiteFlow) {
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
              {error || "The AI Team setup failed before the conversation could begin."}
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
          background: "linear-gradient(180deg, #f5fbff 0%, #edf6ff 50%, #f9fcf6 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {showReadyReveal && (
          <div className="activation-ready-reveal">
            <img
              className="activation-ready-reveal-logo"
              src="/ai-team-logo.png"
              alt="AI Team logo"
              width={180}
              height={180}
            />
          </div>
        )}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -120,
            left: -80,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(104,192,255,0.32) 0%, rgba(104,192,255,0) 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 90,
            right: -70,
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(117,228,183,0.24) 0%, rgba(117,228,183,0) 72%)",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -140,
            left: "30%",
            width: 360,
            height: 360,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,205,118,0.18) 0%, rgba(255,205,118,0) 72%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            padding: "28px 24px 0",
            flexShrink: 0,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 20px",
              borderRadius: 24,
              background: "rgba(255,255,255,0.78)",
              border: "1px solid rgba(159,196,224,0.5)",
              boxShadow: "0 18px 50px rgba(71, 112, 145, 0.12)",
              backdropFilter: "blur(18px)",
            }}
          >
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #2f8cff 0%, #64b9ff 65%, #87d7c0 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 8px 18px rgba(47,140,255,0.28)",
              }}
            >
              <span style={{ color: "white", fontSize: 20, fontWeight: 700 }}>A</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#16324a" }}>
                Set up your AI Team
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#4d677d",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: chatSending || startingNewSite ? "#ffb020" : showBackendProgress ? "#4d9bff" : "#28c76f",
                    boxShadow: chatSending || startingNewSite
                      ? "0 0 0 4px rgba(255,176,32,0.14)"
                      : showBackendProgress
                        ? "0 0 0 4px rgba(77,155,255,0.14)"
                        : "0 0 0 4px rgba(40,199,111,0.14)",
                  }}
                />
                {headerStatusText}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: "#6a8092", marginTop: 8 }}>
                {headerDescriptionText}
              </div>
            </div>
            {activationSession && (
              <div style={{ flexShrink: 0 }}>
                <Button size="small" skin="premium" onClick={handleOpenWorkspace}>
                  Open workspace
                </Button>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 760,
            overflowY: "auto",
            padding: "18px 24px 8px",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            zIndex: 1,
          }}
        >
          {chatMessages.map((message) => (
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
                    background: "linear-gradient(135deg, #2f8cff 0%, #64b9ff 65%, #87d7c0 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 6px 12px rgba(47,140,255,0.22)",
                  }}
                >
                  <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>A</span>
                </div>
              )}
              <div style={{ maxWidth: "82%" }}>
                <div
                  style={{
                    background:
                      message.role === "ceo"
                        ? "rgba(255,255,255,0.88)"
                        : "linear-gradient(135deg, #2f8cff 0%, #54a7ff 100%)",
                    color: message.role === "ceo" ? "#183247" : "white",
                    padding: "16px 20px",
                    borderRadius:
                      message.role === "ceo" ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                    fontSize: 16,
                    lineHeight: 1.72,
                    backdropFilter: message.role === "ceo" ? "blur(14px)" : undefined,
                    border:
                      message.role === "ceo"
                        ? "1px solid rgba(159,196,224,0.5)"
                        : "1px solid rgba(47,140,255,0.18)",
                    boxShadow:
                      message.role === "ceo"
                        ? "0 14px 34px rgba(77, 103, 128, 0.12)"
                        : "0 12px 26px rgba(47,140,255,0.22)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {message.text}
                </div>
              </div>
            </div>
          ))}

          {showRunSpinner && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 18,
                marginLeft: 56,
                padding: "2px 0 2px 2px",
              }}
            >
              <div style={{ opacity: 0.7 }}>
                <Loader size="tiny" />
              </div>
              <span style={{ fontSize: 14, color: "#7b8c9d" }}>
                {spinnerLabel}
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            width: "100%",
            maxWidth: 760,
            padding: "16px 24px 28px",
            flexShrink: 0,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "rgba(255,255,255,0.92)",
              borderRadius: 30,
              padding: "8px 8px 8px 20px",
              border: "1px solid rgba(159,196,224,0.46)",
              boxShadow: "0 18px 44px rgba(71, 112, 145, 0.14)",
              backdropFilter: "blur(18px)",
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
              placeholder="Type your message..."
              disabled={ceoTyping}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                padding: "14px 0",
                fontSize: 16,
                outline: "none",
                color: "#16324a",
              }}
            />
            <button
              onClick={() => {
                void handleSend();
              }}
              disabled={!inputValue.trim() || ceoTyping}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "none",
                background:
                  inputValue.trim() && !ceoTyping
                    ? "linear-gradient(135deg, #2f8cff 0%, #54a7ff 100%)"
                    : "#dfe9f2",
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
            <Text size="small" style={{ color: "#698094" }}>
              {isDraftNewSiteFlow
                ? "This stays a draft conversation until you explicitly tell the AI Team Lead to start the first build."
                : "This activation chat is live. Refreshing the page starts a fresh draft session."}
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

        {activationSession && (
          <button
            onClick={() => {
              void handleRestart();
            }}
            disabled={restarting}
            style={{
              position: "fixed",
              right: 20,
              bottom: 20,
              zIndex: 12,
              border: "1px solid rgba(22,50,74,0.14)",
              background: "rgba(255,255,255,0.88)",
              color: "#527089",
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: restarting ? "default" : "pointer",
              boxShadow: "0 10px 24px rgba(71, 112, 145, 0.12)",
              backdropFilter: "blur(12px)",
              opacity: restarting ? 0.7 : 1,
            }}
          >
            {restarting ? "Restarting..." : "Restart"}
          </button>
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

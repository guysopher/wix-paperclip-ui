"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Page, Box, Text, Badge, Loader, Button, Pagination } from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import { AgentAvatar } from "@/components/agent-avatar";
import { getAgents, getHeartbeatRuns, type Agent, type HeartbeatRun } from "@/lib/api";
import { parseUsage, duration, timeAgo } from "@/lib/run-utils";

const PAGE_SIZE = 10;

const STATUS_SKINS: Record<string, "success" | "warning" | "neutral" | "danger" | "general"> = {
  succeeded: "success",
  running: "warning",
  queued: "neutral",
  failed: "danger",
  timed_out: "danger",
  cancelled: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Completed",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
};

const SOURCE_LABELS: Record<string, string> = {
  on_demand: "Manual run",
  scheduled: "Scheduled",
  mention: "Mentioned",
  assignment: "Assigned",
};

const AVATAR_COLORS = [
  "#3899ec", "#e01f5a", "#2ca55a", "#ff6b35", "#7c4dff", "#00bcd4", "#f59e0b",
];

function avatarColor(agentId: string) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++)
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const isActive = (status: string) => status === "running" || status === "queued";

interface Narrative { title: string; description: string; }
interface FeedPost {
  run: HeartbeatRun;
  agent: Agent | undefined;
  narrative: Narrative | null; // null = not yet fetched
}

function NarrativeSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {[95, 78].map((w, i) => (
        <div key={i} className="skeleton-bar" style={{ height: 12, width: `${w}%` }} />
      ))}
    </div>
  );
}

function PostCard({ post, companyPath }: { post: FeedPost; companyPath: (path: string) => string }) {
  const { run, agent, narrative } = post;
  const agentName = agent?.name || "Unknown";
  const usage = parseUsage(run.usageJson);
  const dur = duration(run.startedAt, run.finishedAt);
  const active = isActive(run.status);

  return (
    <div
      style={{
        background: "white",
        borderRadius: 12,
        border: "1px solid #e8ecf0",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <a href={companyPath(`/team/${run.agentId}`)} style={{ textDecoration: "none", flexShrink: 0 }}>
          <AgentAvatar
            agentName={agentName}
            agentRole={agent?.role}
            icon={agent?.icon}
            size={38}
            fontSize={16}
          />
        </a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <a href={companyPath(`/team/${run.agentId}`)} style={{ textDecoration: "none", color: "inherit" }}>
              <Text size="medium" weight="bold">{agentName}</Text>
            </a>
            {agent?.title && agent.title !== agentName && (
              <Text size="small" secondary>{agent.title}</Text>
            )}
          </div>
          <Text size="tiny" secondary>
            {SOURCE_LABELS[run.invocationSource] || run.invocationSource} · {timeAgo(run.createdAt)}
          </Text>
        </div>
        <Badge size="tiny" skin={STATUS_SKINS[run.status] || "general"}>
          {STATUS_LABELS[run.status] || run.status}
        </Badge>
      </div>

      <div style={{ minHeight: 22 }}>
        {active ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#3899ec" }}>
            <Loader size="tiny" />
            <span style={{ fontSize: 13 }}>
              {run.status === "queued" ? "Waiting to start…" : "Running now…"}
            </span>
          </div>
        ) : narrative === null ? (
          <NarrativeSkeleton />
        ) : narrative.title ? (
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#162d3d", marginBottom: 5 }}>
              {narrative.title}
            </div>
            {narrative.description && (
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.65 }}>
                {narrative.description}
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: "#aaa", fontStyle: "italic" }}>No summary available.</span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderTop: "1px solid #f0f2f5",
          paddingTop: 10,
        }}
      >
        <Text size="tiny" secondary>Duration: {dur}</Text>
        {usage?.cost && usage.cost !== "—" && (
          <>
            <span style={{ color: "#ddd" }}>·</span>
            <Text size="tiny" secondary>{usage.cost}</Text>
          </>
        )}
        <div style={{ flex: 1 }} />
        <a href={companyPath(`/runs/${run.id}`)} style={{ color: "#3899ec", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
          View run →
        </a>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const { companyId, companyPath } = useCompany();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // Track which run IDs have had narrative fetches started (to avoid re-fetching on re-render)
  const fetchedRunIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    fetchedRunIds.current = new Set();

    const [agents, runs] = await Promise.all([
      getAgents(companyId),
      getHeartbeatRuns(companyId),
    ]);

    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const sorted = runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    setPosts(sorted.map((run) => ({
      run,
      agent: agentMap.get(run.agentId),
      // Active runs get an empty narrative (no fetch needed), completed start as null
      narrative: isActive(run.status) ? { title: "", description: "" } : null,
    })));
    setPage(1);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Lazily fetch narratives for the current page — only for runs not yet fetched
  useEffect(() => {
    if (posts.length === 0) return;
    const pageStart = (page - 1) * PAGE_SIZE;
    const pagePosts = posts.slice(pageStart, pageStart + PAGE_SIZE);
    const toFetch = pagePosts.filter(
      (p) => !isActive(p.run.status) && p.narrative === null && !fetchedRunIds.current.has(p.run.id)
    );
    if (toFetch.length === 0) return;

    toFetch.forEach((post, i) => {
      fetchedRunIds.current.add(post.run.id);
      const { run, agent } = post;
      const params = new URLSearchParams({
        agentName: agent?.name || "Unknown",
        agentRole: agent?.role || "",
        status: run.status,
        source: run.invocationSource,
      });
      if (run.error) params.set("error", run.error);
      if (run.triggerDetail) params.set("triggerDetail", run.triggerDetail);

      setTimeout(() => {
        fetch(`/api/run-narrative/${run.id}?${params}`)
          .then((r) => r.json())
          .then((data: { title?: string; description?: string }) => {
            setPosts((prev) => {
              const idx = prev.findIndex((p) => p.run.id === run.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], narrative: { title: data.title || "", description: data.description || "" } };
              return next;
            });
          })
          .catch(() => {
            setPosts((prev) => {
              const idx = prev.findIndex((p) => p.run.id === run.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], narrative: { title: "", description: "" } };
              return next;
            });
          });
      }, i * 50);
    });
  }, [page, posts.length]); // re-run on page change or after initial data load

  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const pagePosts = posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Page>
      <Page.Header
        title="Activity"
        subtitle={loading ? "Loading…" : `${posts.length} runs`}
        actionsBar={
          <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>
            Refresh
          </Button>
        }
      />
      <Page.Content>
        {loading ? (
          <Box align="center" verticalAlign="middle" height="400px">
            <Loader size="medium" />
          </Box>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#aaa" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <Text secondary>No runs yet. Agents will appear here once they start working.</Text>
          </div>
        ) : (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {pagePosts.map((post) => (
              <PostCard key={post.run.id} post={post} companyPath={companyPath} />
              ))}
            </div>
            {totalPages > 1 && (
              <Box align="center" padding="24px 0">
                <Pagination
                  totalPages={totalPages}
                  currentPage={page}
                  onChange={({ page: p }) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                />
              </Box>
            )}
          </div>
        )}
      </Page.Content>
    </Page>
  );
}

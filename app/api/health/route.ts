import { NextResponse } from "next/server";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

async function paperclip(path: string, options?: RequestInit) {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1", ...options?.headers },
  });
  return res.json();
}

export async function POST() {
  const results: {
    status: "healthy" | "repaired" | "error";
    checks: Array<{ name: string; status: string; detail?: string }>;
    actions: string[];
  } = { status: "healthy", checks: [], actions: [] };

  try {
    // 1. Check API is reachable
    const companies = await paperclip("/companies");
    if (!companies?.length) {
      results.checks.push({ name: "api", status: "error", detail: "No companies found" });
      results.status = "error";
      return NextResponse.json(results);
    }
    results.checks.push({ name: "api", status: "ok" });
    const companyId = companies[0].id;

    // 2. Check for stale runs and cancel them
    const runs = await paperclip(`/companies/${companyId}/heartbeat-runs`);
    const now = Date.now();
    const staleRuns = (runs || []).filter(
      (r: { status: string; startedAt: string | null }) =>
        r.status === "running" && r.startedAt && now - new Date(r.startedAt).getTime() > STALE_THRESHOLD_MS
    );

    if (staleRuns.length > 0) {
      const cancelResults = await Promise.allSettled(
        staleRuns.map((r: { id: string }) =>
          paperclip(`/heartbeat-runs/${r.id}/cancel`, { method: "POST" })
        )
      );
      const cancelled = cancelResults.filter((r) => r.status === "fulfilled").length;
      results.checks.push({
        name: "stale_runs",
        status: "repaired",
        detail: `Cancelled ${cancelled} of ${staleRuns.length} stale runs (running > 15 min)`,
      });
      results.actions.push(`Cancelled ${cancelled} stale runs`);
      results.status = "repaired";
    } else {
      results.checks.push({ name: "stale_runs", status: "ok", detail: "No stale runs found" });
    }

    // 3. Check agents are healthy
    const agents = await paperclip(`/companies/${companyId}/agents`);
    const errorAgents = (agents || []).filter((a: { status: string }) => a.status === "error");
    if (errorAgents.length > 0) {
      results.checks.push({
        name: "agents",
        status: "warning",
        detail: `${errorAgents.length} agent(s) in error state: ${errorAgents.map((a: { name: string }) => a.name).join(", ")}`,
      });
    } else {
      results.checks.push({ name: "agents", status: "ok", detail: `${agents.length} agents healthy` });
    }

    // 4. Check scheduler is working (any runs in the last 30 min?)
    const recentRuns = (runs || []).filter(
      (r: { createdAt: string }) => now - new Date(r.createdAt).getTime() < 30 * 60 * 1000
    );
    const activeAgents = (agents || []).filter(
      (a: { status: string; adapterConfig?: { heartbeatIntervalSec?: number } }) =>
        a.status !== "paused" && a.adapterConfig?.heartbeatIntervalSec
    );
    if (recentRuns.length === 0 && activeAgents.length > 0) {
      results.checks.push({
        name: "scheduler",
        status: "warning",
        detail: `No runs in the last 30 minutes despite ${activeAgents.length} active agents with schedules. The scheduler may need a restart.`,
      });
    } else {
      results.checks.push({
        name: "scheduler",
        status: "ok",
        detail: `${recentRuns.length} runs in the last 30 minutes`,
      });
    }

  } catch (err) {
    results.status = "error";
    results.checks.push({
      name: "api",
      status: "error",
      detail: `Cannot reach Paperclip API: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }

  return NextResponse.json(results);
}

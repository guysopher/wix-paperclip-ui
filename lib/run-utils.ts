export interface LogEntry {
  kind: "assistant" | "tools" | "result";
  text: string;
  toolNames?: string[];
  timestamp?: string;
}

export function humanizeToolName(name: string): string {
  const map: Record<string, string> = {
    Bash: "Ran command", Read: "Read file", Edit: "Edited file", Write: "Wrote file",
    Grep: "Searched code", Glob: "Found files", Agent: "Delegated to sub-agent",
    WebFetch: "Fetched URL", WebSearch: "Web search", AskUserQuestion: "Asked a question",
    TaskCreate: "Created task", TaskUpdate: "Updated task",
  };
  return map[name] || name.replace(/([A-Z])/g, " $1").trim();
}

export function parseRunLog(raw: string): LogEntry[] {
  const lines = raw.split("\n").filter(Boolean);
  const items: Array<{ kind: "text" | "tool" | "result"; text: string; toolName?: string; ts?: string }> = [];

  for (const line of lines) {
    try {
      const outer = JSON.parse(line);
      const chunkStr: string = outer.chunk ?? "";
      const ts: string = outer.ts || "";
      let chunk: Record<string, unknown> | null = null;
      try { chunk = JSON.parse(chunkStr); } catch { /* plain text */ }

      if (chunk) {
        const type = chunk.type as string;
        if (type === "assistant" && chunk.message) {
          const msg = chunk.message as { content?: Array<{ type: string; text?: string; name?: string }> };
          if (msg.content) {
            for (const block of msg.content) {
              if (block.type === "text" && block.text?.trim()) items.push({ kind: "text", text: block.text.trim(), ts });
              if (block.type === "tool_use" && block.name) items.push({ kind: "tool", text: "", toolName: block.name, ts });
            }
          }
        } else if (type === "result") {
          const result = (chunk.result as string) || "";
          if (result) items.push({ kind: "result", text: result, ts });
        }
      }
    } catch { /* skip */ }
  }

  const entries: LogEntry[] = [];
  let pendingTools: string[] = [];
  let pendingToolTs = "";
  let pendingText: string[] = [];
  let pendingTextTs = "";

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const counts: Record<string, number> = {};
    for (const t of pendingTools) counts[t] = (counts[t] || 0) + 1;
    const summary = Object.entries(counts)
      .map(([name, count]) => count > 1 ? `${humanizeToolName(name)} (x${count})` : humanizeToolName(name))
      .join(", ");
    entries.push({ kind: "tools", text: summary, toolNames: [...new Set(pendingTools)], timestamp: pendingToolTs });
    pendingTools = [];
    pendingToolTs = "";
  };
  const flushText = () => {
    if (pendingText.length === 0) return;
    entries.push({ kind: "assistant", text: pendingText.join("\n\n"), timestamp: pendingTextTs });
    pendingText = [];
    pendingTextTs = "";
  };

  for (const item of items) {
    if (item.kind === "tool") { flushText(); if (!pendingToolTs && item.ts) pendingToolTs = item.ts; pendingTools.push(item.toolName!); }
    else if (item.kind === "text") { flushTools(); if (!pendingTextTs && item.ts) pendingTextTs = item.ts; pendingText.push(item.text); }
    else if (item.kind === "result") { flushTools(); flushText(); entries.push({ kind: "result", text: item.text, timestamp: item.ts }); }
  }
  flushTools();
  flushText();
  return entries;
}

export function parseUsage(usageJson: string | null): { cost: string; tokens: string } | null {
  if (!usageJson) return null;
  try {
    const u = JSON.parse(usageJson);
    const cost = u.total_cost_usd ? `$${u.total_cost_usd.toFixed(4)}` : null;
    const output = u.usage?.output_tokens || u.output_tokens || 0;
    const input = u.usage?.input_tokens || u.input_tokens || 0;
    const cache = u.usage?.cache_read_input_tokens || u.cache_read_input_tokens || 0;
    const tokens = output + input + cache > 0 ? `${((output + input + cache) / 1000).toFixed(1)}k tokens` : null;
    return { cost: cost || "—", tokens: tokens || "—" };
  } catch { return null; }
}

export function duration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function timeAgo(date: string) {
  const diff = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return new Date(date).toLocaleDateString();
}

import { parseUsageJson } from "@/lib/model-pricing";

export interface LogEntry {
  kind: "assistant" | "tools" | "result";
  text: string;
  toolNames?: string[];
  timestamp?: string;
}

export interface DetailedRunEvent {
  kind: "assistant" | "thinking" | "tool_use" | "tool_result" | "system" | "raw";
  timestamp?: string;
  toolName?: string;
  title?: string;
  text?: string;
  input?: string;
  output?: string;
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
        } else if (type === "item.completed" || type === "item.started") {
          const item = chunk.item as Record<string, unknown> | undefined;
          const itemType = typeof item?.type === "string" ? item.type : "";

          if (itemType === "agent_message" && type === "item.completed") {
            const text = typeof item?.text === "string" ? item.text.trim() : "";
            if (text) items.push({ kind: "text", text, ts });
          }

          if (itemType === "command_execution") {
            items.push({ kind: "tool", text: "", toolName: "Bash", ts });

            if (type === "item.completed") {
              const output = typeof item?.aggregated_output === "string" ? item.aggregated_output.trim() : "";
              if (output) {
                items.push({ kind: "result", text: output, ts });
              }
            }
          }
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

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseDetailedRunLog(raw: string): DetailedRunEvent[] {
  const lines = raw.split("\n").filter(Boolean);
  const events: DetailedRunEvent[] = [];

  for (const line of lines) {
    try {
      const outer = JSON.parse(line) as { ts?: string; stream?: string; chunk?: string };
      const ts = outer.ts || "";
      const chunkStr = outer.chunk ?? "";
      let chunk: Record<string, any> | null = null;

      try {
        chunk = JSON.parse(chunkStr);
      } catch {
        events.push({
          kind: "raw",
          timestamp: ts,
          text: chunkStr || line,
        });
        continue;
      }

      if (!chunk) {
        events.push({
          kind: "raw",
          timestamp: ts,
          text: chunkStr || line,
        });
        continue;
      }

      const type = chunk.type as string | undefined;

      if (type === "assistant" && chunk.message?.content) {
        for (const block of chunk.message.content as Array<Record<string, any>>) {
          if (block.type === "thinking" && block.thinking) {
            events.push({
              kind: "thinking",
              timestamp: ts,
              text: block.thinking,
            });
            continue;
          }

          if (block.type === "text" && block.text) {
            events.push({
              kind: "assistant",
              timestamp: ts,
              text: block.text,
            });
            continue;
          }

          if (block.type === "tool_use" && block.name) {
            const input = block.input ?? {};
            const preferredInput =
              typeof input?.command === "string"
                ? input.command
                : typeof input?.description === "string"
                  ? input.description
                  : stringifyValue(input);

            events.push({
              kind: "tool_use",
              timestamp: ts,
              toolName: block.name,
              title: humanizeToolName(block.name),
              input: preferredInput,
            });
          }
        }
        continue;
      }

      if (type === "item.started" || type === "item.completed") {
        const item = chunk.item as Record<string, any> | undefined;
        const itemType = typeof item?.type === "string" ? item.type : undefined;

        if (itemType === "agent_message" && type === "item.completed" && typeof item?.text === "string") {
          events.push({
            kind: "assistant",
            timestamp: ts,
            text: item.text,
          });
          continue;
        }

        if (itemType === "command_execution") {
          const command = typeof item?.command === "string" ? item.command : "";
          const output =
            typeof item?.aggregated_output === "string"
              ? item.aggregated_output.trim()
              : "";
          const exitCode = item?.exit_code;

          if (type === "item.started") {
            events.push({
              kind: "tool_use",
              timestamp: ts,
              toolName: "Bash",
              title: "Ran command",
              input: command,
            });
            continue;
          }

          if (output || exitCode !== null && exitCode !== undefined) {
            events.push({
              kind: "tool_result",
              timestamp: ts,
              title: exitCode !== null && exitCode !== undefined ? `Exit code: ${String(exitCode)}` : "Command output",
              output: output || "Command completed with no captured output.",
            });
            continue;
          }
        }
      }

      if (type === "user" && chunk.message?.content) {
        for (const block of chunk.message.content as Array<Record<string, any>>) {
          if (block.type === "tool_result") {
            events.push({
              kind: "tool_result",
              timestamp: ts || chunk.timestamp,
              output: stringifyValue(block.content),
            });
            continue;
          }

          if (block.type === "text" && block.text) {
            events.push({
              kind: "raw",
              timestamp: ts || chunk.timestamp,
              text: block.text,
            });
          }
        }
        continue;
      }

      if (type === "system") {
        const parts = [
          chunk.subtype,
          chunk.hook_name,
          chunk.output,
          chunk.stdout,
          chunk.stderr,
        ].filter(Boolean);
        events.push({
          kind: "system",
          timestamp: ts,
          title: "System",
          text: parts.join("\n"),
        });
        continue;
      }

      if (type === "result") {
        events.push({
          kind: "tool_result",
          timestamp: ts,
          title: "Run result",
          output: typeof chunk.result === "string" ? chunk.result : stringifyValue(chunk.result),
        });
        continue;
      }

      events.push({
        kind: "raw",
        timestamp: ts,
        text: chunkStr || line,
      });
    } catch {
      events.push({
        kind: "raw",
        text: line,
      });
    }
  }

  return events;
}

export function parseUsage(usageJson: string | null): { cost: string; tokens: string } | null {
  if (!usageJson) return null;
  try {
    const usage = parseUsageJson(usageJson);
    if (!usage) return null;
    const cost = usage.costUsd > 0 ? `$${usage.costUsd.toFixed(4)}` : null;
    const output = usage.outputTokens || 0;
    const input = usage.inputTokens || 0;
    const cache = usage.cachedInputTokens || 0;
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

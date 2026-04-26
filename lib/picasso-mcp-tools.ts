import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PICASSO_RUN_TIMEOUT_MS = 120_000;
const PICASSO_DEFAULT_TIMEOUT_MS = 600_000;
const PICASSO_RECORDING_DIR = path.join(tmpdir(), "paperclip-picasso-recordings");
const MCP_PROTOCOL_VERSION = "2024-11-05";

const PICASSO_REPO_CANDIDATES = [
  process.env.PICASSO_DEV_TOOLS_PATH,
  "/Users/guyso/Code/Wix/picasso-dev-tools",
  "/Users/guyso/Code/picasso-dev-tools",
].filter((value): value is string => Boolean(value));

interface PicassoCliCommand {
  command: string;
  args: string[];
  cwd?: string;
  label: string;
}

interface PicassoRecordingSummary {
  recordingPath: string;
  siteId?: string;
  conversationId?: string;
  appSpecId?: string;
  projectId?: string;
  developmentUrl?: string;
  publicUrl?: string;
  appSpecStatus?: string;
  statusOptions?: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface PicassoToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function getExpectedRecordingPath(saveToFile: string): string {
  return saveToFile.endsWith(".recording") ? saveToFile : `${saveToFile}.recording`;
}

function toKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function buildCliArgs(params: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean") {
      if (value) args.push(`--${toKebab(key)}`);
    } else {
      args.push(`--${toKebab(key)}`, String(value));
    }
  }
  return args;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePicassoCliCommand(command: string, params: Record<string, unknown>, positionals: string[]) {
  for (const repoPath of PICASSO_REPO_CANDIDATES) {
    const cliPath = path.join(repoPath, "packages/picasso-dev-tools/src/cli.ts");
    if (await pathExists(cliPath)) {
      return {
        command: "npx",
        args: ["tsx", "packages/picasso-dev-tools/src/cli.ts", command, ...positionals, ...buildCliArgs(params)],
        cwd: repoPath,
        label: `repo-local picasso-dev-tools (${repoPath})`,
      } satisfies PicassoCliCommand;
    }
  }

  return {
    command: "npx",
    args: ["@wix/picasso-dev-tools", command, ...positionals, ...buildCliArgs(params)],
    label: "@wix/picasso-dev-tools package",
  } satisfies PicassoCliCommand;
}

async function ensureRecordingPath(command: string, params: Record<string, unknown>) {
  if (command !== "run") {
    return { params, recordingPath: undefined as string | undefined };
  }

  const explicitSaveToFile = typeof params.saveToFile === "string" ? params.saveToFile : undefined;
  if (explicitSaveToFile) {
    return {
      params,
      recordingPath: getExpectedRecordingPath(explicitSaveToFile),
    };
  }

  await mkdir(PICASSO_RECORDING_DIR, { recursive: true });
  const recordingBase = path.join(
    PICASSO_RECORDING_DIR,
    `picasso-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return {
    params: {
      ...params,
      saveToFile: recordingBase,
    },
    recordingPath: getExpectedRecordingPath(recordingBase),
  };
}

function trimOutput(output: string, maxChars = 8_000) {
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars)}\n…output truncated…`;
}

async function parsePicassoRecording(recordingPath?: string): Promise<PicassoRecordingSummary | null> {
  if (!recordingPath || !(await pathExists(recordingPath))) {
    return null;
  }

  const summary: PicassoRecordingSummary = { recordingPath };
  const content = await readFile(recordingPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry?.type === "log") {
      const message = entry?.data?.message;
      if (typeof message === "string") {
        const siteIdMatch = message.match(/^Site ID:\s+([0-9a-f-]{36})$/i);
        if (siteIdMatch) summary.siteId = siteIdMatch[1];

        const conversationIdMatch = message.match(/^Conversation ID:\s+([0-9a-f-]{36})$/i);
        if (conversationIdMatch) summary.conversationId = conversationIdMatch[1];

        const appSpecIdMatch = message.match(/^App Spec ID:\s+([0-9a-f-]{36})$/i);
        if (appSpecIdMatch) summary.appSpecId = appSpecIdMatch[1];

        const projectIdMatch = message.match(/^Project ID:\s+([0-9a-f-]{36})$/i);
        if (projectIdMatch) summary.projectId = projectIdMatch[1];
      }
    }

    if (entry?.type === "network request") {
      const responseData = entry?.data?.response?.data;
      if (responseData?.projectId && typeof responseData.projectId === "string") {
        summary.projectId = responseData.projectId;
      }
      if (responseData?.developmentUrl && typeof responseData.developmentUrl === "string") {
        summary.developmentUrl = responseData.developmentUrl;
      }
      if (responseData?.siteUrl && typeof responseData.siteUrl === "string") {
        summary.publicUrl = responseData.siteUrl;
      }
      if (responseData?.primarySiteUrl && typeof responseData.primarySiteUrl === "string") {
        summary.publicUrl = responseData.primarySiteUrl;
      }
      if (responseData?.status && typeof responseData.status === "string") {
        summary.appSpecStatus = responseData.status;
      }
      if (responseData?.statusOptions && typeof responseData.statusOptions === "object") {
        summary.statusOptions = Object.fromEntries(
          Object.entries(responseData.statusOptions).filter(([, value]) => typeof value === "string"),
        ) as Record<string, string>;
      }
    }
  }

  const hasArtifacts =
    summary.siteId ||
    summary.conversationId ||
    summary.appSpecId ||
    summary.projectId ||
    summary.developmentUrl ||
    summary.publicUrl ||
    summary.appSpecStatus;

  return hasArtifacts ? summary : null;
}

function formatPicassoSummary(
  summary: PicassoRecordingSummary | null,
  label: string,
  output: string,
  timedOut: boolean,
) {
  const lines = [
    timedOut
      ? `Picasso CLI timed out after ${PICASSO_RUN_TIMEOUT_MS / 1000}s via ${label}.`
      : `Picasso CLI finished via ${label}.`,
  ];

  if (summary) {
    lines.push(
      `PICASSO_EVIDENCE: ${JSON.stringify({
        recordingPath: summary.recordingPath,
        siteId: summary.siteId,
        conversationId: summary.conversationId,
        appSpecId: summary.appSpecId,
        projectId: summary.projectId,
        developmentUrl: summary.developmentUrl,
        publicUrl: summary.publicUrl,
        appSpecStatus: summary.appSpecStatus,
        statusOptions: summary.statusOptions,
      })}`,
    );
  }

  if (output.trim()) {
    lines.push("", trimOutput(output));
  }

  return lines.join("\n");
}

async function runPicasso(command: string, params: Record<string, unknown>, positionals: string[] = []): Promise<ToolResult> {
  const { params: normalizedParams, recordingPath } = await ensureRecordingPath(command, params);
  const cli = await resolvePicassoCliCommand(command, normalizedParams, positionals);

  try {
    const { stdout, stderr } = await exec(cli.command, cli.args, {
      cwd: cli.cwd,
      timeout: command === "run" ? PICASSO_RUN_TIMEOUT_MS : PICASSO_DEFAULT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter(Boolean).join("\n");
    const summary = await parsePicassoRecording(recordingPath);
    return {
      content: [
        {
          type: "text",
          text: formatPicassoSummary(summary, cli.label, output || "Command completed successfully.", false),
        },
      ],
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; signal?: string };
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
    const summary = await parsePicassoRecording(recordingPath);
    const timedOut = err.killed || err.signal === "SIGTERM";
    return {
      content: [
        {
          type: "text",
          text: formatPicassoSummary(summary, cli.label, output, timedOut),
        },
      ],
      isError: !summary,
    };
  }
}

const PICASSO_TOOLS: PicassoToolDefinition[] = [
  {
    name: "picasso_run",
    description: "Run an end-to-end flow of Picasso, from prompt to complete site",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The prompt to use for site generation" },
        designer: { type: "string", description: "Designer ID (GUID) or 'none'" },
        saveToFile: { type: "string", description: "Save a recording of this run to a file" },
        forcedSelectedPresetId: { type: "string", description: "Force a specific branding preset ID (GUID)" },
        devMessage: { type: "string", description: "Override the default codegen workflow" },
      },
      additionalProperties: false,
    },
    invoke: (args) => runPicasso("run", args),
  },
  {
    name: "picasso_test",
    description:
      "Test generation of multiple sites in parallel from a CSV file. CSV must have Prompt and Designer columns, optional forcedSelectedPresetId.",
    inputSchema: {
      type: "object",
      properties: {
        pathToCsv: { type: "string", description: "Path to CSV file with test cases" },
        createCsv: { type: "boolean", description: "Create a CSV template and exit without running tests" },
        maxParallel: { type: "number", minimum: 1, maximum: 15, description: "Max parallel site generations (default: 6)" },
        outputDir: { type: "string", description: "Directory to save output files (default: output)" },
        devMessage: { type: "string", description: "Override the default codegen workflow" },
      },
      required: ["pathToCsv"],
      additionalProperties: false,
    },
    invoke: ({ pathToCsv, ...rest }) => runPicasso("test", rest, [String(pathToCsv)]),
  },
  {
    name: "picasso_metrics",
    description: "Generate a detailed metrics report (CSV) from recording files produced by picasso_test runs.",
    inputSchema: {
      type: "object",
      properties: {
        inputDir: { type: "string", description: "Directory with .recording files (default: ./results)" },
        outputDir: { type: "string", description: "Directory to save the report (default: same as input)" },
        outputFile: { type: "string", description: "Output CSV filename (default: picasso-metrics-report.csv)" },
        suffix: { type: "string", description: "Suffix to append before .csv" },
        prefix: { type: "string", description: "Prefix to prepend to filename" },
        timestamp: { type: "boolean", description: "Auto-append timestamp to filename to avoid overwriting" },
      },
      additionalProperties: false,
    },
    invoke: (args) => runPicasso("metrics", args),
  },
  {
    name: "picasso_iterations_metrics",
    description:
      "Run iteration jobs and produce a cost/duration CSV report. Input CSV must have msid, prompt columns and optional jobMode (AGENT or ASK).",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Path to CSV with msid, prompt, jobMode headers" },
        outDir: { type: "string", description: "Output directory" },
        filenamePrefix: { type: "string", description: "CSV filename prefix (default: iteration-metrics-report)" },
        timestamp: { type: "boolean", description: "Append timestamp to output filename" },
        concurrency: { type: "number", minimum: 1, maximum: 20, description: "Max concurrent jobs (default: 4)" },
        dryRun: { type: "boolean", description: "Validate inputs and exit without running" },
      },
      required: ["input"],
      additionalProperties: false,
    },
    invoke: (args) => runPicasso("iterations-metrics", args),
  },
];

function jsonRpcSuccess(id: JsonRpcRequest["id"], result: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

export async function handlePicassoMcpRequest(request: JsonRpcRequest) {
  const id = request.id ?? null;
  const method = request.method;

  if (!method) {
    return jsonRpcError(id, -32600, "Invalid Request");
  }

  if (method === "initialize") {
    return jsonRpcSuccess(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: {
        name: "picasso-dev-tools",
        version: "1.0.0",
      },
    });
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return jsonRpcSuccess(id, {
      tools: PICASSO_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const name = request.params?.name;
    if (typeof name !== "string") {
      return jsonRpcError(id, -32602, "Invalid tool call parameters");
    }

    const tool = PICASSO_TOOLS.find((entry) => entry.name === name);
    if (!tool) {
      return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
    }

    const rawArgs = request.params?.arguments;
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    const result = await tool.invoke(args);
    return jsonRpcSuccess(id, result);
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

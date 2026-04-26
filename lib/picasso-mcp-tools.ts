import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PICASSO_RUN_TIMEOUT_MS = 120_000;
const PICASSO_DEFAULT_TIMEOUT_MS = 600_000;
const PICASSO_RECORDING_DIR = path.join(tmpdir(), "paperclip-picasso-recordings");
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

async function runPicasso(
  command: string,
  params: Record<string, unknown>,
  positionals: string[] = [],
) {
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
          type: "text" as const,
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
          type: "text" as const,
          text: formatPicassoSummary(summary, cli.label, output, timedOut),
        },
      ],
      isError: !summary,
    };
  }
}

export function createPicassoMcpServer(): McpServer {
  const server = new McpServer({
    name: "picasso-dev-tools",
    version: "1.0.0",
  });

  server.tool(
    "picasso_run",
    "Run an end-to-end flow of Picasso, from prompt to complete site",
    {
      prompt: z.string().optional().describe("The prompt to use for site generation"),
      designer: z.string().optional().describe("Designer ID (GUID) or 'none'"),
      saveToFile: z.string().optional().describe("Save a recording of this run to a file"),
      forcedSelectedPresetId: z.string().optional().describe("Force a specific branding preset ID (GUID)"),
      devMessage: z.string().optional().describe("Override the default codegen workflow"),
    },
    async (params) => runPicasso("run", params),
  );

  server.tool(
    "picasso_test",
    "Test generation of multiple sites in parallel from a CSV file. CSV must have Prompt and Designer columns, optional forcedSelectedPresetId.",
    {
      pathToCsv: z.string().describe("Path to CSV file with test cases"),
      createCsv: z.boolean().optional().describe("Create a CSV template and exit without running tests"),
      maxParallel: z.number().min(1).max(15).optional().describe("Max parallel site generations (default: 6)"),
      outputDir: z.string().optional().describe("Directory to save output files (default: output)"),
      devMessage: z.string().optional().describe("Override the default codegen workflow"),
    },
    async ({ pathToCsv, ...rest }) => runPicasso("test", rest, [pathToCsv]),
  );

  server.tool(
    "picasso_metrics",
    "Generate a detailed metrics report (CSV) from recording files produced by picasso_test runs.",
    {
      inputDir: z.string().optional().describe("Directory with .recording files (default: ./results)"),
      outputDir: z.string().optional().describe("Directory to save the report (default: same as input)"),
      outputFile: z.string().optional().describe("Output CSV filename (default: picasso-metrics-report.csv)"),
      suffix: z.string().optional().describe("Suffix to append before .csv"),
      prefix: z.string().optional().describe("Prefix to prepend to filename"),
      timestamp: z.boolean().optional().describe("Auto-append timestamp to filename to avoid overwriting"),
    },
    async (params) => runPicasso("metrics", params),
  );

  server.tool(
    "picasso_iterations_metrics",
    "Run iteration jobs and produce a cost/duration CSV report. Input CSV must have msid, prompt columns and optional jobMode (AGENT or ASK).",
    {
      input: z.string().describe("Path to CSV with msid, prompt, jobMode headers"),
      outDir: z.string().optional().describe("Output directory"),
      filenamePrefix: z.string().optional().describe("CSV filename prefix (default: iteration-metrics-report)"),
      timestamp: z.boolean().optional().describe("Append timestamp to output filename"),
      concurrency: z.number().min(1).max(20).optional().describe("Max concurrent jobs (default: 4)"),
      dryRun: z.boolean().optional().describe("Validate inputs and exit without running"),
    },
    async (params) => runPicasso("iterations-metrics", params),
  );

  return server;
}

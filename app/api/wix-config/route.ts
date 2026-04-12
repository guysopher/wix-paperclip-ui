import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";

const CONFIG_DIR = join(process.cwd(), ".wix-config");
const CONFIG_FILE = join(CONFIG_DIR, "sites.json");

// The workspace where Paperclip agents run
const AGENT_WORKSPACE = process.cwd();
const WIX_MD_PATH = join(AGENT_WORKSPACE, "WIX.md");

interface WixSiteConfig {
  [companyId: string]: {
    siteId: string;
    siteName: string;
    siteUrl?: string;
    connectedAt: string;
  };
}

async function readConfig(): Promise<WixSiteConfig> {
  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeConfig(config: WixSiteConfig) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function writeWixMd(siteName: string, siteId: string, siteUrl?: string) {
  const content = `# Wix Site Integration

This company is connected to a Wix site. You have access to Wix MCP tools to manage it.

## Connected Site
- **Name**: ${siteName}
- **Site ID**: ${siteId}
${siteUrl ? `- **URL**: ${siteUrl}` : ""}

## Available Wix Tools

You have access to the following Wix MCP tools during your work sessions:

- **CallWixSiteAPI** — Call any Wix REST API on the connected site
- **ManageWixSite** — Manage site settings and configuration
- **ListWixSites** — List available Wix sites
- **SearchWixRESTDocumentation** — Search Wix API docs
- **ReadFullDocsArticle** — Read Wix documentation articles
- **WixREADME** — Get Wix context and recipes

## How to Use

When a task involves the Wix site (managing products, blog posts, bookings, contacts, CMS content, etc.):

1. Call **WixREADME** first to get context and find relevant recipes
2. Use **CallWixSiteAPI** with \`siteId: "${siteId}"\` to make API calls
3. Always target this specific site ID when making calls

## Important

- Always use site ID \`${siteId}\` when calling Wix APIs
- Check installed apps before using app-specific APIs
- Use recipes from WixREADME for common operations
`;
  await writeFile(WIX_MD_PATH, content);
}

async function removeWixMd() {
  try { await unlink(WIX_MD_PATH); } catch { /* file may not exist */ }
}

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  const config = await readConfig();
  if (companyId) {
    return NextResponse.json(config[companyId] || null);
  }
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  const { companyId, siteId, siteName, siteUrl } = await request.json();
  if (!companyId || !siteId) {
    return NextResponse.json({ error: "companyId and siteId required" }, { status: 400 });
  }
  const config = await readConfig();
  config[companyId] = { siteId, siteName, siteUrl, connectedAt: new Date().toISOString() };
  await writeConfig(config);
  await writeWixMd(siteName, siteId, siteUrl);
  return NextResponse.json(config[companyId]);
}

export async function DELETE(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }
  const config = await readConfig();
  delete config[companyId];
  await writeConfig(config);
  await removeWixMd();
  return NextResponse.json({ ok: true });
}

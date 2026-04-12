import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import {
  getCompanyWixBinding,
  mergeCompanyDescription,
} from "@/lib/company-metadata";

const CONFIG_DIR = join(process.cwd(), ".wix-config");
const CONFIG_FILE = join(CONFIG_DIR, "sites.json");
const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

// The workspace where Paperclip agents run
const AGENT_WORKSPACE = process.cwd();
const WIX_MD_PATH = join(AGENT_WORKSPACE, "WIX.md");

interface WixSiteConfig {
  [companyId: string]: {
    siteId: string;
    siteName: string;
    siteUrl?: string;
    connectedAt: string;
    metaSiteId?: string;
    activationIssueId?: string;
    auth?: Record<string, string>;
    data?: Record<string, unknown>;
  };
}

interface PaperclipCompany {
  id: string;
  description: string;
  updatedAt: string;
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

async function paperclip<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }

  return response.json();
}

function toConfigResponse(
  companyId: string,
  storedConfig: WixSiteConfig[string] | undefined,
  company: PaperclipCompany | null,
) {
  const binding = company ? getCompanyWixBinding(company.description) : undefined;
  const siteId = binding?.siteId || storedConfig?.siteId;
  const siteName = binding?.siteName || storedConfig?.siteName;

  if (!siteId || !siteName) {
    return null;
  }

  return {
    siteId,
    siteName,
    siteUrl: binding?.siteUrl || storedConfig?.siteUrl,
    connectedAt: storedConfig?.connectedAt || company?.updatedAt || new Date().toISOString(),
    metaSiteId: binding?.metaSiteId,
    activationIssueId: binding?.activationIssueId,
    auth: binding?.auth,
    data: binding?.data,
    companyId,
  };
}

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId");
  const config = await readConfig();
  if (companyId) {
    let company: PaperclipCompany | null = null;
    try {
      company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
    } catch {
      company = null;
    }
    return NextResponse.json(toConfigResponse(companyId, config[companyId], company));
  }
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  const { companyId, siteId, siteName, siteUrl, metaSiteId, auth, data } = await request.json();
  if (!companyId || !siteId) {
    return NextResponse.json({ error: "companyId and siteId required" }, { status: 400 });
  }
  const config = await readConfig();
  config[companyId] = { siteId, siteName, siteUrl, connectedAt: new Date().toISOString() };
  await writeConfig(config);
  await writeWixMd(siteName, siteId, siteUrl);

  let company: PaperclipCompany | null = null;
  try {
    company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
    await paperclip<PaperclipCompany>(`/companies/${companyId}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: mergeCompanyDescription(company.description, {
          wixBinding: {
            metaSiteId: metaSiteId || undefined,
            siteId,
            siteName,
            siteUrl: siteUrl || undefined,
            auth:
              auth && typeof auth === "object" && !Array.isArray(auth)
                ? (auth as Record<string, string>)
                : undefined,
            data:
              data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : undefined,
          },
        }),
      }),
    });
    company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
  } catch {
    company = null;
  }

  return NextResponse.json(toConfigResponse(companyId, config[companyId], company));
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

  try {
    const company = await paperclip<PaperclipCompany>(`/companies/${companyId}`);
    await paperclip<PaperclipCompany>(`/companies/${companyId}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: mergeCompanyDescription(company.description, {
          wixBinding: {
            siteId: undefined,
            siteName: undefined,
            siteUrl: undefined,
            auth: undefined,
            data: undefined,
          },
        }),
      }),
    });
  } catch {
    // Best-effort cleanup only.
  }

  return NextResponse.json({ ok: true });
}

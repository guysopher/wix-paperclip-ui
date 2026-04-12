import { readFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const CONFIG_FILE = join(process.cwd(), ".wix-config", "sites.json");
const client = process.env.OPENAI_API_KEY ? new OpenAI() : null;

interface WixSiteConfig {
  [companyId: string]: {
    siteId: string;
    siteName: string;
    siteUrl?: string;
    connectedAt: string;
  };
}

interface SiteContext {
  siteId?: string;
  siteName?: string;
  siteUrl?: string;
}

async function readConfig(): Promise<WixSiteConfig> {
  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as WixSiteConfig;
  } catch {
    return {};
  }
}

async function getConfiguredSite(companyId: string): Promise<SiteContext | null> {
  const config = await readConfig();
  return config[companyId] || null;
}

async function fetchSiteText(siteUrl: string): Promise<string> {
  try {
    const res = await fetch(siteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WixAIBusinessManager/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return "";
    }

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 6000);
  } catch {
    return "";
  }
}

function buildFallbackKnowledge(site: SiteContext, siteText: string): string {
  const lines: string[] = [];

  if (site.siteName) {
    lines.push(`Business name: ${site.siteName}`);
  }
  if (site.siteUrl) {
    lines.push(`Site URL: ${site.siteUrl}`);
  }
  if (site.siteId) {
    lines.push(`Wix site ID: ${site.siteId}`);
  }

  if (siteText) {
    lines.push(`Observed site content: ${siteText.slice(0, 1200)}`);
  } else {
    lines.push("Observed site content: Not available yet.");
  }

  lines.push("Open questions: Confirm the exact business offering, target customers, and current priorities.");

  return lines.join("\n");
}

async function summarizeKnowledge(site: SiteContext, siteText: string): Promise<string> {
  const fallback = buildFallbackKnowledge(site, siteText);

  if (!client) {
    return fallback;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            'You generate a "common business knowledge" snapshot for an AI Business Manager activation flow. Return only plain text. Keep it concise and factual. Include: business identity, what the business appears to sell or offer, who it likely serves, signals from the site, and explicit gaps or assumptions that still need user confirmation.',
        },
        {
          role: "user",
          content: `Connected site context:
${JSON.stringify(site, null, 2)}

Observed site text:
${siteText || "No site text available."}`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const msid = request.nextUrl.searchParams.get("msid")?.trim() || "";
  const siteIdParam = request.nextUrl.searchParams.get("siteId")?.trim() || "";
  const siteNameParam = request.nextUrl.searchParams.get("siteName")?.trim() || "";
  const siteUrlParam = request.nextUrl.searchParams.get("siteUrl")?.trim() || "";

  const configuredSite = msid ? await getConfiguredSite(msid) : null;
  const site: SiteContext = {
    siteId: siteIdParam || configuredSite?.siteId || msid || undefined,
    siteName: siteNameParam || configuredSite?.siteName || undefined,
    siteUrl: siteUrlParam || configuredSite?.siteUrl || undefined,
  };

  const siteText = site.siteUrl ? await fetchSiteText(site.siteUrl) : "";
  const content = await summarizeKnowledge(site, siteText);

  return NextResponse.json({
    content,
    connectedSite: site,
    hasKnowledge: Boolean(content.trim()),
  });
}

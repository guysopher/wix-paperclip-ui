import { NextRequest, NextResponse } from "next/server";

const WIX_BO_ORIGIN = (process.env.WIX_BO_ORIGIN || "https://wix-bo.com").replace(/\/$/, "");
const BO_TIMEOUT_MS = 15000;

type JsonRecord = Record<string, unknown>;

interface ComposeField {
  id?: string;
  value?: string;
}

interface ComposeSummary {
  applicable?: boolean;
  businessName?: ComposeField;
  businessDescription?: ComposeField;
  siteDescription?: ComposeField;
  targetAudience?: ComposeField;
  goals?: ComposeField;
  location?: ComposeField;
  tagline?: ComposeField;
  context?: ComposeField;
}

interface InsightConfig {
  id?: string;
  name?: string;
  description?: string;
  status?: string;
}

interface Insight {
  id?: string;
  content?: string;
  createdDate?: string;
  updatedDate?: string;
}

interface InsightPreview {
  configId: string;
  title: string;
  description?: string;
  status?: string;
  content: string;
  createdDate?: string;
  updatedDate?: string;
}

function getMetaSiteId(request: NextRequest): string {
  return (
    request.nextUrl.searchParams.get("metaSiteId")?.trim() ||
    request.nextUrl.searchParams.get("msid")?.trim() ||
    ""
  );
}

function copyRequestHeaders(request: NextRequest, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const cookie = request.headers.get("cookie");
  const userAgent = request.headers.get("user-agent");
  const acceptLanguage = request.headers.get("accept-language");
  const xXsrfToken = request.headers.get("x-xsrf-token");
  const xCsrfToken = request.headers.get("x-csrf-token");

  if (cookie) {
    headers.set("cookie", cookie);
  }
  if (userAgent) {
    headers.set("user-agent", userAgent);
  }
  if (acceptLanguage) {
    headers.set("accept-language", acceptLanguage);
  }
  if (xXsrfToken) {
    headers.set("x-xsrf-token", xXsrfToken);
  }
  if (xCsrfToken) {
    headers.set("x-csrf-token", xCsrfToken);
  }

  return headers;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

function getErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as JsonRecord;
  const directMessage = typeof record.message === "string" ? record.message : "";
  const directError = typeof record.error === "string" ? record.error : "";
  const nestedMessage =
    typeof record.details === "object" &&
    record.details &&
    "message" in (record.details as JsonRecord) &&
    typeof (record.details as JsonRecord).message === "string"
      ? ((record.details as JsonRecord).message as string)
      : "";

  return directMessage || directError || nestedMessage;
}

async function fetchBoJson(
  request: NextRequest,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    authorization?: string;
  },
): Promise<unknown> {
  const method = options?.method || "GET";
  const headers = copyRequestHeaders(request, {
    accept: "application/json",
  });

  if (options?.authorization) {
    headers.set("authorization", options.authorization);
  }

  let body: string | undefined;
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${WIX_BO_ORIGIN}${path}`, {
    method,
    headers,
    body,
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(BO_TIMEOUT_MS),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const message = getErrorMessage(payload);
    throw new Error(
      `Wix BO request failed for ${path} (${response.status}${message ? `: ${message}` : ""})`,
    );
  }

  return payload;
}

async function fetchAuthToken(request: NextRequest, metaSiteId: string): Promise<string> {
  const candidates = ["/ai-assistant/api/get-auth-token", "/api/get-auth-token"];
  let lastError: Error | null = null;

  for (const path of candidates) {
    try {
      const payload = await fetchBoJson(request, path, {
        method: "POST",
        body: { metaSiteId },
      });

      const token =
        payload && typeof payload === "object" && typeof (payload as JsonRecord).token === "string"
          ? ((payload as JsonRecord).token as string)
          : "";

      if (token) {
        return token;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown auth error");
    }
  }

  throw lastError || new Error("Failed to get a Wix metasite token");
}

function extractComposeField(payload: unknown): ComposeField | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  for (const value of Object.values(payload as JsonRecord)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const record = value as JsonRecord;
    if (typeof record.value === "string") {
      return {
        id: typeof record.id === "string" ? record.id : undefined,
        value: record.value.trim(),
      };
    }
  }

  return undefined;
}

async function fetchComposeSummary(
  request: NextRequest,
  authorization: string,
): Promise<ComposeSummary> {
  const paths = {
    applicable: "/_api/business-insights-service/v1/compose/is-applicable",
    businessName: "/_api/business-insights-service/v1/compose/busines-name",
    businessDescription: "/_api/business-insights-service/v1/compose/business-description",
    siteDescription: "/_api/business-insights-service/v1/compose/site-description",
    targetAudience: "/_api/business-insights-service/v1/compose/target-audience",
    goals: "/_api/business-insights-service/v1/compose/goals",
    location: "/_api/business-insights-service/v1/compose/location",
    tagline: "/_api/business-insights-service/v1/compose/tagline",
    context: "/_api/business-insights-service/v1/compose/context",
  } as const;

  const [
    applicableResult,
    businessNameResult,
    businessDescriptionResult,
    siteDescriptionResult,
    targetAudienceResult,
    goalsResult,
    locationResult,
    taglineResult,
    contextResult,
  ] = await Promise.allSettled([
    fetchBoJson(request, paths.applicable, { authorization }),
    fetchBoJson(request, paths.businessName, { authorization }),
    fetchBoJson(request, paths.businessDescription, { authorization }),
    fetchBoJson(request, paths.siteDescription, { authorization }),
    fetchBoJson(request, paths.targetAudience, { authorization }),
    fetchBoJson(request, paths.goals, { authorization }),
    fetchBoJson(request, paths.location, { authorization }),
    fetchBoJson(request, paths.tagline, { authorization }),
    fetchBoJson(request, paths.context, { authorization }),
  ]);

  const applicablePayload = applicableResult.status === "fulfilled" ? applicableResult.value : null;

  return {
    applicable:
      applicablePayload &&
      typeof applicablePayload === "object" &&
      typeof (applicablePayload as JsonRecord).applicable === "boolean"
        ? ((applicablePayload as JsonRecord).applicable as boolean)
        : undefined,
    businessName:
      businessNameResult.status === "fulfilled" ? extractComposeField(businessNameResult.value) : undefined,
    businessDescription:
      businessDescriptionResult.status === "fulfilled"
        ? extractComposeField(businessDescriptionResult.value)
        : undefined,
    siteDescription:
      siteDescriptionResult.status === "fulfilled"
        ? extractComposeField(siteDescriptionResult.value)
        : undefined,
    targetAudience:
      targetAudienceResult.status === "fulfilled"
        ? extractComposeField(targetAudienceResult.value)
        : undefined,
    goals: goalsResult.status === "fulfilled" ? extractComposeField(goalsResult.value) : undefined,
    location:
      locationResult.status === "fulfilled" ? extractComposeField(locationResult.value) : undefined,
    tagline:
      taglineResult.status === "fulfilled" ? extractComposeField(taglineResult.value) : undefined,
    context:
      contextResult.status === "fulfilled" ? extractComposeField(contextResult.value) : undefined,
  };
}

async function fetchInsightConfigs(
  request: NextRequest,
  authorization: string,
): Promise<InsightConfig[]> {
  const payload = await fetchBoJson(request, "/_api/insight-config-service/v1/insight-configs/query", {
    method: "POST",
    authorization,
    body: {
      query: {
        sort: [{ fieldName: "name", order: "ASC" }],
      },
    },
  });

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as JsonRecord).insightConfigs)) {
    return [];
  }

  return (payload as JsonRecord).insightConfigs as InsightConfig[];
}

async function fetchLatestInsight(
  request: NextRequest,
  authorization: string,
  config: InsightConfig,
): Promise<InsightPreview | null> {
  if (!config.id) {
    return null;
  }

  const payload = await fetchBoJson(request, "/_api/insight-service/v1/insights/query", {
    method: "POST",
    authorization,
    body: {
      query: {
        filter: {
          insightConfigId: config.id,
        },
        paging: {
          limit: 1,
          offset: 0,
        },
        sort: [{ fieldName: "createdDate", order: "DESC" }],
      },
    },
  });

  const insights =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as JsonRecord).insights)
      ? ((payload as JsonRecord).insights as Insight[])
      : [];

  const insight = insights.length > 0 ? insights[0] : null;

  if (!insight?.content?.trim()) {
    return null;
  }

  return {
    configId: config.id,
    title: config.name?.trim() || "Business knowledge",
    description: config.description?.trim() || undefined,
    status: config.status,
    content: insight.content.trim(),
    createdDate: insight.createdDate,
    updatedDate: insight.updatedDate,
  };
}

function collectComposeLines(summary: ComposeSummary): string[] {
  const lines: string[] = [];

  if (summary.businessName?.value) {
    lines.push(`Business name: ${summary.businessName.value}`);
  }
  if (summary.businessDescription?.value) {
    lines.push(`Business description: ${summary.businessDescription.value}`);
  }
  if (summary.siteDescription?.value) {
    lines.push(`Site description: ${summary.siteDescription.value}`);
  }
  if (summary.targetAudience?.value) {
    lines.push(`Target audience: ${summary.targetAudience.value}`);
  }
  if (summary.goals?.value) {
    lines.push(`Goals: ${summary.goals.value}`);
  }
  if (summary.location?.value) {
    lines.push(`Location: ${summary.location.value}`);
  }
  if (summary.tagline?.value) {
    lines.push(`Tagline: ${summary.tagline.value}`);
  }
  if (summary.context?.value) {
    lines.push(`Business context: ${summary.context.value}`);
  }

  return lines;
}

function buildKnowledgeContent(summary: ComposeSummary, insights: InsightPreview[]): string {
  const lines = collectComposeLines(summary);

  if (insights.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Additional Wix business knowledge:");
    for (const insight of insights) {
      lines.push(`- ${insight.title}: ${insight.content}`);
    }
  }

  return lines.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const metaSiteId = getMetaSiteId(request);
  if (!metaSiteId) {
    return NextResponse.json(
      {
        error: "metaSiteId is required",
        content: "",
        hasKnowledge: false,
      },
      { status: 400 },
    );
  }

  try {
    const authorization = await fetchAuthToken(request, metaSiteId);
    const composeSummary = await fetchComposeSummary(request, authorization);

    let insights: InsightPreview[] = [];
    const composeLineCount = collectComposeLines(composeSummary).length;

    if (composeLineCount < 3) {
      try {
        const configs = await fetchInsightConfigs(request, authorization);
        const relevantConfigs = configs
          .filter((config) => config.id && config.status !== "DRAFT")
          .slice(0, 8);

        const settledInsights = await Promise.allSettled(
          relevantConfigs.map((config) => fetchLatestInsight(request, authorization, config)),
        );

        insights = settledInsights
          .flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
          .slice(0, 4);
      } catch {
        insights = [];
      }
    }

    const content = buildKnowledgeContent(composeSummary, insights);

    return NextResponse.json({
      metaSiteId,
      content,
      hasKnowledge: Boolean(content),
      source:
        collectComposeLines(composeSummary).length > 0
          ? "business-insights"
          : insights.length > 0
            ? "insights-library"
            : "none",
      summary: composeSummary,
      insights,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load Wix common business knowledge";
    console.error("Failed to fetch Wix common business knowledge:", error);

    return NextResponse.json(
      {
        error: message,
        metaSiteId,
        content: "",
        hasKnowledge: false,
      },
      { status: 502 },
    );
  }
}

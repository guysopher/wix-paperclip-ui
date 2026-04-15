const URL_MATCHER = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_URLS_PER_MESSAGE = 2;
const MAX_TEXT_LENGTH = 2200;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#?\w+;/g, " ");
}

function cleanUrlCandidate(url: string): string {
  return url.replace(/[),.!?]+$/g, "");
}

function extractMetaTag(html: string, attribute: string, value: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${value}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${value}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return "";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) : "";
}

function stripHtml(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

async function fetchSingleUrlContext(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WixAIBusinessManager/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return `URL: ${url}\nFetch status: HTTP ${response.status}`;
    }

    const html = await response.text();
    const title =
      extractMetaTag(html, "property", "og:title")
      || extractMetaTag(html, "name", "twitter:title")
      || extractTitle(html);
    const description =
      extractMetaTag(html, "property", "og:description")
      || extractMetaTag(html, "name", "description")
      || extractMetaTag(html, "name", "twitter:description");
    const plainText = stripHtml(html);
    const trimmedText = plainText.length > MAX_TEXT_LENGTH
      ? `${plainText.slice(0, MAX_TEXT_LENGTH)}...`
      : plainText;

    const lines = [`URL: ${url}`];

    if (title) {
      lines.push(`Title: ${title}`);
    }

    if (description) {
      lines.push(`Description: ${description}`);
    }

    if (trimmedText) {
      lines.push(`Page text: ${trimmedText}`);
    } else {
      lines.push("Page text: [No readable page text found]");
    }

    return lines.join("\n");
  } catch {
    return `URL: ${url}\nFetch status: [Could not fetch the URL]`;
  }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_MATCHER) || [];
  const uniqueUrls: string[] = [];

  for (const match of matches) {
    const cleanUrl = cleanUrlCandidate(match);
    if (!cleanUrl || uniqueUrls.includes(cleanUrl)) {
      continue;
    }
    uniqueUrls.push(cleanUrl);
    if (uniqueUrls.length >= MAX_URLS_PER_MESSAGE) {
      break;
    }
  }

  return uniqueUrls;
}

export async function fetchUrlContexts(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map((url) => fetchSingleUrlContext(url)));
}

export async function appendFetchedUrlContext(text: string): Promise<string> {
  const urls = extractUrls(text);
  if (urls.length === 0) {
    return text;
  }

  const contexts = await fetchUrlContexts(urls);

  return `${text}\n\n[SYSTEM: The founder shared link context. Use this only if it is relevant and readable.\n${contexts.join("\n\n")}\n]`;
}

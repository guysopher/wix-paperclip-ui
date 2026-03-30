import { NextRequest, NextResponse } from "next/server";

/** Fetch a URL and return a text summary (stripped HTML → plain text, truncated). */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AgentsBay/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ text: `[Could not fetch: HTTP ${res.status}]` });
    }

    const html = await res.text();

    // Strip HTML tags, scripts, styles → plain text
    let text = html
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

    // Truncate to keep it reasonable for the LLM context
    if (text.length > 3000) text = text.slice(0, 3000) + "...";

    return NextResponse.json({ text });
  } catch (e: unknown) {
    return NextResponse.json({ text: "[Could not fetch the website]" });
  }
}

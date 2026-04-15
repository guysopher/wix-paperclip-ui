import { NextRequest, NextResponse } from "next/server";
import { fetchUrlContexts } from "@/lib/url-context";

/** Fetch a URL and return a text summary (stripped HTML → plain text, truncated). */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const [text] = await fetchUrlContexts([url]);
    return NextResponse.json({ text });
  } catch (e: unknown) {
    return NextResponse.json({ text: "[Could not fetch the website]" });
  }
}

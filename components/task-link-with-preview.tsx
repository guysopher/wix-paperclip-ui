"use client";

import { useState, type AnchorHTMLAttributes, type CSSProperties, type FocusEvent } from "react";
import type { Issue } from "@/lib/api";

type TaskPreviewIssue = Pick<Issue, "identifier" | "title" | "description">;

interface TaskLinkWithPreviewProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  issue?: TaskPreviewIssue | null;
  block?: boolean;
}

function summarizeDescription(description: string | null | undefined): string {
  if (!description) {
    return "No description yet.";
  }

  return description
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260) || "No description yet.";
}

export function extractTaskIdentifierFromHref(href: string | undefined): string | null {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, "https://paperclip.local");
    const match = url.pathname.match(/^\/tasks\/([^/?#]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function TaskLinkWithPreview({
  issue,
  block = false,
  children,
  href,
  ...anchorProps
}: TaskLinkWithPreviewProps) {
  const [open, setOpen] = useState(false);
  const showPreview = Boolean(issue);
  const previewDescription = summarizeDescription(issue?.description);
  const wrapperStyle: CSSProperties = block
    ? { position: "relative", display: "block", width: "100%" }
    : { position: "relative", display: "inline-block", maxWidth: "100%" };

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setOpen(false);
  };

  return (
    <span
      style={wrapperStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={handleBlur}
    >
      <a href={href} {...anchorProps}>
        {children}
      </a>
      {showPreview && open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            width: 320,
            maxWidth: "min(320px, calc(100vw - 32px))",
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(18, 31, 43, 0.96)",
            color: "white",
            boxShadow: "0 18px 45px rgba(8, 16, 24, 0.28)",
            border: "1px solid rgba(255,255,255,0.12)",
            zIndex: 2000,
            pointerEvents: "none",
            whiteSpace: "normal",
          }}
        >
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "rgba(255,255,255,0.72)",
              marginBottom: 8,
            }}
          >
            {issue?.identifier}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{issue?.title}</div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.84)",
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {previewDescription}
          </div>
        </span>
      ) : null}
    </span>
  );
}

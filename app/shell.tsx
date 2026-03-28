"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Box,
  Text,
  Heading,
  Divider,
} from "@wix/design-system";
import {
  Dashboard,
  Users,
  Checklist,
  Chat,
  Inbox,
  Refresh,
  Confirm,
  Globe,
} from "@wix/wix-ui-icons-common";
import { useBadgeCounts, type BadgeCounts } from "./providers";
import { CeoChatPanel } from "./ceo-chat-panel";

type CountKey = keyof BadgeCounts;

const NAV_ITEMS: Array<{ key: string; label: string; Icon: typeof Dashboard; countKey?: CountKey }> = [
  { key: "/", label: "Home", Icon: Dashboard },
  { key: "/inbox", label: "Inbox", Icon: Inbox, countKey: "inbox" },
  { key: "/tasks", label: "Tasks", Icon: Checklist, countKey: "tasks" },
  { key: "/runs", label: "Runs", Icon: Refresh, countKey: "runs" },
  { key: "/approvals", label: "Approvals", Icon: Confirm, countKey: "approvals" },
  { key: "/team", label: "Team", Icon: Users },
  { key: "/company", label: "Company", Icon: Globe },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const counts = useBadgeCounts();
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const navButton = (item: typeof NAV_ITEMS[0]) => {
    const isActive = pathname === item.key;
    const count = item.countKey ? counts[item.countKey] : 0;
    return (
      <button
        key={item.key}
        onClick={() => { router.push(item.key); setMenuOpen(false); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px 12px",
          borderRadius: 6,
          backgroundColor: isActive ? "rgba(255,255,255,0.15)" : "transparent",
          border: "none",
          borderLeftWidth: 3,
          borderLeftStyle: "solid",
          borderLeftColor: isActive ? "#3899ec" : "transparent",
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <item.Icon color={isActive ? "white" : "#b0b0b0"} />
        <Text size="small" light weight={isActive ? "bold" : "normal"}>
          {item.label}
        </Text>
        {count > 0 && (
          <span style={{
            marginLeft: "auto",
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: (item.countKey === "inbox" || item.countKey === "approvals") ? "#ee5951" : "rgba(255,255,255,0.2)",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 6px",
          }}>
            {count}
          </span>
        )}
      </button>
    );
  };

  const totalBadge = (counts.inbox || 0) + (counts.approvals || 0);

  return (
    <Box height="100vh" direction="horizontal">
      {/* Mobile header */}
      <div
        className="shell-mobile-header"
        style={{
          display: "none",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 50,
          backgroundColor: "#162d3d",
          zIndex: 998,
          alignItems: "center",
          padding: "0 14px",
          gap: 12,
        }}
      >
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, position: "relative" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
          </svg>
          {totalBadge > 0 && (
            <span style={{
              position: "absolute", top: -2, right: -4,
              minWidth: 16, height: 16, borderRadius: 8,
              backgroundColor: "#ee5951", color: "white",
              fontSize: 10, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 4px",
            }}>
              {totalBadge}
            </span>
          )}
        </button>
        <Text size="small" light weight="bold">Agents Bay</Text>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setChatOpen(!chatOpen)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
        >
          <Chat color="white" size="22px" />
        </button>
      </div>

      {/* Mobile overlay */}
      <div
        className={`shell-overlay${menuOpen ? " open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Sidebar */}
      <div
        className={`shell-sidebar${menuOpen ? " open" : ""}`}
        style={{
          width: 220,
          flexShrink: 0,
          backgroundColor: "#162d3d",
          padding: "18px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "0 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "white", fontSize: 13, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5,
          }}>
            AB
          </div>
          <div>
            <Heading size="small" light>Agents Bay</Heading>
            <Text size="tiny" light secondary>Your Wix AI Company</Text>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px" }}>
          {NAV_ITEMS.map(navButton)}
        </div>
        <div style={{ flexGrow: 1 }} />

        <div style={{ padding: "8px 12px" }}>
          <button
            onClick={() => { setChatOpen(!chatOpen); setMenuOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "10px 12px", borderRadius: 8,
              backgroundColor: chatOpen ? "#3899ec" : "rgba(56, 153, 236, 0.25)",
              border: chatOpen ? "none" : "1px solid rgba(56, 153, 236, 0.4)",
              cursor: "pointer", width: "100%", textAlign: "left",
              boxShadow: chatOpen ? "0 2px 8px rgba(56, 153, 236, 0.3)" : "none",
            }}
          >
            <Chat color="white" />
            <Text size="small" light weight="bold">Call the CEO</Text>
          </button>
        </div>
      </div>

      {/* Main content */}
      <Box direction="vertical" flexGrow={1} overflow="auto" backgroundColor="D70" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="shell-main-content">
          {children}
        </div>
      </Box>

      {/* CEO Chat slide-in panel */}
      {chatOpen && (
        <div
          className="ceo-chat-panel"
          style={{
            width: 380, flexShrink: 0,
            borderLeft: "1px solid #e0e0e0",
            height: "100vh",
            display: "flex", flexDirection: "column",
            background: "#f7f8fa",
          }}
        >
          <CeoChatPanel onClose={() => setChatOpen(false)} />
        </div>
      )}
    </Box>
  );
}

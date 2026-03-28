"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Box,
  Text,
  TextButton,
  Heading,
  Divider,
} from "@wix/design-system";
import {
  Dashboard,
  Users,
  Checklist,
  Chat,
  Settings,
  Inbox,
  Refresh,
  Confirm,
} from "@wix/wix-ui-icons-common";
import { useBadgeCounts, type BadgeCounts } from "./providers";
import { CeoChatPanel } from "./ceo-chat-panel";

type CountKey = keyof BadgeCounts;

const NAV_ITEMS: Array<{ key: string; label: string; Icon: typeof Dashboard; countKey?: CountKey }> = [
  { key: "/", label: "Dashboard", Icon: Dashboard },
  { key: "/inbox", label: "Inbox", Icon: Inbox, countKey: "inbox" },
  { key: "/team", label: "Team", Icon: Users },
  { key: "/tasks", label: "Tasks", Icon: Checklist, countKey: "tasks" },
  { key: "/approvals", label: "Approvals", Icon: Confirm, countKey: "approvals" },
  { key: "/runs", label: "Runs", Icon: Refresh, countKey: "runs" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const counts = useBadgeCounts();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <Box height="100vh" direction="horizontal">
      {/* Sidebar */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          backgroundColor: "#162d3d",
          padding: "18px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "0 18px", marginBottom: 24 }}>
          <Heading size="small" light>
            Agents Bay
          </Heading>
          <Text size="tiny" light secondary>
            AI Company Backoffice
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.key;
            const count = item.countKey ? counts[item.countKey] : 0;
            return (
              <button
                key={item.key}
                onClick={() => router.push(item.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 12px",
                  borderRadius: 6,
                  backgroundColor: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  border: "none",
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
          })}
        </div>
        <div style={{ flexGrow: 1 }} />

        {/* Talk to CEO button */}
        <div style={{ padding: "0 12px", marginBottom: 8 }}>
          <button
            onClick={() => setChatOpen(!chatOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 12px",
              borderRadius: 6,
              backgroundColor: chatOpen ? "#3899ec" : "rgba(56, 153, 236, 0.15)",
              border: "none",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
            }}
          >
            <Chat color="white" />
            <Text size="small" light weight="bold">
              Talk to CEO
            </Text>
          </button>
        </div>

        <Divider skin="light" />
        <div style={{ padding: "12px 24px", display: "flex", alignItems: "center", gap: 9 }}>
          <Settings color="#b0b0b0" />
          <TextButton size="small" skin="light" onClick={() => router.push("/settings")}>
            Settings
          </TextButton>
        </div>
      </div>

      {/* Main content */}
      <Box direction="vertical" flexGrow={1} overflow="auto" backgroundColor="D70">
        {children}
      </Box>

      {/* CEO Chat slide-in panel */}
      {chatOpen && (
        <div
          style={{
            width: 380,
            flexShrink: 0,
            borderLeft: "1px solid #e0e0e0",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#f7f8fa",
          }}
        >
          <CeoChatPanel onClose={() => setChatOpen(false)} />
        </div>
      )}
    </Box>
  );
}

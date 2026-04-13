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
  ChevronDown,
  Settings,
  Code,
  Feed,
} from "@wix/wix-ui-icons-common";
import { useBadgeCounts, useCompany, type BadgeCounts } from "./providers";
import { CeoChatPanel } from "./ceo-chat-panel";
import { CreateCompanyWizard } from "./create-company-wizard";

type CountKey = keyof BadgeCounts;

const NAV_ITEMS: Array<{ key: string; label: string; Icon: typeof Dashboard; countKey?: CountKey }> = [
  { key: "/", label: "Home", Icon: Dashboard },
  { key: "/activity", label: "Activity", Icon: Feed },
  { key: "/inbox", label: "Inbox", Icon: Inbox, countKey: "inbox" },
  { key: "/tasks", label: "Tasks", Icon: Checklist, countKey: "tasks" },
  { key: "/runs", label: "Runs", Icon: Refresh, countKey: "runs" },
  { key: "/approvals", label: "Approvals", Icon: Confirm, countKey: "approvals" },
  { key: "/team", label: "Team", Icon: Users, countKey: "team" },
  { key: "/wix", label: "Wix", Icon: Code },
  { key: "/company", label: "AI Team", Icon: Globe },
  { key: "/settings", label: "Settings", Icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const counts = useBadgeCounts();
  const { companyId, companies, setCompanyId, companyPath, refreshCompanies, wizardOpen, closeCreateWizard } = useCompany();
  const [chatOpen, setChatOpen] = useState(() => {
    // Load chat open state from localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('ceo-chat-open');
      return stored !== null ? stored === 'true' : true;
    }
    return true;
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Persist chat open/closed state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ceo-chat-open', String(chatOpen));
    }
  }, [chatOpen]);

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const navButton = (item: typeof NAV_ITEMS[0]) => {
    const isActive = item.key === "/" ? pathname === "/" : pathname.startsWith(item.key);
    const count = item.countKey ? counts[item.countKey] : 0;
    return (
      <button
        key={item.key}
        onClick={() => { router.push(companyPath(item.key)); setMenuOpen(false); }}
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

  const currentCompany = companies.find((c) => c.id === companyId);
  const hasActiveCompany = Boolean(currentCompany);

  useEffect(() => {
    if (!hasActiveCompany) {
      setChatOpen(false);
    }
  }, [hasActiveCompany]);

  const handleCompanyCreated = async (newCompanyId: string) => {
    await refreshCompanies();
    setCompanyId(newCompanyId);
    closeCreateWizard();
  };

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
        <Text size="small" light weight="bold">Wix AI Team</Text>
        <div style={{ flex: 1 }} />
        {hasActiveCompany && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, position: "relative" }}
          >
            <Chat color="white" size="22px" />
            {counts.chat > 0 && !chatOpen && (
              <span style={{
                position: "absolute", top: -2, right: -2,
                minWidth: 14, height: 14, borderRadius: 7,
                backgroundColor: "#ee5951", color: "white",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>!</span>
            )}
          </button>
        )}
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
        <div style={{ padding: "0 14px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 34, height: 34, borderRadius: "50%",
              background: "linear-gradient(135deg, #3899ec 0%, #1a4a6e 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontSize: 13, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5,
            }}>
              {(currentCompany?.name || "AB").slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Heading size="small" light>{currentCompany?.name || "Select AI Team"}</Heading>
              <Text size="tiny" light secondary>Your Wix AI Team</Text>
            </div>
            {/* Switcher icon */}
            <div style={{ display: "flex", gap: 4 }}>
              {companies.length > 1 && (
                <div style={{ position: "relative" }}>
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: 28, height: 28 }}
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: "rgba(255,255,255,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#b0b0b0">
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </div>
                </div>
              )}
              <button
                onClick={() => router.push("/new")}
                title="New AI Team"
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: "rgba(255,255,255,0.1)",
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#b0b0b0">
                  <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px" }}>
          {NAV_ITEMS.map(navButton)}
        </div>
        <div style={{ flexGrow: 1 }} />

        {hasActiveCompany && (
          <div style={{ padding: "8px 12px" }}>
            <button
              onClick={() => { setChatOpen(!chatOpen); setMenuOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "10px 12px", borderRadius: 8,
                backgroundColor: chatOpen ? "#3899ec" : counts.chat > 0 ? "rgba(56, 153, 236, 0.4)" : "rgba(56, 153, 236, 0.25)",
                border: chatOpen ? "none" : counts.chat > 0 ? "1px solid #3899ec" : "1px solid rgba(56, 153, 236, 0.4)",
                cursor: "pointer", width: "100%", textAlign: "left",
                boxShadow: chatOpen ? "0 2px 8px rgba(56, 153, 236, 0.3)" : "none",
                position: "relative",
              }}
            >
              <Chat color="white" />
              <Text size="small" light weight="bold">AI Team Lead</Text>
              {counts.chat > 0 && !chatOpen && (
                <span style={{
                  marginLeft: "auto",
                  minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: "#ee5951",
                  color: "white", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 5px",
                  animation: "pulse 2s infinite",
                }}>
                  !
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <Box direction="vertical" flexGrow={1} overflow="auto" backgroundColor="D70" style={{ paddingTop: "env(safe-area-inset-top)", minWidth: 0 }}>
        <div className="shell-main-content">
          {children}
        </div>
      </Box>

      {/* CEO Chat slide-in panel - always mounted, slides in/out */}
      {hasActiveCompany && (
        <div
          className="ceo-chat-panel"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            width: 380,
            height: "100vh",
            borderLeft: "1px solid #e0e0e0",
            display: "flex",
            flexDirection: "column",
            background: "#f7f8fa",
            transform: chatOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            zIndex: 100,
            boxShadow: chatOpen ? "-4px 0 12px rgba(0, 0, 0, 0.1)" : "none",
          }}
        >
          <CeoChatPanel onClose={() => setChatOpen(false)} />
        </div>
      )}

      {/* Create Company Wizard */}
      <CreateCompanyWizard
        open={wizardOpen}
        onClose={closeCreateWizard}
        onCreated={handleCompanyCreated}
      />
    </Box>
  );
}

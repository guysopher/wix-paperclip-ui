"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Page,
  Card,
  Box,
  Text,
  Button,
  Loader,
  FormField,
  Input,
  CopyClipboard,
  Badge,
  Tooltip,
} from "@wix/design-system";
import { Refresh, ExternalLink } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import { getCompany, type Company } from "@/lib/api";

interface WixSiteConfig {
  siteId: string;
  siteName: string;
  siteUrl?: string;
  connectedAt: string;
}

interface WixSiteProperties {
  name: string;
  url: string;
  published: boolean;
  language: string;
  locale?: { country?: string; languageCode?: string };
  multilingual?: boolean;
  createdDate?: string;
  installedApps?: string[];
}

function WixContent() {
  const { companyId } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [config, setConfig] = useState<WixSiteConfig | null>(null);
  const [siteProps, setSiteProps] = useState<WixSiteProperties | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProps, setLoadingProps] = useState(false);

  // Connect form
  const [connectSiteId, setConnectSiteId] = useState("");
  const [connectSiteName, setConnectSiteName] = useState("");
  const [connectSiteUrl, setConnectSiteUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const [c, cfg] = await Promise.all([
      getCompany(companyId),
      fetch(`/api/wix-config?companyId=${companyId}`).then((r) => r.json()).catch(() => null),
    ]);
    setCompany(c);
    setConfig(cfg);
    setLoading(false);

    // Fetch live site properties if connected
    if (cfg?.siteId) {
      setLoadingProps(true);
      try {
        const res = await fetch(`/api/wix-site-info?siteId=${cfg.siteId}`);
        const data = await res.json();
        if (!data.error) setSiteProps(data);
      } catch { /* skip */ }
      setLoadingProps(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async () => {
    if (!companyId || !connectSiteId.trim()) return;
    setConnecting(true);
    try {
      const result = await fetch("/api/wix-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          siteId: connectSiteId.trim(),
          siteName: connectSiteName.trim() || "Wix Site",
          siteUrl: connectSiteUrl.trim() || undefined,
        }),
      }).then((r) => r.json());
      setConfig(result);
      setConnectSiteId("");
      setConnectSiteName("");
      setConnectSiteUrl("");
      load();
    } catch { /* skip */ }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    if (!companyId) return;
    await fetch(`/api/wix-config?companyId=${companyId}`, { method: "DELETE" });
    setConfig(null);
    setSiteProps(null);
  };

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  if (!config) {
    return (
      <Page>
        <Page.Header title="Wix" subtitle="Connect your Wix site" />
        <Page.Content>
          <div style={{ maxWidth: 600 }}>
            <Card>
              <Card.Header title="Connect a Wix site" subtitle="Link a Wix site so your agents can manage it — products, blog, bookings, and more." />
              <Card.Content>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <FormField label="Site ID" required>
                    <Input size="small" value={connectSiteId} onChange={(e) => setConnectSiteId(e.currentTarget.value)} placeholder="e.g., 7c833926-ed51-4b50-bf91-5448e2c8b2cd" />
                  </FormField>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FormField label="Site name">
                      <Input size="small" value={connectSiteName} onChange={(e) => setConnectSiteName(e.currentTarget.value)} placeholder="e.g., My Online Store" />
                    </FormField>
                    <FormField label="Site URL (optional)">
                      <Input size="small" value={connectSiteUrl} onChange={(e) => setConnectSiteUrl(e.currentTarget.value)} placeholder="https://..." />
                    </FormField>
                  </div>
                  <div>
                    <Button size="small" onClick={handleConnect} disabled={!connectSiteId.trim() || connecting}>
                      {connecting ? "Connecting..." : "Connect Site"}
                    </Button>
                  </div>
                </div>
              </Card.Content>
            </Card>
          </div>
        </Page.Content>
      </Page>
    );
  }

  const siteId = config.siteId;
  const editorUrl = `https://manage.wix.com/dashboard/${siteId}`;
  const siteUrl = config.siteUrl || siteProps?.url;

  return (
    <Page>
      <Page.Header
        title="Wix"
        subtitle={config.siteName}
        actionsBar={
          <Box gap="6px" direction="horizontal">
            <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>Refresh</Button>
          </Box>
        }
      />
      <Page.Content>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>

          {/* Site identity card */}
          <Card>
            <Card.Content>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: "linear-gradient(135deg, #0C6EFC 0%, #4A9EFF 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{config.siteName}</div>
                  {siteUrl && (
                    <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                      {siteUrl} <ExternalLink size="12px" />
                    </a>
                  )}
                </div>
                <Badge size="small" skin="success">Connected</Badge>
              </div>
            </Card.Content>
          </Card>

          {/* Quick links */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <a href={editorUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Card>
                <Card.Content>
                  <div style={{ textAlign: "center", padding: "8px 0" }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="#3899ec"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </div>
                    <Text size="small" weight="bold">Dashboard</Text>
                    <br />
                    <Text size="tiny" secondary>Manage your site</Text>
                  </div>
                </Card.Content>
              </Card>
            </a>
            {siteUrl && (
              <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <Card>
                  <Card.Content>
                    <div style={{ textAlign: "center", padding: "8px 0" }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#3899ec"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                      </div>
                      <Text size="small" weight="bold">Live Site</Text>
                      <br />
                      <Text size="tiny" secondary>View your site</Text>
                    </div>
                  </Card.Content>
                </Card>
              </a>
            )}
            <a href={`https://manage.wix.com/dashboard/${siteId}/store/products`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Card>
                <Card.Content>
                  <div style={{ textAlign: "center", padding: "8px 0" }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="#3899ec"><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v12z"/></svg>
                    </div>
                    <Text size="small" weight="bold">Products</Text>
                    <br />
                    <Text size="tiny" secondary>Manage catalog</Text>
                  </div>
                </Card.Content>
              </Card>
            </a>
          </div>

          {/* Site details */}
          <Card>
            <Card.Header title="Site Details" />
            <Card.Content>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 16px", fontSize: 13 }}>
                  <Text size="small" secondary weight="bold">Site ID</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: 12, background: "#f5f5f5", padding: "2px 8px", borderRadius: 4 }}>{siteId}</code>
                  </div>

                  <Text size="small" secondary weight="bold">Site Name</Text>
                  <Text size="small">{config.siteName}</Text>

                  {siteUrl && (
                    <>
                      <Text size="small" secondary weight="bold">Site URL</Text>
                      <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>{siteUrl}</a>
                    </>
                  )}

                  <Text size="small" secondary weight="bold">Dashboard</Text>
                  <a href={editorUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>{editorUrl}</a>

                  <Text size="small" secondary weight="bold">Connected</Text>
                  <Text size="small">{new Date(config.connectedAt).toLocaleDateString()}</Text>

                  {siteProps && (
                    <>
                      {siteProps.language && (
                        <>
                          <Text size="small" secondary weight="bold">Language</Text>
                          <Text size="small">{siteProps.language}</Text>
                        </>
                      )}
                      {siteProps.locale?.country && (
                        <>
                          <Text size="small" secondary weight="bold">Country</Text>
                          <Text size="small">{siteProps.locale.country}</Text>
                        </>
                      )}
                      {siteProps.multilingual !== undefined && (
                        <>
                          <Text size="small" secondary weight="bold">Multilingual</Text>
                          <Badge size="tiny" skin={siteProps.multilingual ? "success" : "neutral"}>
                            {siteProps.multilingual ? "Enabled" : "Disabled"}
                          </Badge>
                        </>
                      )}
                    </>
                  )}
                </div>

                {loadingProps && (
                  <Box align="center" padding="12px 0">
                    <Loader size="tiny" />
                    <Text size="tiny" secondary style={{ marginLeft: 6 }}>Loading site properties...</Text>
                  </Box>
                )}
              </div>
            </Card.Content>
          </Card>

          {/* Agent access info */}
          <Card>
            <Card.Header title="Agent Access" subtitle="How your agents interact with this Wix site" />
            <Card.Content>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#3899ec", fontWeight: 600, flexShrink: 0 }}>CallWixSiteAPI</span>
                    <span>— Call any Wix REST API (products, orders, contacts, blog, bookings, etc.)</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#3899ec", fontWeight: 600, flexShrink: 0 }}>ManageWixSite</span>
                    <span>— Site-level management (settings, apps, publishing)</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#3899ec", fontWeight: 600, flexShrink: 0 }}>WixSiteBuilder</span>
                    <span>— Edit pages, layouts, sections, and visual design</span>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>

          {/* Danger zone */}
          <Card>
            <Card.Content>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#d32f2f" }}>Disconnect site</div>
                  <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Remove the Wix site connection. Agents will no longer be able to manage it.</div>
                </div>
                <Button size="small" skin="destructive" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>
      </Page.Content>
    </Page>
  );
}

export default function WixPage() {
  return <WixContent />;
}

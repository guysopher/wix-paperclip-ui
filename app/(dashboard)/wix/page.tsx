"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Page,
  Card,
  Box,
  Text,
  Button,
  Loader,
  Badge,
} from "@wix/design-system";
import { Refresh, ExternalLink } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import { getCompany, type Company } from "@/lib/api";
import { getCompanyVibeSite, getCompanyWixBinding } from "@/lib/company-metadata";

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Ignore clipboard failures.
  }
}

function WixContent() {
  const { companyId } = useCompany();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    const nextCompany = await getCompany(companyId);
    setCompany(nextCompany);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <Box align="center" verticalAlign="middle" height="400px"><Loader size="medium" /></Box>;
  }

  if (!company) {
    return (
      <Page>
        <Page.Header title="Wix" subtitle="No company loaded" />
        <Page.Content>
          <Text>No company found.</Text>
        </Page.Content>
      </Page>
    );
  }

  const binding = getCompanyWixBinding(company.description);
  const vibeSite = getCompanyVibeSite(company.description);
  const metaSiteId = binding?.metaSiteId || "";
  const siteId = binding?.siteId || "";
  const siteName = binding?.siteName || company.name;
  const siteUrl = binding?.siteUrl || "";
  const vibeSiteId = vibeSite?.siteId || "";
  const vibeSiteUrl = vibeSite?.siteUrl || "";
  const vibeSiteStatus = vibeSite?.status || "";
  const vibeSiteJobId = vibeSite?.jobId || "";
  const vibeSiteDevelopmentUrl = vibeSite?.developmentUrl || "";
  const editorUrl = siteId ? `https://manage.wix.com/dashboard/${siteId}` : "";
  const authJson = binding?.auth ? JSON.stringify(binding.auth, null, 2) : "";
  const dataJson = binding?.data ? JSON.stringify(binding.data, null, 2) : "";

  return (
    <Page>
      <Page.Header
        title="Wix"
        subtitle={siteName}
        actionsBar={
          <Box gap="6px" direction="horizontal">
            <Button size="small" priority="secondary" prefixIcon={<Refresh />} onClick={load}>Refresh</Button>
          </Box>
        }
      />
      <Page.Content>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
          <Card>
            <Card.Content>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #0C6EFC 0%, #4A9EFF 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{siteName}</div>
                  {siteUrl && (
                    <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                      {siteUrl} <ExternalLink size="12px" />
                    </a>
                  )}
                </div>
                <Badge size="small" skin={metaSiteId ? "success" : "neutral"}>
                  {metaSiteId ? "Mapped" : "Unmapped"}
                </Badge>
              </div>
            </Card.Content>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {editorUrl && (
              <a href={editorUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <Card>
                  <Card.Content>
                    <div style={{ textAlign: "center", padding: "8px 0" }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#3899ec"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                      </div>
                      <Text size="small" weight="bold">Dashboard</Text>
                      <br />
                      <Text size="tiny" secondary>Open the site dashboard</Text>
                    </div>
                  </Card.Content>
                </Card>
              </a>
            )}
            {siteUrl && (
              <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <Card>
                  <Card.Content>
                    <div style={{ textAlign: "center", padding: "8px 0" }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#3899ec"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
                      </div>
                      <Text size="small" weight="bold">Live Site</Text>
                      <br />
                      <Text size="tiny" secondary>Open the public site</Text>
                    </div>
                  </Card.Content>
                </Card>
              </a>
            )}
            {vibeSiteUrl && (
              <a href={vibeSiteUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                <Card>
                  <Card.Content>
                    <div style={{ textAlign: "center", padding: "8px 0" }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#8b3dff"><path d="M12 2l2.39 4.84L20 7.64l-4 3.9.94 5.46L12 14.77 7.06 17l.94-5.46-4-3.9 5.61-.8L12 2z" /></svg>
                      </div>
                      <Text size="small" weight="bold">Vibe Site</Text>
                      <br />
                      <Text size="tiny" secondary>Open the Picasso experiment</Text>
                    </div>
                  </Card.Content>
                </Card>
              </a>
            )}
          </div>

          <Card>
            <Card.Header title="Wix Mapper" subtitle="This data is stored directly in company.description JSON." />
            <Card.Content>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 16px", fontSize: 13 }}>
                  <Text size="small" secondary weight="bold">MetaSite ID</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: 12, background: "#f5f5f5", padding: "2px 8px", borderRadius: 4 }}>
                      {metaSiteId || "Not set"}
                    </code>
                    {metaSiteId && (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(metaSiteId)}
                        style={{
                          border: "1px solid #d5d9e0",
                          background: "#fff",
                          borderRadius: 4,
                          fontSize: 11,
                          padding: "2px 6px",
                          cursor: "pointer",
                          color: "#4a4a4a",
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>

                  <Text size="small" secondary weight="bold">Site ID</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: 12, background: "#f5f5f5", padding: "2px 8px", borderRadius: 4 }}>
                      {siteId || "Not set"}
                    </code>
                    {siteId && (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(siteId)}
                        style={{
                          border: "1px solid #d5d9e0",
                          background: "#fff",
                          borderRadius: 4,
                          fontSize: 11,
                          padding: "2px 6px",
                          cursor: "pointer",
                          color: "#4a4a4a",
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>

                  <Text size="small" secondary weight="bold">Site Name</Text>
                  <Text size="small">{siteName || "Not set"}</Text>

                  <Text size="small" secondary weight="bold">Site URL</Text>
                  {siteUrl ? (
                    <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                      {siteUrl}
                    </a>
                  ) : (
                    <Text size="small">Not set</Text>
                  )}

                  <Text size="small" secondary weight="bold">Activation Issue</Text>
                  <Text size="small">{binding?.activationIssueId || "Not set"}</Text>

                  <Text size="small" secondary weight="bold">Vibe Site ID</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: 12, background: "#f5f5f5", padding: "2px 8px", borderRadius: 4 }}>
                      {vibeSiteId || "Not set"}
                    </code>
                    {vibeSiteId && (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(vibeSiteId)}
                        style={{
                          border: "1px solid #d5d9e0",
                          background: "#fff",
                          borderRadius: 4,
                          fontSize: 11,
                          padding: "2px 6px",
                          cursor: "pointer",
                          color: "#4a4a4a",
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>

                  <Text size="small" secondary weight="bold">Vibe Site URL</Text>
                  {vibeSiteUrl ? (
                    <a href={vibeSiteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                      {vibeSiteUrl}
                    </a>
                  ) : (
                    <Text size="small">Not set</Text>
                  )}

                  <Text size="small" secondary weight="bold">Vibe Site Status</Text>
                  <Text size="small">{vibeSiteStatus || "Not set"}</Text>

                  <Text size="small" secondary weight="bold">Vibe Site Job</Text>
                  <Text size="small">{vibeSiteJobId || "Not set"}</Text>

                  <Text size="small" secondary weight="bold">Vibe Dev URL</Text>
                  {vibeSiteDevelopmentUrl ? (
                    <a href={vibeSiteDevelopmentUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3899ec", textDecoration: "none" }}>
                      {vibeSiteDevelopmentUrl}
                    </a>
                  ) : (
                    <Text size="small">Not set</Text>
                  )}
                </div>
              </div>
            </Card.Content>
          </Card>

          {authJson && (
            <Card>
              <Card.Header title="Auth Data" />
              <Card.Content>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
                  {authJson}
                </pre>
              </Card.Content>
            </Card>
          )}

          {dataJson && (
            <Card>
              <Card.Header title="Extra Data" />
              <Card.Content>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
                  {dataJson}
                </pre>
              </Card.Content>
            </Card>
          )}

          <Card>
            <Card.Header title="Raw Description JSON" />
            <Card.Content>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
                {company.description || "{}"}
              </pre>
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

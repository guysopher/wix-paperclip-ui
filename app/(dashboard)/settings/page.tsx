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
  Heading,
  ToggleSwitch,
  SectionHelper,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import type { TelegramConfig, CompanyTelegramConfig } from "@/lib/telegram-config";

interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
}

function SettingsContent() {
  const { companyId, companies } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [companyConfigs, setCompanyConfigs] = useState<Record<string, CompanyTelegramConfig>>({});
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("https://nonoperatic-priorly-isidro.ngrok-free.dev/api/telegram/webhook");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testingChatId, setTestingChatId] = useState<string | null>(null);
  const [settingWebhook, setSettingWebhook] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/telegram/settings");
      const data = await res.json();
      const config: TelegramConfig = data.config;
      setBotToken(config.botToken || "");
      setCompanyConfigs(config.companies || {});
      if (data.webhookInfo) {
        setWebhookInfo(data.webhookInfo);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          botToken,
          companies: companyConfigs,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMessage({ type: "success", text: "Settings saved successfully." });
      } else {
        setStatusMessage({ type: "error", text: data.error || "Failed to save." });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  };

  const handleSetWebhook = async () => {
    setSettingWebhook(true);
    setStatusMessage(null);
    try {
      // Save first to ensure token is persisted
      await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", botToken }),
      });
      const res = await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setWebhook", webhookUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMessage({ type: "success", text: "Webhook set successfully." });
        // Refresh webhook info
        loadSettings();
      } else {
        setStatusMessage({ type: "error", text: data.description || "Failed to set webhook." });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Failed to set webhook." });
    } finally {
      setSettingWebhook(false);
    }
  };

  const handleTestConnection = async (chatId: string) => {
    setTestingChatId(chatId);
    setStatusMessage(null);
    try {
      // Save first
      await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", botToken }),
      });
      const res = await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "testConnection", chatId }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMessage({ type: "success", text: `Test message sent to chat ${chatId}.` });
      } else {
        setStatusMessage({ type: "error", text: data.description || "Failed to send test message." });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Failed to send test message." });
    } finally {
      setTestingChatId(null);
    }
  };

  const updateCompanyConfig = (cid: string, updates: Partial<CompanyTelegramConfig>) => {
    setCompanyConfigs((prev) => {
      const defaults: CompanyTelegramConfig = { chatId: "", enabled: false, lastSentCommentId: null };
      const existing = prev[cid] || defaults;
      return {
        ...prev,
        [cid]: { ...defaults, ...existing, ...updates },
      };
    });
  };

  if (loading) {
    return (
      <Page>
        <Page.Header title="Settings" />
        <Page.Content>
          <Box align="center" padding="60px 0">
            <Loader size="small" />
          </Box>
        </Page.Content>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header title="Settings" subtitle="Telegram integration configuration" />
      <Page.Content>
        <Box direction="vertical" gap="18px" paddingBottom="30px">
          {statusMessage && (
            <SectionHelper
              appearance={statusMessage.type === "success" ? "success" : "danger"}
              title={statusMessage.text}
              onClose={() => setStatusMessage(null)}
            />
          )}

          {/* Bot Token */}
          <Card>
            <Card.Header title="Telegram Bot" />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="12px">
                <FormField label="Bot Token">
                  <Input
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="Enter your Telegram bot token"
                    type="password"
                  />
                </FormField>
              </Box>
            </Card.Content>
          </Card>

          {/* Webhook */}
          <Card>
            <Card.Header title="Webhook Configuration" />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="12px">
                <FormField label="Webhook URL">
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-domain.com/api/telegram/webhook"
                  />
                </FormField>
                <Box gap="12px" verticalAlign="middle">
                  <Button
                    size="small"
                    onClick={handleSetWebhook}
                    disabled={!botToken || !webhookUrl || settingWebhook}
                  >
                    {settingWebhook ? "Setting..." : "Set Webhook"}
                  </Button>
                  {webhookInfo && (
                    <Box direction="vertical" gap="3px">
                      <Box gap="6px" verticalAlign="middle">
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: webhookInfo.url ? "#00d68f" : "#ccc",
                          }}
                        />
                        <Text size="small" secondary>
                          {webhookInfo.url ? `Active: ${webhookInfo.url}` : "No webhook set"}
                        </Text>
                      </Box>
                      {webhookInfo.pending_update_count > 0 && (
                        <Text size="tiny" secondary>
                          {webhookInfo.pending_update_count} pending updates
                        </Text>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            </Card.Content>
          </Card>

          {/* Per-company config */}
          <Card>
            <Card.Header
              title="Company Telegram Channels"
              subtitle="Configure Telegram chat IDs for each company"
            />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="18px">
                {companies.map((company) => {
                  const cfg = companyConfigs[company.id] || {
                    chatId: "",
                    enabled: false,
                    lastSentCommentId: null,
                  };
                  return (
                    <Box
                      key={company.id}
                      direction="vertical"
                      gap="9px"
                      padding="12px"
                      borderRadius="6px"
                    >
                      <Box gap="12px" verticalAlign="middle">
                        <Heading size="tiny">{company.name}</Heading>
                        <Box marginLeft="auto">
                          <ToggleSwitch
                            size="small"
                            checked={cfg.enabled}
                            onChange={() =>
                              updateCompanyConfig(company.id, { enabled: !cfg.enabled })
                            }
                          />
                        </Box>
                      </Box>
                      <Box gap="9px" verticalAlign="bottom">
                        <Box flex={1}>
                          <FormField label="Telegram Chat ID" labelSize="small">
                            <Input
                              size="small"
                              value={cfg.chatId}
                              onChange={(e) =>
                                updateCompanyConfig(company.id, { chatId: e.target.value })
                              }
                              placeholder="e.g. 123456789"
                              disabled={!cfg.enabled}
                            />
                          </FormField>
                        </Box>
                        <Button
                          size="tiny"
                          priority="secondary"
                          disabled={!cfg.chatId || !botToken || testingChatId === cfg.chatId}
                          onClick={() => handleTestConnection(cfg.chatId)}
                        >
                          {testingChatId === cfg.chatId ? "Sending..." : "Test"}
                        </Button>
                      </Box>
                    </Box>
                  );
                })}
                {companies.length === 0 && (
                  <Text size="small" secondary>
                    No companies found. Create a company first.
                  </Text>
                )}
              </Box>
            </Card.Content>
          </Card>

          {/* Save button */}
          <Box gap="12px">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
            <Button priority="secondary" prefixIcon={<Refresh />} onClick={loadSettings}>
              Refresh
            </Button>
          </Box>
        </Box>
      </Page.Content>
    </Page>
  );
}

export default function SettingsPage() {
  return <SettingsContent />;
}

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
  SectionHelper,
} from "@wix/design-system";
import { Refresh } from "@wix/wix-ui-icons-common";
import { useCompany } from "../../providers";
import { backfillAgentPrompts } from "@/lib/api";
import type { TelegramConfig } from "@/lib/telegram-config";

interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
}

function SettingsContent() {
  const { companyId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [allowedChatId, setAllowedChatId] = useState("");
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testingChatId, setTestingChatId] = useState<string | null>(null);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [backfillingPrompts, setBackfillingPrompts] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/telegram/settings");
      const data = await res.json();
      const config: TelegramConfig = data.config;
      setBotToken(config.botToken || "");
      setAllowedChatId(config.allowedChatId || "");
      if (data.webhookInfo) {
        setWebhookInfo(data.webhookInfo);
        if (data.webhookInfo.url) {
          setWebhookUrl(data.webhookInfo.url);
        }
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
          allowedChatId,
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
        body: JSON.stringify({ action: "save", botToken, allowedChatId }),
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
        body: JSON.stringify({ action: "save", botToken, allowedChatId }),
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

  const handleBackfillPrompts = async () => {
    if (!companyId || backfillingPrompts) {
      return;
    }

    setBackfillingPrompts(true);
    setStatusMessage(null);
    try {
      const result = await backfillAgentPrompts(companyId);
      setStatusMessage({
        type: result.errorCount > 0 ? "error" : "success",
        text:
          result.updatedCount > 0
            ? `Backfilled ${result.updatedCount} agent prompt${result.updatedCount === 1 ? "" : "s"} for this company.`
            : "All agent promptTemplate fields are already present for this company.",
      });
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to backfill agent prompts.",
      });
    } finally {
      setBackfillingPrompts(false);
    }
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
                <FormField label="Allowed Chat ID">
                  <Input
                    value={allowedChatId}
                    onChange={(e) => setAllowedChatId(e.target.value)}
                    placeholder="Telegram chat id for this POC"
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

          <Card>
            <Card.Header
              title="Telegram POC Mode"
              subtitle="One Telegram chat, one active company at a time, switched with /company"
            />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="18px">
                <Text size="small" secondary>
                  The bot no longer maps one Telegram chat per company. Instead, it uses one shared chat and asks you to switch the active company with <code>/company</code>.
                </Text>
                <Box gap="9px" verticalAlign="bottom">
                  <Box flex={1}>
                    <FormField label="Test Chat ID" labelSize="small">
                      <Input
                        size="small"
                        value={allowedChatId}
                        onChange={(e) => setAllowedChatId(e.target.value)}
                        placeholder="e.g. 123456789"
                      />
                    </FormField>
                  </Box>
                  <Button
                    size="tiny"
                    priority="secondary"
                    disabled={!allowedChatId || !botToken || testingChatId === allowedChatId}
                    onClick={() => handleTestConnection(allowedChatId)}
                  >
                    {testingChatId === allowedChatId ? "Sending..." : "Test"}
                  </Button>
                </Box>
              </Box>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header
              title="Agent Prompt Repair"
              subtitle="Copies managed agent instruction bundles into stored promptTemplate fields for the current company"
            />
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="12px">
                <Text size="small" secondary>
                  Use this if agents appear to have blank role descriptions in the Team view. This repair keeps their effective instructions on the agent record so the deployed UI can read them reliably.
                </Text>
                <Box gap="12px" verticalAlign="middle">
                  <Button
                    size="small"
                    priority="secondary"
                    onClick={handleBackfillPrompts}
                    disabled={!companyId || backfillingPrompts}
                  >
                    {backfillingPrompts ? "Backfilling..." : "Backfill Agent Prompts"}
                  </Button>
                  {!companyId && (
                    <Text size="small" secondary>
                      Select a company first.
                    </Text>
                  )}
                </Box>
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

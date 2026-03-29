import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const CONFIG_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(CONFIG_DIR, "telegram-config.json");

export interface CompanyTelegramConfig {
  chatId: string;
  enabled: boolean;
  lastSentCommentId: string | null;
}

export interface TelegramConfig {
  botToken: string;
  companies: Record<string, CompanyTelegramConfig>;
}

const DEFAULT_CONFIG: TelegramConfig = {
  botToken: "",
  companies: {},
};

export async function loadConfig(): Promise<TelegramConfig> {
  // Try env var first (for Vercel/serverless)
  const envConfig = process.env.TELEGRAM_CONFIG;
  if (envConfig) {
    try { return JSON.parse(envConfig) as TelegramConfig; } catch {}
  }

  // Try env vars for simple setup
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    const config: TelegramConfig = { botToken: token, companies: {} };
    // Parse TELEGRAM_CHAT_MAP: "companyId1:chatId1,companyId2:chatId2"
    const chatMap = process.env.TELEGRAM_CHAT_MAP || "";
    for (const pair of chatMap.split(",").filter(Boolean)) {
      const [companyId, chatId] = pair.split(":");
      if (companyId && chatId) {
        config.companies[companyId] = { chatId, enabled: true, lastSentCommentId: null };
      }
    }
    return config;
  }

  // Fallback to file (local dev)
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as TelegramConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: TelegramConfig): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // On Vercel/serverless, filesystem writes may fail — that's OK
    console.log("telegram-config: cannot write to filesystem (serverless?), config is in-memory only");
  }
}

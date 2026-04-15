import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const CONFIG_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(CONFIG_DIR, "telegram-config.json");
let memoryConfig: TelegramConfig | null = null;

export interface CompanyTelegramConfig {
  chatId: string;
  enabled: boolean;
  lastSentCommentId: string | null;
}

export interface TelegramUserSession {
  activeCompanyId: string | null;
  updatedAt: string | null;
}

export interface TelegramConfig {
  botToken: string;
  allowedChatId: string;
  companies: Record<string, CompanyTelegramConfig>;
  sessions: Record<string, TelegramUserSession>;
}

const DEFAULT_CONFIG: TelegramConfig = {
  botToken: "",
  allowedChatId: "",
  companies: {},
  sessions: {},
};

function normalizeConfig(config: Partial<TelegramConfig> | null | undefined): TelegramConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    companies: config?.companies || {},
    sessions: config?.sessions || {},
  };
}

export async function loadConfig(): Promise<TelegramConfig> {
  if (memoryConfig) {
    return memoryConfig;
  }

  // Try env var first (for Vercel/serverless)
  const envConfig = process.env.TELEGRAM_CONFIG;
  if (envConfig) {
    try {
      memoryConfig = normalizeConfig(JSON.parse(envConfig) as TelegramConfig);
      return memoryConfig;
    } catch {}
  }

  // Try env vars for simple setup
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    const config: TelegramConfig = {
      ...DEFAULT_CONFIG,
      botToken: token,
      allowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID || "",
    };
    // Parse TELEGRAM_CHAT_MAP: "companyId1:chatId1,companyId2:chatId2"
    const chatMap = process.env.TELEGRAM_CHAT_MAP || "";
    for (const pair of chatMap.split(",").filter(Boolean)) {
      const [companyId, chatId] = pair.split(":");
      if (companyId && chatId) {
        config.companies[companyId] = { chatId, enabled: true, lastSentCommentId: null };
      }
    }
    memoryConfig = config;
    return config;
  }

  // Fallback to file (local dev)
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    memoryConfig = normalizeConfig(JSON.parse(raw) as TelegramConfig);
    return memoryConfig;
  } catch {
    memoryConfig = { ...DEFAULT_CONFIG };
    return memoryConfig;
  }
}

export async function saveConfig(config: TelegramConfig): Promise<void> {
  memoryConfig = normalizeConfig(config);
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(memoryConfig, null, 2), "utf-8");
  } catch {
    // On Vercel/serverless, filesystem writes may fail — that's OK
    console.log("telegram-config: cannot write to filesystem (serverless?), config is in-memory only");
  }
}

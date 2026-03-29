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
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as TelegramConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: TelegramConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

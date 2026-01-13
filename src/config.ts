import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitoringConfig } from "./types";

const DEFAULT_CONFIG_PATH = "config/monitoring.json";

export type AppEnv = {
  damaiAppKey?: string;
  damaiAppSecret?: string;
  damaiSignMethod: "md5" | "hmac";
  damaiBaseUrl: string;
  baiduApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel: string;
  timezone: string;
  dbPath: string;
};

export const loadConfig = (): MonitoringConfig => {
  const configPath = Bun.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;
  const fullPath = resolve(process.cwd(), configPath);
  try {
    const raw = readFileSync(fullPath, "utf-8");
    return JSON.parse(raw) as MonitoringConfig;
  } catch (error) {
    throw new Error(`Failed to load config at ${fullPath}: ${String(error)}`);
  }
};

export const loadEnv = (): AppEnv => {
  return {
    damaiAppKey: Bun.env.DAMAI_APP_KEY,
    damaiAppSecret: Bun.env.DAMAI_APP_SECRET,
    damaiSignMethod: (Bun.env.DAMAI_SIGN_METHOD || "md5") as "md5" | "hmac",
    damaiBaseUrl: Bun.env.DAMAI_BASE_URL || "https://eco.taobao.com/router/rest",
    baiduApiKey: Bun.env.BAIDU_APPBUILDER_API_KEY,
    openaiApiKey: Bun.env.OPENAI_API_KEY,
    openaiBaseUrl: Bun.env.OPENAI_BASE_URL,
    openaiModel: Bun.env.OPENAI_MODEL || "kimi-k2",
    timezone: Bun.env.APP_TIMEZONE || "Asia/Shanghai",
    dbPath: Bun.env.DB_PATH || "./data/gigwatch.sqlite"
  };
};

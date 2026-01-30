import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitoringConfig } from "./types";

const DEFAULT_CONFIG_PATH = "config/monitoring.json";

export type AppEnv = {
  timezone: string;
  dbPath: string;
  serverPort: number;
};

export const loadConfig = (): MonitoringConfig => {
  const fullPath = getConfigPath();
  try {
    const raw = readFileSync(fullPath, "utf-8");
    return JSON.parse(raw) as MonitoringConfig;
  } catch (error) {
    throw new Error(`Failed to load config at ${fullPath}: ${String(error)}`);
  }
};

export const getConfigPath = () => {
  const configPath = Bun.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;
  return resolve(process.cwd(), configPath);
};

export const loadEnv = (): AppEnv => {
  return {
    timezone: Bun.env.APP_TIMEZONE || "Asia/Shanghai",
    dbPath: Bun.env.DB_PATH || "./data/gigwatch.sqlite",
    serverPort: Number(Bun.env.APP_PORT || 3000)
  };
};

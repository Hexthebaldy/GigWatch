import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LOG_PATH = resolve(process.cwd(), Bun.env.LOG_PATH || "./data/gigwatch.log");

const ensureDir = () => {
  const dir = dirname(LOG_PATH);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
};

const format = (level: "INFO" | "WARN" | "ERROR", message: string) => {
  const ts = new Date().toISOString();
  return `${ts} [${level}] ${message}\n`;
};

export const logInfo = (msg: string) => {
  ensureDir();
  appendFileSync(LOG_PATH, format("INFO", msg), "utf-8");
};

export const logWarn = (msg: string) => {
  ensureDir();
  appendFileSync(LOG_PATH, format("WARN", msg), "utf-8");
};

export const logError = (msg: string) => {
  ensureDir();
  appendFileSync(LOG_PATH, format("ERROR", msg), "utf-8");
};

export const logPath = LOG_PATH;

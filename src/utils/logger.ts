import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LOG_PATH = resolve(process.cwd(), Bun.env.LOG_PATH || "./data/gigwatch.log.jsonl");

const ensureDir = () => {
  const dir = dirname(LOG_PATH);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
};

type Level = "INFO" | "WARN" | "ERROR";

const write = (level: Level, message: string) => {
  ensureDir();
  const entry = {
    ts: new Date().toISOString(),
    level,
    message
  };
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
};

export const logInfo = (msg: string) => write("INFO", msg);
export const logWarn = (msg: string) => write("WARN", msg);
export const logError = (msg: string) => write("ERROR", msg);

export const logPath = LOG_PATH;

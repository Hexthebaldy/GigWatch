import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { AppEnv } from "../config";

export const openDb = (env: AppEnv): Database => {
  const dbDir = dirname(env.dbPath);
  mkdirSync(dbDir, { recursive: true });
  return new Database(env.dbPath);
};

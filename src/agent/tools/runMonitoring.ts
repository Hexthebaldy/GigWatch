import type { Database } from "bun:sqlite";
import type { AppEnv } from "../../config";
import { loadConfig } from "../../config";
import { runDailyReportWithAgent } from "../../jobs/dailyReport";
import type { Tool } from "./base";

export const createRunMonitoringTool = (db: Database, env: AppEnv): Tool => ({
  name: "run_monitoring_now",
  description: "立即执行一次完整监控流程并生成日报。",
  parameters: {
    type: "object",
    properties: {}
  },
  execute: async () => {
    try {
      const config = loadConfig();
      const report = await runDailyReportWithAgent(db, config, env);
      return {
        success: true,
        data: {
          report: {
            runAt: report.runAt,
            timezone: report.timezone,
            summary: report.summary,
            focusArtists: report.focusArtists,
            eventsCount: report.events.length
          }
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

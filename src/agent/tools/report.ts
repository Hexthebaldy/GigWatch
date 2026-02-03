import type { Database } from "bun:sqlite";
import type { DailyReport } from "../../types";
import type { Tool } from "./base";

export const createLatestReportTool = (db: Database): Tool => ({
  name: "get_latest_report",
  description: "读取最近一条日报。",
  parameters: {
    type: "object",
    properties: {}
  },
  execute: async () => {
    try {
      const stmt = db.prepare("SELECT report_json FROM reports ORDER BY run_at DESC LIMIT 1");
      const row = stmt.get() as { report_json?: string } | undefined;
      const report = row?.report_json ? (JSON.parse(row.report_json) as DailyReport) : null;
      return { success: true, data: { report } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

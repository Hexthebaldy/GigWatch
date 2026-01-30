import readline from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, loadEnv, getConfigPath } from "./config";
import { openDb } from "./db/client";
import { initSchema } from "./db/schema";
import { runDailyReport } from "./jobs/dailyReport";
import type { DailyReport, MonitoringConfig } from "./types";

const loadLatestReport = (db: any): DailyReport | null => {
  const stmt = db.prepare("SELECT report_json FROM reports ORDER BY run_at DESC LIMIT 1");
  const row = stmt.get() as { report_json?: string } | undefined;
  return row?.report_json ? (JSON.parse(row.report_json) as DailyReport) : null;
};

const loadLogs = (db: any, limit = 10) => {
  const stmt = db.prepare(`
    SELECT query_name, url, city_code, keyword, run_at, results_count
    FROM search_logs
    ORDER BY run_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Array<{
    query_name: string;
    url: string;
    city_code?: string;
    keyword?: string;
    run_at: string;
    results_count?: number;
  }>;
};

const saveConfig = (config: MonitoringConfig) => {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  console.log(`配置已保存: ${path}`);
};

const printReport = (report: DailyReport | null) => {
  if (!report) {
    console.log("暂无日报。");
    return;
  }
  console.log(`\n=== 日报 @ ${report.runAt} (${report.timezone}) ===`);
  console.log(report.summary);
  console.log("要点:");
  for (const h of report.highlights) console.log(" -", h);
  console.log("关注艺人:");
  for (const fa of report.focusArtists) {
    const titles = fa.events.map((e) => e.title).join(" / ") || "无";
    console.log(` - ${fa.artist}: ${titles}`);
  }
  console.log(`共 ${report.events.length} 条演出\n`);
};

const printLogs = (logs: ReturnType<typeof loadLogs>) => {
  if (!logs.length) {
    console.log("暂无搜索日志。");
    return;
  }
  console.log("\n最近搜索日志:");
  for (const log of logs) {
    console.log(
      ` - ${log.run_at} | ${log.query_name} | ${log.keyword || ""} / ${log.city_code || ""} => ${
        log.results_count ?? 0
      } 条`
    );
  }
  console.log("");
};

export const startTui = async () => {
  const env = loadEnv();
  const db = openDb(env);
  initSchema(db);

  const rl = readline.createInterface({ input, output });
  const ask = (q: string) => rl.question(q);

  while (true) {
    const config = loadConfig();
    if (!config.monitoring) {
      config.monitoring = { focusArtists: [], queries: [] };
    }
    console.log("\n--- GigWatch TUI ---");
    console.log("1) 查看最新日报");
    console.log("2) 查看最近搜索日志");
    console.log("3) 立即抓取");
    console.log("4) 新增监听查询");
    console.log("5) 设置关注艺人");
    console.log("6) 查看当前监听查询");
    console.log("0) 退出");
    const choice = await ask("选择操作: ");

    if (choice === "1") {
      printReport(loadLatestReport(db));
    } else if (choice === "2") {
      printLogs(loadLogs(db));
    } else if (choice === "3") {
      console.log("抓取中...");
      const report = await runDailyReport(db, config);
      printReport(report);
    } else if (choice === "4") {
      const name = await ask("名称: ");
      const cityCode = await ask("cityCode (可空): ");
      const keyword = await ask("keyword (可空): ");
      const url = await ask("自定义 URL (可空): ");
      const page = await ask("页码 (可空): ");
      const pageSize = await ask("页大小 (可空): ");
      if (!config.monitoring.queries) config.monitoring.queries = [];
      config.monitoring.queries.push({
        name: name || "未命名",
        cityCode: cityCode || undefined,
        keyword: keyword || undefined,
        url: url || undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined
      });
      saveConfig(config);
    } else if (choice === "5") {
      const artists = await ask("关注艺人(用逗号分隔): ");
      config.monitoring.focusArtists = artists
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      saveConfig(config);
    } else if (choice === "6") {
      if (!config.monitoring.queries?.length) {
        console.log("暂无监听查询。");
      } else {
        console.log("\n当前监听查询:");
        config.monitoring.queries.forEach((q, idx) => {
          console.log(
            ` ${idx + 1}. ${q.name} | cityCode=${q.cityCode || "-"} keyword=${q.keyword || "-"} url=${
              q.url || "-"
            }`
          );
        });
      }
    } else if (choice === "0") {
      break;
    } else {
      console.log("无效选择");
    }
  }

  rl.close();
};

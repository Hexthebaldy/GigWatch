import type { Database } from "bun:sqlite";
import type { AppEnv } from "./config";
import type { DailyReport, MonitoringConfig } from "./types";
import { runDailyReport } from "./jobs/dailyReport";

const loadLatestReport = (db: Database): DailyReport | null => {
  const stmt = db.prepare("SELECT report_json FROM reports ORDER BY run_at DESC LIMIT 1");
  const row = stmt.get() as { report_json?: string } | undefined;
  return row?.report_json ? (JSON.parse(row.report_json) as DailyReport) : null;
};

const loadLogs = (db: Database, limit = 50) => {
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

const indexHtml = `
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <title>GigWatch · ShowStart</title>
    <style>
      body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; margin: 24px; }
      h1 { margin: 0 0 12px; }
      button { padding: 8px 14px; border: 1px solid #444; background: #111; color: #fff; cursor: pointer; border-radius: 6px; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .card { border: 1px solid #ddd; padding: 12px; border-radius: 8px; margin: 12px 0; }
      .muted { color: #666; font-size: 12px; }
      code { background: #f5f5f5; padding: 2px 4px; border-radius: 4px; }
      ul { padding-left: 18px; }
    </style>
  </head>
  <body>
    <h1>GigWatch · ShowStart</h1>
    <p class="muted">手动触发抓取 / 查看最近日报和搜索日志</p>
    <button id="runBtn">触发抓取</button>
    <span id="status" class="muted"></span>
    <div id="report"></div>
    <div id="logs"></div>
    <script>
      const statusEl = document.getElementById('status');
      const runBtn = document.getElementById('runBtn');
      const reportEl = document.getElementById('report');
      const logsEl = document.getElementById('logs');

      const renderReport = (data) => {
        if (!data) { reportEl.innerHTML = '<p class="muted">暂无报告</p>'; return; }
        const highlights = data.highlights.map(h => '<li>' + h + '</li>').join('');
        const focus = data.focusArtists.map(f => '<li><strong>' + f.artist + '</strong>: ' + (f.events.map(e => e.title).join(' / ') || '无') + '</li>').join('');
        reportEl.innerHTML = '<div class="card"><div><strong>运行时间：</strong>' + data.runAt + ' (' + data.timezone + ')</div><div><strong>摘要：</strong>' + data.summary + '</div><div><strong>要点：</strong><ul>' + highlights + '</ul></div><div><strong>关注艺人：</strong><ul>' + focus + '</ul></div><div class="muted">共 ' + data.events.length + ' 条演出</div></div>';
      };

      const renderLogs = (logs) => {
        if (!logs || !logs.length) { logsEl.innerHTML = '<p class="muted">暂无搜索日志</p>'; return; }
        logsEl.innerHTML = '<div class="card"><strong>最近搜索</strong><ul>' + logs.map(l => '<li><code>' + l.query_name + '</code> ' + (l.keyword || '') + ' / ' + (l.city_code || '') + ' — ' + l.results_count + ' 条 <span class="muted">' + l.run_at + '</span></li>').join('') + '</ul></div>';
      };

      const loadData = async () => {
        const reportRes = await fetch('/api/report/latest');
        const report = reportRes.ok ? await reportRes.json() : null;
        renderReport(report);
        const logsRes = await fetch('/api/logs');
        const logs = logsRes.ok ? await logsRes.json() : [];
        renderLogs(logs);
      };

      runBtn.onclick = async () => {
        runBtn.disabled = true;
        statusEl.textContent = '抓取中...';
        const res = await fetch('/api/run', { method: 'POST' });
        if (res.ok) {
          statusEl.textContent = '抓取完成';
          const data = await res.json();
          renderReport(data);
          const logsRes = await fetch('/api/logs');
          renderLogs(logsRes.ok ? await logsRes.json() : []);
        } else {
          statusEl.textContent = '抓取失败';
        }
        runBtn.disabled = false;
      };

      loadData();
    </script>
  </body>
</html>
`;

export const startServer = (db: Database, config: MonitoringConfig, env: AppEnv) => {
  const port = env.serverPort || 3000;
  const server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/api/report/latest") {
        const report = loadLatestReport(db);
        return new Response(report ? JSON.stringify(report) : "null", {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/logs") {
        const logs = loadLogs(db);
        return new Response(JSON.stringify(logs), { headers: { "Content-Type": "application/json" } });
      }

      if (url.pathname === "/api/run" && req.method === "POST") {
        const report = await runDailyReport(db, config);
        return new Response(JSON.stringify(report), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(indexHtml, { headers: { "Content-Type": "text/html" } });
    }
  });

  console.log(`Web UI available at http://localhost:${port}`);
  return server;
};

import { writeFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { AppEnv } from "./config";
import { getConfigPath } from "./config";
import type { DailyReport, MonitoringConfig, MonitoringQuery } from "./types";
import { runDailyReport } from "./jobs/dailyReport";
import { nowInTz } from "./utils";

type ConfigRef = { current: MonitoringConfig };

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

const saveConfig = (ref: ConfigRef) => {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(ref.current, null, 2), "utf-8");
  console.log(`Config saved to ${path}`);
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
      label { display:block; margin:6px 0 2px; font-weight:600; }
      input, textarea { width: 100%; padding: 6px; box-sizing: border-box; margin-bottom: 6px; }
      .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    </style>
  </head>
  <body>
    <h1>GigWatch · ShowStart</h1>
    <p class="muted">每日 06:00 自动抓取（服务器时区），可手动触发、查看日报、编辑监听规则。</p>
    <div class="grid">
      <div class="card">
        <h3>抓取</h3>
        <button id="runBtn">立即抓取</button>
        <span id="status" class="muted"></span>
        <div id="report"></div>
      </div>
      <div class="card">
        <h3>新增监听</h3>
        <form id="queryForm">
          <label>名称</label><input name="name" required />
          <label>城市代码 (cityCode)</label><input name="cityCode" />
          <label>关键词 (keyword)</label><input name="keyword" />
          <label>自定义 URL (可选，覆盖以上参数)</label><input name="url" />
          <label>页码 (可选)</label><input name="page" type="number" />
          <label>页大小 (可选)</label><input name="pageSize" type="number" />
          <button type="submit">保存并追加</button>
        </form>
        <h4>关注艺人</h4>
        <textarea id="focusInput" rows="3" placeholder="以逗号分隔"></textarea>
        <button id="saveFocus">保存关注艺人</button>
        <p class="muted">保存后下次抓取生效。</p>
      </div>
    </div>
    <div id="logs"></div>
    <script>
      const statusEl = document.getElementById('status');
      const runBtn = document.getElementById('runBtn');
      const reportEl = document.getElementById('report');
      const logsEl = document.getElementById('logs');
      const queryForm = document.getElementById('queryForm');
      const focusInput = document.getElementById('focusInput');
      const saveFocusBtn = document.getElementById('saveFocus');

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

      const loadConfig = async () => {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const cfg = await res.json();
        if (Array.isArray(cfg.monitoring?.focusArtists)) {
          focusInput.value = cfg.monitoring.focusArtists.join(',');
        }
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

      queryForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(queryForm);
        const payload = {
          name: fd.get('name'),
          cityCode: fd.get('cityCode'),
          keyword: fd.get('keyword'),
          url: fd.get('url'),
          page: fd.get('page') ? Number(fd.get('page')) : undefined,
          pageSize: fd.get('pageSize') ? Number(fd.get('pageSize')) : undefined,
        };
        statusEl.textContent = '保存中...';
        const res = await fetch('/api/config/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        statusEl.textContent = res.ok ? '已保存查询' : '保存失败';
        queryForm.reset();
      };

      saveFocusBtn.onclick = async () => {
        const artists = focusInput.value.split(',').map(s => s.trim()).filter(Boolean);
        const res = await fetch('/api/config/focus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ focusArtists: artists })
        });
        statusEl.textContent = res.ok ? '关注艺人已保存' : '保存失败';
      };

      loadData();
      loadConfig();
    </script>
  </body>
</html>
`;

const shouldRunNow = (timezone: string, lastDay: string) => {
  const now = nowInTz(timezone); // "YYYY-MM-DD HH:mm:ss"
  const [date, time] = now.split(" ");
  const [hour, minute] = time.split(":");
  if (hour === "06" && minute === "00" && date !== lastDay) return { run: true, day: date };
  return { run: false, day: lastDay };
};

export const startServer = (db: Database, config: MonitoringConfig, env: AppEnv) => {
  const port = env.serverPort || 3000;
  const configRef: ConfigRef = {
    current: {
      app: config.app,
      monitoring: {
        focusArtists: config.monitoring.focusArtists || [],
        queries: config.monitoring.queries || []
      }
    }
  };
  let isRunning = false;
  let lastAutoDay = "";

  const triggerRun = async () => {
    if (isRunning) return null;
    isRunning = true;
    try {
      return await runDailyReport(db, configRef.current);
    } finally {
      isRunning = false;
    }
  };

  // 每分钟检查一次是否到 06:00
  setInterval(async () => {
    const { run, day } = shouldRunNow(env.timezone, lastAutoDay);
    if (!run) return;
    lastAutoDay = day;
    console.log(`[scheduler] Auto run at ${nowInTz(env.timezone)}`);
    await triggerRun();
  }, 60 * 1000);

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
        const report = await triggerRun();
        if (!report) {
          return new Response(JSON.stringify({ error: "running" }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify(report), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/config" && req.method === "GET") {
        return new Response(JSON.stringify(configRef.current), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/config/query" && req.method === "POST") {
        const body = await req.json();
        const query: MonitoringQuery = {
          name: body.name || "未命名",
          cityCode: body.cityCode || undefined,
          keyword: body.keyword || undefined,
          url: body.url || undefined,
          page: body.page || undefined,
          pageSize: body.pageSize || undefined
        };
        if (!configRef.current.monitoring.queries) configRef.current.monitoring.queries = [];
        configRef.current.monitoring.queries.push(query);
        saveConfig(configRef);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      }

      if (url.pathname === "/api/config/focus" && req.method === "POST") {
        const body = await req.json();
        configRef.current.monitoring.focusArtists = Array.isArray(body.focusArtists) ? body.focusArtists : [];
        saveConfig(configRef);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      }

      return new Response(indexHtml, { headers: { "Content-Type": "text/html" } });
    }
  });

  console.log("Loaded config from", getConfigPath());
  console.log("Auto scheduler: daily 06:00", env.timezone);
  console.log(`Web UI available at http://localhost:${port}`);
  return server;
};

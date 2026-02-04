import { writeFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { AppEnv } from "./config";
import { getConfigPath } from "./config";
import type { DailyReport, MonitoringConfig } from "./types";
import { runDailyReportWithAgent } from "./jobs/dailyReport";
import { nowInTz } from "./utils/datetime";
import { showstartCities } from "./dictionary/showstartCities";
import { showstartShowStyles } from "./dictionary/showstartShowStyles";

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

const cityOptionsHtml = showstartCities
  .map(
    (city) =>
      `<label class="city-item"><input type="checkbox" value="${city.code}" data-name="${city.name}" /><span>${city.name}</span></label>`
  )
  .join("");

const showStyleOptionsHtml = showstartShowStyles
  .map(
    (style) =>
      `<label class="city-item"><input type="checkbox" value="${style.code}" data-name="${style.name}" /><span>${style.name}</span></label>`
  )
  .join("");

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
      .city-box { border: 1px solid #ddd; border-radius: 6px; padding: 6px; max-height: 220px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 4px 10px; }
      .city-item { display: grid; grid-template-columns: 16px 1fr; align-items: center; font-size: 14px; line-height: 1.2; gap: 6px; padding: 2px 0; }
      .city-item input { margin: 0; justify-self: start; }
      .city-item span { justify-self: start; }
      .city-selected { margin: 6px 0; font-size: 12px; color: #444; }
      .city-tags { display: inline-flex; flex-wrap: wrap; gap: 6px; }
      .city-tag { background: #f5f5f5; border-radius: 999px; padding: 2px 8px; }
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
        <h3>监听配置</h3>
        <label>关注艺人（逗号分隔）</label>
        <textarea id="focusInput" rows="3" placeholder="如：五月天, 周杰伦"></textarea>
        <label>城市 cityCodes（多选）</label>
        <div class="city-box" id="cityInput">
          ${cityOptionsHtml}
        </div>
        <div class="city-selected">已选：<span id="citySelected" class="city-tags"></span></div>
        <label>演出风格 showStyles（多选）</label>
        <div class="city-box" id="styleInput">
          ${showStyleOptionsHtml}
        </div>
        <div class="city-selected">已选：<span id="styleSelected" class="city-tags"></span></div>
        <label>关键词 keywords（逗号分隔）</label>
        <textarea id="keywordInput" rows="2" placeholder="如：音乐节, 巡演"></textarea>
        <button id="saveMonitoring">保存配置</button>
        <p class="muted">保存后下次抓取生效。</p>
      </div>
    </div>
    <div id="logs"></div>
    <script>
      const statusEl = document.getElementById('status');
      const runBtn = document.getElementById('runBtn');
      const reportEl = document.getElementById('report');
      const logsEl = document.getElementById('logs');
      const focusInput = document.getElementById('focusInput');
      const cityInput = document.getElementById('cityInput');
      const citySelected = document.getElementById('citySelected');
      const styleInput = document.getElementById('styleInput');
      const styleSelected = document.getElementById('styleSelected');
      const keywordInput = document.getElementById('keywordInput');
      const saveMonitoringBtn = document.getElementById('saveMonitoring');

      const renderReport = (data) => {
        if (!data) { reportEl.innerHTML = '<p class="muted">暂无报告</p>'; return; }
        const focus = data.focusArtists.map(f => '<li><strong>' + f.artist + '</strong>: ' + (f.events.map(e => e.title).join(' / ') || '无') + '</li>').join('');
        reportEl.innerHTML = '<div class="card"><div><strong>运行时间：</strong>' + data.runAt + ' (' + data.timezone + ')</div><div><strong>摘要：</strong>' + data.summary + '</div><div><strong>关注艺人：</strong><ul>' + focus + '</ul></div><div class="muted">共 ' + data.events.length + ' 条演出</div></div>';
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
        if (Array.isArray(cfg.monitoring?.cityCodes)) {
          const selected = new Set(cfg.monitoring.cityCodes);
          Array.from(cityInput.querySelectorAll('input[type="checkbox"]')).forEach((checkbox) => {
            checkbox.checked = selected.has(checkbox.value);
          });
          renderCitySelected();
        }
        if (Array.isArray(cfg.monitoring?.showStyles)) {
          const selected = new Set(cfg.monitoring.showStyles);
          Array.from(styleInput.querySelectorAll('input[type="checkbox"]')).forEach((checkbox) => {
            checkbox.checked = selected.has(checkbox.value);
          });
          renderStyleSelected();
        }
        if (Array.isArray(cfg.monitoring?.keywords)) {
          keywordInput.value = cfg.monitoring.keywords.join(',');
        }
      };

      const renderCitySelected = () => {
        const selected = Array.from(cityInput.querySelectorAll('input[type="checkbox"]:checked'))
          .map((checkbox) => checkbox.dataset.name || checkbox.value);
        if (!selected.length) {
          citySelected.textContent = '（无）';
          return;
        }
        citySelected.innerHTML = selected.map((code) => '<span class="city-tag">' + code + '</span>').join('');
      };

      const renderStyleSelected = () => {
        const selected = Array.from(styleInput.querySelectorAll('input[type="checkbox"]:checked'))
          .map((checkbox) => checkbox.dataset.name || checkbox.value);
        if (!selected.length) {
          styleSelected.textContent = '（无）';
          return;
        }
        styleSelected.innerHTML = selected.map((name) => '<span class="city-tag">' + name + '</span>').join('');
      };

      cityInput.addEventListener('change', (event) => {
        if (event.target && event.target.type === 'checkbox') {
          renderCitySelected();
        }
      });

      styleInput.addEventListener('change', (event) => {
        if (event.target && event.target.type === 'checkbox') {
          renderStyleSelected();
        }
      });

      renderCitySelected();
      renderStyleSelected();

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

      saveMonitoringBtn.onclick = async () => {
        const artists = focusInput.value.split(',').map(s => s.trim()).filter(Boolean);
        const cities = Array.from(cityInput.querySelectorAll('input[type="checkbox"]:checked'))
          .map((checkbox) => checkbox.value);
        const styles = Array.from(styleInput.querySelectorAll('input[type="checkbox"]:checked'))
          .map((checkbox) => checkbox.value);
        const keywords = keywordInput.value.split(',').map(s => s.trim()).filter(Boolean);
        statusEl.textContent = '保存中...';
        const res = await fetch('/api/config/monitoring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ focusArtists: artists, cityCodes: cities, showStyles: styles, keywords })
        });
        statusEl.textContent = res.ok ? '配置已保存' : '保存失败';
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
        cityCodes: config.monitoring.cityCodes || [],
        showStyles: config.monitoring.showStyles || [],
        keywords: config.monitoring.keywords || []
      }
    }
  };
  let isRunning = false;
  let lastAutoDay = "";

  const triggerRun = async () => {
    if (isRunning) return null;
    isRunning = true;
    try {
      return await runDailyReportWithAgent(db, configRef.current, env);
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

      if (url.pathname === "/api/config/monitoring" && req.method === "POST") {
        const body = await req.json();
        configRef.current.monitoring = {
          focusArtists: Array.isArray(body.focusArtists) ? body.focusArtists : [],
          cityCodes: Array.isArray(body.cityCodes) ? body.cityCodes : [],
          showStyles: Array.isArray(body.showStyles) ? body.showStyles : [],
          keywords: Array.isArray(body.keywords) ? body.keywords : []
        };
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

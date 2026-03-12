import { writeFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { AppEnv } from "./config";
import { getConfigPath } from "./config";
import type { DailyReport, MonitoringConfig } from "./types";
import { runDailyReport } from "./jobs/dailyReport";
import { nowInTz } from "./utils/datetime";
import { ChatService } from "./agent/chatService";
import { showstartCities } from "./dictionary/showstartCities";
import { showstartShowStyles } from "./dictionary/showstartShowStyles";
import { MemoRepository } from "./memo/memoRepository";

type ConfigRef = { current: MonitoringConfig };
type MemoOperation = "add" | "remove";

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

const shouldRunNow = (timezone: string, lastDay: string) => {
  const now = nowInTz(timezone); // "YYYY-MM-DD HH:mm:ss"
  const [date, time] = now.split(" ");
  const [hour, minute] = time.split(":");
  if (hour === "06" && minute === "00" && date !== lastDay) return { run: true, day: date };
  return { run: false, day: lastDay };
};

export const startServer = (db: Database, config: MonitoringConfig, env: AppEnv) => {
  const port = env.serverPort || 9826;
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
  // Initialize ChatService for web chat
  const memoRepository = new MemoRepository(db);
  const chatService = new ChatService(db, env);

  let isRunning = false;
  let lastAutoDay = "";

  const triggerRun = async () => {
    if (isRunning) return null;
    isRunning = true;
    try {
      return await runDailyReport(db, configRef.current, env);
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

      // Events query API — multi-dimension filtering
      // GET /api/events?keyword=&city=&artist=&since=&until=&soldOut=0|1&sort=recent|showTime&limit=N
      if (url.pathname === "/api/events" && req.method === "GET") {
        const conditions: string[] = [];
        const params: Array<string | number> = [];

        const keyword = url.searchParams.get("keyword")?.trim();
        if (keyword) {
          conditions.push("(title LIKE ? OR performers LIKE ?)");
          const like = `%${keyword}%`;
          params.push(like, like);
        }

        const city = url.searchParams.get("city")?.trim();
        if (city) {
          conditions.push("city_name LIKE ?");
          params.push(`%${city}%`);
        }

        // artists: comma-separated list, matched with OR
        const artistsRaw = url.searchParams.get("artists")?.trim();
        if (artistsRaw) {
          const artists = artistsRaw.split(",").map((a) => a.trim()).filter(Boolean);
          if (artists.length > 0) {
            const clauses = artists.map(() => "performers LIKE ?").join(" OR ");
            conditions.push(`(${clauses})`);
            for (const a of artists) params.push(`%${a}%`);
          }
        }

        const since = url.searchParams.get("since")?.trim();
        if (since) {
          conditions.push("first_seen_at >= ?");
          params.push(since);
        }

        const until = url.searchParams.get("until")?.trim();
        if (until) {
          conditions.push("first_seen_at <= ?");
          params.push(until);
        }

        const soldOut = url.searchParams.get("soldOut");
        if (soldOut === "0" || soldOut === "1") {
          conditions.push("json_extract(raw_json, '$.soldOut') = ?");
          params.push(Number(soldOut));
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const sort = url.searchParams.get("sort") === "showTime" ? "show_time" : "last_seen_at";
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
        params.push(limit);

        const stmt = db.prepare(`
          SELECT raw_json FROM events
          ${where}
          ORDER BY ${sort} DESC
          LIMIT ?
        `);
        const rows = stmt.all(...params) as Array<{ raw_json: string }>;
        const events = rows.map((r) => JSON.parse(r.raw_json));
        return new Response(JSON.stringify(events), {
          headers: { "Content-Type": "application/json" }
        });
      }

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

      if (url.pathname === "/api/memos" && req.method === "GET") {
        const memos = memoRepository.listAll();
        return new Response(JSON.stringify(memos), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/memos" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const operation = typeof body.operation === "string" ? body.operation : "";
        const content = typeof body.content === "string" ? body.content.trim() : "";
        if ((operation !== "add" && operation !== "remove") || !content) {
          return new Response(JSON.stringify({ error: "operation must be add/remove and content must be non-empty" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        try {
          if ((operation as MemoOperation) === "add") {
            const result = memoRepository.add(content);
            return new Response(JSON.stringify({
              operation,
              status: result.created ? "created" : "already_exists",
              memo: result.memo
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }

          const result = memoRepository.remove(content);
          return new Response(JSON.stringify({
            operation,
            status: result.removed ? "removed" : "not_found",
            memo: result.memo,
            content
          }), {
            headers: { "Content-Type": "application/json" }
          });
        } catch (error) {
          return new Response(JSON.stringify({ error: String(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
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

      // Dictionary API — returns city/showStyle code-name pairs
      if (url.pathname.startsWith("/api/dictionary/") && req.method === "GET") {
        const type = url.pathname.slice("/api/dictionary/".length);
        const dictMap: Record<string, Array<{ code: string; name: string }>> = {
          cities: showstartCities,
          showStyles: showstartShowStyles,
        };
        const data = dictMap[type];
        if (!data) {
          return new Response(JSON.stringify({ error: "unknown dictionary type" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify(data), {
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

      // Chat message history (supports ?limit=N, default 30)
      if (url.pathname === "/api/chat/messages" && req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 200);
        const messages = chatService.listVisibleMessages(limit);
        return new Response(JSON.stringify(messages), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Chat streaming endpoint (SSE)
      if (url.pathname === "/api/chat" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          return new Response(JSON.stringify({ error: "empty message" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };
            const signal = req.signal;
            try {
              const gen = chatService.handleIncomingMessageStream(
                { source: "web", text },
                { signal }
              );
              for await (const event of gen) {
                if (signal?.aborted) break;
                send(event.type, event);
              }
            } catch (err) {
              if ((err as Error).name !== "AbortError") {
                send("error", { type: "error", message: String(err) });
              }
            } finally {
              controller.close();
            }
          }
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        });
      }

      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  console.log("Loaded config from", getConfigPath());
  console.log("Auto scheduler: daily 06:00", env.timezone);
  console.log(`API server available at http://localhost:${port}`);
  return server;
};

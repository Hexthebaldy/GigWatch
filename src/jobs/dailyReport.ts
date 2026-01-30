import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import type { DailyReport, MonitoringConfig, ShowStartEvent } from "../types";
import { fetchShowStartEvents } from "../clients/showstart";
import { generateReportWithModel } from "../clients/openai";
import { nowInTz, toIso } from "../utils";

// 写入或更新单条演出记录，冲突时刷新 last_seen_at 及核心字段
const upsertEvent = (db: Database, event: ShowStartEvent, fetchedAt: string) => {
  // 预编译SQL语句
  const stmt = db.prepare(`
    INSERT INTO events (
      event_id,
      title,
      city_name,
      site_name,
      show_time,
      price,
      performers,
      poster,
      url,
      source,
      raw_json,
      first_seen_at,
      last_seen_at
    ) VALUES (
      @event_id,
      @title,
      @city_name,
      @site_name,
      @show_time,
      @price,
      @performers,
      @poster,
      @url,
      @source,
      @raw_json,
      @first_seen_at,
      @last_seen_at
    )
    ON CONFLICT(event_id)
    DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      price = excluded.price,
      show_time = excluded.show_time,
      city_name = excluded.city_name,
      site_name = excluded.site_name,
      performers = excluded.performers,
      poster = excluded.poster,
      url = excluded.url,
      raw_json = excluded.raw_json
  `);

  stmt.run({
    event_id: event.id,
    title: event.title || "",
    city_name: event.cityName || "",
    site_name: event.siteName || "",
    show_time: event.showTime || "",
    price: event.price || "",
    performers: event.performers || "",
    poster: event.poster || "",
    url: event.url || "",
    source: event.source || "showstart",
    raw_json: JSON.stringify(event),
    first_seen_at: fetchedAt,
    last_seen_at: fetchedAt
  });
};

// 记录一次搜索日志，失败不阻塞主流程
const logSearch = (
  db: Database,
  options: { name?: string; url: string; cityCode?: string; keyword?: string },
  fetchedAt: string,
  resultsCount: number
) => {
  const stmt = db.prepare(`
    INSERT INTO search_logs (query_name, url, city_code, keyword, run_at, results_count)
    VALUES (@query_name, @url, @city_code, @keyword, @run_at, @results_count)
  `);

  try {
    stmt.run({
      query_name: options.name || "unknown",
      url: options.url,
      city_code: options.cityCode || "",
      keyword: options.keyword || "",
      run_at: fetchedAt,
      results_count: resultsCount
    });
  } catch (error) {
    console.error("Failed to log search", error);
  }
};

// 加载自指定时间以来首次出现的演出
const loadRecentEvents = (db: Database, sinceIso: string): ShowStartEvent[] => {
  const stmt = db.prepare(`
    SELECT raw_json FROM events
    WHERE first_seen_at >= ?
    ORDER BY last_seen_at DESC
  `);
  const rows = stmt.all(sinceIso) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json) as ShowStartEvent);
};

// 保存生成的日报 JSON
const storeReport = (db: Database, report: DailyReport) => {
  const stmt = db.prepare(`
    INSERT INTO reports (run_at, report_json)
    VALUES (@run_at, @report_json)
  `);
  stmt.run({
    run_at: report.runAt,
    report_json: JSON.stringify(report)
  });
};

// 针对每个关注艺人收集最多 5 条匹配演出
const buildFocusEvents = (events: ShowStartEvent[], focusArtists: string[]) => {
  return focusArtists.map((artist) => {
    const lower = artist.toLowerCase();
    const matches = events.filter(
      (evt) => evt.title?.toLowerCase().includes(lower) || evt.performers?.toLowerCase().includes(lower)
    );
    return {
      artist,
      events: matches.slice(0, 5).map((evt) => ({
        title: evt.title,
        url: evt.url,
        city: evt.cityName,
        site: evt.siteName,
        showTime: evt.showTime,
        price: evt.price
      }))
    };
  });
};

// 提炼演出最多的前若干城市
const buildHighlights = (events: ShowStartEvent[]) => {
  const byCity = new Map<string, number>();
  for (const evt of events) {
    const city = evt.cityName || "未知";
    byCity.set(city, (byCity.get(city) || 0) + 1);
  }

  return [...byCity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => `${city} ${count} 场`);
};

// 本地兜底日报，不依赖模型
export const buildHeuristicReport = (events: ShowStartEvent[], timezone: string, focusArtists: string[]): DailyReport => {
  const focus = buildFocusEvents(events, focusArtists);
  const total = events.length;
  const cities = new Set(events.map((evt) => evt.cityName || "未知"));

  return {
    runAt: nowInTz(timezone),
    timezone,
    summary: `今日共抓取 ${total} 条秀动演出，覆盖 ${cities.size} 个城市。关注艺人相关场次 ${focus.reduce(
      (sum, item) => sum + item.events.length,
      0
    )} 条。`,
    highlights: buildHighlights(events),
    focusArtists: focus,
    events
  };
};

// 每日主流程：抓取、落库、记日志、生成日报（模型或本地兜底）、保存日报
export const runDailyReport = async (db: Database, config: MonitoringConfig, env?: AppEnv) => {
  const timezone = config.app?.timezone || "Asia/Shanghai";
  const reportWindowHours = config.app?.reportWindowHours || 24;
  const fetchedAt = toIso(new Date());

  const queries = config.monitoring.queries || [];
  if (queries.length === 0) {
    console.warn("No monitoring queries configured; skipping scrape.");
  }

  for (const query of queries) {
    const filled = [query.cityCode, query.keyword, query.showStyle].filter(Boolean).length;
    if (filled > 1) {
      console.warn(`Query "${query.name}" has multiple params; only one of cityCode/keyword/showStyle should be set.`);
    }
    try {
      const { events, url } = await fetchShowStartEvents({
        cityCode: query.cityCode,
        keyword: query.keyword,
        showStyle: query.showStyle,
        page: query.page,
        pageSize: query.pageSize,
        url: query.url
      });

      for (const event of events) {
        upsertEvent(db, event, fetchedAt);
      }
      logSearch(db, { name: query.name, url, cityCode: query.cityCode, keyword: query.keyword }, fetchedAt, events.length);
    } catch (error) {
      console.error(`Query "${query.name}" failed:`, error);
      logSearch(db, { name: query.name, url: query.url || "unknown", cityCode: query.cityCode, keyword: query.keyword }, fetchedAt, 0);
    }
  }

  const since = new Date(Date.now() - reportWindowHours * 60 * 60 * 1000).toISOString();
  const events = loadRecentEvents(db, since);

  const heuristic = () => buildHeuristicReport(events, timezone, config.monitoring.focusArtists || []);
  const report = await generateReportWithModel({
    timezone,
    runAt: nowInTz(timezone),
    events,
    focusArtists: (config.monitoring.focusArtists || []).map((artist) => ({
      artist,
      events: events.filter(
        (evt) => evt.title?.toLowerCase().includes(artist.toLowerCase()) || evt.performers?.toLowerCase().includes(artist.toLowerCase())
      )
    })),
    env: env || { timezone, dbPath: "", serverPort: 0 },
    fallback: heuristic
  });

  storeReport(db, report);
  return report;
};

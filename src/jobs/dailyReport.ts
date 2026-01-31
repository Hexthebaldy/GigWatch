import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import type { DailyReport, MonitoringConfig, ShowStartEvent, MonitoringQuery } from "../types";
import { fetchShowStartEvents } from "../clients/showstart";
import { generateReportWithModel } from "../clients/openai";
import { nowInTz, toIso } from "../utils";
import { logError, logInfo, logWarn } from "../logger";

// 写入或更新单条演出记录，冲突时刷新 last_seen_at 及核心字段
const upsertEvent = (db: Database, event: ShowStartEvent, fetchedAt: string) => {
  if (event.id === null || event.id === undefined) {
    logWarn("Skip event without id");
    return;
  }
  const safeTitle = (event.title || "").trim() || "未命名演出";
  const safeUrl = event.url || `https://www.showstart.com/event/${event.id}`;
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
    title: safeTitle,
    city_name: event.cityName || "",
    site_name: event.siteName || "",
    show_time: event.showTime || "",
    price: event.price || "",
    performers: event.performers || "",
    poster: event.poster || "",
    url: safeUrl,
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
  const queryName = (options.name || "").trim() || "unknown";
  const url = options.url || "unknown";
  const stmt = db.prepare(`
    INSERT INTO search_logs (query_name, url, city_code, keyword, run_at, results_count)
    VALUES (@query_name, @url, @city_code, @keyword, @run_at, @results_count)
  `);

  try {
    stmt.run({
      query_name: queryName,
      url,
      city_code: options.cityCode || "",
      keyword: options.keyword || "",
      run_at: fetchedAt,
      results_count: resultsCount
    });
  } catch (error) {
    logError(`Failed to log search: ${String(error)}`);
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
  const runAt = report.runAt || nowInTz(report.timezone || "Asia/Shanghai");
  const stmt = db.prepare(`
    INSERT INTO reports (run_at, report_json)
    VALUES (@run_at, @report_json)
  `);
  stmt.run({
    run_at: runAt,
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

// 从配置派生所有需要执行的查询：关注艺人 + 城市 + 演出风格 + 关键词
const buildQueriesFromConfig = (config: MonitoringConfig): MonitoringQuery[] => {
  const base: MonitoringQuery[] = [];
  const focus = config.monitoring.focusArtists || [];
  const cityCodes = config.monitoring.cityCodes || [];
  const showStyles = config.monitoring.showStyles || [];
  const keywords = config.monitoring.keywords || [];

  for (const artist of focus) {
    base.push({ name: `艺人-${artist}`, keyword: artist });
  }
  for (const code of cityCodes) {
    base.push({ name: `城市-${code}`, cityCode: code });
  }
  for (const style of showStyles) {
    base.push({ name: `风格-${style}`, showStyle: style });
  }
  for (const kw of keywords) {
    base.push({ name: `关键词-${kw}`, keyword: kw });
  }
  return base;
};

// 每日主流程：抓取、落库、记日志、生成日报（优先模型，缺省则返回空摘要）、保存日报
export const runDailyReport = async (db: Database, config: MonitoringConfig, env?: AppEnv) => {
  const timezone = config.app?.timezone || "Asia/Shanghai";
  const reportWindowHours = config.app?.reportWindowHours || 24;
  const fetchedAt = toIso(new Date());

  const queries = buildQueriesFromConfig(config);
  if (queries.length === 0) {
    logWarn("No monitoring queries configured; skipping scrape.");
  }
  logInfo(`Daily run start at ${fetchedAt}, queries=${queries.length}`);

  for (const query of queries) {
    const filled = [query.cityCode, query.keyword, query.showStyle].filter(Boolean).length;
    if (filled > 1) {
      logWarn(`Query "${query.name}" has multiple params; only one of cityCode/keyword/showStyle should be set.`);
    }
    try {
      logInfo(`Fetching query "${query.name}" ...`);
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
      logInfo(`Query "${query.name}" success, events=${events.length}, url=${url}`);
      logSearch(db, { name: query.name, url, cityCode: query.cityCode, keyword: query.keyword }, fetchedAt, events.length);
    } catch (error) {
      logError(`Query "${query.name}" failed: ${String(error)}`);
      logSearch(db, { name: query.name, url: query.url || "unknown", cityCode: query.cityCode, keyword: query.keyword }, fetchedAt, 0);
    }
  }

  const since = new Date(Date.now() - reportWindowHours * 60 * 60 * 1000).toISOString();
  const events = loadRecentEvents(db, since);
  logInfo(`Loaded ${events.length} recent events since ${since}`);
  const focusList = config.monitoring.focusArtists || [];
  const focusMatchesForModel = focusList.map((artist) => ({
    artist,
    events: events.filter(
      (evt) => evt.title?.toLowerCase().includes(artist.toLowerCase()) || evt.performers?.toLowerCase().includes(artist.toLowerCase())
    )
  }));
  logInfo(`Built focus matches for ${focusList.length} artists`);

  const report = await generateReportWithModel({
    timezone,
    runAt: nowInTz(timezone),
    events,
    focusArtists: focusMatchesForModel,
    env: env || { timezone, dbPath: "", serverPort: 0 },
    fallback: () => ({
      runAt: nowInTz(timezone),
      timezone,
      summary: `未调用模型，本地仅列出关注艺人匹配。共 ${events.length} 条演出。`,
      focusArtists: buildFocusEvents(events, focusList),
      events
    })
  });

  storeReport(db, report);
  logInfo(`Report stored at ${report.runAt || fetchedAt}, events=${report.events.length}`);
  return report;
};

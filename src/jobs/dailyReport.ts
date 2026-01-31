import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import type { DailyReport, MonitoringConfig, ShowStartEvent, MonitoringQuery } from "../types";
import { fetchShowStartEvents } from "../clients/showstart";
import { generateReportWithModel } from "../clients/openai";
import { nowInTz, toIso } from "../utils";
import { logError, logInfo, logWarn } from "../logger";

// 写入或更新单条演出记录，冲突时刷新 last_seen_at 及核心字段
const upsertEvent = (db: Database, event: ShowStartEvent, fetchedAt: string) => {
  if (!event.id || !event.title || !event.url) {
    console.log("[warn] skip event missing required fields", {
      id: event.id,
      title: event.title,
      url: event.url
    });
    return;
  }
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
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(event_id)
    DO UPDATE SET
      title = excluded.title,
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
  try {
    const res = stmt.run(
      event.id,
      event.title,
      event.cityName || "",
      event.siteName || "",
      event.showTime || "",
      event.price || "",
      event.performers || "",
      event.poster || "",
      event.url,
      event.source || "showstart",
      JSON.stringify(event),
      fetchedAt,
      fetchedAt
    );
  } catch (err) {
    console.log('#upsert err: ', err);
  }
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
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(
      queryName,
      url,
      options.cityCode || "",
      options.keyword || "",
      fetchedAt,
      resultsCount
    );
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
    VALUES (?, ?)
  `);
  stmt.run(runAt, JSON.stringify(report));
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

  // 关注艺人查询（使用 keyword）
  for (const artist of focus) {
    base.push({ name: `艺人-${artist}`, keyword: artist });
  }

  // 城市 × 风格排列组合查询
  if (cityCodes.length > 0 && showStyles.length > 0) {
    for (const code of cityCodes) {
      for (const style of showStyles) {
        base.push({ name: `城市id${code}-风格id${style}`, cityCode: code, showStyle: style });
      }
    }
  } else {
    // 如果只有城市或只有风格，单独查询
    for (const code of cityCodes) {
      base.push({ name: `城市id-${code}`, cityCode: code });
    }
    for (const style of showStyles) {
      base.push({ name: `风格id-${style}`, showStyle: style });
    }
  }

  // 关键词查询（使用 keyword）
  for (const kw of keywords) {
    base.push({ name: `关键词-${kw}`, keyword: kw });
  }

  console.log('#all the queries: ', base)
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

      const sample = events.slice(0, 3).map((e) => e.title || "无标题").join(" | ");
      logInfo(`Query "${query.name}" fetched ${events.length} events, sample=[${sample}], url=${url}`);


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
  //过滤出关注艺人的演出
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
  logInfo(`Report stored at ${report.runAt}, events=${report.events.length}`);
  return report;
};

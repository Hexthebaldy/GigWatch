import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import type { DailyReport, MonitoringConfig, ShowStartEvent, MonitoringQuery } from "../types";
import { fetchShowStartEvents } from "../clients/showstart";
import { nowInTz, toIso } from "../utils/datetime";
import { logError, logInfo, logWarn } from "../utils/logger";
import { AgentRunner } from "../agent/runtime/agentRunner";
import { ToolRegistry } from "../agent/tools/registry";
import { createTelegramTool } from "../agent/tools/shows/telegram";

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

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const buildTelegramDailyReportMessage = (report: DailyReport) => {
  const focusHits = report.focusArtists
    .map((artist) => ({ artist: artist.artist, count: artist.events.length }))
    .filter((artist) => artist.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const focusLines = focusHits.length
    ? focusHits.map((artist) => `- ${escapeHtml(artist.artist)}: ${artist.count} 条`).join("\n")
    : "- 无关注艺人命中";

  return [
    "<b>GigWatch 日报</b>",
    `时间: ${escapeHtml(`${report.runAt} (${report.timezone})`)}`,
    `新增演出: ${report.events.length} 条`,
    `摘要: ${escapeHtml(clip(report.summary, 800))}`,
    "关注艺人命中:",
    focusLines
  ].join("\n");
};

const notifyDailyReportViaTelegram = async (report: DailyReport, env?: AppEnv) => {
  if (!env?.telegramBotToken || !env.telegramChatId) return;

  const telegramTool = createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  });

  try {
    const result = await telegramTool.execute({
      message: buildTelegramDailyReportMessage(report),
      priority: "normal",
      parseMode: "HTML"
    });

    if (!result.success) {
      logError(`[DailyReport] Telegram notification failed: ${result.error || "Unknown error"}`);
      return;
    }

    logInfo("[DailyReport] Telegram notification sent");
  } catch (error) {
    logError(`[DailyReport] Telegram notification failed: ${String(error)}`);
  }
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

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1];
  return content.trim();
};

const tryParseDailyReport = (content: string): DailyReport | null => {
  try {
    const parsed = JSON.parse(extractJson(content)) as DailyReport;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.runAt !== "string" ||
      typeof parsed.timezone !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.focusArtists) ||
      !Array.isArray(parsed.events)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

type MonitoringData = {
  timezone: string;
  reportWindowHours: number;
  queries: MonitoringQuery[];
  events: ShowStartEvent[];
  focusMatchesForModel: Array<{ artist: string; events: ShowStartEvent[] }>;
  focusArtists: string[];
  totalEventsFetched: number;
};

const collectMonitoringData = async (db: Database, config: MonitoringConfig): Promise<MonitoringData> => {
  const timezone = config.app?.timezone || "Asia/Shanghai";
  const reportWindowHours = config.app?.reportWindowHours || 24;
  const fetchedAt = toIso(new Date());
  const queries = buildQueriesFromConfig(config);

  if (queries.length === 0) {
    logWarn("No monitoring queries configured; skipping scrape.");
  }
  logInfo(`Daily run start at ${fetchedAt}, queries=${queries.length}`);

  let totalEventsFetched = 0;
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
      totalEventsFetched += events.length;
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
  const focusArtists = config.monitoring.focusArtists || [];
  const focusMatchesForModel = focusArtists.map((artist) => ({
    artist,
    events: events.filter(
      (evt) => evt.title?.toLowerCase().includes(artist.toLowerCase()) || evt.performers?.toLowerCase().includes(artist.toLowerCase())
    )
  }));
  logInfo(`Built focus matches for ${focusArtists.length} artists`);

  return {
    timezone,
    reportWindowHours,
    queries,
    events,
    focusMatchesForModel,
    focusArtists,
    totalEventsFetched
  };
};

const generateReportWithAgentRunner = async (input: {
  timezone: string;
  runAt: string;
  events: ShowStartEvent[];
  focusArtists: Array<{ artist: string; events: ShowStartEvent[] }>;
  queries: MonitoringQuery[];
  reportWindowHours: number;
  totalEventsFetched: number;
  env: AppEnv;
  fallback: () => DailyReport;
}): Promise<DailyReport> => {
  if (!input.env.openaiApiKey) return input.fallback();

  const runner = new AgentRunner(new ToolRegistry(), input.env);
  const initialMessages = [
    {
      role: "system" as const,
      content:
        "根据信息总结演出日报。输出请严格符合 DailyReport 结构的 JSON，不要包含多余字段。字段仅包含 runAt, timezone, summary, focusArtists, events。Chinese output."
    },
    {
      role: "user" as const,
      content: `请根据已抓取的数据生成日报。
runAt: ${input.runAt}
timezone: ${input.timezone}
reportWindowHours: ${input.reportWindowHours}
queriesExecuted: ${input.queries.length}
totalEventsFetched: ${input.totalEventsFetched}
recentEventsCount: ${input.events.length}

要求：
1) 保留 events 原始数组。
2) focusArtists 中每个艺人的 events 仅保留 title/url/city/site/showTime/price 字段。
3) summary 用 3-5 句中文，覆盖总量、关注艺人命中、值得关注的演出。

Events: ${JSON.stringify(input.events)}
FocusArtists: ${JSON.stringify(
        input.focusArtists.map((f) => ({
          artist: f.artist,
          events: f.events.map((e) => ({
            title: e.title,
            url: e.url,
            city: e.cityName,
            site: e.siteName,
            showTime: e.showTime,
            price: e.price
          }))
        }))
      )}`
    }
  ];

  const runtimeResult = await runner.runTurn(initialMessages);
  const parsed = tryParseDailyReport(runtimeResult.reply);
  if (parsed) return parsed;

  logWarn("[DailyReport] AgentRunner returned non-JSON/invalid JSON report, fallback to template report.");
  return input.fallback();
};

// 每日主流程：抓取、落库、记日志，最后使用 AgentRunner 生成日报并保存
export const runDailyReport = async (db: Database, config: MonitoringConfig, env?: AppEnv) => {
  const data = await collectMonitoringData(db, config);
  const report = await generateReportWithAgentRunner({
    timezone: data.timezone,
    runAt: nowInTz(data.timezone),
    events: data.events,
    focusArtists: data.focusMatchesForModel,
    queries: data.queries,
    reportWindowHours: data.reportWindowHours,
    totalEventsFetched: data.totalEventsFetched,
    env: env || { timezone: data.timezone, dbPath: "", serverPort: 0 },
    fallback: () => ({
      runAt: nowInTz(data.timezone),
      timezone: data.timezone,
      summary: `Agent 摘要生成已回退。共抓取 ${data.totalEventsFetched} 条演出，最近 ${data.reportWindowHours} 小时内有 ${data.events.length} 条新演出。`,
      focusArtists: buildFocusEvents(data.events, data.focusArtists),
      events: data.events
    })
  });

  storeReport(db, report);
  logInfo(`Report stored at ${report.runAt}, events=${report.events.length}`);
  await notifyDailyReportViaTelegram(report, env);
  return report;
};

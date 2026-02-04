import type { Database } from "bun:sqlite";
import type { Tool } from "../base";
import type { ShowStartEvent } from "../../../types";
import { toIso } from "../../../utils/datetime";

export const createDatabaseTool = (db: Database): Tool => ({
  name: "upsert_event",
  description: "将演出信息保存或更新到数据库。如果 event_id 已存在则更新，否则插入新记录。",
  parameters: {
    type: "object",
    properties: {
      event: {
        type: "object",
        description: "演出信息对象，必须包含 id, title, url 字段"
      },
      fetchedAt: {
        type: "string",
        description: "抓取时间的 ISO 格式字符串，默认为当前时间"
      }
    },
    required: ["event"]
  },
  execute: async ({ event, fetchedAt }: { event: ShowStartEvent; fetchedAt?: string }) => {
    const timestamp = fetchedAt || toIso(new Date());

    if (!event.id || !event.title || !event.url) {
      return {
        success: false,
        error: "Event missing required fields: id, title, or url"
      };
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
      stmt.run(
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
        timestamp,
        timestamp
      );
      return {
        success: true,
        data: { eventId: event.id, action: "upserted" }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
});

export const createLoadEventsTool = (db: Database): Tool => ({
  name: "load_recent_events",
  description: "从数据库加载指定时间以来首次出现的演出列表",
  parameters: {
    type: "object",
    properties: {
      sinceIso: {
        type: "string",
        description: "起始时间的 ISO 格式字符串"
      }
    },
    required: ["sinceIso"]
  },
  execute: async ({ sinceIso }: { sinceIso: string }) => {
    try {
      const stmt = db.prepare(`
        SELECT raw_json FROM events
        WHERE first_seen_at >= ?
        ORDER BY last_seen_at DESC
      `);
      const rows = stmt.all(sinceIso) as Array<{ raw_json: string }>;
      const events = rows.map((row) => JSON.parse(row.raw_json) as ShowStartEvent);

      return {
        success: true,
        data: { events, count: events.length }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
});

export const createLogSearchTool = (db: Database): Tool => ({
  name: "log_search",
  description: "记录一次搜索操作的日志",
  parameters: {
    type: "object",
    properties: {
      queryName: {
        type: "string",
        description: "查询名称"
      },
      url: {
        type: "string",
        description: "请求的 URL"
      },
      cityCode: {
        type: "string",
        description: "城市代码（可选）"
      },
      keyword: {
        type: "string",
        description: "搜索关键词（可选）"
      },
      runAt: {
        type: "string",
        description: "执行时间 ISO 字符串"
      },
      resultsCount: {
        type: "number",
        description: "结果数量"
      }
    },
    required: ["queryName", "url", "runAt", "resultsCount"]
  },
  execute: async (params: {
    queryName: string;
    url: string;
    cityCode?: string;
    keyword?: string;
    runAt: string;
    resultsCount: number;
  }) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO search_logs (query_name, url, city_code, keyword, run_at, results_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        params.queryName,
        params.url,
        params.cityCode || "",
        params.keyword || "",
        params.runAt,
        params.resultsCount
      );
      return {
        success: true,
        data: { logged: true }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
});

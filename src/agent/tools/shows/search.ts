import type { Database } from "bun:sqlite";
import type { ShowStartEvent } from "../../../types";
import type { Tool } from "../base";

export const createSearchEventsTool = (db: Database): Tool => ({
  name: "search_events_db",
  description: "在本地数据库中搜索演出（可按关键词、城市、时间范围过滤）。",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "关键词（匹配标题或演出者）"
      },
      city: {
        type: "string",
        description: "城市名称（模糊匹配）"
      },
      sinceIso: {
        type: "string",
        description: "起始时间 ISO 字符串"
      },
      untilIso: {
        type: "string",
        description: "结束时间 ISO 字符串"
      },
      limit: {
        type: "number",
        description: "返回数量上限，默认 20",
        default: 20
      }
    }
  },
  execute: async ({
    keyword,
    city,
    sinceIso,
    untilIso,
    limit
  }: {
    keyword?: string;
    city?: string;
    sinceIso?: string;
    untilIso?: string;
    limit?: number;
  }) => {
    try {
      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (keyword) {
        conditions.push("(title LIKE ? OR performers LIKE ?)");
        const like = `%${keyword}%`;
        params.push(like, like);
      }
      if (city) {
        conditions.push("city_name LIKE ?");
        params.push(`%${city}%`);
      }
      if (sinceIso) {
        conditions.push("first_seen_at >= ?");
        params.push(sinceIso);
      }
      if (untilIso) {
        conditions.push("first_seen_at <= ?");
        params.push(untilIso);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const max = typeof limit === "number" && limit > 0 ? Math.min(limit, 100) : 20;
      params.push(max);

      const stmt = db.prepare(`
        SELECT raw_json FROM events
        ${where}
        ORDER BY last_seen_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(...params) as Array<{ raw_json: string }>;
      const events = rows.map((row) => JSON.parse(row.raw_json) as ShowStartEvent);
      return { success: true, data: { events, count: events.length } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

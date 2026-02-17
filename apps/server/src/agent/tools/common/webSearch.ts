import type { Tool } from "../base";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_SEARCH_TYPE = "web";
const DEFAULT_ENDPOINT = "https://open.feedcoopapi.com/search_api/web_search";

type SearchType = "web" | "web_summary";

type VolcWebResult = {
  SortId?: number;
  Title?: string;
  Url?: string;
  Snippet?: string;
  Summary?: string;
  SiteName?: string;
  PublishTime?: string;
  AuthInfoDes?: string;
  AuthInfoLevel?: number;
};

type VolcResponse = {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: {
      CodeN?: number;
      Code?: string;
      Message?: string;
    };
  };
  Result?: {
    ResultCount?: number;
    TimeCost?: number;
    LogId?: string;
    WebResults?: VolcWebResult[] | null;
    Choices?: Array<{
      Message?: {
        Content?: string;
      } | null;
    }> | null;
  } | null;
};

const clampLimit = (limit?: number) => {
  const max = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, max));
};

const normalizeSearchType = (input?: string): SearchType => {
  if (input === "web_summary") return input;
  return DEFAULT_SEARCH_TYPE;
};

const parseErrorMessage = (payload: VolcResponse, fallback: string) => {
  const errorMeta = payload.ResponseMetadata?.Error;
  const requestId = payload.ResponseMetadata?.RequestId;
  const suffix = requestId ? ` (requestId: ${requestId})` : "";
  if (!errorMeta) return fallback;
  const code = errorMeta.Code || (typeof errorMeta.CodeN === "number" ? String(errorMeta.CodeN) : "");
  const message = errorMeta.Message || "unknown error";
  return code ? `web search failed: ${code} ${message}${suffix}` : `web search failed: ${message}${suffix}`;
};

export const webSearchTool: Tool = {
  name: "web_search",
  description: "使用火山引擎融合信息搜索 API 按关键词搜索网页/图片，返回标题、链接、摘要。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词"
      },
      limit: {
        type: "number",
        description: "返回结果数量，默认10，最大 50",
        default: DEFAULT_LIMIT
      },
      searchType: {
        type: "string",
        description: "搜索类型：web（默认）/ web_summary",
        enum: ["web", "web_summary"],
        default: DEFAULT_SEARCH_TYPE
      }
    },
    required: ["query"]
  },
  execute: async ({ query, limit, searchType }: { query?: string; limit?: number; searchType?: string }) => {
    try {
      const keyword = (query || "").trim();
      if (!keyword) return { success: false, error: "query is required" };

      const apiKey = (Bun.env.WEB_SEARCH_KEY || "").trim();
      if (!apiKey) {
        return { success: false, error: "WEB_SEARCH_KEY is not configured" };
      }

      const endpoint = (Bun.env.WEB_SEARCH_URL || DEFAULT_ENDPOINT).trim();
      const timeoutFromEnv = Number(Bun.env.WEB_SEARCH_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(timeoutFromEnv) ? timeoutFromEnv : DEFAULT_TIMEOUT_MS;
      const capped = clampLimit(limit);
      const resolvedSearchType = normalizeSearchType(searchType);

      const body = {
        Query: keyword,
        SearchType: resolvedSearchType,
        Count: capped,
        NeedSummary: resolvedSearchType === "web_summary",
        Filter: {
          NeedContent: false,
          NeedUrl: false
        }
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      let payload: VolcResponse = {};
      try {
        payload = (await response.json()) as VolcResponse;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const requestId = payload.ResponseMetadata?.RequestId;
        const fallback = requestId
          ? `web search failed: HTTP ${response.status} (requestId: ${requestId})`
          : `web search failed: HTTP ${response.status}`;
        return { success: false, error: parseErrorMessage(payload, fallback) };
      }

      const apiError = payload.ResponseMetadata?.Error;
      if (apiError) {
        return { success: false, error: parseErrorMessage(payload, "web search failed") };
      }

      const webResults = Array.isArray(payload.Result?.WebResults) ? payload.Result?.WebResults : [];
      const results = webResults.slice(0, capped).map((item, index) => ({
        title: item.Title || "",
        url: item.Url || "",
        snippet: item.Summary || item.Snippet || "",
        rank: index + 1,
        siteName: item.SiteName || "",
        publishTime: item.PublishTime || "",
        authInfo: item.AuthInfoDes || "",
        authInfoLevel: item.AuthInfoLevel
      }));

      const summary = payload.Result?.Choices?.[0]?.Message?.Content;

      return {
        success: true,
        data: {
          query: keyword,
          searchType: resolvedSearchType,
          count: results.length,
          resultCount: payload.Result?.ResultCount ?? results.length,
          timeCostMs: payload.Result?.TimeCost,
          logId: payload.Result?.LogId || payload.ResponseMetadata?.RequestId || "",
          summary: typeof summary === "string" ? summary : "",
          results
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

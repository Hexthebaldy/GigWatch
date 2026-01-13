import type { BaiduReference } from "../types";
import { loadEnv } from "../config";

export type BaiduSearchOptions = {
  query: string;
  recency?: "week" | "month" | "semiyear" | "year";
  siteAllowList?: string[];
  topK?: number;
};

type BaiduSearchResponse = {
  references?: BaiduReference[];
  request_id?: string;
  code?: number;
  message?: string;
};

export const searchBaidu = async (options: BaiduSearchOptions) => {
  const env = loadEnv();
  if (!env.baiduApiKey) {
    throw new Error("Missing BAIDU_APPBUILDER_API_KEY");
  }

  const url = "https://qianfan.baidubce.com/v2/ai_search/web_search";
  const payload = {
    messages: [{ role: "user", content: options.query }],
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: options.topK || 10 }],
    search_filter: options.siteAllowList && options.siteAllowList.length > 0
      ? { match: { site: options.siteAllowList } }
      : undefined,
    search_recency_filter: options.recency || "month"
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.baiduApiKey}`,
      "X-Appbuilder-Authorization": `Bearer ${env.baiduApiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as BaiduSearchResponse;
  if (data.code) {
    throw new Error(`Baidu search error ${data.code}: ${data.message || "unknown"}`);
  }

  return data.references || [];
};

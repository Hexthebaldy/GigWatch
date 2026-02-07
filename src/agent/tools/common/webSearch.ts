import type { Tool } from "../base";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const SEARCH_ENDPOINT = "https://duckduckgo.com/html/";

const stripTags = (input: string) => input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const decodeHtml = (input: string) =>
  input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const normalizeResultUrl = (rawUrl: string) => {
  try {
    const decoded = decodeURIComponent(rawUrl);
    const parsed = new URL(decoded, "https://duckduckgo.com");
    if (!parsed.pathname.startsWith("/l/")) return parsed.toString();
    const redirect = parsed.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : parsed.toString();
  } catch {
    return rawUrl;
  }
};

const extractSearchResults = (html: string) => {
  const results: Array<{ title: string; url: string; snippet: string; rank: number }> = [];
  const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<(?:a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g;
  const snippets = Array.from(html.matchAll(snippetRegex)).map((match) => stripTags(decodeHtml(match[1] || "")));

  let match: RegExpExecArray | null = null;
  while ((match = titleRegex.exec(html)) !== null) {
    const rawUrl = match[1] || "";
    const rawTitle = match[2] || "";
    const title = stripTags(decodeHtml(rawTitle));
    if (!title) continue;

    const index = results.length;
    results.push({
      title,
      url: normalizeResultUrl(rawUrl),
      snippet: snippets[index] || "",
      rank: index + 1
    });
  }
  return results;
};

export const webSearchTool: Tool = {
  name: "web_search",
  description: "使用搜索引擎按关键词搜索网页，返回标题、链接、摘要。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词"
      },
      limit: {
        type: "number",
        description: "返回结果数量，默认10，最大 20",
        default: DEFAULT_LIMIT
      }
    },
    required: ["query"]
  },
  execute: async ({ query, limit }: { query?: string; limit?: number }) => {
    try {
      const keyword = (query || "").trim();
      if (!keyword) {
        return { success: false, error: "query is required" };
      }

      const max = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
      const capped = Math.max(1, Math.min(MAX_LIMIT, max));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(keyword)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return { success: false, error: `web search failed: HTTP ${response.status}` };
      }

      const html = await response.text();
      const allResults = extractSearchResults(html);
      const results = allResults.slice(0, capped);
      console.log('#results: ', results);
      return {
        success: true,
        data: {
          query: keyword,
          count: results.length,
          results
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

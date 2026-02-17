import type { Tool } from "../base";

const DEFAULT_MAX_CHARS = 6000;
const MAX_CHARS_LIMIT = 20000;

const decodeHtml = (input: string) =>
  input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (input: string) => input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const extractTitle = (html: string) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) return "";
  return stripTags(decodeHtml(titleMatch[1]));
};

const extractTextContent = (html: string) => {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return stripTags(decodeHtml(noScripts));
};

const isSupportedUrl = (url: string) => /^https?:\/\//i.test(url);

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "根据 URL 抓取网页并提取标题与正文文本。",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "要抓取的网页 URL（http/https）"
      },
      maxChars: {
        type: "number",
        description: "返回正文最大字符数，默认 6000，最大 20000",
        default: DEFAULT_MAX_CHARS
      }
    },
    required: ["url"]
  },
  execute: async ({ url, maxChars }: { url?: string; maxChars?: number }) => {
    try {
      const targetUrl = (url || "").trim();
      if (!targetUrl) return { success: false, error: "url is required" };
      if (!isSupportedUrl(targetUrl)) return { success: false, error: "only http/https URL is supported" };

      const max = typeof maxChars === "number" && Number.isFinite(maxChars) ? Math.floor(maxChars) : DEFAULT_MAX_CHARS;
      const cappedMaxChars = Math.max(500, Math.min(MAX_CHARS_LIMIT, max));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return { success: false, error: `web fetch failed: HTTP ${response.status}` };
      }

      const html = await response.text();
      const title = extractTitle(html);
      const fullText = extractTextContent(html);
      const content = fullText.slice(0, cappedMaxChars);
      console.log('#调用了web fetch工具, content: ', content);
      return {
        success: true,
        data: {
          url: targetUrl,
          finalUrl: response.url || targetUrl,
          title,
          content,
          contentLength: content.length,
          truncated: fullText.length > content.length
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

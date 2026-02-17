import OpenAI from "openai";
import { logWarn } from "../../utils/logger";
import { resolveModelTemperature } from "../../clients/modelTemperature";
import type { StoredChatMessage } from "./types";

const toLine = (message: StoredChatMessage) => {
  // 将消息压缩为单行文本，供摘要模型或本地兜底策略使用。
  const prefix = message.role === "user" ? "用户" : "助手";
  const compact = message.content.replace(/\s+/g, " ").trim();
  return `${prefix}: ${compact.slice(0, 320)}`;
};

const fallbackSummarize = (existingSummary: string, messages: StoredChatMessage[]) => {
  // 当无可用模型或摘要失败时，使用规则拼接生成可控长度的本地摘要。
  const lines: string[] = [];
  if (existingSummary.trim()) {
    lines.push(existingSummary.trim());
  }
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    lines.push(toLine(message));
  }
  const merged = lines.join("\n");
  return merged.slice(-4000);
};

export class ContextSummarizer {
  private client?: OpenAI;
  private model?: string;
  private temperature = 1;

  constructor(input: { apiKey?: string; baseUrl?: string; model?: string; requestedTemperature?: number }) {
    // 无 API Key 时仅启用本地摘要兜底，不初始化远程客户端。
    if (!input.apiKey) return;
    this.client = new OpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl
    });
    this.model = input.model;
    this.temperature = resolveModelTemperature(input.model, input.requestedTemperature, 1);
  }

  async summarize(existingSummary: string, messages: StoredChatMessage[]): Promise<string> {
    // 增量摘要入口：优先调用模型生成；失败或空结果时自动回退本地策略。
    if (!messages.length) return existingSummary;
    if (!this.client || !this.model) {
      return fallbackSummarize(existingSummary, messages);
    }

    const transcript = messages
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map(toLine)
      .join("\n");

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: this.temperature,
        messages: [
          {
            role: "system",
            content:
              "你负责维护会话长期记忆。请输出简洁中文摘要，保留：用户偏好、已确认事实、待办事项、决策结论。禁止杜撰。控制在 1000 字内。"
          },
          {
            role: "user",
            content: `已有摘要：\n${existingSummary || "（无）"}\n\n新增对话片段：\n${transcript}`
          }
        ]
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return fallbackSummarize(existingSummary, messages);
      }
      return content.slice(0, 4000);
    } catch (error) {
      logWarn(`[Context] Summarization failed, fallback to local strategy: ${String(error)}`);
      return fallbackSummarize(existingSummary, messages);
    }
  }
}

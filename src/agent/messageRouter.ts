import OpenAI from "openai";
import type { ToolRegistry } from "./tools/registry";
import type { AppEnv } from "../config";
import { logError, logInfo, logWarn } from "../logger";

const SYSTEM_PROMPT =
  "你是 GigWatch 助手。用户用自然语言提出任务。你可以调用提供的工具完成任务。若缺少必要信息请先提问；若现有工具无法完成，请如实说明。";

const MAX_ITERATIONS = 20;
const MAX_HISTORY_MESSAGES = 16;

const compactEvents = (events: any[], limit = 10) => {
  if (!Array.isArray(events)) return events;
  const trimmed = events.slice(0, limit);
  return { items: trimmed, total: events.length };
};

const compactToolResult = (result: any) => {
  if (!result || typeof result !== "object") return result;
  if (!result.data) return result;
  const data: Record<string, any> = { ...result.data };
  if (Array.isArray(data.events)) {
    data.events = compactEvents(data.events);
  }
  if (data.report?.events && Array.isArray(data.report.events)) {
    data.report = { ...data.report, events: compactEvents(data.report.events) };
  }
  return { ...result, data };
};

export class MessageRouter {
  private llm?: OpenAI;
  private llmModel?: string;
  private history: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(
    private tools: ToolRegistry,
    env: AppEnv
  ) {
    if (env.openaiApiKey) {
      this.llm = new OpenAI({
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl
      });
      this.llmModel = env.openaiModel || "kimi-k2-turbo-preview";
    }
  }

  async handleMessage(text: string): Promise<string> {
    if (!this.llm || !this.llmModel) {
      return "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...this.history,
      { role: "user", content: text }
    ];

    const availableTools = this.tools.toFunctionSchemas();
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations += 1;
      try {
        const response = await this.llm.chat.completions.create({
          model: this.llmModel,
          messages,
          tools: availableTools,
          tool_choice: "auto",
          temperature: 0.3
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new Error("No response from LLM");
        }

        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          logInfo(`[Router] LLM requested ${assistantMessage.tool_calls.length} tool calls`);

          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any = {};
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch (error) {
              const errorMsg = `Tool arguments parse error: ${String(error)}`;
              logWarn(`[Router] ${errorMsg}`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              continue;
            }

            const tool = this.tools.get(toolName);
            if (!tool) {
              const errorMsg = `Tool "${toolName}" not found`;
              logWarn(`[Router] ${errorMsg}`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              continue;
            }

            try {
              const result = await tool.execute(toolArgs);
              const compacted = compactToolResult(result);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(compacted)
              });
            } catch (error) {
              const errorResult = { success: false, error: String(error) };
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(errorResult)
              });
            }
          }

          continue;
        }

        const reply = assistantMessage.content?.trim();
        if (reply) {
          this.appendToHistory({ role: "user", content: text }, assistantMessage);
          return reply;
        }
      } catch (error) {
        logError(`[Router] LLM iteration failed: ${String(error)}`);
        return "处理请求时出现错误，请稍后再试。";
      }
    }

    logWarn("[Router] Reached max iterations without a final response");
    return "任务处理未完成，请换种说法再试。";
  }

  private appendToHistory(...messages: OpenAI.ChatCompletionMessageParam[]) {
    this.history.push(...messages);
    if (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
    }
  }
}

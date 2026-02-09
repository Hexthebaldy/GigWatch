import OpenAI from "openai";
import type { AppEnv } from "../../config";
import { resolveModelTemperature } from "../../clients/modelTemperature";
import { logError, logInfo, logWarn } from "../../utils/logger";
import type { ToolRegistry } from "../tools/registry";
import type { AgentRuntimeResult, AgentRuntimeStep } from "./types";

const MAX_ITERATIONS = 50;

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

const normalizeAssistantContent = (input: unknown): string => {
  if (typeof input === "string") return input.trim();
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const text = (item as { text?: string }).text;
        return typeof text === "string" ? text : "";
      })
      .join("\n")
      .trim();
  }
  return "";
};

export class AgentRunner {
  private llm?: OpenAI;
  private llmModel?: string;
  private temperature = 1;

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
      this.temperature = resolveModelTemperature(this.llmModel, env.openaiTemperature, 1);
    }
  }

  getModel() {
    return this.llmModel;
  }

  async runTurn(initialMessages: OpenAI.ChatCompletionMessageParam[]): Promise<AgentRuntimeResult> {
    if (!this.llm || !this.llmModel) {
      const fallback = "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
      return {
        reply: fallback,
        messages: [...initialMessages, { role: "assistant", content: fallback }],
        steps: [{ stepType: "system_error", payload: { error: "missing_openai_api_key" } }]
      };
    }

    const messages = [...initialMessages];
    const steps: AgentRuntimeStep[] = [];
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
          temperature: this.temperature
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new Error("No response from LLM");
        }

        const assistantMessage = choice.message;
        messages.push(assistantMessage);
        steps.push({
          stepType: "assistant_message",
          payload: {
            content: normalizeAssistantContent(assistantMessage.content),
            toolCalls: assistantMessage.tool_calls?.length || 0
          }
        });

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          logInfo(`[AgentRunner] LLM requested ${assistantMessage.tool_calls.length} tool calls`);
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch (error) {
              const errorMsg = `Tool arguments parse error: ${String(error)}`;
              logWarn(`[AgentRunner] ${errorMsg}`);
              steps.push({
                stepType: "system_error",
                toolName,
                payload: { error: errorMsg }
              });
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              continue;
            }

            steps.push({
              stepType: "tool_call",
              toolName,
              payload: { arguments: toolArgs }
            });

            const tool = this.tools.get(toolName);
            if (!tool) {
              const errorMsg = `Tool "${toolName}" not found`;
              logWarn(`[AgentRunner] ${errorMsg}`);
              steps.push({
                stepType: "system_error",
                toolName,
                payload: { error: errorMsg }
              });
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
              steps.push({
                stepType: "tool_result",
                toolName,
                payload: {
                  success: !!(compacted as { success?: boolean })?.success,
                  result: compacted as Record<string, unknown>
                }
              });
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(compacted)
              });
            } catch (error) {
              const errorResult = { success: false, error: String(error) };
              steps.push({
                stepType: "tool_result",
                toolName,
                payload: { success: false, result: errorResult }
              });
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(errorResult)
              });
            }
          }
          continue;
        }

        const reply = normalizeAssistantContent(assistantMessage.content);
        if (reply) {
          return { reply, messages, steps };
        }
      } catch (error) {
        const errorMsg = `LLM iteration failed: ${String(error)}`;
        logError(`[AgentRunner] ${errorMsg}`);
        steps.push({
          stepType: "system_error",
          payload: { error: errorMsg }
        });
        return {
          reply: "处理请求时出现错误，请稍后再试。",
          messages,
          steps
        };
      }
    }

    logWarn("[AgentRunner] Reached max iterations without a final response");
    return {
      reply: "任务处理未完成，请换种说法再试。",
      messages,
      steps: [
        ...steps,
        {
          stepType: "system_error",
          payload: { error: "max_iterations_reached" }
        }
      ]
    };
  }
}

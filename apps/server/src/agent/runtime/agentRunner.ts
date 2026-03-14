import { generateText, streamText, type ModelMessage } from "ai";
import { createMoonshotAI, type MoonshotAIProvider } from "@ai-sdk/moonshotai";
import type { AppEnv } from "../../config";
import { resolveModelTemperature } from "../../clients/modelTemperature";
import { modelContextWindows } from "../../dictionary/modelContextWindows";
import { estimateTextTokens } from "../context/tokenEstimator";
import { logError, logInfo, logWarn } from "../../utils/logger";
import type { ToolRegistry } from "../tools/registry";
import type { AgentRuntimeResult, AgentRuntimeStep, AgentStreamEvent } from "./types";

const MAX_ITERATIONS = 50;
const LLM_TIMEOUT_MS = 120_000;
const COMPACTION_THRESHOLD_RATIO = 0.5;
const COMPACTION_KEEP_RECENT = 6;

// ── 上下文压缩 ──

const resolveContextWindow = (model: string | undefined): number => {
  if (!model) return 16 * 1024;
  const normalized = model.trim().toLowerCase();
  if (modelContextWindows[normalized]) return modelContextWindows[normalized];
  const prefixMatch = Object.entries(modelContextWindows).find(([key]) => normalized.startsWith(key));
  return prefixMatch ? prefixMatch[1] : 16 * 1024;
};

const estimateMessagesTokens = (messages: ModelMessage[]): number => {
  let total = 0;
  for (const msg of messages) {
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    total += estimateTextTokens(text) + 12;
  }
  return total;
};

const shouldCompact = (messages: ModelMessage[], model: string | undefined): boolean => {
  const contextWindow = resolveContextWindow(model);
  const threshold = Math.floor(contextWindow * COMPACTION_THRESHOLD_RATIO);
  return estimateMessagesTokens(messages) > threshold;
};

/**
 * 就地压缩消息：保留 system 消息和最近 N 条，中间部分用本地策略截断摘要。
 * 不依赖 LLM，避免额外 API 调用开销。
 */
const compactMessages = (messages: ModelMessage[]): ModelMessage[] => {
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  if (nonSystem.length <= COMPACTION_KEEP_RECENT) return messages;

  const toSummarize = nonSystem.slice(0, nonSystem.length - COMPACTION_KEEP_RECENT);
  const toKeep = nonSystem.slice(nonSystem.length - COMPACTION_KEEP_RECENT);

  const lines: string[] = [];
  for (const msg of toSummarize) {
    const prefix = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "工具";
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    lines.push(`${prefix}: ${text.replace(/\s+/g, " ").trim().slice(0, 320)}`);
  }
  const summaryText = lines.join("\n").slice(-4000);

  return [
    ...systemMessages,
    { role: "system" as const, content: `以下是之前对话与工具调用的摘要：\n${summaryText}` },
    ...toKeep,
  ];
};

/**
 * 安全获取 response.messages —— generateText/streamText 在 tool call
 * 后因 stopWhen 停止时 await result.response 可能抛出 NoOutputGeneratedError。
 */
const safeGetResponseMessages = async (
  responsePromise: PromiseLike<{ messages: any[] }>
): Promise<ModelMessage[] | null> => {
  try {
    const response = await responsePromise;
    return response.messages as ModelMessage[];
  } catch {
    return null;
  }
};

// ── AgentRunner ──

export class AgentRunner {
  private provider?: MoonshotAIProvider;
  readonly model?: string;
  private temperature = 1;

  constructor(
    private tools: ToolRegistry,
    env: AppEnv
  ) {
    if (env.openaiApiKey) {
      this.provider = createMoonshotAI({
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl,
      });
      this.model = env.openaiModel || "kimi-k2.5";
      this.temperature = resolveModelTemperature(this.model, env.openaiTemperature, 1);
    }
  }

  getModel(): string | undefined {
    return this.model;
  }

  // ──────────────────────────────────────────────────────────────────────
  // runTurn（非流式版本）
  // ──────────────────────────────────────────────────────────────────────
  async runTurn(initialMessages: ModelMessage[]): Promise<AgentRuntimeResult> {
    if (!this.provider || !this.model) {
      const fallback = "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
      return {
        reply: fallback,
        messages: [...initialMessages, { role: "assistant" as const, content: fallback }],
        steps: [{ stepType: "system_error", payload: { error: "missing_openai_api_key" } }]
      };
    }

    let messages: ModelMessage[] = [...initialMessages];

    const steps: AgentRuntimeStep[] = [];
    const vercelTools = this.tools.toVercelTools();

    let iterations = 0;
    while (iterations < MAX_ITERATIONS) {
      iterations += 1;

      // 上下文压缩检查
      if (shouldCompact(messages, this.model)) {
        logInfo(`[AgentRunner] Compacting context (iteration ${iterations})`);
        messages = compactMessages(messages);
      }

      try {
        const result = await generateText({
          model: this.provider(this.model),
          messages,
          tools: vercelTools,
          temperature: this.temperature,
          abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });

        // 记录 steps
        for (const step of result.steps) {
          steps.push({
            stepType: "assistant_message",
            payload: { content: step.text?.trim() || "", toolCalls: step.toolCalls?.length || 0 }
          });
          if (step.toolCalls) {
            for (const tc of step.toolCalls) {
              steps.push({ stepType: "tool_call", toolName: tc.toolName, payload: { arguments: tc.input } });
            }
          }
          if (step.toolResults) {
            for (const tr of step.toolResults) {
              const success = !!(tr.output as any)?.success;
              steps.push({ stepType: "tool_result", toolName: tr.toolName, payload: { success, result: tr.output as Record<string, unknown> } });
            }
          }
        }

        // 获取 SDK 构建的 response messages（generateText 的 response 是同步的）
        let responseMessages: ModelMessage[] | null = null;
        try {
          responseMessages = result.response.messages as ModelMessage[];
        } catch {
          responseMessages = null;
        }

        // 判断是否还有 tool calls 需要继续循环
        const lastStep = result.steps[result.steps.length - 1];
        const hasToolCalls = lastStep?.toolCalls && lastStep.toolCalls.length > 0;

        if (!hasToolCalls) {
          const reply = result.text?.trim();
          if (reply) {
            const finalMessages = responseMessages
              ? [...messages, ...responseMessages]
              : messages;
            return { reply, messages: finalMessages, steps };
          }
        }

        // 有 tool calls：优先用 SDK 的 response messages（追加），否则手动拼接
        if (responseMessages) {
          messages = [...messages, ...responseMessages];
        } else {
          // 手动构建：将 assistant(tool_calls) + tool results 追加到 messages
          this.appendToolCallMessages(messages, lastStep);
        }
      } catch (error) {
        const isTimeout = (error as Error).name === "TimeoutError";
        const errorMsg = isTimeout
          ? `LLM call timed out after ${LLM_TIMEOUT_MS / 1000}s`
          : `LLM iteration failed: ${String(error)}`;
        logError(`[AgentRunner] ${errorMsg}`);
        steps.push({ stepType: "system_error", payload: { error: errorMsg } });
        return {
          reply: isTimeout ? "请求超时，请稍后再试。" : "处理请求时出现错误，请稍后再试。",
          messages,
          steps
        };
      }
    }

    logWarn("[AgentRunner] Reached max iterations without a final response");
    return {
      reply: "任务处理未完成，请换种说法再试。",
      messages,
      steps: [...steps, { stepType: "system_error", payload: { error: "max_iterations_reached" } }]
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // runTurnStreaming（流式版本）
  // ──────────────────────────────────────────────────────────────────────
  async *runTurnStreaming(
    initialMessages: ModelMessage[],
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<AgentStreamEvent, AgentRuntimeResult> {
    const signal = options?.signal;
    if (!this.provider || !this.model) {
      const fallback = "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
      yield { type: "error", message: fallback };
      return {
        reply: fallback,
        messages: [...initialMessages, { role: "assistant" as const, content: fallback }],
        steps: [{ stepType: "system_error", payload: { error: "missing_openai_api_key" } }]
      };
    }

    let messages: ModelMessage[] = [...initialMessages];

    const steps: AgentRuntimeStep[] = [];
    const vercelTools = this.tools.toVercelTools();

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      if (signal?.aborted) break;
      iterations += 1;

      // 上下文压缩检查
      if (shouldCompact(messages, this.model)) {
        logInfo(`[AgentRunner] Compacting context (streaming iteration ${iterations})`);
        messages = compactMessages(messages);
      }

      try {
        logInfo(`[AgentRunner] Streaming iteration ${iterations}, model=${this.model}, messages=${messages.length}`);

        const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
        const combinedSignal = signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal;

        const result = streamText({
          model: this.provider(this.model),
          messages,
          tools: vercelTools,
          temperature: this.temperature,
          abortSignal: combinedSignal,
        });

        let iterationText = "";
        let hasToolCalls = false;
        // 收集本轮的 tool calls 和 results，用于手动构建 messages
        const collectedToolCalls: Array<{ id: string; name: string; input: any }> = [];
        const collectedToolResults: Array<{ id: string; name: string; output: any }> = [];

        for await (const part of result.fullStream) {
          if (signal?.aborted) {
            yield { type: "error", message: "已终止" };
            return { reply: "已终止", messages, steps };
          }

          switch (part.type) {
            case "text-delta":
              iterationText += part.text;
              yield { type: "token", content: part.text };
              break;

            case "tool-call":
              hasToolCalls = true;
              logInfo(`[AgentRunner] Tool call: ${part.toolName}(${JSON.stringify(part.input)})`);
              yield { type: "tool_start", toolName: part.toolName, arguments: part.input as Record<string, unknown> };
              steps.push({ stepType: "tool_call", toolName: part.toolName, payload: { arguments: part.input as Record<string, unknown> } });
              collectedToolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
              break;

            case "tool-result": {
              const success = !!(part.output as any)?.success;
              logInfo(`[AgentRunner] Tool result: ${part.toolName} → success=${success}`);
              yield { type: "tool_end", toolName: part.toolName, success };
              steps.push({
                stepType: "tool_result",
                toolName: part.toolName,
                payload: { success, result: part.output as Record<string, unknown> }
              });
              collectedToolResults.push({ id: part.toolCallId, name: part.toolName, output: part.output });
              break;
            }

            case "error":
              yield { type: "error", message: String(part.error) };
              break;
          }
        }

        steps.push({
          stepType: "assistant_message",
          payload: { content: iterationText.trim(), toolCalls: hasToolCalls ? collectedToolCalls.length : 0 }
        });

        if (!hasToolCalls) {
          // 最终回复 — 只用当前迭代的文本，中间迭代的碎片文本已流式发送
          const reply = iterationText.trim() || "（无回复内容）";
          logInfo(`[AgentRunner] Final reply (${iterations} iteration(s)): ${reply.slice(0, 200)}`);
          yield { type: "done", reply };
          return { reply, messages, steps };
        }

        // 有 tool calls — 尝试从 SDK 获取 messages，失败则手动构建
        const responseMessages = await safeGetResponseMessages(result.response);
        if (responseMessages) {
          // SDK 返回的是本轮新增消息，追加到历史中
          messages = [...messages, ...responseMessages];
        } else {
          // 手动构建 assistant + tool messages
          messages.push({
            role: "assistant" as const,
            content: [
              ...(iterationText ? [{ type: "text" as const, text: iterationText }] : []),
              ...collectedToolCalls.map(tc => ({
                type: "tool-call" as const,
                toolCallId: tc.id,
                toolName: tc.name,
                input: tc.input as unknown,
              })),
            ],
          });
          messages.push({
            role: "tool" as const,
            content: collectedToolResults.map(tr => ({
              type: "tool-result" as const,
              toolCallId: tr.id,
              toolName: tr.name,
              output: { type: "json" as const, value: tr.output },
            })),
          });
        }
      } catch (error) {
        if ((error as Error).name === "AbortError" || signal?.aborted) {
          yield { type: "error", message: "已终止" };
          return { reply: "已终止", messages, steps };
        }
        const isTimeout = (error as Error).name === "TimeoutError";
        const errorMsg = isTimeout
          ? `LLM call timed out after ${LLM_TIMEOUT_MS / 1000}s`
          : `LLM iteration failed: ${String(error)}`;
        logError(`[AgentRunner] ${errorMsg}`);
        steps.push({ stepType: "system_error", payload: { error: errorMsg } });
        const fallback = isTimeout ? "请求超时，请稍后再试。" : "处理请求时出现错误，请稍后再试。";
        yield { type: "error", message: fallback };
        return { reply: fallback, messages, steps };
      }
    }

    if (signal?.aborted) {
      yield { type: "error", message: "已终止" };
      return { reply: "已终止", messages, steps };
    }
    logWarn("[AgentRunner] Reached max iterations without a final response (streaming)");
    const fallback = "任务处理未完成，请换种说法再试。";
    yield { type: "error", message: fallback };
    return {
      reply: fallback,
      messages,
      steps: [...steps, { stepType: "system_error", payload: { error: "max_iterations_reached" } }]
    };
  }

  /**
   * 当 SDK 的 response.messages 不可用时，手动将 tool call 结果追加到 messages。
   */
  private appendToolCallMessages(messages: ModelMessage[], lastStep: any) {
    if (!lastStep?.toolCalls?.length) return;

    messages.push({
      role: "assistant" as const,
      content: lastStep.toolCalls.map((tc: any) => ({
        type: "tool-call" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input as unknown,
      })),
    });

    if (lastStep.toolResults?.length) {
      messages.push({
        role: "tool" as const,
        content: lastStep.toolResults.map((tr: any) => ({
          type: "tool-result" as const,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: { type: "json" as const, value: tr.output },
        })),
      });
    }
  }
}

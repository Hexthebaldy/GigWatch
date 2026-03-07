import OpenAI from "openai";
import type { AppEnv } from "../../config";
import { resolveModelTemperature } from "../../clients/modelTemperature";
import { logError, logInfo, logWarn } from "../../utils/logger";
import type { ToolRegistry } from "../tools/registry";
import type { AgentRuntimeResult, AgentRuntimeStep, AgentStreamEvent } from "./types";

const MAX_ITERATIONS = 50;

const compactEvents = (events: any[], limit = 20) => {
  if (!Array.isArray(events)) return events;
  const trimmed = events.slice(0, limit);
  return { items: trimmed, total: events.length };
};

//截断tool calling返回结果中过大的数据，防止撑爆 llm 上下文窗口
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

const getReplyText = (content: string | null | undefined): string =>
  (content ?? "").trim();

export class AgentRunner {
  private llm?: OpenAI;
  readonly model?: string;
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
      this.model = env.openaiModel || "kimi-k2.5";
      this.temperature = resolveModelTemperature(this.model, env.openaiTemperature, 1);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // runTurn（非流式版本）
  //
  // 核心是一个 while 循环，每轮做一件事：把当前 messages 发给 LLM，
  // 看返回的 assistant 消息里有没有 tool_calls：
  //   - 有 tool_calls → 执行工具，把结果追加到 messages，continue 进入下一轮
  //   - 没有 tool_calls → 说明 LLM 给出了最终文本回复，return 结束
  //
  // 上下文管理的关键：messages 数组在整个循环中是同一个引用，不断 push。
  // 每一轮循环都把完整的 messages 发给 LLM，所以 LLM 能看到：
  //   [system prompt, 历史对话, user 消息, assistant(tool_calls), tool结果, assistant(tool_calls), tool结果, ...]
  // 这就是 OpenAI function calling 的上下文协议——assistant 消息和 tool 消息
  // 必须严格配对，tool 消息的 tool_call_id 必须对应前面 assistant 消息中的某个 tool_call。
  // ──────────────────────────────────────────────────────────────────────
  async runTurn(initialMessages: OpenAI.ChatCompletionMessageParam[]): Promise<AgentRuntimeResult> {
    if (!this.llm || !this.model) {
      const fallback = "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
      return {
        reply: fallback,
        messages: [...initialMessages, { role: "assistant", content: fallback }],
        steps: [{ stepType: "system_error", payload: { error: "missing_openai_api_key" } }]
      };
    }

    // messages: 贯穿整个 tool calling loop 的上下文数组。
    // 初始内容由 ContextManager 构建，包含 [system prompt, (可选)历史摘要, 近期对话历史, 本次 user 消息]。
    // 循环中每一轮都会往里 push assistant 消息和 tool 结果消息，下一轮整体发给 LLM。
    const messages = [...initialMessages];
    // steps: 记录整个循环的执行轨迹，用于持久化到 agent_steps 表，方便调试和审计。
    const steps: AgentRuntimeStep[] = [];
    // 把注册的工具转成 OpenAI function calling 的 JSON Schema 格式，随每次请求发给 LLM。
    const availableTools = this.tools.toFunctionSchemas();

    let iterations = 0;
    while (iterations < MAX_ITERATIONS) {
      iterations += 1;
      try {
        logInfo(
          `[AgentRunner] LLM context (iteration ${iterations}) ${JSON.stringify({
            model: this.model,
            temperature: this.temperature,
            messages
          })}`
        );

        // ── 调用 LLM ──
        // tool_choice: "auto" 表示由模型自行决定是否调用工具。
        // 模型会根据 messages 上下文和可用工具列表，决定：
        //   a) 直接返回文本回复（finish_reason: "stop"）
        //   b) 请求调用一个或多个工具（finish_reason: "tool_calls"）
        const response = await this.llm.chat.completions.create({
          model: this.model,
          messages,
          tools: availableTools,
          tool_choice: "auto",
          temperature: this.temperature
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new Error("No response from LLM");
        }

        // ── 将 assistant 消息追加到上下文 ──
        // 无论模型是返回文本还是 tool_calls，都先把这条 assistant 消息 push 进 messages。
        // 非流式模式下直接用 API 返回的原始对象，它自带 reasoning_content 等字段，
        // 不会丢失 thinking 模型所需的元数据。
        const assistantMessage = choice.message;
        messages.push(assistantMessage);
        steps.push({
          stepType: "assistant_message",
          payload: {
            content: getReplyText(assistantMessage.content),
            toolCalls: assistantMessage.tool_calls?.length || 0
          }
        });

        // ── 分支：模型请求调用工具 ──
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          logInfo(`[AgentRunner] LLM requested ${assistantMessage.tool_calls.length} tool calls`);
          logInfo(
            `[AgentRunner] Tools selected: ${assistantMessage.tool_calls.map((call) => call.function.name).join(", ")}`
          );

          // 逐个执行工具。每个 tool_call 都必须有一条对应的 role:"tool" 消息回填到 messages，
          // 否则下一轮调用 LLM 时 API 会报错（tool_call_id 无匹配的 tool 结果）。
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};

            // 解析工具参数（LLM 返回的是 JSON 字符串）
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
              // 即使解析失败也必须 push 一条 tool 消息，保持 assistant ↔ tool 配对
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

            // 执行工具，将结果序列化后 push 到 messages。
            // compactToolResult 会截断过大的 events 数组，防止上下文膨胀超出模型窗口。
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
          // 所有工具执行完毕，continue 回到循环顶部，带着新的上下文再次调用 LLM。
          // LLM 会看到工具返回的结果，决定是继续调工具还是给出最终回复。
          continue;
        }

        // ── 分支：模型返回最终文本回复，没有 tool_calls ──
        // 循环结束，返回结果。
        const reply = getReplyText(assistantMessage.content);
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

    // 超过 MAX_ITERATIONS 仍未拿到最终回复，强制退出防止无限循环。
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

  // ──────────────────────────────────────────────────────────────────────
  // runTurnStreaming（流式版本）
  //
  // 整体逻辑和 runTurn 完全一致：同样的 while 循环、同样的上下文累积策略。
  // 区别在于：
  //   1. LLM 调用使用 stream: true，返回的不是完整响应，而是逐 chunk 的 async iterable
  //   2. 每收到一个文本 chunk 就 yield 出去，前端可以实时显示（打字机效果）
  //   3. tool_calls 也是分 chunk 到达的（id/name/arguments 可能分散在多个 chunk 里），
  //      需要用 toolCallAccum Map 按 index 累积拼装
  //   4. assistant 消息需要手动构建（非流式版本直接用 API 返回的完整对象）
  //
  // 上下文管理和非流式版本完全相同：
  //   - messages 数组贯穿整个循环
  //   - 每轮 push assistant 消息 + tool 结果消息
  //   - 下一轮把完整 messages 发给 LLM
  //
  // 返回值约定：yield 出去的是 AgentStreamEvent（给前端实时消费），
  // 最终 return 的是 AgentRuntimeResult（给 ChatService 用于持久化）。
  // ──────────────────────────────────────────────────────────────────────
  async *runTurnStreaming(
    initialMessages: OpenAI.ChatCompletionMessageParam[]
  ): AsyncGenerator<AgentStreamEvent, AgentRuntimeResult> {
    if (!this.llm || !this.model) {
      const fallback = "未配置 OPENAI_API_KEY，无法理解自然语言任务。请先配置后重试。";
      yield { type: "error", message: fallback };
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
        logInfo(`[AgentRunner] Streaming iteration ${iterations}, model=${this.model}, messages=${messages.length}`);
        logInfo(`[AgentRunner] Full context:\n${JSON.stringify(messages, null, 2)}`);

        const stream = await this.llm.chat.completions.create({
          model: this.model,
          messages,
          tools: availableTools,
          tool_choice: "auto",
          temperature: this.temperature,
          stream: true
        });

        // ── 流式 chunk 累积 ──
        // 流式响应把一条完整的 assistant 消息拆成了几十上百个 chunk，
        // 需要手动累积还原出完整的 content、reasoning_content 和 tool_calls。
        let contentAccum = "";
        let reasoningAccum = "";
        // toolCallAccum: 按 chunk.tool_calls[].index 分组累积。
        // 流式模式下一个 tool_call 的 id、name、arguments 可能分散在多个 chunk 中：
        //   chunk1: { index: 0, id: "call_xxx", function: { name: "web_search", arguments: "" } }
        //   chunk2: { index: 0, function: { arguments: '{"que' } }
        //   chunk3: { index: 0, function: { arguments: 'ry":"test"}' } }
        // 所以用 Map<index, accumulated> 逐步拼接。
        const toolCallAccum: Map<number, {
          id: string;
          name: string;
          arguments: string;
        }> = new Map();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as Record<string, any> | undefined;
          if (!delta) continue;
          console.log('#流式chunk: ', chunk);
          // reasoning_content: Kimi K2.5 等 thinking 模型的推理过程。
          // 不发给前端，但必须累积并写入 assistant 消息，
          // 否则下一轮调用 API 时会报 400（thinking 模式要求每条 assistant 消息都带此字段）。
          if (delta.reasoning_content) {
            reasoningAccum += delta.reasoning_content;
          }

          // content: 模型的正文输出，每个 chunk 立刻 yield 给前端实时显示。
          if (delta.content) {
            contentAccum += delta.content;
            yield { type: "token", content: delta.content };
          }

          // tool_calls: 按 index 分组累积，拼装完整的工具调用。
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccum.get(tc.index);
              if (!existing) {
                toolCallAccum.set(tc.index, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || ""
                });
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          }
        }

        // ── 从累积数据手动构建 assistant 消息 ──
        // 非流式版本直接用 API 返回的 choice.message 对象（自带所有字段），
        // 流式版本必须自己拼装。注意 reasoning_content 必须无条件赋值（即使是空字符串），
        // 因为kimi k2.5 thinking 模式要求这个字段存在，空字符串 "" 是 falsy 但 API 需要它。
        const toolCalls = Array.from(toolCallAccum.values()).filter(tc => tc.id && tc.name);
        const assistantMessage: Record<string, any> = {
          role: "assistant",
          content: contentAccum || null,
          reasoning_content: reasoningAccum,
        };
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments }
          }));
        }

        // push 到 messages，下一轮循环时 LLM 能看到这条 assistant 消息及其后的 tool 结果。
        messages.push(assistantMessage as OpenAI.ChatCompletionMessageParam);
        steps.push({
          stepType: "assistant_message",
          payload: {
            content: contentAccum.trim(),
            toolCalls: toolCalls.length
          }
        });

        // ── 分支：模型请求调用工具 ──
        // 逻辑和非流式版本完全一致：逐个执行，结果 push 到 messages，continue 下一轮。
        if (toolCalls.length > 0) {
          logInfo(`[AgentRunner] LLM requested ${toolCalls.length} tool call(s): ${toolCalls.map(tc => tc.name).join(", ")}`);
          for (const tc of toolCalls) {
            let toolArgs: Record<string, unknown> = {};
            try {
              toolArgs = JSON.parse(tc.arguments || "{}");
            } catch (error) {
              const errorMsg = `Tool arguments parse error: ${String(error)}`;
              logWarn(`[AgentRunner] ${errorMsg}`);
              steps.push({ stepType: "system_error", toolName: tc.name, payload: { error: errorMsg } });
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              continue;
            }

            logInfo(`[AgentRunner] Tool call: ${tc.name}(${JSON.stringify(toolArgs)})`);
            yield { type: "tool_start", toolName: tc.name, arguments: toolArgs };
            steps.push({ stepType: "tool_call", toolName: tc.name, payload: { arguments: toolArgs } });

            const tool = this.tools.get(tc.name);
            if (!tool) {
              const errorMsg = `Tool "${tc.name}" not found`;
              logWarn(`[AgentRunner] ${errorMsg}`);
              steps.push({ stepType: "system_error", toolName: tc.name, payload: { error: errorMsg } });
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              yield { type: "tool_end", toolName: tc.name, success: false };
              continue;
            }

            try {
              const result = await tool.execute(toolArgs);
              const compacted = compactToolResult(result);
              const resultJson = JSON.stringify(compacted);
              logInfo(`[AgentRunner] Tool result: ${tc.name} → success=${!!(compacted as any)?.success}, ${resultJson.length} chars`);
              logInfo(`[AgentRunner] Tool result detail: ${resultJson.slice(0, 2000)}`);
              steps.push({
                stepType: "tool_result",
                toolName: tc.name,
                payload: { success: !!(compacted as { success?: boolean })?.success, result: compacted as Record<string, unknown> }
              });
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: resultJson
              });
              yield { type: "tool_end", toolName: tc.name, success: true };
            } catch (error) {
              const errorResult = { success: false, error: String(error) };
              logError(`[AgentRunner] Tool error: ${tc.name} → ${String(error)}`);
              steps.push({ stepType: "tool_result", toolName: tc.name, payload: { success: false, result: errorResult } });
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(errorResult)
              });
              yield { type: "tool_end", toolName: tc.name, success: false };
            }
          }
          continue;
        }

        // ── 分支：最终文本回复 ──
        const reply = contentAccum.trim();
        if (reply) {
          logInfo(`[AgentRunner] Final reply (${iterations} iteration(s), ${messages.length} messages): ${reply.slice(0, 200)}`);
          yield { type: "done", reply };
          return { reply, messages, steps };
        }
      } catch (error) {
        const errorMsg = `LLM iteration failed: ${String(error)}`;
        logError(`[AgentRunner] ${errorMsg}`);
        steps.push({ stepType: "system_error", payload: { error: errorMsg } });
        const fallback = "处理请求时出现错误，请稍后再试。";
        yield { type: "error", message: fallback };
        return { reply: fallback, messages, steps };
      }
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
}

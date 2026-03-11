import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import { logError } from "../utils/logger";
import type { AgentStreamEvent } from "./runtime/types";
import type { StoredChatMessage } from "./context/types";
import { ChatRepository } from "./context/chatRepository";
import { ContextManager } from "./context/contextManager";
import { ContextSummarizer } from "./context/contextSummarizer";
import { ToolRegistry } from "./tools/registry";
import { AgentRunner } from "./runtime/agentRunner";
import { bashExecTool } from "./tools/common/bashExec";
import { createEditMemoTool } from "./tools/common/memo";
import { createListMemosTool } from "./tools/common/memo";
import { webFetchTool } from "./tools/common/webFetch";
import { webSearchTool } from "./tools/common/webSearch";
import { createUpdateMonitoringConfigTool } from "./tools/shows/config";
import { createLoadEventsTool } from "./tools/shows/database";
import { createLatestReportTool } from "./tools/shows/report";
import { createRunMonitoringTool } from "./tools/shows/runMonitoring";
import { createSearchEventsTool } from "./tools/shows/search";
import { showstartTool } from "./tools/shows/showstart";

const SYSTEM_PROMPT = [
  "你是 GigWatch 助手。用户用自然语言提出任务。你调用提供的工具完成任务。",
  "",
  "关键文件位置（相对项目根目录）：",
  "- 监控配置：./config/monitoring.json",
  "- 城市/演出风格的字典：./src/dictionary",
  "",
  "文件操作规范：",
  "- 读取/修改项目文件时，优先使用 bash_exec 工具。",
  "- 使用macos系统原生命令：find/grep/ls/cat/sed/head/tail。",
  "- bash_exec 仅支持 command + args，不支持 shell 管道和重定向。",
  "",
  "回答规范：",
  "- 若缺少必要信息，请先提问；有任务需要完成时必须调用工具，严禁欺骗用户任务已完成。若无法完成任务，请如实说明。"
].join("\n");

const trimStepPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const raw = JSON.stringify(payload);
  if (raw.length <= 6000) return payload;
  return {
    truncated: true,
    preview: raw.slice(0, 6000)
  };
};

export type ChatSource = "telegram" | "web" | "tui" | "feishu";

export type IncomingChatMessage = {
  source: ChatSource;
  text: string;
  externalChatId?: string;
  externalUserId?: string;
  metadata?: Record<string, unknown>;
};

export type ChatReply = {
  text: string;
  userMessageId: number;
  assistantMessageId: number;
  runId: number;
};

const createToolRegistry = (
  db: Database,
  env: AppEnv
) => {
  const registry = new ToolRegistry();
  registry.register(bashExecTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(showstartTool);
  registry.register(createLoadEventsTool(db));
  registry.register(createSearchEventsTool(db));
  registry.register(createLatestReportTool(db));
  registry.register(createRunMonitoringTool(db, env));
  registry.register(createEditMemoTool(db));
  registry.register(createListMemosTool(db));
  registry.register(createUpdateMonitoringConfigTool());

  return registry;
};

export class ChatService {
  private repository: ChatRepository; //管数据库读写的持久化层
  private contextManager: ContextManager; //上下文管理层
  private runner: AgentRunner; //Agent Loop主循环

  constructor(
    db: Database,
    env: AppEnv
  ) {
    const tools = createToolRegistry(db, env);
    this.repository = new ChatRepository(db);
    this.contextManager = new ContextManager(
      this.repository,
      new ContextSummarizer({
        apiKey: env.openaiApiKey,
        baseUrl: env.openaiBaseUrl,
        model: env.openaiModel || "kimi-k2-turbo-preview",
        requestedTemperature: env.openaiTemperature
      })
    );
    this.runner = new AgentRunner(tools, env);
  }

  async handleIncomingMessage(message: IncomingChatMessage): Promise<ChatReply> {
    const userText = (message.text || "").trim();
    if (!userText) {
      throw new Error("Empty message");
    }

    const userMessage = this.repository.insertMessage({
      role: "user",
      content: userText,
      source: message.source,
      externalChatId: message.externalChatId,
      externalUserId: message.externalUserId,
      metadata: message.metadata,
      visible: true
    });

    //写入本次agent执行任务的运行记录
    const run = this.repository.startAgentRun({
      triggerMessageId: userMessage.id,
      source: message.source,
      model: this.runner.model,
      metadata: {
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId
      }
    });

    try {
      const prompt = await this.contextManager.buildPrompt({
        maxMessageId: userMessage.id, // 上下文截断点
        systemPrompt: SYSTEM_PROMPT,
        model: this.runner.model
      });

      const runtimeResult = await this.runner.runTurn(prompt.messages);

      runtimeResult.steps.forEach((step, index) => {
        this.repository.insertAgentStep(run.id, index + 1, {
          ...step,
          payload: trimStepPayload(step.payload)
        });
      });

      const assistantMessage = this.repository.insertMessage({
        role: "assistant",
        content: runtimeResult.reply,
        source: "agent",
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId,
        metadata: {
          runId: run.id,
          estimatedPromptTokens: prompt.estimatedPromptTokens,
          promptTokenBudget: prompt.promptTokenBudget,
          modelContextWindow: prompt.modelContextWindow
        },
        visible: true
      });

      const isFailedReply = runtimeResult.reply.includes("处理请求时出现错误") ||
        runtimeResult.reply.includes("任务处理未完成") ||
        runtimeResult.reply.includes("未配置 OPENAI_API_KEY");
      this.repository.finishAgentRun(run.id, isFailedReply ? "failed" : "success");

      await this.contextManager.maybeCompactHistory();

      return {
        text: runtimeResult.reply,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        runId: run.id
      };
    } catch (error) {
      logError(`[ChatService] Failed to handle message: ${String(error)}`);
      this.repository.finishAgentRun(run.id, "failed", String(error));
      const fallback = "处理请求时出现错误，请稍后再试。";
      const assistantMessage = this.repository.insertMessage({
        role: "assistant",
        content: fallback,
        source: "agent",
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId,
        metadata: { runId: run.id, error: String(error) },
        visible: true
      });
      return {
        text: fallback,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        runId: run.id
      };
    }
  }

  async *handleIncomingMessageStream(
    message: IncomingChatMessage
  ): AsyncGenerator<AgentStreamEvent & { userMessageId?: number }> {
    const userText = (message.text || "").trim();
    if (!userText) {
      yield { type: "error", message: "Empty message" };
      return;
    }

    const userMessage = this.repository.insertMessage({
      role: "user",
      content: userText,
      source: message.source,
      externalChatId: message.externalChatId,
      externalUserId: message.externalUserId,
      metadata: message.metadata,
      visible: true
    });

    // Emit the userMessageId so the frontend knows the persisted ID
    yield { type: "token", content: "", userMessageId: userMessage.id };

    const run = this.repository.startAgentRun({
      triggerMessageId: userMessage.id,
      source: message.source,
      model: this.runner.model,
      metadata: {
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId
      }
    });

    try {
      const prompt = await this.contextManager.buildPrompt({
        maxMessageId: userMessage.id,
        systemPrompt: SYSTEM_PROMPT,
        model: this.runner.model
      });

      const gen = this.runner.runTurnStreaming(prompt.messages);
      let runtimeResult;
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          runtimeResult = value;
          break;
        }
        yield value;
      }

      runtimeResult.steps.forEach((step, index) => {
        this.repository.insertAgentStep(run.id, index + 1, {
          ...step,
          payload: trimStepPayload(step.payload)
        });
      });

      this.repository.insertMessage({
        role: "assistant",
        content: runtimeResult.reply,
        source: "agent",
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId,
        metadata: {
          runId: run.id,
          estimatedPromptTokens: prompt.estimatedPromptTokens,
          promptTokenBudget: prompt.promptTokenBudget,
          modelContextWindow: prompt.modelContextWindow
        },
        visible: true
      });

      const isFailedReply =
        runtimeResult.reply.includes("处理请求时出现错误") ||
        runtimeResult.reply.includes("任务处理未完成") ||
        runtimeResult.reply.includes("未配置 OPENAI_API_KEY");
      this.repository.finishAgentRun(run.id, isFailedReply ? "failed" : "success");

      await this.contextManager.maybeCompactHistory();
    } catch (error) {
      logError(`[ChatService] Stream failed: ${String(error)}`);
      this.repository.finishAgentRun(run.id, "failed", String(error));
      const fallback = "处理请求时出现错误，请稍后再试。";
      this.repository.insertMessage({
        role: "assistant",
        content: fallback,
        source: "agent",
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId,
        metadata: { runId: run.id, error: String(error) },
        visible: true
      });
      yield { type: "error", message: fallback };
    }
  }

  listVisibleMessages(limit = 200): StoredChatMessage[] {
    return this.repository.listVisibleLatest(limit);
  }
}

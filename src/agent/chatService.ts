import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import { logError } from "../utils/logger";
import type { StoredChatMessage } from "./context/types";
import { ChatRepository } from "./context/chatRepository";
import { ContextManager } from "./context/contextManager";
import { ContextSummarizer } from "./context/contextSummarizer";
import type { ToolRegistry } from "./tools/registry";
import { AgentRunner } from "./runtime/agentRunner";

const SYSTEM_PROMPT = [
  "你是 GigWatch 助手。用户用自然语言提出任务。你调用提供的工具完成任务。",
  "",
  "关键文件位置（相对项目根目录）：",
  "- 监控配置：./config/monitoring.json",
  "- 城市字典：./src/dictionary/showstartCities.ts",
  "- 演出风格字典：./src/dictionary/showstartShowStyles.ts",
  "",
  "文件操作规范：",
  "- 读取/修改项目文件时，优先使用 bash_exec 工具。",
  "- 使用macos系统原生命令：find/grep/ls/cat/sed/head/tail。",
  "- bash_exec 仅支持 command + args，不支持 shell 管道和重定向。",
  "",
  "回答规范：",
  "- 若缺少必要信息请先提问；若现有工具无法完成，请如实说明。"
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

export class ChatService {
  private repository: ChatRepository; //管数据库读写的持久化层
  private contextManager: ContextManager; //上下文管理层
  private runner: AgentRunner; //Agent Loop主循环

  constructor(
    db: Database,
    tools: ToolRegistry,
    env: AppEnv
  ) {
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
      model: this.runner.getModel(),
      metadata: {
        externalChatId: message.externalChatId,
        externalUserId: message.externalUserId
      }
    });

    try {
      const prompt = await this.contextManager.buildPrompt({
        maxMessageId: userMessage.id, // 上下文截断点
        systemPrompt: SYSTEM_PROMPT,
        model: this.runner.getModel()
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

  listVisibleMessages(limit = 200): StoredChatMessage[] {
    return this.repository.listVisibleLatest(limit);
  }
}

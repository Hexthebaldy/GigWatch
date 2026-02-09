import type OpenAI from "openai";
import { modelContextWindows } from "../../dictionary/modelContextWindows";
import type { ChatRepository } from "./chatRepository";
import type { PromptBuildResult, StoredChatMessage } from "./types";
import { estimateTextTokens } from "./tokenEstimator";
import type { ContextSummarizer } from "./contextSummarizer";

const SUMMARY_SCOPE = "global";
const DEFAULT_MODEL_CONTEXT_WINDOW = 16 * 1024;
const PROMPT_BUDGET_RATIO = 0.72;
const RECENT_MESSAGES_FETCH_LIMIT = 240;
const MIN_SUMMARIZE_MESSAGES = 20;
const KEEP_RECENT_UNSUMMARIZED = 10;
const MAX_SUMMARIZE_BATCH = 120;

// 根据模型名解析上下文窗口大小；未命中时回退默认值。
const resolveModelContextWindow = (model: string | undefined) => {
  if (!model) return DEFAULT_MODEL_CONTEXT_WINDOW;
  const normalized = model.trim().toLowerCase();
  if (modelContextWindows[normalized]) {
    return modelContextWindows[normalized];
  }
  const prefixMatched = Object.entries(modelContextWindows).find(([key]) => normalized.startsWith(key));
  if (prefixMatched) {
    return prefixMatched[1];
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW;
};

// 将存储层消息结构转换为 OpenAI 对话消息结构。
const toChatMessage = (message: StoredChatMessage): OpenAI.ChatCompletionMessageParam => {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content };
  }
  if (message.role === "system") {
    return { role: "system", content: message.content };
  }
  if (message.role === "tool") {
    return { role: "assistant", content: message.content };
  }
  return { role: "user", content: message.content };
};

export class ContextManager {
  // 注入消息仓储与摘要器，供上下文构建流程复用。
  constructor(
    private repository: ChatRepository,
    private summarizer: ContextSummarizer
  ) { }

  // 当未压缩消息达到阈值时，增量压缩为摘要并推进游标。
  async maybeCompactHistory() {
    const summary = this.repository.getSummary(SUMMARY_SCOPE);
    const pending = this.repository.listVisibleMessagesAfter(summary.untilMessageId, 500);
    const summarizeCount = pending.length - KEEP_RECENT_UNSUMMARIZED;
    if (summarizeCount < MIN_SUMMARIZE_MESSAGES) return;

    const compactCount = Math.min(summarizeCount, MAX_SUMMARIZE_BATCH);
    if (compactCount <= 0) return;

    const chunk = pending.slice(0, compactCount);
    if (!chunk.length) return;

    const newSummary = await this.summarizer.summarize(summary.summaryText, chunk);
    const lastId = chunk[chunk.length - 1]?.id;
    if (!lastId) return;
    this.repository.upsertSummary(SUMMARY_SCOPE, lastId, newSummary);
  }

  // 基于系统提示词、摘要与近期消息生成最终 prompt，并控制 token 预算。
  async buildPrompt(input: {
    maxMessageId: number;
    systemPrompt: string;
    model?: string;
  }): Promise<PromptBuildResult> {
    await this.maybeCompactHistory();

    const summary = this.repository.getSummary(SUMMARY_SCOPE);
    const recentMessages = this.repository.listVisibleMessagesBeforeOrAt(
      input.maxMessageId,
      RECENT_MESSAGES_FETCH_LIMIT
    );

    const modelContextWindow = resolveModelContextWindow(input.model);
    const promptTokenBudget = Math.max(1024, Math.floor(modelContextWindow * PROMPT_BUDGET_RATIO));
    const summaryPrompt = summary.summaryText
      ? `以下是长期记忆摘要（由历史对话压缩而来）：\n${summary.summaryText}`
      : "";

    // 固定开销（systemPrompt + summaryPrompt）
    const fixedTokens =
      estimateTextTokens(input.systemPrompt) + (summaryPrompt ? estimateTextTokens(summaryPrompt) : 0) + 64;
    const historyBudget = Math.max(256, promptTokenBudget - fixedTokens);

    const selected: StoredChatMessage[] = [];
    let used = 0;
    for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
      const msg = recentMessages[i];
      const tokens = estimateTextTokens(msg.content) + 12;
      if (selected.length > 0 && used + tokens > historyBudget) {
        continue;
      }
      selected.push(msg);
      used += tokens;
      if (used >= historyBudget) break;
    }
    selected.reverse();

    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "system", content: input.systemPrompt }];
    if (summaryPrompt) {
      messages.push({ role: "system", content: summaryPrompt });
    }
    for (const message of selected) {
      messages.push(toChatMessage(message));
    }

    return {
      messages,
      modelContextWindow,
      promptTokenBudget,
      estimatedPromptTokens: fixedTokens + used
    };
  }
}

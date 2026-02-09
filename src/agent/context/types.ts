import type OpenAI from "openai";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type StoredChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  source: string;
  externalChatId?: string;
  externalUserId?: string;
  visible: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ContextSummary = {
  scope: string;
  untilMessageId: number;
  summaryText: string;
  updatedAt: string;
};

export type AgentRun = {
  id: number;
  triggerMessageId?: number;
  source: string;
  status: "running" | "success" | "failed";
  model?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
};

export type AgentStep = {
  stepType: "assistant_message" | "tool_call" | "tool_result" | "system_error";
  toolName?: string;
  payload: Record<string, unknown>;
};

export type PromptBuildResult = {
  messages: OpenAI.ChatCompletionMessageParam[];
  modelContextWindow: number;
  promptTokenBudget: number;
  estimatedPromptTokens: number;
};

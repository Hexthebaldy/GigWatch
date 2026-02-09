import type OpenAI from "openai";

export type AgentRuntimeStep = {
  stepType: "assistant_message" | "tool_call" | "tool_result" | "system_error";
  toolName?: string;
  payload: Record<string, unknown>;
};

export type AgentRuntimeResult = {
  reply: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  steps: AgentRuntimeStep[];
};

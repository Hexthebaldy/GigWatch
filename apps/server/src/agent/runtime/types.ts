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

/** Events yielded by the streaming agent runner */
export type AgentStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_start"; toolName: string; arguments: Record<string, unknown> }
  | { type: "tool_end"; toolName: string; success: boolean }
  | { type: "done"; reply: string }
  | { type: "error"; message: string };

#!/usr/bin/env bun

/**
 * AgentRunner 单元测试
 *
 * 测试：
 * - 未配置 OPENAI_API_KEY 时的回退行为
 * - 返回结构完整性
 */

import type OpenAI from "openai";
import { AgentRunner } from "../src/agent/runtime/agentRunner";
import { ToolRegistry } from "../src/agent/tools/registry";
import type { AppEnv } from "../src/config";

console.log("🤖 Testing AgentRunner\n");

const env: AppEnv = {
  timezone: "Asia/Shanghai",
  dbPath: ":memory:",
  serverPort: 3000
};

const runner = new AgentRunner(new ToolRegistry(), env);

console.log("Test 1: Missing OPENAI_API_KEY fallback");
if (runner.getModel() !== undefined) {
  console.error("❌ getModel should be undefined without OPENAI_API_KEY");
  process.exit(1);
}
console.log("✅ getModel returns undefined as expected");

const initialMessages: OpenAI.ChatCompletionMessageParam[] = [
  { role: "system", content: "你是测试助手" },
  { role: "user", content: "请帮我总结今日演出" }
];

const result = await runner.runTurn(initialMessages);

if (!result.reply.includes("未配置 OPENAI_API_KEY")) {
  console.error("❌ Fallback reply mismatch");
  process.exit(1);
}
console.log("✅ Returned fallback reply");

if (!Array.isArray(result.steps) || result.steps.length !== 1) {
  console.error("❌ Steps should contain exactly one system_error step");
  process.exit(1);
}

const firstStep = result.steps[0];
if (firstStep.stepType !== "system_error" || firstStep.payload.error !== "missing_openai_api_key") {
  console.error("❌ system_error step payload mismatch");
  process.exit(1);
}
console.log("✅ system_error step is correct");

if (!Array.isArray(result.messages) || result.messages.length !== initialMessages.length + 1) {
  console.error("❌ Messages length mismatch");
  process.exit(1);
}
console.log("✅ Messages append behavior is correct");

console.log("\n🎉 All agent tests passed!");

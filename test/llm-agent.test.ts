#!/usr/bin/env bun

/**
 * LLM-driven Agent 测试
 *
 * 测试：
 * - Agent 自主调用工具
 * - Agent 分析结果并决定通知
 * - Telegram 通知发送（如果配置）
 */

import { Database } from "bun:sqlite";
import { loadConfig, loadEnv } from "../src/config";
import { runDailyReportWithAgent } from "../src/jobs/dailyReport";

console.log("🤖 Testing LLM-driven Agent Execution\n");

// Load environment
const env = loadEnv();

// Check LLM configuration
if (!env.openaiApiKey) {
  console.error("❌ OPENAI_API_KEY not configured");
  console.log("   Please set OPENAI_API_KEY in .env to test LLM-driven agent");
  process.exit(1);
}

console.log("✅ LLM configured");
console.log(`   Model: ${env.openaiModel || "kimi-k2-turbo-preview"}`);
console.log(`   Base URL: ${env.openaiBaseUrl || "default"}`);

// Check Telegram configuration
if (env.telegramBotToken && env.telegramChatId) {
  console.log("✅ Telegram configured");
  console.log(`   Chat ID: ${env.telegramChatId}`);
} else {
  console.log("⚠️  Telegram not configured (notifications disabled)");
}

console.log("");

// Load config
const config = loadConfig(env.configPath);
console.log("✅ Config loaded");
console.log(`   Focus artists: ${config.monitoring.focusArtists?.join(", ") || "none"}`);
console.log(`   Time window: ${config.app?.reportWindowHours || 24} hours`);

console.log("");

// Open database
const db = new Database(env.dbPath);
console.log(`✅ Database opened: ${env.dbPath}`);

console.log("");
console.log("🚀 Starting LLM-driven agent execution...");
console.log("   (This may take a while as the agent makes autonomous decisions)\n");

try {
  const report = await runDailyReportWithAgent(db, config, env);

  console.log("\n✅ Agent execution completed!");
  console.log(`   Summary: ${report.summary}`);
  console.log(`   Events: ${report.events.length}`);
  console.log(`   Focus matches: ${report.focusArtists.length}`);

  // Check if agent sent notifications
  console.log("\n📊 Agent Behavior:");
  console.log("   Check your Telegram for notifications (if configured)");
  console.log("   The agent should have autonomously decided:");
  console.log("   - Which events are worth notifying");
  console.log("   - Whether to send urgent vs normal priority messages");

  console.log("\n🎉 Test completed successfully!");
} catch (error) {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
} finally {
  db.close();
  console.log("\n🧹 Cleaned up resources");
}

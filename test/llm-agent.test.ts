#!/usr/bin/env bun

/**
 * LLM 日报生成测试
 *
 * 测试：
 * - 程序化抓取 + AgentRunner 总结
 * - 日报 JSON 生成
 */

import { Database } from "bun:sqlite";
import { loadConfig, loadEnv } from "../src/config";
import { runDailyReport } from "../src/jobs/dailyReport";

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

// Load config
const config = loadConfig();
console.log("✅ Config loaded");
console.log(`   Focus artists: ${config.monitoring.focusArtists?.join(", ") || "none"}`);
console.log(`   Time window: ${config.app?.reportWindowHours || 24} hours`);

console.log("");

// Open database
const db = new Database(env.dbPath);
console.log(`✅ Database opened: ${env.dbPath}`);

console.log("");
console.log("🚀 Starting daily report run...");
console.log("   (Programmatic fetch + AgentRunner summary)\n");

try {
  const report = await runDailyReport(db, config, env);

  console.log("\n✅ Agent execution completed!");
  console.log(`   Summary: ${report.summary}`);
  console.log(`   Events: ${report.events.length}`);
  console.log(`   Focus matches: ${report.focusArtists.length}`);

  console.log("\n🎉 Test completed successfully!");
} catch (error) {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
} finally {
  db.close();
  console.log("\n🧹 Cleaned up resources");
}

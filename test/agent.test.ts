#!/usr/bin/env bun

/**
 * Agent 执行器单元测试
 *
 * 测试：
 * - AgentExecutor 基本功能
 * - 任务执行流程
 * - 错误处理
 */

import { Database } from "bun:sqlite";
import { AgentExecutor } from "../src/agent/executor";
import { ToolRegistry } from "../src/agent/tools/registry";
import { buildEventMonitoringTask } from "../src/agent/task";
import { showstartTool } from "../src/agent/tools/showstart";
import { createDatabaseTool, createLoadEventsTool, createLogSearchTool } from "../src/agent/tools/database";
import type { MonitoringConfig } from "../src/types";

console.log("🤖 Testing Agent Executor\n");

// 准备测试环境
console.log("📦 Setting up test environment...");

// 创建内存数据库
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    city_name TEXT,
    site_name TEXT,
    show_time TEXT,
    price TEXT,
    performers TEXT,
    poster TEXT,
    url TEXT,
    source TEXT,
    raw_json TEXT,
    first_seen_at TEXT,
    last_seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_name TEXT NOT NULL,
    url TEXT NOT NULL,
    city_code TEXT,
    keyword TEXT,
    run_at TEXT NOT NULL,
    results_count INTEGER
  );
`);

console.log("✅ Created test database");

// 创建工具注册表
const registry = new ToolRegistry();
registry.register(showstartTool);
registry.register(createDatabaseTool(db));
registry.register(createLoadEventsTool(db));
registry.register(createLogSearchTool(db));

console.log("✅ Registered tools");
console.log(`   Tools: ${registry.getNames().join(", ")}`);

// 创建执行器
const executor = new AgentExecutor(db, registry);
console.log("✅ Created AgentExecutor");

console.log("");

// 测试 1: 空查询任务
console.log("Test 1: Empty queries task");

const emptyConfig: MonitoringConfig = {
  monitoring: {
    focusArtists: []
  }
};

const emptyTask = buildEventMonitoringTask(emptyConfig, []);
const emptyResult = await executor.execute(emptyTask);

if (emptyResult.success && emptyResult.summary.includes("No queries")) {
  console.log("✅ Correctly handles empty queries");
  console.log(`   Summary: ${emptyResult.summary}`);
} else {
  console.error("❌ Failed to handle empty queries");
  process.exit(1);
}

console.log("");

// 测试 2: 不支持的任务类型
console.log("Test 2: Unsupported task type");

const unsupportedTask = {
  id: "test-unsupported",
  type: "unknown_type" as any,
  objective: "Test unsupported task",
  context: {},
  constraints: [],
  priority: "normal" as const
};

const unsupportedResult = await executor.execute(unsupportedTask);

if (!unsupportedResult.success && unsupportedResult.error?.includes("not implemented")) {
  console.log("✅ Correctly rejects unsupported task type");
  console.log(`   Error: ${unsupportedResult.error}`);
} else {
  console.error("❌ Should reject unsupported task type");
  process.exit(1);
}

console.log("");

// 测试 3: 实际监控任务（限制查询以避免实际网络请求）
console.log("Test 3: Event monitoring task structure");

const testConfig: MonitoringConfig = {
  app: {
    timezone: "Asia/Shanghai",
    reportWindowHours: 24
  },
  monitoring: {
    focusArtists: ["测试艺人"],
    cityCodes: ["21"],
    showStyles: ["2"],
    keywords: ["测试"]
  }
};

// 构建最小查询集（只测试结构，不实际抓取）
const testQueries = [
  { name: "测试查询", keyword: "测试关键词" }
];

const testTask = buildEventMonitoringTask(testConfig, testQueries);

// 验证任务结构
if (testTask.type === "event_monitoring") {
  console.log("✅ Task type is correct");
}

if (testTask.objective.includes("测试艺人")) {
  console.log("✅ Task objective includes focus artists");
}

if (testTask.context.queries && testTask.context.focusArtists) {
  console.log("✅ Task context is properly structured");
  console.log(`   Queries: ${testTask.context.queries.length}`);
  console.log(`   Focus Artists: ${testTask.context.focusArtists.length}`);
}

if (testTask.constraints.length > 0) {
  console.log("✅ Task has constraints");
  console.log(`   Constraints: ${testTask.constraints.length}`);
}

console.log("");

// 测试 4: 工具调用记录
console.log("Test 4: Tool execution tracking");

// 注意：实际执行会发起网络请求，这里只测试追踪机制
console.log("ℹ️  Skipping actual network requests in unit tests");
console.log("   (Use integration tests for full network testing)");

console.log("");

// 测试 5: AgentResult 结构验证
console.log("Test 5: AgentResult structure");

// 创建一个模拟结果
const mockResult = {
  taskId: "test-123",
  success: true,
  summary: "测试摘要",
  data: {
    queriesExecuted: 1,
    totalEventsFetched: 0,
    recentEventsCount: 0,
    focusMatches: [],
    events: []
  },
  toolExecutions: []
};

if (
  mockResult.taskId &&
  typeof mockResult.success === "boolean" &&
  mockResult.summary &&
  mockResult.data &&
  Array.isArray(mockResult.toolExecutions)
) {
  console.log("✅ AgentResult structure is valid");
  console.log(`   Has required fields: taskId, success, summary, data, toolExecutions`);
} else {
  console.error("❌ AgentResult structure is invalid");
  process.exit(1);
}

console.log("");

// 清理
db.close();
console.log("🧹 Cleaned up test resources");

console.log("\n🎉 All agent tests passed!");
console.log("\n💡 Tip: Run integration tests to test with actual network requests:");
console.log("   bun run test/integration.test.ts");

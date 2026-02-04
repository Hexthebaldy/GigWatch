#!/usr/bin/env bun

/**
 * 工具系统单元测试
 *
 * 测试：
 * - Tool 接口
 * - ToolRegistry
 * - 各个具体工具
 */

import { Database } from "bun:sqlite";
import { ToolRegistry } from "../src/agent/tools/registry";
import { showstartTool } from "../src/agent/tools/shows/showstart";
import { createDatabaseTool, createLoadEventsTool, createLogSearchTool } from "../src/agent/tools/shows/database";

console.log("🧪 Testing Tool System\n");

// 测试 1: ToolRegistry 基本功能
console.log("Test 1: ToolRegistry basic operations");
const registry = new ToolRegistry();

// 注册工具
registry.register(showstartTool);
console.log("✅ Registered showstartTool");

// 检查工具存在
if (registry.has("fetch_showstart_events")) {
  console.log("✅ Tool exists in registry");
} else {
  console.error("❌ Tool not found in registry");
  process.exit(1);
}

// 获取工具
const tool = registry.get("fetch_showstart_events");
if (tool && tool.name === "fetch_showstart_events") {
  console.log("✅ Retrieved tool successfully");
} else {
  console.error("❌ Failed to retrieve tool");
  process.exit(1);
}

// 获取所有工具名
const names = registry.getNames();
if (names.length === 1 && names[0] === "fetch_showstart_events") {
  console.log("✅ getNames() works correctly");
} else {
  console.error("❌ getNames() failed");
  process.exit(1);
}

// 测试重复注册
try {
  registry.register(showstartTool);
  console.error("❌ Should throw error on duplicate registration");
  process.exit(1);
} catch (error) {
  console.log("✅ Correctly prevents duplicate registration");
}

console.log("");

// 测试 2: toFunctionSchemas
console.log("Test 2: toFunctionSchemas conversion");
const schemas = registry.toFunctionSchemas();

if (schemas.length === 1) {
  console.log("✅ Correct number of schemas");
} else {
  console.error("❌ Wrong number of schemas");
  process.exit(1);
}

const schema = schemas[0];
if (
  schema.type === "function" &&
  schema.function.name === "fetch_showstart_events" &&
  schema.function.description &&
  schema.function.parameters
) {
  console.log("✅ Schema structure is correct");
  console.log(`   Name: ${schema.function.name}`);
  console.log(`   Params: ${Object.keys(schema.function.parameters.properties || {}).join(", ")}`);
} else {
  console.error("❌ Schema structure is incorrect");
  process.exit(1);
}

console.log("");

// 测试 3: 数据库工具
console.log("Test 3: Database tools");

// 创建内存数据库
const db = new Database(":memory:");

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
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
    last_seen_at TEXT,
    UNIQUE(event_id)
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

console.log("✅ Created in-memory database");

// 创建数据库工具
const upsertTool = createDatabaseTool(db);
const loadTool = createLoadEventsTool(db);
const logTool = createLogSearchTool(db);

console.log("✅ Created database tools");

// 测试 upsert
const testEvent = {
  id: 12345,
  title: "Test Event",
  url: "https://example.com/event/12345",
  cityName: "上海",
  siteName: "测试场馆",
  showTime: "2026-03-01 20:00",
  price: "100-200",
  performers: "Test Artist",
  poster: "https://example.com/poster.jpg",
  source: "test"
};

const upsertResult = await upsertTool.execute({
  event: testEvent,
  fetchedAt: new Date().toISOString()
});

if (upsertResult.success) {
  console.log("✅ Event upserted successfully");
  console.log(`   Event ID: ${upsertResult.data.eventId}`);
} else {
  console.error("❌ Upsert failed:", upsertResult.error);
  process.exit(1);
}

// 测试加载
const loadResult = await loadTool.execute({
  sinceIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
});

if (loadResult.success && loadResult.data.count === 1) {
  console.log("✅ Loaded events successfully");
  console.log(`   Count: ${loadResult.data.count}`);
} else {
  console.error("❌ Load failed");
  process.exit(1);
}

// 测试日志记录
const logResult = await logTool.execute({
  queryName: "test-query",
  url: "https://example.com",
  cityCode: "21",
  keyword: "test",
  runAt: new Date().toISOString(),
  resultsCount: 10
});

if (logResult.success) {
  console.log("✅ Search log recorded successfully");
} else {
  console.error("❌ Log failed:", logResult.error);
  process.exit(1);
}

console.log("");

// 测试 4: 工具参数验证
console.log("Test 4: Tool parameter validation");

// 测试缺少必需字段
const invalidEvent = {
  id: 999,
  title: "Invalid Event"
  // 缺少 url
};

const invalidResult = await upsertTool.execute({
  event: invalidEvent as any,
  fetchedAt: new Date().toISOString()
});

if (!invalidResult.success && invalidResult.error) {
  console.log("✅ Correctly rejects invalid event");
  console.log(`   Error: ${invalidResult.error}`);
} else {
  console.error("❌ Should reject invalid event");
  process.exit(1);
}

console.log("");

// 清理
db.close();
console.log("🧹 Cleaned up test database");

console.log("\n🎉 All tests passed!");

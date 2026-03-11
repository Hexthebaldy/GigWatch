#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema";
import { createEditMemoTool } from "../src/agent/tools/common/memo";
import { createListMemosTool } from "../src/agent/tools/common/memo";
import { MemoRepository } from "../src/memo/memoRepository";

console.log("🧪 Testing memo tool\n");

const db = new Database(":memory:");
initSchema(db);

const tool = createEditMemoTool(db);
const listTool = createListMemosTool(db);
const repository = new MemoRepository(db);

const addResult = await tool.execute({
  operation: "add",
  content: "下周三提醒我看演出开票"
});

if (!addResult.success || addResult.data?.status !== "created") {
  console.error("❌ Memo add failed:", addResult);
  process.exit(1);
}
console.log("✅ Memo add works");

const duplicateResult = await tool.execute({
  operation: "add",
  content: "下周三提醒我看演出开票"
});

if (!duplicateResult.success || duplicateResult.data?.status !== "already_exists") {
  console.error("❌ Duplicate memo add should be idempotent:", duplicateResult);
  process.exit(1);
}
console.log("✅ Duplicate add is idempotent");

const memosAfterAdd = repository.listAll();
if (memosAfterAdd.length !== 1 || memosAfterAdd[0]?.content !== "下周三提醒我看演出开票") {
  console.error("❌ Memo list mismatch after add:", memosAfterAdd);
  process.exit(1);
}
console.log("✅ Memo repository list works");

const listResult = await listTool.execute({
  keyword: "开票",
  limit: 10
});

if (!listResult.success || listResult.data?.count !== 1 || listResult.data?.memos?.[0]?.content !== "下周三提醒我看演出开票") {
  console.error("❌ Memo list tool failed:", listResult);
  process.exit(1);
}
console.log("✅ Memo list tool works");

const removeResult = await tool.execute({
  operation: "remove",
  content: "下周三提醒我看演出开票"
});

if (!removeResult.success || removeResult.data?.status !== "removed") {
  console.error("❌ Memo remove failed:", removeResult);
  process.exit(1);
}
console.log("✅ Memo remove works");

const memosAfterRemove = repository.listAll();
if (memosAfterRemove.length !== 0) {
  console.error("❌ Memo should be empty after remove:", memosAfterRemove);
  process.exit(1);
}
console.log("✅ Memo cleanup works");

db.close();
console.log("\n🎉 Memo tests passed!");

# GigWatch 测试指南

## 快速开始

### 运行所有单元测试
```bash
bun run test
```

### 运行特定测试
```bash
bun run test:tools      # 工具系统测试
bun run test:agent      # Agent 执行器测试
bun run test:telegram   # Telegram 通知测试（需要配置）
```

---

## 测试结构

```
test/
├── README.md              # 测试套件说明
├── tools.test.ts          # 工具系统单元测试
├── agent.test.ts          # Agent 执行器单元测试
└── telegram.test.ts       # Telegram 集成测试
```

---

## 测试覆盖范围

### ✅ 工具系统 (`tools.test.ts`)

**ToolRegistry 功能**
- ✅ 工具注册
- ✅ 工具查询（get, has, getNames）
- ✅ 重复注册检测
- ✅ Schema 转换（toFunctionSchemas）

**数据库工具**
- ✅ Event upsert（插入/更新）
- ✅ 加载最近演出
- ✅ 搜索日志记录
- ✅ 参数验证

**示例输出**：
```
🧪 Testing Tool System

Test 1: ToolRegistry basic operations
✅ Registered showstartTool
✅ Tool exists in registry
✅ Retrieved tool successfully
✅ getNames() works correctly
✅ Correctly prevents duplicate registration

...

🎉 All tests passed!
```

### ✅ Agent 执行器 (`agent.test.ts`)

**基本功能**
- ✅ 空查询处理
- ✅ 不支持的任务类型
- ✅ 任务结构验证
- ✅ 结果格式验证

**错误处理**
- ✅ 优雅降级
- ✅ 错误信息传递

**示例输出**：
```
🤖 Testing Agent Executor

Test 1: Empty queries task
✅ Correctly handles empty queries
   Summary: No queries configured, nothing to monitor

Test 2: Unsupported task type
✅ Correctly rejects unsupported task type
   Error: Task type "unknown_type" is not implemented

...

🎉 All agent tests passed!
```

### 🔧 Telegram 通知 (`telegram.test.ts`)

**需要环境配置**：
```bash
export TELEGRAM_BOT_TOKEN="你的token"
export TELEGRAM_CHAT_ID="你的chat_id"
```

**测试内容**
- 普通消息发送
- 紧急消息发送（带声音）
- Markdown 格式化
- 错误处理

**示例输出**：
```
🤖 Testing Telegram notification...

✅ Configuration found
   Bot Token: 123456789:ABCdefGH...
   Chat ID: 123456789

📤 Test 1: Sending normal message...
✅ Message sent! ID: 456

...

🎉 All tests completed!
```

---

## 测试最佳实践

### 1. 使用内存数据库

```typescript
// ✅ 好：不影响实际数据
const db = new Database(":memory:");

// ❌ 避免：使用实际数据库
const db = new Database("./data/gigwatch.sqlite");
```

### 2. 独立的测试用例

```typescript
// ✅ 好：每个测试独立
console.log("Test 1: Basic operation");
const result1 = await tool.execute({...});

console.log("Test 2: Error handling");
const result2 = await tool.execute({...});

// ❌ 避免：测试之间有依赖
```

### 3. 清理测试资源

```typescript
// 测试结束时
db.close();
console.log("🧹 Cleaned up test resources");
```

### 4. 清晰的断言信息

```typescript
if (result.success) {
  console.log("✅ Test passed");
  console.log(`   Details: ${result.data}`);
} else {
  console.error("❌ Test failed:", result.error);
  process.exit(1);
}
```

---

## 添加新测试

### 步骤 1：创建测试文件

```typescript
// test/new-feature.test.ts
#!/usr/bin/env bun

console.log("🧪 Testing New Feature\n");

// 测试用例...

console.log("\n🎉 All tests passed!");
```

### 步骤 2：添加到 package.json

```json
{
  "scripts": {
    "test:new-feature": "bun run test/new-feature.test.ts"
  }
}
```

### 步骤 3：更新测试文档

在 `test/README.md` 中添加说明。

---

## CI/CD 集成（计划中）

未来可以在 GitHub Actions 中自动运行：

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run test
```

---

## 测试 vs 实际运行

| 场景 | 测试模式 | 实际运行 |
|------|---------|---------|
| 数据库 | 内存数据库 | 文件数据库 |
| 网络请求 | Mock/跳过 | 真实请求 |
| 外部服务 | Mock | 真实服务 |
| 执行速度 | 快（< 1秒） | 慢（分钟级） |

---

## 常见问题

### Q: 测试失败怎么办？

1. 查看错误信息
2. 确认测试环境（数据库、配置）
3. 检查依赖是否安装：`bun install`

### Q: 如何调试测试？

在测试代码中添加：
```typescript
console.log("Debug:", JSON.stringify(result, null, 2));
```

### Q: Telegram 测试失败？

确保：
1. 已设置环境变量
2. 已给 bot 发送过消息
3. Bot Token 和 Chat ID 正确

### Q: 想跳过某些测试？

注释掉不需要的测试用例，或单独运行特定测试：
```bash
bun run test:tools  # 只运行工具测试
```

---

## 未来计划

- [ ] 添加集成测试（含网络请求）
- [ ] 添加性能测试
- [ ] 配置测试覆盖率报告
- [ ] 自动化 CI/CD
- [ ] 添加 E2E 测试

---

## 相关文档

- [测试套件说明](../test/README.md)
- [Telegram 集成指南](./telegram-integration.md)
- [架构文档](./agent-architecture-plan.md)

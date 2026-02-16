# GigWatch 测试套件

## 测试文件说明

### 单元测试（Unit Tests）

**`tools.test.ts`** - 工具系统测试
- ToolRegistry 功能
- Tool 接口实现
- 数据库工具（upsert, load, log）
- 参数验证
- Schema 转换

运行：
```bash
bun run test/tools.test.ts
```

**`agent.test.ts`** - AgentRunner 测试
- 未配置 OPENAI_API_KEY 的回退行为
- 返回结构验证（reply/messages/steps）
- system_error 步骤验证

运行：
```bash
bun run test/agent.test.ts
```

**`telegram.test.ts`** - Telegram 通知测试
- Telegram Bot 集成
- 消息发送
- 优先级控制
- 格式化支持

运行：
```bash
# 需要先配置环境变量
export TELEGRAM_BOT_TOKEN="你的token"
export TELEGRAM_CHAT_ID="你的chat_id"

bun run test/telegram.test.ts
```

**`llm-agent.test.ts`** - LLM-driven Agent 集成测试
- Agent 自主工具调用
- 智能通知决策
- 完整执行流程测试

运行：
```bash
# 需要先配置环境变量（LLM 必需，Telegram 可选）
export OPENAI_API_KEY="sk-xxx"
export OPENAI_BASE_URL="https://api.moonshot.cn/v1"

bun run test:llm
```

---

## 快速运行

### 运行所有单元测试（不含网络请求）

```bash
bun run test/tools.test.ts && bun run test/agent.test.ts
```

### 运行包含网络请求的测试

```bash
# Telegram 测试（需要配置）
bun run test:telegram

# LLM Agent 测试（需要 LLM 配置）
bun run test:llm
```

---

## 测试组织原则

### 单元测试
- 不依赖外部服务（使用 mock/内存数据库）
- 快速执行（< 1秒）
- 独立运行
- 文件命名：`*.test.ts`

### 集成测试（未来）
- 测试完整流程
- 可能包含网络请求
- 使用真实配置
- 文件命名：`*.integration.test.ts`

### 端到端测试（未来）
- 测试用户场景
- 完整的系统测试
- 文件命名：`*.e2e.test.ts`

---

## 编写测试的最佳实践

### 1. 明确测试目标
```typescript
console.log("Test 1: Tool registry basic operations");
// 清晰说明这个测试在测什么
```

### 2. 使用内存数据库
```typescript
const db = new Database(":memory:");
// 避免影响实际数据
```

### 3. 独立的测试用例
```typescript
// ✅ 好：每个测试独立
const test1 = await tool.execute({...});
const test2 = await tool.execute({...});

// ❌ 避免：测试之间有依赖
```

### 4. 清理测试资源
```typescript
// 测试结束后清理
db.close();
console.log("🧹 Cleaned up test resources");
```

### 5. 清晰的错误信息
```typescript
if (!result.success) {
  console.error("❌ Test failed:", result.error);
  process.exit(1);
}
```

---

## CI/CD 集成（未来）

未来可以在 GitHub Actions 中运行测试：

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run test/tools.test.ts
      - run: bun run test/agent.test.ts
```

---

## 测试覆盖率目标

- ✅ 核心工具系统：100%
- ✅ AgentRunner：基本流程覆盖
- 🚧 网络请求：集成测试覆盖
- 🚧 LLM 调用：mock 测试（阶段 2）

---

## 常见问题

**Q: 测试失败怎么办？**
- 查看错误信息
- 确认测试环境（数据库、配置）
- 检查依赖是否安装

**Q: 如何跳过某些测试？**
- 单独运行特定测试文件
- 注释掉不需要的测试

**Q: 测试太慢？**
- 单元测试应该很快（< 1秒）
- 如果慢，可能是在做网络请求
- 将网络请求移到集成测试

---

## 贡献测试

欢迎添加新的测试！请确保：
1. 测试有清晰的描述
2. 测试是独立的
3. 测试完成后清理资源
4. 更新这个 README

---

## 下一步

- [ ] 添加集成测试
- [ ] 添加性能测试
- [ ] 配置 CI/CD
- [ ] 测试覆盖率报告

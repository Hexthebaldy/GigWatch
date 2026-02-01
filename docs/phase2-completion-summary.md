# Phase 2 完成总结

## 🎯 目标

将 Agent 从**规则驱动（rule-based）**升级为**LLM 驱动（LLM-driven）**，实现：
1. Agent 自主调用工具（不再硬编码执行流程）
2. 智能分析演出信息，决定是否通知用户
3. 根据重要性发送不同优先级的 Telegram 通知

## ✅ 已完成功能

### 1. LLM-driven Executor

**文件：** `src/agent/executor.ts`

**核心变更：**
- 新增 `llmClient` 和 `llmModel` 字段
- 构造函数接受 `env?: AppEnv` 参数来初始化 LLM
- `execute()` 方法优先使用 LLM-driven 执行，无 LLM 时降级为 rule-based
- 新增 `executeWithLLM()` 方法（150+ 行）实现自主工具调用循环

**LLM Function Calling 循环：**
```typescript
while (continueLoop && iterationCount < maxIterations) {
  // 1. LLM 决定调用哪些工具
  const response = await llmClient.chat.completions.create({
    tools: availableTools,
    tool_choice: "auto"
  });

  // 2. 执行工具调用
  if (response.tool_calls) {
    for (const toolCall of response.tool_calls) {
      const result = await executeTool(toolCall);
      messages.push({ role: "tool", content: result });
    }
  } else {
    // 3. LLM 完成任务
    return finalResult;
  }
}
```

### 2. 系统提示词（System Prompt）

定义了 Agent 的工作流程和通知策略：

```
你是一个演出监控 Agent。你的任务是：
1. 执行演出抓取查询
2. 分析结果，判断是否有值得通知用户的演出
3. 如果有重要演出，使用 Telegram 发送通知

**通知策略：**
- 【紧急】关注艺人有演出 → 立即发送 Telegram（priority: urgent）
- 【普通】新演出匹配流派+城市或关键词 → 发送摘要（priority: normal）
- 【静默】无相关演出 → 不发送通知

**工作流程：**
1. fetch_showstart_events - 抓取演出
2. upsert_event - 保存到数据库
3. log_search - 记录搜索日志
4. load_recent_events - 加载最近演出
5. 分析匹配情况
6. send_telegram - 发送通知（如果需要）
7. 返回最终摘要
```

### 3. Telegram Tool 集成

**文件：** `src/jobs/dailyReport.ts`

**变更：**
- 导入 `createTelegramTool`
- 在 tool registry 中注册 Telegram tool（如果配置）
- 传递 `env` 给 `AgentExecutor` 构造函数

```typescript
// 注册 Telegram 工具（如果配置）
if (env?.telegramBotToken && env?.telegramChatId) {
  registry.register(createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  }));
}

// 创建 executor 时传入 env
const executor = new AgentExecutor(db, registry, env);
```

### 4. 智能通知策略

Agent 根据分析结果自主决定：

**通知优先级：**

| 优先级 | 触发条件 | 行为 | 示例 |
|--------|---------|------|------|
| **Urgent** | 关注艺人有新演出 | 立即发送，带声音 | "🎵 Central Cee 新增 3 场演出" |
| **Normal** | 新演出匹配流派+城市/关键词 | 发送摘要，静音 | "📊 今日新增 15 场演出" |
| **Silent** | 无相关演出 | 不发送通知 | 仅记录日志 |

### 5. Fallback 机制

**自动降级：**
- 无 LLM 配置 → 使用 Phase 1 rule-based 执行
- 无 Telegram 配置 → Agent 正常工作，跳过通知

**日志提示：**
```
[Agent] LLM not available, using rule-based execution
[Agent] Telegram not configured, notifications disabled
```

### 6. 测试套件

**新增测试文件：** `test/llm-agent.test.ts`

**测试内容：**
- 检查 LLM 配置
- 检查 Telegram 配置
- 执行完整 Agent 任务
- 验证自主工具调用
- 验证通知发送（如果配置）

**运行：**
```bash
bun run test:llm
```

### 7. 文档

**新增文档：**
- `docs/phase2-llm-agent.md` - Phase 2 完整文档
- `docs/phase2-completion-summary.md` - 本文档

**更新文档：**
- `test/README.md` - 添加 LLM test 说明
- `docs/testing-guide.md` - 添加 LLM test 章节

---

## 🔧 配置要求

### LLM 配置（必需）

```bash
# .env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.moonshot.cn/v1
OPENAI_MODEL=kimi-k2-turbo-preview
```

### Telegram 配置（可选）

```bash
# .env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=123456789
```

---

## 📊 与 Phase 1 对比

| 特性 | Phase 1 | Phase 2 |
|------|---------|---------|
| **执行方式** | 硬编码流程 | LLM 自主决策 |
| **工具调用** | 固定顺序 | 动态调整 |
| **通知策略** | 无（仅日报） | 智能分析 + 主动通知 |
| **适应性** | 低（需修改代码） | 高（通过 prompt 调整） |
| **成本** | 仅 API 请求 | API 请求 + LLM 推理（~¥0.14/次） |
| **执行时间** | ~30-60 秒 | ~60-120 秒 |
| **配置要求** | 无 | LLM API Key |
| **Fallback** | N/A | 自动降级为 Phase 1 |

---

## 🚀 使用方式

### CLI

```bash
# 运行每日监控（自动使用 LLM-driven agent）
bun run daily
```

### TUI

```bash
bun run tui
# 选择"立即抓取"
```

### Web UI

```bash
bun run serve
# 访问 http://localhost:3000
# 点击"立即抓取"
```

---

## 📝 执行流程示例

### 场景：发现关注艺人演出

**用户配置：**
- 关注艺人：Central Cee
- 监控城市：上海、北京
- 流派：LiveHouse、电音

**Agent 执行流程：**

1. **LLM Iteration 1-7:** 抓取 7 个查询的演出数据
   ```
   [Agent] Executing tool: fetch_showstart_events
   [Agent] Parameters: {"name":"艺人-Central Cee","keyword":"Central Cee"}
   [Agent] Tool result: success (3 events)
   ```

2. **LLM Iteration 8-14:** 保存演出到数据库
   ```
   [Agent] Executing tool: upsert_event
   [Agent] Tool result: success
   ```

3. **LLM Iteration 15:** 加载最近演出
   ```
   [Agent] Executing tool: load_recent_events
   [Agent] Tool result: success (287 events)
   ```

4. **LLM Iteration 16:** 分析并发送通知
   ```
   [Agent] Executing tool: send_telegram
   [Agent] Parameters: {
     "message": "🎵 Central Cee 新增 3 场演出：\n- 成都站 2026/03/04...",
     "priority": "urgent"
   }
   [Agent] Tool result: success (message_id: 12345)
   ```

5. **LLM Iteration 17:** 返回最终摘要
   ```
   [Agent] LLM finished: 已完成演出监控并发送关注艺人通知
   ```

### 场景：无关注艺人演出

**Agent 执行流程：**

1. 抓取所有查询
2. 保存演出到数据库
3. 加载最近演出
4. 分析：无关注艺人匹配
5. **不发送 Telegram 通知**
6. 返回摘要："共抓取 150 条演出，无关注艺人演出"

---

## 💰 成本分析

### Kimi K2 Turbo Preview 价格

- Input: ¥0.01 / 1K tokens
- Output: ¥0.03 / 1K tokens

### 单次任务预估

| 项目 | Tokens | 成本 |
|------|--------|------|
| System prompt | ~300 | ¥0.003 |
| User prompt | ~500 | ¥0.005 |
| Tools schema | ~800 | ¥0.008 |
| Iterations (8-15 次) | ~7K | ¥0.07 |
| LLM output | ~2K | ¥0.06 |
| **总计** | **~10K** | **¥0.14** |

### 每月成本（每日 1 次）

- 每日：¥0.14
- 每月：¥4.20
- 每年：¥51.10

**结论：** 成本非常低廉，完全可接受。

---

## 🔍 调试与日志

### 查看 Agent 执行日志

```bash
bun run daily 2>&1 | grep "\[Agent\]"
```

**示例输出：**
```
[Agent] Starting task: event_monitoring_xxx
[Agent] Using LLM-driven execution
[Agent] Starting LLM-driven execution with 5 tools
[Agent] LLM iteration 1
[Agent] LLM requested 7 tool calls
[Agent] Executing tool: fetch_showstart_events
[Agent] Tool fetch_showstart_events result: success
...
[Agent] Executing tool: send_telegram
[Agent] Tool send_telegram result: success
[Agent] LLM finished: 已完成演出监控并发送通知
```

### 常见问题排查

**问题 1: "LLM not available, using rule-based execution"**
- 检查 `.env` 中 `OPENAI_API_KEY` 是否配置
- 测试 API 连接：`curl https://api.moonshot.cn/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`

**问题 2: Agent 执行成功但未收到 Telegram**
- 检查 `.env` 中 Telegram 配置
- 查看日志：`grep "Telegram" daily.log`
- 手动测试：`bun run test:telegram`

**问题 3: Agent 执行超过 50 次迭代**
- 检查系统提示词是否清晰
- 降低 `temperature`（当前 0.3）
- 查看 LLM 返回内容

---

## 📈 未来优化方向

### Phase 3（计划中）

- [ ] Agent 记忆系统（记住用户偏好和历史反馈）
- [ ] 多轮对话交互（用户可以问"为什么通知我这个？"）
- [ ] 自适应通知策略（学习用户反馈，优化通知阈值）
- [ ] 批量通知优化（合并多条相似通知）

### 工具扩展

- [ ] `search_web`: 搜索艺人最新消息、巡演计划
- [ ] `analyze_trends`: 分析演出趋势和热度
- [ ] `recommend_events`: 基于历史推荐相关演出
- [ ] `price_alert`: 监控票价变动

---

## ✅ 验收标准

所有 Phase 2 功能已完成并通过验收：

- [x] LLM-driven executor 实现
- [x] 自主工具调用循环
- [x] 系统提示词定义通知策略
- [x] Telegram tool 集成到 registry
- [x] 智能通知决策（urgent/normal/silent）
- [x] Fallback 机制（无 LLM → Phase 1）
- [x] 测试套件（llm-agent.test.ts）
- [x] 完整文档（phase2-llm-agent.md）
- [x] 代码类型检查通过（bun run lint）
- [x] 与现有功能兼容（CLI/TUI/Web）

---

## 🎉 总结

Phase 2 成功将 GigWatch Agent 升级为**真正智能的自主 Agent**：

**核心突破：**
1. **自主性：** Agent 不再被硬编码束缚，可以根据任务动态决策
2. **智能性：** 能够分析演出信息，判断哪些值得通知用户
3. **主动性：** 发现重要演出时主动发送 Telegram，无需用户主动查看

**用户体验提升：**
- **Phase 1：** 用户需要主动查看日报 → 被动获取信息
- **Phase 2：** Agent 主动通知重要演出 → 主动推送，不会错过

**可维护性提升：**
- **Phase 1：** 修改逻辑需要改代码 → 开发成本高
- **Phase 2：** 调整行为只需修改 prompt → 灵活性高

Phase 2 为 GigWatch 奠定了智能化基础，为未来的 Agent 记忆、多轮对话、自适应推荐等高级功能铺平了道路。

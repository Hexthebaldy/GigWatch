# Phase 2: LLM-Driven Autonomous Agent

## 概述

Phase 2 将 Agent 从 **规则驱动（rule-based）** 升级为 **LLM 驱动（LLM-driven）**，实现真正的自主决策和智能通知。

### Phase 1 vs Phase 2

| 特性 | Phase 1 (Rule-based) | Phase 2 (LLM-driven) |
|------|---------------------|---------------------|
| 执行逻辑 | 硬编码（fetch → save → log → load → match） | LLM 自主决定工具调用顺序 |
| 通知策略 | 无通知，仅生成日报 | Agent 分析结果并主动发送 Telegram |
| 灵活性 | 固定流程 | 根据结果动态调整 |
| 智能程度 | 低（机械执行） | 高（理解任务、分析、决策） |

---

## 核心功能

### 1. 自主工具调用

Agent 不再按照固定流程执行，而是：
1. 接收任务目标（objective）
2. 查看可用工具（tools）
3. 决定调用哪些工具、以什么顺序
4. 分析工具返回结果
5. 决定下一步行动

**示例工具调用流程：**
```
Agent: "我需要抓取 7 个查询的演出数据"
→ 调用 fetch_showstart_events (7次)
→ 调用 upsert_event (N次) 保存演出
→ 调用 log_search (7次) 记录日志
→ 调用 load_recent_events 加载最近演出
→ 分析结果：发现 Central Cee 有 3 场新演出
→ 调用 send_telegram 发送通知（priority: urgent）
```

### 2. 智能通知策略

Agent 根据分析结果自主决定是否发送通知：

#### 通知优先级

**【紧急】Urgent Priority**
- **触发条件：** 关注艺人有新演出
- **行为：** 立即发送 Telegram，带声音通知
- **示例：**
  ```
  🎵 关注艺人演出提醒

  Central Cee 新增 3 场演出：
  - 成都站 2026/03/04 (¥380-480)
  - 上海站 2026/03/07 (¥380-480)
  - 佛山站 2026/03/08 (¥380-480)
  ```

**【普通】Normal Priority**
- **触发条件：** 新演出匹配流派+城市或关键词
- **行为：** 发送 Telegram 摘要，静音通知
- **示例：**
  ```
  📊 今日演出监控摘要

  最近 24 小时新增 15 场演出：
  - 上海 LiveHouse演出：8 场
  - 电音/说唱：5 场
  - "新年"相关：2 场
  ```

**【静默】No Notification**
- **触发条件：** 无关注艺人演出，无新匹配演出
- **行为：** 不发送通知，仅记录日志

### 3. LLM Function Calling 循环

Agent 使用 OpenAI/Kimi 的 Function Calling 功能：

```typescript
while (continueLoop && iterationCount < maxIterations) {
  // 1. LLM 决定调用哪些工具
  const response = await llmClient.chat.completions.create({
    model: "kimi-k2-turbo-preview",
    messages,
    tools: availableTools,  // 所有注册的工具
    tool_choice: "auto"
  });

  // 2. 如果 LLM 返回 tool_calls，执行工具
  if (response.tool_calls) {
    for (const toolCall of response.tool_calls) {
      const result = await executeTool(toolCall);
      messages.push({ role: "tool", content: result });
    }
  } else {
    // 3. LLM 返回最终结果，结束循环
    return response.content;
  }
}
```

---

## 系统提示词（System Prompt）

Agent 的行为由以下系统提示词定义：

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
1. 使用 fetch_showstart_events 抓取每个查询的演出
2. 使用 upsert_event 保存演出到数据库
3. 使用 log_search 记录搜索日志
4. 使用 load_recent_events 加载最近时间窗口内的演出
5. 分析演出，判断是否匹配关注艺人或监控维度
6. 如果有重要演出，使用 send_telegram 发送通知
7. 返回最终摘要
```

---

## 实现细节

### AgentExecutor 变更

**新增字段：**
```typescript
export class AgentExecutor {
  private llmClient?: OpenAI;
  private llmModel: string;

  constructor(
    private db: Database,
    private tools: ToolRegistry,
    private env?: AppEnv  // 新增：需要 env 来初始化 LLM
  ) {
    // 如果有 API key，初始化 LLM client
    if (env?.openaiApiKey) {
      this.llmClient = new OpenAI({
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl
      });
    }
  }
}
```

**执行逻辑变更：**
```typescript
async execute(task: AgentTask): Promise<AgentResult> {
  // 优先使用 LLM-driven execution
  if (this.llmClient && task.type === "event_monitoring") {
    return await this.executeWithLLM(task, fetchedAt, toolExecutions);
  }

  // Fallback: 规则驱动
  return await this.executeEventMonitoring(task, fetchedAt, toolExecutions);
}
```

**新增方法：**
- `executeWithLLM()`: LLM-driven 执行引擎（150+ 行）

### Tool Registry 变更

**新增工具：**
- `send_telegram`: 发送 Telegram 通知

**工具注册（dailyReport.ts）：**
```typescript
const registry = new ToolRegistry();
registry.register(showstartTool);
registry.register(createDatabaseTool(db));
registry.register(createLoadEventsTool(db));
registry.register(createLogSearchTool(db));

// 如果配置了 Telegram，注册通知工具
if (env?.telegramBotToken && env?.telegramChatId) {
  registry.register(createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  }));
}
```

---

## 配置

### 环境变量

**必需（LLM 功能）：**
```bash
OPENAI_API_KEY=sk-xxx                      # Kimi/OpenAI API Key
OPENAI_BASE_URL=https://api.moonshot.cn/v1 # Kimi API endpoint
OPENAI_MODEL=kimi-k2-turbo-preview         # 模型名称
```

**可选（Telegram 通知）：**
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdef...     # Bot Token
TELEGRAM_CHAT_ID=123456789                 # Chat ID
```

### Fallback 行为

- **无 LLM 配置：** 自动降级为 Phase 1 rule-based 执行
- **无 Telegram 配置：** Agent 仍正常工作，但跳过通知步骤

---

## 测试

### 单元测试

```bash
# 运行所有单元测试（不含网络请求）
bun run test

# 工具系统测试
bun run test:tools

# Agent 执行器测试
bun run test:agent
```

### LLM Agent 集成测试

```bash
# 运行 LLM-driven agent 真实测试（需要配置 LLM）
bun run test:llm
```

**测试流程：**
1. 检查 LLM 和 Telegram 配置
2. 加载监控配置
3. 执行 Agent 任务
4. Agent 自主决定工具调用
5. Agent 分析结果并发送通知（如果有关注艺人演出）
6. 验证执行结果

**示例输出：**
```
🤖 Testing LLM-driven Agent Execution

✅ LLM configured
   Model: kimi-k2-turbo-preview
   Base URL: https://api.moonshot.cn/v1

✅ Telegram configured
   Chat ID: 123456789

✅ Config loaded
   Focus artists: 青叶市子, Central Cee
   Time window: 24 hours

✅ Database opened: ./data/gigwatch.sqlite

🚀 Starting LLM-driven agent execution...
   (This may take a while as the agent makes autonomous decisions)

[Agent] Starting task: event_monitoring_xxx
[Agent] Using LLM-driven execution
[Agent] LLM iteration 1
[Agent] LLM requested 7 tool calls
[Agent] Executing tool: fetch_showstart_events
...
[Agent] LLM iteration 5
[Agent] Executing tool: send_telegram
[Agent] Tool send_telegram result: success
[Agent] LLM finished: 已发送关注艺人演出通知

✅ Agent execution completed!
   Summary: 已发送关注艺人演出通知
   Events: 287
   Focus matches: 2

📊 Agent Behavior:
   Check your Telegram for notifications (if configured)
   The agent should have autonomously decided:
   - Which events are worth notifying
   - Whether to send urgent vs normal priority messages

🎉 Test completed successfully!
```

---

## 运行

### CLI

```bash
# 运行每日监控（自动使用 LLM-driven agent）
bun run daily
```

### TUI

```bash
# 启动 TUI 菜单
bun run tui

# 选择"立即抓取"触发 Agent 执行
```

### Web UI

```bash
# 启动 Web 服务器
bun run serve

# 访问 http://localhost:3000
# 点击"立即抓取"按钮触发 Agent
```

---

## 日志示例

**LLM-driven execution 日志：**
```
[Agent] Starting task: event_monitoring_xxx, type: event_monitoring
[Agent] Objective: 监控演出信息，执行 7 个抓取任务...
[Agent] Using LLM-driven execution
[Agent] Starting LLM-driven execution with 5 tools
[Agent] LLM iteration 1
[Agent] LLM requested 7 tool calls
[Agent] Executing tool: fetch_showstart_events
[Agent] Parameters: {"name":"艺人-青叶市子","keyword":"青叶市子"}
[Agent] Tool fetch_showstart_events result: success
...
[Agent] LLM iteration 8
[Agent] LLM requested 1 tool calls
[Agent] Executing tool: send_telegram
[Agent] Parameters: {"message":"🎵 Central Cee 新增 3 场演出...","priority":"urgent"}
[Agent] Tool send_telegram result: success
[Agent] LLM iteration 9
[Agent] LLM finished: 已完成演出监控并发送通知
```

---

## 与 Phase 1 的兼容性

- **Phase 1 代码保留：** `executeEventMonitoring()` 方法仍存在，作为 fallback
- **自动降级：** 如果未配置 LLM，自动使用 Phase 1 逻辑
- **数据库兼容：** 无 schema 变更，完全兼容
- **配置兼容：** Phase 1 配置在 Phase 2 中继续有效

---

## 成本与性能

### LLM 调用成本

**Kimi K2 Turbo Preview 价格（截至 2025-01）：**
- Input: ¥0.01 / 1K tokens
- Output: ¥0.03 / 1K tokens

**单次任务预估：**
- System prompt: ~300 tokens
- User prompt: ~500 tokens
- Tools schema: ~800 tokens
- Iterations: 8-15 次
- Total input: ~8K tokens (¥0.08)
- Total output: ~2K tokens (¥0.06)
- **单次成本：¥0.14**

### 执行时间

- **Phase 1 rule-based:** ~30-60 秒（取决于网络请求）
- **Phase 2 LLM-driven:** ~60-120 秒（增加 LLM 推理时间）

---

## 未来优化

### 阶段 3（计划中）
- [ ] Agent 记忆系统（记住用户偏好）
- [ ] 多轮对话交互（用户可以问"为什么通知我这个？"）
- [ ] 自适应通知策略（学习用户反馈）
- [ ] 批量通知优化（合并多条相似通知）

### 工具扩展（计划中）
- [ ] `search_web`: 搜索艺人最新消息
- [ ] `analyze_trends`: 分析演出趋势
- [ ] `recommend_events`: 推荐相关演出
- [ ] `book_ticket`: 自动抢票（需谨慎）

---

## 故障排查

### LLM 未启用

**症状：** 日志显示 "LLM not available, using rule-based execution"

**解决：**
1. 检查 `.env` 中是否配置 `OPENAI_API_KEY`
2. 验证 API key 是否有效
3. 测试 API 连接：`curl https://api.moonshot.cn/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`

### Telegram 通知未发送

**症状：** Agent 执行成功，但未收到 Telegram 消息

**排查：**
1. 检查 `.env` 中 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`
2. 确认你已给 bot 发送过至少一条消息
3. 查看日志：`[Agent] Telegram not configured, notifications disabled`
4. 手动测试：`bun run test:telegram`

### Agent 无限循环

**症状：** Agent 执行超过 50 次迭代（maxIterations）

**原因：** LLM 未正确返回 finish 信号

**解决：**
1. 检查系统提示词是否清晰
2. 降低 `temperature`（当前 0.3）
3. 查看日志中 LLM 的返回内容

---

## 相关文档

- [Phase 1 完成报告](./phase1-completion.md)
- [Telegram 集成指南](./telegram-integration.md)
- [测试指南](./testing-guide.md)
- [Agent 架构规划](./agent-architecture-plan.md)

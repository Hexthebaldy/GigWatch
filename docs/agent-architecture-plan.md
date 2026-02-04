# Agent Architecture Migration Plan

## 目标
将 GigWatch 从"演出监控工具"升级为"通用智能代理框架"，支持：
- 演出信息监控（当前功能增强）
- 社会舆情热点信息搜集与分析
- 投资信息收集分析
- 其他自定义任务

## 核心设计原则

1. **目标驱动**：告诉 agent "不能让用户错过关注艺人的演出"，而不是"调用这个 API"
2. **自主决策**：agent 自己决定调用哪些工具、执行什么步骤
3. **可扩展**：新增任务类型不需要重写核心逻辑

## 架构设计

### 1. 任务抽象层

```typescript
// src/types/agent.ts
export type AgentTask = {
  id: string;
  type: 'event_monitoring' | 'sentiment_analysis' | 'investment_research';
  objective: string;  // 自然语言描述目标
  constraints: string[];  // 约束条件
  priority: 'critical' | 'high' | 'normal';
  schedule?: CronExpression;
};

// 示例
const task: AgentTask = {
  id: 'monitor-focus-artists',
  type: 'event_monitoring',
  objective: '确保用户不错过关注艺人的任何演出，包括秀动未收录的',
  constraints: [
    '必须检查搜索引擎补充信息',
    '发现新演出立即通知用户',
    '每日至少检查一次'
  ],
  priority: 'critical'
};
```

### 2. 工具系统（Tool System）

```typescript
// src/agent/tools/base.ts
export interface Tool {
  name: string;
  description: string;  // 给 AI 看的工具说明
  parameters: JSONSchema;
  execute: (params: any) => Promise<any>;
}

// src/agent/tools/registry.ts
export const toolRegistry = {
  // 数据源工具
  'showstart_search': showStartTool,
  'web_search': searchEngineTool,
  'social_media_search': socialMediaTool,

  // 通知工具
  'send_email': emailTool,
  'send_telegram': telegramTool,
  'send_push': pushNotificationTool,

  // 数据处理
  'db_query': databaseTool,
  'web_fetch': webFetchTool,
  'extract_info': extractionTool
};
```

### 3. Agent 执行器

```typescript
// src/agent/executor.ts
export class AgentExecutor {
  constructor(
    private llm: LLMClient,  // OpenAI/Anthropic/etc
    private tools: Map<string, Tool>,
    private db: Database
  ) {}

  async execute(task: AgentTask): Promise<AgentResult> {
    const context = await this.loadContext(task);

    // 给 AI 的系统提示
    const systemPrompt = `
你是一个智能代理，负责执行以下任务：
目标：${task.objective}
约束：${task.constraints.join('\n')}
优先级：${task.priority}

可用工具：
${this.formatToolDescriptions()}

请制定执行计划，然后逐步调用工具完成任务。
如果发现关键信息（如关注艺人的新演出），立即调用通知工具。
`;

    // 多轮对话执行
    let messages = [{ role: 'system', content: systemPrompt }];
    let steps = 0;
    const maxSteps = 20;

    while (steps < maxSteps) {
      const response = await this.llm.chat(messages);

      // 解析 tool calls
      if (response.tool_calls) {
        for (const call of response.tool_calls) {
          const tool = this.tools.get(call.name);
          const result = await tool.execute(call.parameters);

          // 记录执行日志
          await this.logToolExecution(task.id, call, result);

          // 添加工具结果到上下文
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }
      }

      // AI 认为任务完成
      if (response.finish_reason === 'stop') {
        return this.parseAgentResult(response.content);
      }

      messages.push(response);
      steps++;
    }

    throw new Error('Agent exceeded max steps');
  }
}
```

### 4. 具体工具实现示例

```typescript
// src/agent/tools/search-engine.ts
export const searchEngineTool: Tool = {
  name: 'web_search',
  description: '使用搜索引擎查找演出、新闻、投资信息等。当秀动等专业平台没有信息时使用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      max_results: { type: 'number', default: 10 }
    },
    required: ['query']
  },
  execute: async ({ query, max_results = 10 }) => {
    // 调用 Google/Bing API
    const results = await searchAPI.search(query, max_results);
    return results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet
    }));
  }
};

// src/agent/tools/notification.ts
export const telegramTool: Tool = {
  name: 'send_telegram',
  description: '向用户发送 Telegram 通知。用于重要信息（如关注艺人新演出）的即时推送。',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      priority: { enum: ['urgent', 'normal'] }
    },
    required: ['message']
  },
  execute: async ({ message, priority = 'normal' }) => {
    await telegramBot.sendMessage(config.userId, message, {
      parse_mode: 'Markdown',
      disable_notification: priority !== 'urgent'
    });
    return { sent: true, timestamp: new Date().toISOString() };
  }
};
```

### 5. 任务配置文件

```json
// config/tasks/event-monitoring.json
{
  "id": "event-monitoring",
  "type": "event_monitoring",
  "objective": "监控关注艺人的演出信息，确保用户不错过任何演出",
  "constraints": [
    "优先使用秀动数据，但必须用搜索引擎交叉验证",
    "发现距离演出时间少于7天的新演出，立即发送 urgent 级别通知",
    "每日生成汇总报告"
  ],
  "priority": "critical",
  "schedule": "0 6 * * *",
  "config": {
    "focusArtists": ["青叶市子", "Central Cee"],
    "searchEngines": ["google", "baidu"],
    "notificationChannels": ["telegram", "email"]
  }
}
```

## 目录结构

```
src/
├── agent/
│   ├── executor.ts          # Agent 核心执行器
│   ├── planner.ts           # 任务规划器（可选，用于复杂任务分解）
│   ├── memory.ts            # Agent 记忆系统（存储执行历史）
│   ├── tools/
│   │   ├── base.ts          # Tool 接口定义
│   │   ├── registry.ts      # 工具注册表
│   │   ├── showstart.ts     # 秀动查询工具
│   │   ├── search.ts        # 搜索引擎工具
│   │   ├── notification.ts  # 通知工具（email/telegram/push）
│   │   ├── database.ts      # 数据库查询工具
│   │   └── web.ts           # 网页抓取工具
│   └── prompts/
│       ├── system.ts        # 系统提示模板
│       └── task-specific/   # 各类任务的专用提示
├── tasks/
│   ├── base.ts              # AgentTask 类型定义
│   ├── loader.ts            # 从配置加载任务
│   └── scheduler.ts         # 定时任务调度
├── clients/
│   ├── llm.ts               # LLM 客户端（OpenAI/Anthropic）
│   ├── search.ts            # 搜索引擎 API
│   ├── telegram.ts          # Telegram Bot
│   └── email.ts             # 邮件服务
└── db/
    ├── schema.ts
    └── migrations/
        └── add_agent_logs.sql   # 新增 agent 执行日志表
```

## 数据库扩展

```sql
-- 任务执行日志
CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT,  -- 'running' | 'success' | 'failed'
  steps_count INTEGER,
  result_json TEXT
);

-- 工具调用日志
CREATE TABLE tool_executions (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES agent_runs(id),
  tool_name TEXT NOT NULL,
  parameters TEXT,
  result TEXT,
  executed_at TEXT,
  duration_ms INTEGER
);

-- 通知记录
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES agent_runs(id),
  channel TEXT,  -- 'telegram' | 'email' | 'push'
  message TEXT,
  sent_at TEXT,
  priority TEXT
);
```

## 迁移路径

### 阶段 1：重构现有演出监控

**目标**：保持功能不变，但改为 Agent 架构

**步骤**：
1. 保留 `showstart.ts` 但改造为 Tool
   - 创建 `src/agent/tools/shows/showstart.ts`
   - 实现 `Tool` 接口
   - 迁移现有的 `fetchShowStartEvents` 逻辑

2. 创建基础 Agent 框架
   - 实现 `src/agent/tools/base.ts` (Tool 接口)
   - 实现 `src/agent/tools/registry.ts` (工具注册)
   - 实现 `src/agent/executor.ts` (基础执行器)

3. 改造 `runDailyReport`
   - 将配置转换为 `AgentTask`
   - 用 `AgentExecutor` 替换当前逻辑
   - 保持数据库操作不变

4. 添加数据库工具
   - 创建 `src/agent/tools/shows/database.ts`
   - 封装 `upsertEvent`、`loadRecentEvents` 等操作

**验证**：
- 运行 `bun run daily`，确保功能与之前一致
- 检查数据库中的 events、search_logs、reports 表

### 阶段 2：增强自主性

**目标**：让 AI 自主决策，添加搜索引擎和通知功能

**步骤**：
1. 添加搜索引擎工具
   - 创建 `src/clients/search.ts` (Google/Bing API 客户端)
   - 创建 `src/agent/tools/shows/search.ts`
   - 设置环境变量 `SEARCH_API_KEY`

2. 添加通知工具
   - 创建 `src/clients/telegram.ts` (Telegram Bot)
   - 创建 `src/clients/email.ts` (SMTP 客户端)
   - 创建 `src/agent/tools/notification.ts`
   - 设置环境变量 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_USER_ID`

3. 更新任务配置
   - 修改 `config/monitoring.json`，添加 `objective` 和 `constraints`
   - 示例：
     ```json
     {
       "task": {
         "objective": "确保用户不错过关注艺人的任何演出",
         "constraints": [
           "优先使用秀动数据",
           "如果秀动没有结果，使用搜索引擎补充",
           "发现新演出立即通知"
         ]
       },
       "monitoring": { ... }
     }
     ```

4. 升级 system prompt
   - 在 `src/agent/prompts/system.ts` 中定义提示模板
   - 明确告诉 AI 何时调用搜索、何时发通知

**验证**：
- 手动删除数据库中某个关注艺人的演出
- 运行任务，检查是否调用搜索引擎
- 检查是否收到 Telegram 通知

### 阶段 3：扩展新任务类型

**目标**：添加舆情监控、投资信息监控分析等更多功能

**步骤**：
1. 添加新的任务配置
   - `config/tasks/sentiment-monitoring.json`
   - `config/tasks/investment-research.json`

2. 添加专用工具
   - 社交媒体 API 工具 (Twitter, 微博)
   - 新闻聚合工具 (NewsAPI)
   - 财经数据工具 (Yahoo Finance, Alpha Vantage)

3. 创建任务调度器
   - `src/tasks/scheduler.ts`
   - 支持多任务并行执行
   - 实现 cron 表达式解析

4. 升级数据库 schema
   - 添加 `agent_runs`、`tool_executions`、`notifications` 表
   - 为新任务类型添加专用数据表

**验证**：
- 配置舆情监控任务，运行并检查结果
- 配置投资分析任务，验证数据收集

## 关键技术决策

### LLM 选择

**选定**：Kimi 系列（月之暗面）

**理由**：
- **成本优势**：相比 GPT-4/Claude 价格便宜很多
- **Tool Calling 性能好**：已验证支持 function calling，性能不错
- **中文能力强**：处理中文艺人名、演出信息更准确
- **长上下文**：支持大量工具定义和历史对话

**技术细节**：
- 使用 Kimi API (兼容 OpenAI SDK 格式)
- 主模型：`kimi-k2-turbo-preview` (日常任务)
- 复杂推理：`kimi-k2.5` (多步骤决策)
- Tool calling format: OpenAI function calling 格式

### 成本控制

1. **设置上限**
   - `maxSteps`: 每次执行最多 20 步
   - `maxTokens`: 每次响应最多 4000 tokens
   - `dailyBudget`: 每日 API 调用预算

2. **优化策略**
   - 使用便宜模型做规划 (GPT-4o-mini)
   - 使用强模型做决策 (GPT-4)
   - 缓存常见查询结果

3. **监控**
   - 记录每次执行的 token 消耗
   - 在数据库中存储成本信息

### 可靠性保障

1. **人工审核**
   - 重要通知发送前记录日志
   - 提供 Web UI 查看待发送通知
   - 用户确认后才真正发送

2. **错误处理**
   - Tool 执行失败时重试
   - AI 决策异常时降级到规则引擎
   - 记录所有失败案例供人工分析

3. **测试**
   - 为每个 Tool 编写单元测试
   - 创建模拟任务验证 Agent 逻辑
   - 使用小数据集测试端到端流程

### 隐私与安全

1. **API Key 管理**
   - 使用环境变量存储敏感信息
   - 不在日志中输出完整 API 响应

2. **数据隐私**
   - 用户关注艺人等信息不上传到第三方
   - 搜索引擎查询使用匿名化参数
   - 本地存储所有历史数据

3. **通知安全**
   - Telegram Bot 验证用户 ID
   - 邮件使用 TLS 加密
   - 敏感信息不包含在通知内容中

## 风险与挑战

### 技术风险

1. **AI 不稳定性**
   - 同样的任务可能产生不同结果
   - **缓解**：关键决策增加确定性规则

2. **工具调用失败**
   - 搜索 API 限流、网络故障
   - **缓解**：实现重试机制和降级策略

3. **成本超支**
   - 复杂任务可能消耗大量 tokens
   - **缓解**：严格的预算控制和监控

### 产品风险

1. **误报/漏报**
   - AI 可能错误判断演出信息
   - **缓解**：增加人工确认环节

2. **用户体验**
   - 通知过多导致骚扰
   - **缓解**：智能去重和优先级控制

3. **维护成本**
   - 系统复杂度增加
   - **缓解**：完善日志和监控系统

## 成功指标

### 阶段 1
- [ ] 所有现有测试通过
- [ ] 数据库记录与之前一致
- [ ] 无功能回退

### 阶段 2
- [ ] AI 成功调用搜索引擎补充信息
- [ ] 新演出通知及时送达
- [ ] 零漏报（关注艺人演出）

### 阶段 3
- [ ] 支持 3 种以上任务类型
- [ ] 工具库达到 10+ 个
- [ ] 每日成本 < $5

## 下一步行动

1. **评估当前代码**
   - 确定哪些部分可以复用
   - 识别需要重构的模块

2. **技术验证**
   - 测试选定的 LLM 的 function calling
   - 验证搜索引擎 API 可用性
   - 搭建 Telegram Bot

3. **启动阶段 1**
   - 创建 `src/agent/` 目录结构
   - 实现第一个 Tool (showstart)
   - 重构 `runDailyReport`

---

**创建时间**: 2026-02-01
**最后更新**: 2026-02-01

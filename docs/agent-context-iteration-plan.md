# Agent Context 重构迭代方案（冻结代码版）

## 目标
- 在不影响现有可用性的前提下，逐步把上下文管理升级为可支持主/子 Agent 的架构。
- 保持“全端共享聊天历史（Telegram/Web/TUI）”体验，同时实现“子 Agent 独立上下文空间”。
- 先留方案，后续分阶段实施；当前不做代码重构。

## 当前状态（2026-02）
- 统一消息入口：`ChatService`。
- 聊天持久化：`chat_messages`。
- 摘要压缩：`chat_context_summaries`（当前仅 `scope=global`）。
- 执行轨迹：`agent_runs`、`agent_run_steps`。
- 问题：summary/messages 未按 `agent_id/context_scope` 隔离，未来子 Agent 易上下文串扰。

## 设计原则
- 时间线与工作区分离：
  - `timeline`：用户可见历史（跨端统一）。
  - `workspace`：Agent 推理上下文（可隔离）。
- 兼容优先：先增量字段与双写，再切读路径，最后清理旧逻辑。
- 可回滚：每阶段有明确开关和回退路径。

## 目标模型
- 主 Agent：`context_scope = main`
- 子 Agent：`context_scope = run:{runId}` 或 `sub:{agentId}:{runId}`
- 对用户可见消息进入 timeline；子 Agent 过程默认不可见，仅回传 handoff 摘要到主空间。

## 分阶段实施

### Phase 0：冻结与观测（准备阶段）
- 冻结范围：`ChatService`、`ContextManager`、`AgentRunner` 仅修 bug，不加新特性。
- 增加观测：
  - 每轮记录 `promptTokenBudget`、`estimatedPromptTokens`、`modelContextWindow`（已具备，保持）。
  - 新增运行面板查询 SQL（见附录）。
- 验收：能稳定查看 message/run/step/summary 的增长趋势。

### Phase 1：Schema 增量（兼容，不切流）
- `chat_messages` 新增字段：
  - `timeline_scope TEXT NOT NULL DEFAULT 'global'`
  - `context_scope TEXT NOT NULL DEFAULT 'main'`
  - `agent_id TEXT`
- `agent_runs` 新增字段：
  - `agent_id TEXT`
  - `parent_run_id INTEGER`
  - `context_scope TEXT NOT NULL DEFAULT 'main'`
- 索引：
  - `idx_chat_messages_context_scope_id(context_scope, id)`
  - `idx_chat_messages_timeline_scope_id(timeline_scope, id)`
  - `idx_agent_runs_context_scope_started_at(context_scope, started_at DESC)`
- 验收：老逻辑不改读写，线上行为不变。

### Phase 2：Repository/Context 双写
- `ChatRepository.insertMessage()` 支持写入 `timeline_scope/context_scope/agent_id`（默认兼容旧值）。
- `getSummary/upsertSummary` 从固定 `global` 改为显式 `scope` 参数传入。
- `ContextManager` 增加 `contextScope` 入参：
  - `buildPrompt({ ..., contextScope })`
  - `maybeCompactHistory(contextScope)`
- 先双写：摘要继续写 `global`，同时写 `main`；验证无偏差后停写 `global`。
- 验收：主链路仍稳定，`main` scope 的 summary 游标独立推进。

### Phase 3：子 Agent 工作区
- 增加子任务启动协议：
  - 创建 `agent_run`（含 `parent_run_id`、`context_scope`）。
  - 子 Agent 在独立 `context_scope` 推理，过程消息 `visible=false`。
  - 结束后输出一条 handoff（结构化结果）到 `main`。
- 主 Agent 读取策略：
  - 默认仅读 `main`。
  - 按需读取 handoff，不直接读取子空间原始步骤。
- 验收：并行子任务不会污染主上下文，且用户能看到最终结果。

### Phase 4：读路径切换与清理
- 所有入口（Telegram/Web/TUI）统一按 `timeline_scope` 拉消息。
- Debug 页面支持筛选 `context_scope` 查看内部执行。
- 删除遗留分支：
  - 停止依赖 `global` summary。
  - 清理旧字段/旧查询（若确认无回滚需求）。
- 验收：主链路无回归，子 Agent 可稳定多轮运行。

## 发布策略
- 建议加两个开关：
  - `AGENT_CONTEXT_SCOPED_WRITE=0/1`
  - `AGENT_CONTEXT_SCOPED_READ=0/1`
- 切换顺序：
  1. 先开 scoped write（双写）
  2. 观察 3-7 天
  3. 再开 scoped read
  4. 稳定后清理旧路径

## 回滚策略
- 任一阶段异常，先关闭 `AGENT_CONTEXT_SCOPED_READ`，恢复旧读取。
- 保留双写期数据，避免回滚丢失。
- 若子 Agent 逻辑不稳定，回退到“主 Agent 单空间执行”。

## 验收标准（最终）
- 主/子 Agent 上下文互不污染。
- 用户端仍能看到完整聊天时间线。
- 同等负载下，token 成本与响应时延不显著劣化。
- 关键流程（加监控、查演出、改配置）功能回归通过。

## 非目标（本方案不覆盖）
- 不引入向量库语义检索。
- 不处理多租户权限体系。
- 不改前端技术栈（React/shadcn 后续单独规划）。

## 附录：常用巡检 SQL
```sql
-- 最近 20 条可见聊天消息
SELECT id, role, source, created_at, substr(content, 1, 120)
FROM chat_messages
WHERE visible = 1
ORDER BY id DESC
LIMIT 20;

-- 各 scope 摘要游标
SELECT scope, until_message_id, length(summary_text) AS summary_len, updated_at
FROM chat_context_summaries
ORDER BY updated_at DESC;

-- 最近 20 次 agent run
SELECT id, source, status, model, started_at, finished_at
FROM agent_runs
ORDER BY id DESC
LIMIT 20;
```

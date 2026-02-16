# GigWatch

GigWatch 是一个基于 Bun + TypeScript 的演出监控系统：抓取 ShowStart（秀动）演出列表，落库到 SQLite，并通过 LLM Tool Calling 生成日报与对话式任务执行结果。

当前代码的核心思路是：
- 程序化抓取与数据整理放在 `src/jobs/dailyReport.ts`
- 大模型只负责总结与工具调用（`AgentRunner`）
- 运行入口拆分为 Web / Telegram / Feishu

## 功能概览

- 按监控规则（艺人、城市、风格、关键词）自动展开查询
- 抓取 ShowStart 列表并解析 `window.__NUXT__`
- 演出数据去重入库（按 `event_id` upsert）
- 记录每次查询日志
- 生成并存储日报（`reports`）
- Telegram / Feishu 对话入口接入 AgentRunner + 工具集

## 技术栈

- Runtime: Bun
- Language: TypeScript (ESM)
- Database: SQLite（`bun:sqlite`）
- LLM SDK: `openai`（兼容 OpenAI API）
- Feishu SDK: `@larksuiteoapi/node-sdk`

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 准备配置

```bash
cp config/monitoring.example.json config/monitoring.json
cp .env.example .env
```

编辑 `config/monitoring.json`：

```json
{
  "app": {
    "timezone": "Asia/Shanghai",
    "reportWindowHours": 24
  },
  "monitoring": {
    "focusArtists": ["青叶市子", "Central Cee"],
    "cityCodes": ["21", "10"],
    "showStyles": ["2", "3"],
    "keywords": ["音乐节"]
  }
}
```

### 3. 启动 Web

```bash
bun run web
```

访问 `http://localhost:3000`。

## 命令入口

所有命令统一由 `src/cli.ts` 分发。

| 命令 | 脚本 | 说明 |
|---|---|---|
| `init-db` | `bun run init-db` | 仅初始化数据库表结构 |
| `daily` | `bun run daily` | 立即执行一次日报流程 |
| `serve` | `bun run serve` | 启动 Web 页面 + API + 内置定时器 |
| `telegram` | `bun run telegram` | 启动 Telegram 长轮询机器人 |
| `feishu` | `bun run feishu` | 启动 Feishu 长连接机器人 |

开发时可用：
- `bun run serve:watch`
- `bun run web:watch`

## 环境变量

由 `src/config.ts` 的 `loadEnv()` 读取。

| 变量 | 必需 | 默认值 | 用途 |
|---|---|---|---|
| `OPENAI_API_KEY` | 否 | - | 日报总结 / 对话 Agent |
| `OPENAI_BASE_URL` | 否 | - | OpenAI 兼容接口地址 |
| `OPENAI_MODEL` | 否 | - | 模型名 |
| `OPENAI_TEMPERATURE` | 否 | - | 温度参数覆盖 |
| `APP_TIMEZONE` | 否 | `Asia/Shanghai` | 报告时区与定时器 |
| `DB_PATH` | 否 | `./data/gigwatch.sqlite` | SQLite 文件路径 |
| `APP_PORT` | 否 | `3000` | Web 端口 |
| `CONFIG_PATH` | 否 | `config/monitoring.json` | 监控配置路径 |
| `LOG_PATH` | 否 | `./data/gigwatch.log.jsonl` | JSONL 日志路径 |
| `TELEGRAM_BOT_TOKEN` | Telegram 模式需要 | - | Telegram 收发消息 |
| `TELEGRAM_CHAT_ID` | 否 | - | 限制允许的聊天会话 / 指定回消息目标 |
| `FEISHU_APP_ID` | Feishu 模式需要 | - | 飞书鉴权 |
| `FEISHU_APP_SECRET` | Feishu 模式需要 | - | 飞书鉴权 |
| `FEISHU_BASE_URL` | 否 | `https://open.feishu.cn` | 飞书 API 地址 |

说明：
- 未配置 `OPENAI_API_KEY` 时，`AgentRunner` 会返回降级回复，不会进入 LLM tool calling。
- 日报流程中，如果 LLM 输出不是合法 `DailyReport` JSON，会自动回退模板摘要。

## 监控规则如何展开

`src/jobs/dailyReport.ts` 中的规则展开逻辑：

- `focusArtists`：每个艺人生成一个 `keyword` 查询
- `cityCodes + showStyles`：两者都存在时做笛卡尔积
- 仅有城市或仅有风格时：按单字段分别查询
- `keywords`：每个关键词生成一个查询

相关字典：
- `src/dictionary/showstartCities.ts`
- `src/dictionary/showstartShowStyles.ts`

## 日报主流程

`runDailyReport(db, config, env)`（`src/jobs/dailyReport.ts`）执行步骤：

1. 从监控配置生成查询列表
2. 逐条抓取 ShowStart 数据
3. upsert 到 `events`
4. 写入 `search_logs`
5. 按窗口读取近期演出
6. 调用 `AgentRunner` 生成 `DailyReport` JSON
7. 若解析失败，回退到模板摘要
8. 存档到 `reports`

## Web 服务与 API

`src/server.ts` 同时提供页面与 API。

### 内置定时器

`serve/web` 运行后，每分钟检查一次，到本地时区 `06:00` 当天只触发一次自动抓取。

### API 列表

- `GET /api/report/latest`：读取最新日报
- `GET /api/logs`：读取最近查询日志
- `POST /api/run`：立即执行一次流程
- `GET /api/config`：读取当前内存配置
- `POST /api/config/monitoring`：更新监控配置并写回配置文件

## Telegram / Feishu 对话入口

### Telegram（`src/telegram/poller.ts`）

- 基于 `getUpdates` 长轮询
- 文本消息转换为 `ChatService` 入站结构
- `AgentRunner` 执行工具调用
- 最终回复通过 `sendMessage` 返回

### Feishu（`src/feishu/poller.ts`）

- 基于飞书 SDK WebSocket 长连接
- 进程内事件去重（避免重复回复）
- 文本消息转换为 `ChatService` 入站结构
- 通过飞书消息接口回发结果

## Agent Runtime 与上下文管理

核心文件：
- `src/agent/runtime/agentRunner.ts`
- `src/agent/chatService.ts`
- `src/agent/context/*`

当前行为：
- `AgentRunner` 是核心 tool-calling loop（`MAX_ITERATIONS = 50`）
- 工具 schema 来自 `ToolRegistry`
- 对话、运行轨迹会持久化到数据库
- `ContextManager` 会做历史压缩（摘要写入 `chat_context_summaries`）以控制上下文 token

## 当前注册的工具集（对话入口）

Telegram / Feishu 入口默认注册：
- `bash_exec`
- `web_fetch`
- `web_search`
- `fetch_showstart_events`
- `load_recent_events`
- `search_events_db`
- `get_latest_report`
- `run_monitoring_now`

工具定义目录：
- `src/agent/tools/common/*`
- `src/agent/tools/shows/*`

## 数据库结构

由 `src/db/schema.ts` 初始化。

主要表：
- `events`：演出规范化数据 + 原始 JSON + 首次/最近发现时间
- `search_logs`：每次查询的参数与结果数量
- `reports`：完整日报 JSON
- `chat_messages`：聊天消息
- `chat_context_summaries`：上下文摘要
- `agent_runs`：每次 Agent 运行状态
- `agent_run_steps`：每次运行的步骤轨迹

当前没有迁移框架，结构变更需手工处理。

## 测试

```bash
# 核心检查
bun run lint
bun run test

# 可选网络/集成测试
bun run test:telegram
bun run test:llm
bun run test:all
```

测试文件位于 `test/`。

## 目录结构

```text
src/
  agent/         # runner, chat service, context, tool system
  clients/       # showstart/openai/feishu clients
  jobs/          # 程序化任务（日报）
  db/            # sqlite client + schema
  telegram/      # telegram poller
  feishu/        # feishu long connection poller
  dictionary/    # 城市/风格/模型上下文窗口字典
  utils/         # datetime/logger
  cli.ts         # 命令入口
  server.ts      # web server + dashboard
config/
  monitoring.example.json

test/
  *.test.ts
```

## 运行建议

- `serve`、`telegram`、`feishu` 是独立常驻进程，按需分别启动。
- 若依赖内置 06:00 自动任务，避免多个 `serve` 进程同时写同一套 DB/配置。
- 日志默认 JSONL 追加写入（`LOG_PATH`）。

## 相关文档

- `docs/feishu-bot-setup.md`
- `docs/telegram-integration.md`
- `docs/telegram-quickstart.md`
- `docs/testing-guide.md`

说明：部分历史文档可能落后于当前重构，`src/` 代码始终是最终事实来源。

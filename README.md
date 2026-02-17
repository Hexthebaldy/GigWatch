# GigWatch

GigWatch 是一个基于 Bun + TypeScript 的演出监控系统：抓取 ShowStart（秀动）演出列表，落库到 SQLite，并通过 LLM Tool Calling 生成日报与对话式任务执行结果。

## Monorepo 结构

```text
apps/
  server/                # Bun 后端（API / 调度 / Telegram / Feishu）
  web/                   # React + TypeScript 前端（Vite）
packages/
  shared/                # 前后端共享类型
config/
  monitoring.example.json
```

核心逻辑：
- 程序化抓取与数据整理在 `apps/server/src/jobs/dailyReport.ts`
- 大模型负责总结与工具调用（`AgentRunner`）
- 运行入口拆分为 Web / Telegram / Feishu

## 技术栈

- Runtime: Bun
- Language: TypeScript (ESM)
- Frontend: React + Vite
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

### 3. 启动服务

```bash
# 后端 API + 内置 dashboard + 调度
bun run serve

# React 前端（可选，另开终端）
bun run dev:web
```

- 后端默认地址：`http://localhost:3000`
- 前端默认地址：`http://localhost:5173`

## 根命令（workspace 编排）

| 命令 | 说明 |
|---|---|
| `bun run init-db` | 初始化数据库表结构 |
| `bun run daily` | 立即执行一次日报流程 |
| `bun run serve` | 启动 Bun Web 服务 + API + 定时器 |
| `bun run telegram` | 启动 Telegram 长轮询机器人 |
| `bun run feishu` | 启动 Feishu 长连接机器人 |
| `bun run dev:web` | 启动 React 开发服务器 |
| `bun run build:web` | 构建 React 前端 |
| `bun run lint` | 后端 TypeScript 检查 |
| `bun run test` | 后端核心测试 |

## 环境变量

由 `apps/server/src/config.ts` 的 `loadEnv()` 读取。

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
| `WEB_SEARCH_KEY` | 否（使用 `web_search` 时建议配置） | - | 火山引擎融合信息搜索 API Key |
| `WEB_SEARCH_URL` | 否 | `https://open.feedcoopapi.com/search_api/web_search` | 火山引擎融合信息搜索 API 地址 |
| `WEB_SEARCH_TIMEOUT_MS` | 否 | `12000` | `web_search` 请求超时（毫秒） |

## 后端 API 列表

- `GET /api/report/latest`：读取最新日报
- `GET /api/logs`：读取最近查询日志
- `POST /api/run`：立即执行一次流程
- `GET /api/config`：读取当前内存配置
- `POST /api/config/monitoring`：更新监控配置并写回配置文件

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

测试文件位于 `apps/server/test/`。

## 相关文档

- `docs/monorepo-architecture-change.md`
- `docs/feishu-bot-setup.md`
- `docs/telegram-integration.md`
- `docs/telegram-quickstart.md`
- `docs/testing-guide.md`

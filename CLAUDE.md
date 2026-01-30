# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GigWatch is a Bun.js-based monitoring agent that scrapes ShowStart (秀动)演出列表、保存结果到 SQLite，并生成启发式日报。支持 CLI 和 Web UI，关注艺人配置与搜索日志落盘。

## Commands

### Development
```bash
# Install dependencies
bun install

# Type-check the codebase
bun run lint
```

### Database
```bash
# Initialize SQLite database schema
bun run init-db
```

### Running Reports
```bash
# Run daily monitoring and report generation
bun run daily
```

## Architecture

### Data Flow
1. **Queries** (`config/monitoring.json`) define ShowStart列表抓取参数（cityCode / keyword / 自定义 URL）
2. **ShowStart scraper** (`src/clients/showstart.ts`) 请求列表页、解析 `window.__NUXT__` 中的 `listData`
3. **Database** (`src/db/`) 存储演出数据与搜索日志，并存档日报
4. **Report generation** (`src/jobs/dailyReport.ts`) 汇总最近窗口内的演出，匹配关注艺人，生成摘要/高亮
5. **Web server** (`src/server.ts`) 提供简单 UI + API 触发抓取、查看最新日报与搜索日志

### Key Components

**Configuration System** (`src/config.ts`, `src/types.ts`)
- Env via `loadEnv()`: `APP_TIMEZONE`, `DB_PATH`, `APP_PORT`, `CONFIG_PATH`
- Monitoring config via `loadConfig()` from `config/monitoring.json`
- Queries are explicit objects (one of cityCode/keyword/showStyle per query), no implicit default profiles

**ShowStart Scraper** (`src/clients/showstart.ts`)
- Builds list URL from cityCode/keyword/showStyle (only one per request) or accepts custom URL
- Fetches HTML with headers, extracts `window.__NUXT__` block, evaluates in a sandbox, reads `data[0].listData`
- Paginates pageNo up to 20, pageSize default 50; stops when page is empty or < pageSize
- Normalizes items and fills event URL (`https://www.showstart.com/event/{id}`)

**Database Schema** (`src/db/schema.ts`)
- `events` table: stores ShowStart event fields + timestamps, unique on `event_id`
- `search_logs` table: records each query run with url, cityCode/keyword, run time, result count
- `reports` table: archives generated report JSON

**Report Generation** (`src/jobs/dailyReport.ts`)
- For each configured query, scrape ShowStart, upsert events, log the search
- Build heuristic report: city counts as highlights; focus artists matched against title/performers; summary text

**Web UI** (`src/server.ts`)
- Endpoints: `GET /api/report/latest`, `GET /api/logs`, `POST /api/run`, `GET /api/config`, `POST /api/config/query`, `POST /api/config/focus`
- `GET /` serves a lightweight dashboard to触发抓取/查看日报/编辑监听；带每日 06:00 自动调度（服务器时区）

**TUI** (`src/tui.ts`)
- CLI 菜单：查看日报、查看日志、立即抓取、新增查询、设置关注艺人、查看当前查询

### Timezone Handling
- All timestamps use the configured timezone (default: Asia/Shanghai)
- `nowInTz()` and `toIso()` utilities in `src/utils.ts` handle timezone-aware formatting
- Report window (default 24 hours) filters projects by `first_seen_at` timestamp

### Environment Variables
Env:
- `APP_TIMEZONE` (default Asia/Shanghai)
- `DB_PATH` (default ./data/gigwatch.sqlite)
- `APP_PORT` (default 3000, for Web UI)
- `CONFIG_PATH` (override config file)

## Important Implementation Details

### Database Migrations
There is no migration system. Schema changes require:
1. Updating `initSchema()` in `src/db/schema.ts`
2. Manual handling of existing databases (backup and re-init, or manual ALTER statements)

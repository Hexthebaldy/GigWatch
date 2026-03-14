# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GigWatch is a Bun.js monorepo that scrapes ShowStart (秀动) event listings, stores results in SQLite, and provides an AI agent for natural-language interaction. Entrypoints: Web UI, Telegram bot, Feishu bot.

## Monorepo Structure

```
apps/server/   — Bun backend: HTTP server, SQLite, scraper, LLM agent, bot integrations
apps/web/      — React 18 + Vite frontend: chat UI, event search, config editor
packages/shared/ — Shared TypeScript types (no runtime deps)
config/        — monitoring.json (scrape queries, focus artists)
```

Workspaces: `apps/*` and `packages/*`. Import shared types via `@gigwatch/shared`.

## Commands

```bash
bun install                # Install all workspace dependencies

# Server
bun run serve              # Start backend (port 9826) with daily 06:00 scheduler
bun run serve:watch        # Same, with file watching
bun run init-db            # Initialize SQLite schema
bun run daily              # Run daily scrape+report once

# Web frontend
bun run dev:web            # Vite dev server (port 5173, proxies /api → localhost:9826)
bun run build:web          # Production build

# Bots
bun run telegram           # Telegram long-polling bot
bun run feishu             # Feishu long-connection bot

# Quality
bun run lint               # TypeScript type-check (bun --check on server files)
bun run typecheck:web      # TypeScript check for web app

# Tests
bun run test               # Core tests (tools + agent)
bun run test:tools         # Tool tests only
bun run test:agent         # Agent tests only
bun run test:telegram      # Telegram integration tests
bun run test:llm           # LLM agent tests (requires API key)
bun run test:all           # All tests including integration

# Run a single test file
bun run apps/server/test/<file>.test.ts
```

## Architecture

### Data Flow
1. **Monitoring config** (`config/monitoring.json`) defines scrape queries: focusArtists, cityCodes, showStyles, keywords expand into individual queries
2. **ShowStart scraper** (`apps/server/src/clients/showstart.ts`) fetches listing pages, parses `window.__NUXT__` payload for `listData`
3. **SQLite database** (`apps/server/src/db/`) stores events, search logs, reports, chat history, memos, agent runs
4. **Daily report** (`apps/server/src/jobs/dailyReport.ts`) scrapes all queries, upserts events, generates LLM summary
5. **HTTP server** (`apps/server/src/server.ts`) serves API + static web build; schedules daily job at 06:00

### AI Agent System
The agent uses OpenAI-compatible function calling (supports Kimi, DeepSeek, MiniMax, GLM models):

- **ChatService** (`apps/server/src/agent/chatService.ts`) — orchestrates chat: manages tool registry, streams SSE responses, persists messages
- **AgentRunner** (`apps/server/src/agent/runtime/agentRunner.ts`) — executes the tool-calling loop (max 50 iterations), compacts large results
- **Tools** (`apps/server/src/agent/tools/`) — `base.ts` defines the interface; `registry.ts` manages registration; tools in `common/` and `shows/` subdirectories
- **ContextManager** — summarizes long conversations to fit model context windows

System prompt language is Chinese. The agent has tools for: shell commands, web fetch/search, memo CRUD, ShowStart scraping, event DB queries, config updates, report reading, Telegram messaging, dictionary lookups, file reading.

### Web Frontend
React 18 SPA with Vite. Key areas:
- `components/chat/` — ChatPanel with SSE streaming, MessageList, ChatInput
- `components/events/` — EventsPanel for multi-dimensional event queries
- `components/config/` — ConfigDialog for editing monitoring.json
- `store.tsx` — React Context state management (cities, showStyles, config)
- `api.ts` — fetch-based API client

Vite dev server proxies `/api/*` to `localhost:9826`.

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/events` | GET | Query events (keyword, city, artists, dates, soldOut, sort) |
| `/api/report/latest` | GET | Latest daily report |
| `/api/logs` | GET | Recent search logs |
| `/api/memos` | GET/POST | List/add/remove memos |
| `/api/run` | POST | Trigger immediate scrape+report |
| `/api/dictionary/{type}` | GET | City or showStyle dictionary |
| `/api/config` | GET | Current monitoring config |
| `/api/config/monitoring` | POST | Update monitoring config |
| `/api/chat/messages` | GET | Chat history (?limit=N) |
| `/api/chat` | POST | Chat with SSE streaming |

### Database
SQLite via `bun:sqlite`. Tables: `events`, `search_logs`, `reports`, `memos`, `chat_messages`, `chat_context_summaries`, `agent_runs`, `agent_run_steps`. No migration system — schema changes require updating `initSchema()` in `apps/server/src/db/schema.ts` and manual ALTER or re-init.

### Environment Variables
See `.env.example`. Key vars:
- `APP_TIMEZONE` (default: Asia/Shanghai), `DB_PATH` (default: ./data/gigwatch.sqlite), `APP_PORT` (default: 9826)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` — LLM config (OpenAI-compatible APIs)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram bot
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET` — Feishu bot

### Timezone Handling
All timestamps use configured timezone (default Asia/Shanghai). Utilities `nowInTz()` and `toIso()` in `apps/server/src/utils/datetime.ts`.

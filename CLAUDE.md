# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GigWatch is a Bun.js-based monitoring agent that tracks live performance data from Damai (大麦网) and generates daily reports using AI. It pulls concert/show data via the Alibaba Damai TOP API, searches Baidu for artist tour updates, stores everything in SQLite, and generates summaries using OpenAI-compatible models (configured for Kimi K2).

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
1. **Monitoring profiles** (from `config/monitoring.json`) define what to search for (cities, categories, artists)
2. **Damai client** (`src/clients/damai.ts`) fetches performance data via signed TOP API requests
3. **Baidu client** (`src/clients/baidu.ts`) searches web for focus artist updates
4. **Database** (`src/db/`) stores projects and artist news with upsert logic to track first/last seen times
5. **OpenAI client** (`src/clients/openai.ts`) generates structured reports, falls back to heuristic summary if API key missing
6. **Daily report job** (`src/jobs/dailyReport.ts`) orchestrates the entire pipeline

### Key Components

**Configuration System** (`src/config.ts`, `src/types.ts`)
- Environment variables loaded via `loadEnv()` from `.env`
- Monitoring config loaded from `config/monitoring.json` via `loadConfig()`
- Supports monitoring profiles for different search criteria combinations
- If no profiles defined, creates a default profile from global monitoring settings

**Damai API Integration** (`src/clients/damai.ts`)
- Uses Alibaba TOP API method `alibaba.damai.ec.search.project.search`
- Supports both MD5 and HMAC signature methods for authentication
- Filters: categories, sub-categories, artists, keywords, cities, date ranges, channels
- Response can contain single object or array - normalized to array in `searchDamaiProjects()`

**Database Schema** (`src/db/schema.ts`)
- `projects` table: Unique constraint on (name, venue_name, show_time, city_name, perform_start_time)
- `artist_news` table: Stores Baidu search results for focus artists
- `reports` table: Archives generated reports with JSON and text versions
- Upsert logic updates `last_seen_at`, `site_status`, `price_str`, `promotion_price` on conflicts

**Report Generation** (`src/clients/openai.ts`)
- AI-generated: Uses OpenAI SDK with Kimi K2 model to produce structured JSON reports
- Heuristic fallback: If no API key or parsing fails, generates basic summary with city counts
- Extracts JSON from markdown code fences in LLM responses

### Timezone Handling
- All timestamps use the configured timezone (default: Asia/Shanghai)
- `nowInTz()` and `toIso()` utilities in `src/utils.ts` handle timezone-aware formatting
- Report window (default 24 hours) filters projects by `first_seen_at` timestamp

### Environment Variables
Required for full functionality:
- `DAMAI_APP_KEY`, `DAMAI_APP_SECRET` - Damai TOP API credentials
- `BAIDU_APPBUILDER_API_KEY` - Baidu web search API
- `OPENAI_API_KEY` - For AI report generation (optional, uses heuristic fallback)
- `OPENAI_BASE_URL` - Base URL for OpenAI-compatible API (e.g., https://api.moonshot.cn/v1)
- `OPENAI_MODEL` - Model name (default: kimi-k2)

Optional:
- `APP_TIMEZONE` - Timezone for timestamps (default: Asia/Shanghai)
- `DB_PATH` - SQLite database location (default: ./data/gigwatch.sqlite)
- `DAMAI_SIGN_METHOD` - md5 or hmac (default: md5)
- `CONFIG_PATH` - Monitoring config file path (default: config/monitoring.json)

## Important Implementation Details

### Adding New Monitoring Filters
When adding filters to Damai searches, update:
1. `DamaiSearchFilters` type in `src/clients/damai.ts`
2. `param` object construction in `searchDamaiProjects()`
3. Profile filter types in `src/types.ts` if exposing to config
4. `buildProfiles()` in `src/jobs/dailyReport.ts` for default profile mapping

### Database Migrations
There is no migration system. Schema changes require:
1. Updating `initSchema()` in `src/db/schema.ts`
2. Manual handling of existing databases (backup and re-init, or manual ALTER statements)

### API Signature Generation
Damai TOP API requires signatures on all requests:
- MD5 mode: `MD5(secret + sorted_params + secret)`
- HMAC mode: `HMAC-MD5(sorted_params, secret)`
- All parameter keys must be sorted alphabetically before signing
- Signature is added as `sign` parameter AFTER generation

### Search Recency Filtering
Baidu search supports: "week", "month", "semiyear", "year" (configured in `config/monitoring.json` under `search.recency`)

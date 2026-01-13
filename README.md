# GigWatch

Bun.js + SQLite agent for monitoring Damai gigs and generating a daily report with Kimi K2 (OpenAI SDK compatible).

## What it does
- Pulls performance data from Damai TOP API (alibaba.damai.ec.search.project.search)
- Uses Baidu web search for focus-artist tour updates
- Stores data in SQLite
- Prints a daily report to console (model-assisted or heuristic fallback)

## Setup
1) Install deps
```bash
bun install
```

2) Create config
```bash
cp config/monitoring.example.json config/monitoring.json
```
Edit `config/monitoring.json` to set your cities, categories, and focus artists.

3) Set env
```bash
cp .env.example .env
```
Fill in keys in `.env`.

4) Init DB
```bash
bun run init-db
```

## Run daily report
```bash
bun run daily
```

## Scheduling
Use cron or any scheduler to run once every 24h. Example:
```
0 9 * * * cd /path/to/GigWatch && bun run daily >> ./logs/daily.log 2>&1
```

## Notes
- Damai TOP API requires signing; this project supports md5/hmac (default md5).
- If `OPENAI_API_KEY` is missing, report falls back to a heuristic summary.
- Kimi K2 model is configured via `OPENAI_MODEL` and `OPENAI_BASE_URL`.

## Config reference
See `config/monitoring.example.json`.

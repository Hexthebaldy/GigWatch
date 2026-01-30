# GigWatch (ShowStart)

Bun.js + SQLite agent that scrapes ShowStart 演出列表，按配置批量搜索并生成每日摘要。支持 CLI 与 Web UI，关注艺人和搜索日志都落盘。

## What it does
- 抓取 ShowStart 列表页（解析 `window.__NUXT__` 数据）获取演出信息
- 依据配置中的查询（城市 / 关键词 / 自定义 URL）批量抓取
- 本地 SQLite 记录演出、搜索日志与生成的日报
- 日报使用启发式统计生成摘要、高亮和关注艺人匹配结果

## Setup
1) 安装依赖（无额外包）
```bash
bun install
```
2) 创建配置
```bash
cp config/monitoring.example.json config/monitoring.json
```
根据需要调整查询与关注艺人。

3) 初始化数据库
```bash
bun run init-db
```

## Commands
- 运行一次抓取并打印日报
```bash
bun run daily
```
- 启动 Web UI（默认 http://localhost:3000）
```bash
bun run serve
```

## Config / Env
- 配置示例：`config/monitoring.example.json`
- 环境变量：`APP_TIMEZONE`（默认 Asia/Shanghai），`DB_PATH`（默认 ./data/gigwatch.sqlite），`APP_PORT`（Web 端口，默认 3000），`CONFIG_PATH`（自定义配置路径）

## Scheduling
用 cron 等调度每日运行一次，例如：
```
0 9 * * * cd /path/to/GigWatch && bun run daily >> ./logs/daily.log 2>&1
```

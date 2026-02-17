# GigWatch 架构变更说明（Monorepo）

本文档用于说明 GigWatch 从“单应用目录结构”迁移到“Monorepo 结构”的变更背景、改动内容和影响范围，便于团队统一理解当前工程布局。

## 1. 变更背景

在原结构中，后端代码、前端页面逻辑、测试与共享类型均位于同一层目录（以 `src/` 为中心）。随着前端从内联 HTML/JS 逐步演进为 React + TypeScript 应用，原结构在以下方面逐渐受限：

- 前后端边界不清晰，模块职责混杂。
- 前端独立构建、开发代理、类型管理不方便。
- 共享类型缺少稳定位置，容易出现重复定义。
- 后续扩展（如新 app、新包）成本较高。

因此将项目调整为 Monorepo，统一由 workspace 管理多应用与共享包。

## 2. 目标

- 明确分离 `server`（后端）与 `web`（前端）职责。
- 提供稳定的共享类型包 `@gigwatch/shared`。
- 保持原后端能力与命令可用，降低迁移风险。
- 为后续扩展（新 app / 工具包 / CI 分层）预留结构空间。

## 3. 变更前后对照

### 3.1 目录结构

变更前（核心）：

```text
src/
test/
package.json
tsconfig.json
```

变更后（核心）：

```text
apps/
  server/          # 原后端代码与测试迁移目标
    src/
    test/
  web/             # React + TypeScript + Vite 前端
packages/
  shared/          # 前后端共享类型（@gigwatch/shared）
package.json       # workspace 编排层
tsconfig.base.json # 公共 TS 配置
```

### 3.2 路径迁移映射

- `src/**` -> `apps/server/src/**`
- `test/**` -> `apps/server/test/**`
- `src/types.ts` -> `packages/shared/src/index.ts`（并由 `apps/server/src/types.ts` re-export）

## 4. 关键改动说明

### 4.1 Workspace 编排

根 `package.json` 新增：

- `workspaces: ["apps/*", "packages/*"]`

并保留根命令作为统一入口，例如：

- `bun run serve`
- `bun run telegram`
- `bun run feishu`
- `bun run dev:web`
- `bun run build:web`

### 4.2 后端应用拆分

新增 `apps/server/package.json` 与 `apps/server/tsconfig.json`，后端继续使用 Bun + TypeScript。

后端核心能力保持不变：

- `runDailyReport`
- Web API（`/api/report/latest`、`/api/logs`、`/api/run`、`/api/config`、`/api/config/monitoring`）
- Telegram / Feishu 机器人入口

### 4.3 前端应用拆分

新增 `apps/web`，使用 React + TypeScript + Vite：

- 开发命令：`bun run dev:web`
- 构建命令：`bun run build:web`
- 本地开发代理：`/api` -> `http://localhost:3000`

### 4.4 共享类型包

新增 `packages/shared` 并导出统一类型：

- `MonitoringConfig`
- `MonitoringQuery`
- `ShowStartEvent`
- `DailyReport`
- `SearchLogRecord`
- `MonitoringPayload`

前后端通过 `@gigwatch/shared` 复用类型定义，减少重复声明与类型漂移风险。

## 5. 命令变更对照

### 5.1 对外（开发者）命令

迁移后仍推荐从根目录执行，常用命令基本保持一致：

- `bun run serve`
- `bun run daily`
- `bun run init-db`
- `bun run test`

新增前端命令：

- `bun run dev:web`
- `bun run build:web`
- `bun run preview:web`
- `bun run typecheck:web`

### 5.2 内部入口路径

CLI 真实入口路径由 `src/cli.ts` 变为：

- `apps/server/src/cli.ts`

## 6. 运行链路（当前）

### 6.1 后端链路

`bun run serve` -> `apps/server/src/cli.ts` -> `startServer(...)` -> 提供 API 与调度能力。

### 6.2 前端链路

`bun run dev:web` -> `apps/web` Vite Dev Server -> 通过代理访问后端 `/api/*`。

## 7. 兼容性与影响范围

### 7.1 已保持兼容

- 根级常用后端命令可继续使用。
- 后端 API 路由与行为保持一致。
- 现有后端测试结构保留，仅路径迁移。

### 7.2 受影响点

- 脚本、文档、CI 中硬编码 `src/`、`test/` 的路径需要同步到 `apps/server/...`。
- 依赖安装应以 workspace 方式处理（根目录执行 `bun install`）。
- 新增前端依赖（React/Vite/TypeScript）由 `apps/web` 管理。

## 8. 风险与后续建议

### 8.1 当前风险

- 若 CI 仍使用旧路径命令，可能直接失败。
- 若未安装 workspace 依赖，`apps/web` 命令无法运行。

### 8.2 下一阶段建议

- 将 `apps/server/src/server.ts` 从“内联页面”过渡到“API + 托管 `apps/web/dist`”。
- 在 CI 中拆分 `server` 与 `web` 两条流水线（lint/test/build）。
- 按需新增 `packages/*`（如 API SDK、UI 组件）并复用 workspace 机制。

## 9. 结论

本次变更的本质是“工程组织方式升级”，而不是“核心业务重写”。  
后端业务逻辑和外部 API 保持稳定，前端与共享类型获得独立演进能力，为后续规模化开发提供了清晰边界。

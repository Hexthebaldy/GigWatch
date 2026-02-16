# Web UI Task List

1. 在 `web/` 初始化 `TypeScript + React + shadcn/ui` 前端工程。
2. 在后端新增 `POST /api/chat` 接口（复用现有 `ChatService + AgentRunner`）。
3. 前端实现 `Chat` 页面：消息列表、输入框、发送按钮、加载状态。
4. 接入现有配置接口：`GET /api/config`、`POST /api/config/monitoring`。
5. 前端实现 `Config` 页面：`focusArtists`、`cityCodes`、`showStyles`、`keywords` 的编辑与保存。
6. 增加基础交互：回车发送、发送中禁用按钮、请求失败提示。
7. 将前端构建产物接入 Bun 静态托管，`bun run serve` 可直接访问页面。
8. 更新 `README.md`：补充前端启动/构建方式与 API 使用说明。

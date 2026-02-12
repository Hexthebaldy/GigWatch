# 飞书 Bot 注册与接入指南（SDK 长连接）

本文档用于把 GigWatch 接入飞书，实现「用户在飞书发消息 -> GigWatch Agent 处理 -> 飞书回消息」。

当前项目使用飞书官方 Node SDK 的长连接模式，不需要公网 webhook 回调地址。

## 1. 前置条件

- 已有可运行的 GigWatch 项目（本地已执行 `bun install`、`bun run init-db`）
- 可访问飞书开放平台并创建企业自建应用（`https://open.feishu.cn/app`）

## 2. 在飞书开放平台创建应用

1. 进入飞书开放平台，创建企业自建应用
2. 在应用功能中启用机器人能力
3. 发布应用版本（至少发布测试版本，保证机器人可用）

关键提醒：

- 只在后台保存配置不够，必须点击发布新版本
- 未发布时，飞书客户端通常看不到机器人聊天输入框或无法正常收发消息

## 3. 配置权限与事件

在应用后台完成两类配置：

- `消息权限`：允许机器人接收消息并发送消息
- `事件`：订阅 `im.message.receive_v1`

订阅方式选择：

- 选择飞书提供的 `长连接` 模式（不需要公网域名、也无需 webhook 回调地址）

说明：

- GigWatch 当前只处理文本消息（`message_type = text`）
- 只处理用户发送的消息，不处理机器人自己发出的消息

## 4. 配置环境变量

在 `.env` 中添加：

```bash
# Feishu Bot
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 可选：飞书开放平台 API 基础地址（一般不用改）
FEISHU_BASE_URL=https://open.feishu.cn
```

变量说明：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`：用于 SDK 长连接鉴权与发送消息 API 鉴权
- `FEISHU_BASE_URL`：仅用于发送消息 API，默认 `https://open.feishu.cn`

## 5. 安装飞书 SDK 依赖

```bash
bun add @larksuiteoapi/node-sdk
```

## 6. 启动飞书入口服务

```bash
bun run feishu
```

启动后会建立长连接并监听飞书消息事件，日志写入 `data/gigwatch.log.jsonl`。

## 7. 本地部署方案（Mac mini）

你可以只在本地 Mac mini 运行，无需云服务器和内网穿透。

注意事项：

- Mac mini 需要常开、不断网、不可休眠
- GigWatch 进程需要常驻（建议后续使用 `launchd` 托管）
- 外出时能否收到消息，取决于本地机器和进程是否在线

## 8. 验证联通

建议按以下顺序验证：

1. 在飞书应用后台完成长连接事件配置并发布新版本
2. 运行 `bun run feishu`
3. 给机器人所在会话发送一条文本消息（例如：`你好`）
4. 检查日志中是否出现 `[Feishu] Message from ...`
5. 确认收到机器人回复
6. 用 SQL 检查消息是否入库：

```sql
SELECT id, role, source, external_chat_id, substr(content, 1, 80) AS preview, created_at
FROM chat_messages
ORDER BY id DESC
LIMIT 10;
```

## 9. 常见问题

### 9.1 启动报错 `Feishu SDK missing`

未安装 SDK。执行：

```bash
bun add @larksuiteoapi/node-sdk
```

### 9.2 能收到消息但回不去

- 检查 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否正确
- 检查应用是否已发布并具备发送消息权限
- 查看 `data/gigwatch.log.jsonl` 中的飞书 API 报错信息

### 9.3 外出时机器人不回复

- 检查 Mac mini 是否在线
- 检查 `bun run feishu` 进程是否仍在运行
- 检查本机网络是否中断

### 9.4 客户端看不到机器人输入框

- 检查飞书应用是否已发布最新版本（仅保存配置不会生效）
- 检查应用可用范围是否包含当前账号
- 关闭会话后重新搜索机器人进入聊天页面

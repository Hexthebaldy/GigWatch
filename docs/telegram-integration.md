# Telegram 集成指南

## 概述

GigWatch 支持通过 Telegram Bot 发送通知消息，用于即时推送重要信息（如关注艺人的新演出）。

## 设置步骤

### 1. 创建 Telegram Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot` 命令
3. 按提示设置 bot 名称和 username
4. 获得 Bot Token（类似：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

### 2. 获取 Chat ID

**方法 1：使用 @userinfobot**
1. 在 Telegram 中找到 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 获得你的 Chat ID（数字形式，如：`123456789`）

**方法 2：使用 API**
1. 先给你的 bot 发送一条消息
2. 访问：`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. 在返回的 JSON 中查找 `chat.id`

### 3. 配置环境变量

在项目根目录创建或编辑 `.env` 文件：

```bash
# Telegram 配置
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

或者直接设置环境变量：

```bash
export TELEGRAM_BOT_TOKEN="你的Bot Token"
export TELEGRAM_CHAT_ID="你的Chat ID"
```

## 使用方式

### 长轮询模式（Telegram → GigWatch）

适用于本地或内网环境，不需要公网 HTTPS。

```bash
# 启动 Telegram 长轮询监听
bun run telegram
```

> 监听会读取 TELEGRAM_BOT_TOKEN 与 TELEGRAM_CHAT_ID，
> 收到消息后由 Agent 解析并调用工具执行任务。

### 方式 1：在 Agent 中使用（推荐）

```typescript
import { loadEnv } from "./config";
import { ToolRegistry } from "./agent/tools/registry";
import { createTelegramTool } from "./agent/tools/telegram";
import { AgentExecutor } from "./agent/executor";

const env = loadEnv();

// 创建 Telegram 工具
const telegramTool = createTelegramTool({
  botToken: env.telegramBotToken!,
  chatId: env.telegramChatId!
});

// 注册到工具表
const registry = new ToolRegistry();
registry.register(telegramTool);

// 在 Agent 中调用
const executor = new AgentExecutor(db, registry);
// Agent 会自动决定何时发送通知
```

### 方式 2：直接调用工具

```typescript
import { loadEnv } from "./config";
import { createTelegramTool } from "./agent/tools/telegram";

const env = loadEnv();

const telegramTool = createTelegramTool({
  botToken: env.telegramBotToken!,
  chatId: env.telegramChatId!
});

// 发送普通消息
const result = await telegramTool.execute({
  message: "GigWatch 日报已生成！",
  priority: "normal"
});

// 发送紧急消息（带声音通知）
const urgentResult = await telegramTool.execute({
  message: "**重要通知**：Central Cee 新增上海站演出！",
  priority: "urgent"
});

// 使用 HTML 格式
const htmlResult = await telegramTool.execute({
  message: "<b>关注艺人新演出</b>\n<i>青叶市子 - 北京站</i>",
  parseMode: "HTML"
});
```

### 方式 3：在日报中集成

修改 `runDailyReportWithAgent` 添加通知功能：

```typescript
export const runDailyReportWithAgent = async (db, config, env) => {
  // ... 现有逻辑 ...

  const result = await executor.execute(task);

  // 如果有关注艺人的新演出，发送通知
  if (env?.telegramBotToken && env?.telegramChatId) {
    const telegramTool = createTelegramTool({
      botToken: env.telegramBotToken,
      chatId: env.telegramChatId
    });

    const focusMatches = result.data.focusMatches;
    const hasNewEvents = focusMatches.some(m => m.events.length > 0);

    if (hasNewEvents) {
      let message = "🎵 **关注艺人新演出**\n\n";
      for (const match of focusMatches) {
        if (match.events.length > 0) {
          message += `**${match.artist}**\n`;
          for (const evt of match.events) {
            message += `• ${evt.title}\n  ${evt.showTime || '时间待定'}\n  ${evt.url}\n\n`;
          }
        }
      }

      await telegramTool.execute({
        message,
        priority: "urgent"
      });
    }
  }

  // ... 继续生成报告 ...
};
```

## 消息格式

### Markdown 格式（默认）

```markdown
**粗体文字**
*斜体文字*
[链接文字](https://example.com)
`代码`
```

### HTML 格式

```html
<b>粗体</b>
<i>斜体</i>
<a href="https://example.com">链接</a>
<code>代码</code>
```

## 工具参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `message` | string | ✅ | - | 消息内容 |
| `priority` | "urgent" \| "normal" | ❌ | "normal" | urgent 会触发声音通知 |
| `parseMode` | "Markdown" \| "HTML" | ❌ | "Markdown" | 消息解析格式 |

## 返回值

成功时：
```typescript
{
  success: true,
  data: {
    messageId: 123,
    sentAt: "2026-02-01T...",
    chatId: "123456789"
  }
}
```

失败时：
```typescript
{
  success: false,
  error: "错误描述"
}
```

## 常见问题

### Q: Bot 发送消息失败，提示 "Forbidden: bot was blocked by the user"
**A:** 确保你已经在 Telegram 中给 bot 发送过至少一条消息（随便发什么都行）。

### Q: 获取不到 Chat ID
**A:** 先给你的 bot 发一条消息，然后访问 `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`

### Q: 想给多个用户发送通知
**A:** 可以创建一个 Telegram 群组，把 bot 加入群组，然后使用群组的 Chat ID（负数）。

### Q: 消息格式错乱
**A:** 检查 `parseMode` 是否正确。Markdown 和 HTML 的语法不同，不要混用。

## 安全建议

1. ❌ 不要把 Bot Token 提交到代码仓库
2. ✅ 使用环境变量或 `.env` 文件
3. ✅ 将 `.env` 添加到 `.gitignore`
4. ✅ 使用不同的 bot 用于开发和生产环境

## 示例：完整的通知流程

```typescript
// 1. 加载配置
const env = loadEnv();

// 2. 检查是否配置了 Telegram
if (env.telegramBotToken && env.telegramChatId) {

  // 3. 创建工具
  const telegramTool = createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  });

  // 4. 发送消息
  const result = await telegramTool.execute({
    message: "GigWatch 监控到新演出！",
    priority: "urgent"
  });

  // 5. 处理结果
  if (result.success) {
    console.log("✅ Telegram 通知发送成功");
  } else {
    console.error("❌ 发送失败:", result.error);
  }
} else {
  console.log("⚠️  Telegram 未配置，跳过通知");
}
```

## 阶段 2 集成

在阶段 2 中，LLM Agent 会自主决定何时发送通知：

```
Agent 思考过程：
1. "我发现了关注艺人 Central Cee 的新演出"
2. "根据约束条件：关注艺人的演出绝对不能遗漏"
3. "我应该立即通知用户"
4. "选择工具：send_telegram，priority: urgent"
```

Agent 会根据事件重要性自动选择是否通知、通知优先级等。

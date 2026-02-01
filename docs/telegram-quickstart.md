# Telegram 通知快速开始

## 5 分钟设置指南

### 第 1 步：创建 Telegram Bot（2 分钟）

1. 打开 Telegram，搜索 `@BotFather`
2. 发送命令：`/newbot`
3. 设置 bot 名称（例如：`GigWatch Bot`）
4. 设置 username（例如：`gigwatch_bot`）
5. **复制 Bot Token**（类似：`123456789:ABCdefGHI...`）

### 第 2 步：获取 Chat ID（1 分钟）

1. 搜索 `@userinfobot`
2. 发送任意消息
3. **复制你的 ID**（一串数字）

### 第 3 步：配置 GigWatch（1 分钟）

编辑 `.env` 文件：

```bash
TELEGRAM_BOT_TOKEN=你刚才复制的Bot Token
TELEGRAM_CHAT_ID=你刚才复制的Chat ID
```

### 第 4 步：测试（1 分钟）

```bash
bun run scripts/test-telegram.ts
```

如果看到 "All tests completed!"，恭喜你设置成功！检查你的 Telegram，应该收到了 3 条测试消息。

---

## 常见问题

**Q: 没收到消息？**

1. 先给你的 bot 发一条消息（随便发什么）
2. 确认 Bot Token 和 Chat ID 正确
3. 重新运行测试脚本

**Q: 提示 "bot was blocked by the user"？**

在 Telegram 中找到你的 bot，点击 "START" 按钮或发送任意消息。

**Q: Chat ID 获取不到？**

访问：`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
（先给 bot 发一条消息，然后访问这个链接）

---

## 在日报中使用

编辑 `src/jobs/dailyReport.ts`，在 `runDailyReportWithAgent` 最后添加：

```typescript
// 发送 Telegram 通知
if (env?.telegramBotToken && env?.telegramChatId) {
  const { createTelegramTool } = await import("../agent/tools/telegram");

  const telegramTool = createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  });

  const focusMatches = result.data.focusMatches;
  const hasNewEvents = focusMatches.some(m => m.events.length > 0);

  if (hasNewEvents) {
    let message = "🎵 **GigWatch - 关注艺人新演出**\n\n";

    for (const match of focusMatches) {
      if (match.events.length > 0) {
        message += `**${match.artist}** (${match.events.length}场)\n`;
        for (const evt of match.events.slice(0, 3)) {
          message += `• ${evt.title}\n`;
          message += `  📅 ${evt.showTime || '时间待定'}\n`;
          message += `  🔗 ${evt.url}\n\n`;
        }
      }
    }

    await telegramTool.execute({
      message,
      priority: "urgent"  // 紧急通知，有声音
    });
  }
}
```

现在每次运行 `bun run daily`，如果发现关注艺人的新演出，就会收到 Telegram 通知！

---

## 示例效果

你会收到类似这样的消息：

```
🎵 GigWatch - 关注艺人新演出

**Central Cee** (3场)
• CENTRAL CEE - CAN'T RUSH GREATNESS WORLD TOUR - 成都站
  📅 2026/03/04 20:00
  🔗 https://www.showstart.com/event/287310

• 上海站加场-CENTRAL CEE - CAN'T RUSH GREATNESS WORLD TOUR
  📅 2026/03/07 19:00
  🔗 https://www.showstart.com/event/289271

• CENTRAL CEE CAN'T RUSH GREATNESS WORLD TOUR-佛山站
  📅 2026/03/08 20:00
  🔗 https://www.showstart.com/event/286846
```

完整文档：`docs/telegram-integration.md`

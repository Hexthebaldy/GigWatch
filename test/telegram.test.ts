#!/usr/bin/env bun

/**
 * 测试 Telegram 通知功能
 *
 * 使用方法：
 * 1. 设置环境变量 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID
 * 2. 运行：bun run scripts/test-telegram.ts
 */

import { loadEnv } from "../src/config";
import { createTelegramTool } from "../src/agent/tools/shows/telegram";

const main = async () => {
  console.log("🤖 Testing Telegram notification...\n");

  const env = loadEnv();

  // 检查配置
  if (!env.telegramBotToken || !env.telegramChatId) {
    console.error("❌ Telegram not configured!");
    console.error("\nPlease set environment variables:");
    console.error("  TELEGRAM_BOT_TOKEN=your_bot_token");
    console.error("  TELEGRAM_CHAT_ID=your_chat_id");
    console.error("\nSee docs/telegram-integration.md for setup instructions.");
    process.exit(1);
  }

  console.log("✅ Configuration found");
  console.log(`   Bot Token: ${env.telegramBotToken.substring(0, 20)}...`);
  console.log(`   Chat ID: ${env.telegramChatId}\n`);

  // 创建工具
  const telegramTool = createTelegramTool({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId
  });

  // 测试 1：普通消息
  console.log("📤 Test 1: Sending normal message...");
  const result1 = await telegramTool.execute({
    message: "✅ GigWatch Telegram 集成测试成功！\n\n这是一条普通消息（静默通知）",
    priority: "normal"
  });

  if (result1.success) {
    console.log(`✅ Message sent! ID: ${result1.data.messageId}\n`);
  } else {
    console.error(`❌ Failed: ${result1.error}\n`);
    process.exit(1);
  }

  // 等待 2 秒
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 2：紧急消息（带声音）
  console.log("📤 Test 2: Sending urgent message...");
  const result2 = await telegramTool.execute({
    message: "🔔 **紧急通知**\n\n这是一条紧急消息（会有声音通知）",
    priority: "urgent"
  });

  if (result2.success) {
    console.log(`✅ Urgent message sent! ID: ${result2.data.messageId}\n`);
  } else {
    console.error(`❌ Failed: ${result2.error}\n`);
  }

  // 等待 2 秒
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 3：Markdown 格式
  console.log("📤 Test 3: Sending formatted message...");
  const result3 = await telegramTool.execute({
    message: `🎵 **关注艺人新演出**

**Central Cee** - CAN'T RUSH GREATNESS WORLD TOUR
• 时间：2026/03/07 19:00
• 地点：上海
• 票价：380-480 元
• [购票链接](https://www.showstart.com/event/289271)

_由 GigWatch 自动监控_`,
    priority: "urgent"
  });

  if (result3.success) {
    console.log(`✅ Formatted message sent! ID: ${result3.data.messageId}\n`);
  } else {
    console.error(`❌ Failed: ${result3.error}\n`);
  }

  console.log("🎉 All tests completed!");
  console.log("\n💡 Tip: Check your Telegram to see the messages.");
};

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

import type { Tool } from "./base";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export const createTelegramTool = (config: TelegramConfig): Tool => ({
  name: "send_telegram",
  description: "向用户发送 Telegram 通知消息。用于重要信息的即时推送，如关注艺人的新演出。",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "要发送的消息内容，支持 Markdown 格式"
      },
      priority: {
        type: "string",
        description: "消息优先级：urgent (紧急，有声音通知) 或 normal (普通，静默通知)",
        enum: ["urgent", "normal"],
        default: "normal"
      },
      parseMode: {
        type: "string",
        description: "消息解析模式",
        enum: ["Markdown", "HTML"],
        default: "Markdown"
      }
    },
    required: ["message"]
  },
  execute: async ({ message, priority = "normal", parseMode = "Markdown" }) => {
    const { botToken, chatId } = config;

    if (!botToken || !chatId) {
      return {
        success: false,
        error: "Telegram bot token or chat ID not configured"
      };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
          disable_notification: priority !== "urgent"
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: `Telegram API error: ${errorData.description || response.statusText}`
        };
      }

      const data = await response.json();

      return {
        success: true,
        data: {
          messageId: data.result.message_id,
          sentAt: new Date().toISOString(),
          chatId
        }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
});

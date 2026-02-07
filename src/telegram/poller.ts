import type { Database } from "bun:sqlite";
import type { AppEnv } from "../config";
import { logError, logInfo, logWarn } from "../utils/logger";
import { ToolRegistry } from "../agent/tools/registry";
import { showstartTool } from "../agent/tools/shows/showstart";
import { createLoadEventsTool } from "../agent/tools/shows/database";
import { createLatestReportTool } from "../agent/tools/shows/report";
import { createSearchEventsTool } from "../agent/tools/shows/search";
import { createGetConfigTool, createUpdateAppConfigTool, createUpdateMonitoringConfigTool } from "../agent/tools/shows/config";
import { createRunMonitoringTool } from "../agent/tools/shows/runMonitoring";
import { resolveCityCodeTool, resolveShowStyleTool } from "../agent/tools/shows/dictionary";
import { createReadFileTool } from "../agent/tools/shows/readFile";
import { webSearchTool } from "../agent/tools/common/webSearch";
import { MessageRouter } from "../agent/messageRouter";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sendTelegramMessage = async (token: string, chatId: string, text: string) => {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.description || response.statusText);
  }
};

export const startTelegramLongPolling = async (db: Database, env: AppEnv) => {
  if (!env.telegramBotToken) {
    logWarn("[Telegram] TELEGRAM_BOT_TOKEN not configured, polling disabled");
    return;
  }

  const registry = new ToolRegistry();
  registry.register(webSearchTool);
  registry.register(showstartTool);
  registry.register(createLoadEventsTool(db));
  registry.register(createSearchEventsTool(db));
  registry.register(createLatestReportTool(db));
  registry.register(createGetConfigTool());
  registry.register(createUpdateMonitoringConfigTool());
  registry.register(createUpdateAppConfigTool());
  registry.register(createRunMonitoringTool(db, env));
  registry.register(resolveCityCodeTool);
  registry.register(resolveShowStyleTool);
  registry.register(createReadFileTool());

  const router = new MessageRouter(registry, env);

  let offset = 0;
  let backoff = 1000;
  logInfo("[Telegram] Long-polling started");

  while (true) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset,
          timeout: 50,
          allowed_updates: ["message"]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.description || "Telegram getUpdates failed");
      }

      const updates: any[] = payload.result || [];
      if (updates.length > 0) {
        logInfo(`[Telegram] Received ${updates.length} update(s)`);
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        const message = update.message;
        const text = message?.text?.trim();
        if (!text) continue;

        const incomingChatId = message?.chat?.id?.toString?.();
        if (!incomingChatId) continue;

        if (env.telegramChatId && incomingChatId !== env.telegramChatId) {
          logWarn(`[Telegram] Ignored message from chat ${incomingChatId}`);
          continue;
        }

        const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        logInfo(`[Telegram] Message from ${incomingChatId}: ${preview}`);

        const reply = await router.handleMessage(text);
        const replyChatId = env.telegramChatId || incomingChatId;
        await sendTelegramMessage(env.telegramBotToken, replyChatId, reply);
      }

      backoff = 1000;
    } catch (error) {
      logError(`[Telegram] Polling error: ${String(error)}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
};

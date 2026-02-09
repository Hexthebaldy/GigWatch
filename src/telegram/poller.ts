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
import { webFetchTool } from "../agent/tools/common/webFetch";
import { webSearchTool } from "../agent/tools/common/webSearch";
import { ChatService, type IncomingChatMessage } from "../agent/chatService";

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

const toIncomingChatMessage = (update: any): IncomingChatMessage | undefined => {
  const message = update?.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id?.toString?.();
  const userId = message?.from?.id?.toString?.();
  if (!text || !chatId) return undefined;
  return {
    source: "telegram",
    text,
    externalChatId: chatId,
    externalUserId: userId,
    metadata: {
      updateId: update.update_id
    }
  };
};

const processTelegramUpdate = async (
  update: any,
  env: AppEnv,
  chatService: ChatService
) => {
  const incoming = toIncomingChatMessage(update);
  if (!incoming) return;

  const incomingChatId = incoming.externalChatId;
  if (!incomingChatId) return;

  if (env.telegramChatId && incomingChatId !== env.telegramChatId) {
    logWarn(`[Telegram] Ignored message from chat ${incomingChatId}`);
    return;
  }

  const preview = incoming.text.length > 120 ? `${incoming.text.slice(0, 120)}…` : incoming.text;
  logInfo(`[Telegram] Message from ${incomingChatId}: ${preview}`);

  const result = await chatService.handleIncomingMessage(incoming);
  const replyChatId = env.telegramChatId || incomingChatId;
  await sendTelegramMessage(env.telegramBotToken!, replyChatId, result.text);
};

export const startTelegramLongPolling = async (db: Database, env: AppEnv) => {
  if (!env.telegramBotToken) {
    logWarn("[Telegram] TELEGRAM_BOT_TOKEN not configured, polling disabled");
    return;
  }

  const registry = new ToolRegistry();
  registry.register(webFetchTool);
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

  const chatService = new ChatService(db, registry, env);

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
        await processTelegramUpdate(update, env, chatService);
      }

      backoff = 1000;
    } catch (error) {
      logError(`[Telegram] Polling error: ${String(error)}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
};

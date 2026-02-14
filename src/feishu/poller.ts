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
import { FeishuClient, parseFeishuTextContent, type FeishuSenderId } from "../clients/feishu";

// 进程内事件去重缓存：避免飞书重投递或网络抖动造成重复回复。
const EVENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EVENT_CACHE_MAX_SIZE = 5000;
const seenEvents = new Map<string, number>();

type LongConnMessage = {
  message_id?: string;
  root_id?: string;
  parent_id?: string;
  create_time?: string;
  chat_id?: string;
  chat_type?: string;
  message_type?: string;
  content?: string;
};

type LongConnSender = {
  sender_id?: FeishuSenderId;
  sender_type?: string;
  tenant_key?: string;
};

type LongConnEventPayload = {
  eventId?: string;
  sender?: LongConnSender;
  message?: LongConnMessage;
};

// 动态加载 SDK，未安装时给出明确安装提示。
const loadFeishuSdk = async () => {
  try {
    return await import("@larksuiteoapi/node-sdk");
  } catch (error) {
    throw new Error(
      `Feishu SDK missing: ${String(error)}. Please run: bun add @larksuiteoapi/node-sdk`
    );
  }
};

// 定期清理去重缓存中过期的事件 ID。
const cleanupSeenEvents = () => {
  const now = Date.now();
  for (const [eventId, seenAt] of seenEvents.entries()) {
    if (now - seenAt > EVENT_CACHE_TTL_MS) {
      seenEvents.delete(eventId);
    }
  }
};

// 判断事件是否已处理过（基于 event_id / message_id）。
const hasSeenEvent = (eventId: string) => {
  cleanupSeenEvents();
  const seenAt = seenEvents.get(eventId);
  return typeof seenAt === "number" && Date.now() - seenAt <= EVENT_CACHE_TTL_MS;
};

// 记录本次事件 ID，用于后续去重。
const rememberEvent = (eventId: string) => {
  cleanupSeenEvents();
  if (!seenEvents.has(eventId) && seenEvents.size >= EVENT_CACHE_MAX_SIZE) {
    const oldestEventId = seenEvents.keys().next().value as string | undefined;
    if (oldestEventId) {
      seenEvents.delete(oldestEventId);
    }
  }
  seenEvents.set(eventId, Date.now());
};

// 兼容不同 SDK 版本返回结构，统一抽取 sender/message/eventId。
const toLongConnEventPayload = (input: unknown): LongConnEventPayload | undefined => {
  if (!input || typeof input !== "object") return undefined;
  const payload = input as {
    header?: { event_id?: unknown };
    event_id?: unknown;
    sender?: LongConnSender;
    message?: LongConnMessage;
    event?: { sender?: LongConnSender; message?: LongConnMessage } | undefined;
  };

  // SDK versions may return either the full envelope or only event body.
  const sender = payload.sender || payload.event?.sender;
  const message = payload.message || payload.event?.message;
  if (!message) return undefined;

  const eventId =
    (typeof payload.header?.event_id === "string" ? payload.header.event_id : undefined) ||
    (typeof payload.event_id === "string" ? payload.event_id : undefined) ||
    message.message_id;

  return { eventId, sender, message };
};

// 将飞书事件转换为 ChatService 统一入站消息结构。
const toIncomingChatMessage = (eventPayload: LongConnEventPayload): IncomingChatMessage | undefined => {
  const senderType = eventPayload.sender?.sender_type;
  if (senderType && senderType !== "user") return undefined;

  const message = eventPayload.message;
  if (!message || message.message_type !== "text") return undefined;

  const text = parseFeishuTextContent(message.content);
  if (!text) return undefined;

  const chatId = message.chat_id;
  if (!chatId) return undefined;

  const senderId = eventPayload.sender?.sender_id;
  const userId = senderId?.user_id || senderId?.open_id || senderId?.union_id;

  return {
    source: "feishu",
    text,
    externalChatId: chatId,
    externalUserId: userId,
    metadata: {
      eventId: eventPayload.eventId,
      messageId: message.message_id,
      messageType: message.message_type,
      chatType: message.chat_type
    }
  };
};

// 单条飞书消息事件处理：解析 -> 去重 -> 交给 ChatService -> 回消息。
const processMessageEvent = async (
  rawEvent: unknown,
  chatService: ChatService,
  feishuClient: FeishuClient
) => {
  //把 SDK 原始事件统一解析成内部结构
  const event = toLongConnEventPayload(rawEvent);
  if (!event) return;

  const dedupId = event.eventId || event.message?.message_id;
  if (dedupId && hasSeenEvent(dedupId)) return;
  if (dedupId) rememberEvent(dedupId);

  const incoming = toIncomingChatMessage(event);
  if (!incoming) return;

  const preview = incoming.text.length > 120 ? `${incoming.text.slice(0, 120)}...` : incoming.text;
  logInfo(`[Feishu] Message from ${incoming.externalChatId}: ${preview}`);

  const result = await chatService.handleIncomingMessage(incoming);
  await feishuClient.sendTextMessageByChatId(incoming.externalChatId!, result.text);
};

// 飞书入口主函数：建立 SDK 长连接并注册消息事件处理器。
export const startFeishuLongConnection = async (db: Database, env: AppEnv) => {
  if (!env.feishuAppId || !env.feishuAppSecret) {
    logWarn("[Feishu] FEISHU_APP_ID or FEISHU_APP_SECRET not configured, long connection disabled");
    return;
  }

  const sdk = await loadFeishuSdk();

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
  const feishuClient = new FeishuClient({
    appId: env.feishuAppId,
    appSecret: env.feishuAppSecret,
    baseUrl: env.feishuBaseUrl
  });

  // 事件分发器，只订阅并处理文本消息事件，其余事件忽略。register的参数里key是事件名，value是handler
  const eventDispatcher = new sdk.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      // Return quickly to Feishu and process message asynchronously.
      void processMessageEvent(data, chatService, feishuClient).catch((error) => {
        logError(`[Feishu] Failed to process message event: ${String(error)}`);
      });
    }
  });

  //创建飞书web socket长连接客户端
  const wsClient = new sdk.WSClient({
    appId: env.feishuAppId,
    appSecret: env.feishuAppSecret,
    loggerLevel: sdk.LoggerLevel.info
  });

  //正式建立长连接，并把事件分发器挂上去
  await wsClient.start({
    eventDispatcher
  });

  logInfo("[Feishu] Long connection started (SDK WSClient)");
  return wsClient;
};

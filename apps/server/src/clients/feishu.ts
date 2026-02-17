const DEFAULT_FEISHU_BASE_URL = "https://open.feishu.cn";
// 提前 60 秒刷新 token，避免边界时刻请求失败。
const TOKEN_REFRESH_BUFFER_MS = 60_000;

type TenantAccessTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

type SendMessageResponse = {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
  };
};

export type FeishuClientOptions = {
  appId: string;
  appSecret: string;
  baseUrl?: string;
};

type TenantAccessTokenCache = {
  value: string;
  expiresAtMs: number;
};

export type FeishuSenderId = {
  union_id?: string;
  user_id?: string;
  open_id?: string;
};

export type FeishuMessageReceiveEvent = {
  schema: "2.0";
  header: {
    event_id: string;
    event_type: string;
    token?: string;
    create_time?: string;
    app_id?: string;
    tenant_key?: string;
  };
  event: {
    sender?: {
      sender_id?: FeishuSenderId;
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      create_time?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
};

export type FeishuUrlVerificationBody = {
  type: "url_verification";
  challenge: string;
  token?: string;
};

const trimTrailingSlash = (input: string) => input.replace(/\/+$/g, "");

const parseJsonSafe = <T>(input: string): T | undefined => {
  try {
    return JSON.parse(input) as T;
  } catch {
    return undefined;
  }
};

const toErrorMessage = (status: number, payload: unknown) => {
  const apiMsg =
    typeof payload === "object" && payload !== null && "msg" in payload ? String((payload as { msg?: unknown }).msg) : "";
  return apiMsg ? `HTTP ${status}: ${apiMsg}` : `HTTP ${status}`;
};

const normalizeText = (input: string) =>
  input
    // 移除飞书 <at> 标签，避免把 mention 标记当成用户正文。
    .replace(/<at[^>]*>.*?<\/at>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const parseFeishuTextContent = (content: string | undefined): string | undefined => {
  if (!content) return undefined;
  const parsed = parseJsonSafe<{ text?: unknown }>(content);
  if (parsed && typeof parsed.text === "string") {
    const text = normalizeText(parsed.text);
    return text || undefined;
  }
  const fallback = normalizeText(content);
  return fallback || undefined;
};

//判断是否是飞书回调地址校验包
export const isFeishuUrlVerificationBody = (input: unknown): input is FeishuUrlVerificationBody => {
  if (!input || typeof input !== "object") return false;
  const payload = input as { type?: unknown; challenge?: unknown };
  return payload.type === "url_verification" && typeof payload.challenge === "string";
};

//判断是否是飞书 im.message.receive_v1 这类消息事件包
export const isFeishuMessageReceiveEvent = (input: unknown): input is FeishuMessageReceiveEvent => {
  if (!input || typeof input !== "object") return false;
  const payload = input as {
    schema?: unknown;
    header?: { event_id?: unknown; event_type?: unknown } | undefined;
    event?: unknown;
  };
  return (
    payload.schema === "2.0" &&
    !!payload.event &&
    typeof payload.header?.event_id === "string" &&
    typeof payload.header?.event_type === "string"
  );
};

export class FeishuClient {
  private readonly baseUrl: string;
  private tokenCache?: TenantAccessTokenCache;

  constructor(private readonly options: FeishuClientOptions) {
    if (!options.appId || !options.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required");
    }
    this.baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_FEISHU_BASE_URL);
  }

  private async getTenantAccessToken() {
    // 命中本地缓存时直接复用，减少鉴权接口调用频率。
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAtMs - TOKEN_REFRESH_BUFFER_MS) {
      return this.tokenCache.value;
    }

    const response = await fetch(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        app_id: this.options.appId,
        app_secret: this.options.appSecret
      })
    });

    const payload = (await response.json()) as TenantAccessTokenResponse;
    if (!response.ok) {
      throw new Error(toErrorMessage(response.status, payload));
    }
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(payload.msg || "Failed to fetch tenant access token");
    }

    const expireSeconds = typeof payload.expire === "number" ? payload.expire : 7200;
    // 缓存租户 token，后续发送消息复用。
    this.tokenCache = {
      value: payload.tenant_access_token,
      expiresAtMs: Date.now() + expireSeconds * 1000
    };
    return this.tokenCache.value;
  }

  async sendTextMessageByChatId(chatId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Message text cannot be empty");
    }

    // 使用 chat_id 作为接收方，向当前会话直接回消息。
    const token = await this.getTenantAccessToken();
    const response = await fetch(`${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: trimmed })
      })
    });

    const payload = (await response.json()) as SendMessageResponse;
    if (!response.ok) {
      throw new Error(toErrorMessage(response.status, payload));
    }
    if (payload.code !== 0) {
      throw new Error(payload.msg || "Failed to send Feishu message");
    }

    return payload.data?.message_id;
  }
}

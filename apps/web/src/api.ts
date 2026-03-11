import type { ChatMessage, DailyReport, DictEntry, MonitoringConfig, MonitoringPayload, SearchLogRecord, ShowStartEvent } from "@gigwatch/shared";

export type ChatStreamEvent =
  | { type: "token"; content: string; userMessageId?: number }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; success: boolean }
  | { type: "done"; reply: string }
  | { type: "error"; message: string };

const toError = async (res: Response) => {
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    detail = "";
  }
  return new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
};

const expectJson = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
};

export const api = {
  async getLatestReport() {
    const res = await fetch("/api/report/latest");
    return expectJson<DailyReport | null>(res);
  },
  async getLogs() {
    const res = await fetch("/api/logs");
    return expectJson<SearchLogRecord[]>(res);
  },
  async runNow() {
    const res = await fetch("/api/run", { method: "POST" });
    return expectJson<DailyReport>(res);
  },
  async getConfig() {
    const res = await fetch("/api/config");
    return expectJson<MonitoringConfig>(res);
  },
  async getDictionary(type: "cities" | "showStyles") {
    const res = await fetch(`/api/dictionary/${type}`);
    return expectJson<DictEntry[]>(res);
  },
  async saveMonitoring(payload: MonitoringPayload) {
    const res = await fetch("/api/config/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return expectJson<{ ok: boolean }>(res);
  },

  async queryEvents(params: {
    keyword?: string;
    city?: string;
    artists?: string[];
    since?: string;
    until?: string;
    soldOut?: 0 | 1;
    sort?: "recent" | "showTime";
    limit?: number;
  } = {}): Promise<ShowStartEvent[]> {
    const qs = new URLSearchParams();
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.city) qs.set("city", params.city);
    if (params.artists?.length) qs.set("artists", params.artists.join(","));
    if (params.since) qs.set("since", params.since);
    if (params.until) qs.set("until", params.until);
    if (params.soldOut !== undefined) qs.set("soldOut", String(params.soldOut));
    if (params.sort) qs.set("sort", params.sort);
    if (params.limit) qs.set("limit", String(params.limit));
    const res = await fetch(`/api/events?${qs}`);
    return expectJson<ShowStartEvent[]>(res);
  },

  async getChatMessages(limit = 30): Promise<ChatMessage[]> {
    const res = await fetch(`/api/chat/messages?limit=${limit}`);
    const data = await expectJson<Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
    }>>(res);
    return data.map((m) => ({
      id: String(m.id),
      role: m.role,
      content: m.content
    }));
  },

  async sendChatMessage(
    text: string,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal
    });

    if (!res.ok) throw await toError(res);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const body = await res.text();
      throw new Error(`Expected SSE stream but got ${contentType}: ${body.slice(0, 200)}`);
    }
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEventType) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent({ ...data, type: currentEventType } as ChatStreamEvent);
          } catch {
            // skip malformed JSON
          }
          currentEventType = "";
        }
      }
    }
  }
};

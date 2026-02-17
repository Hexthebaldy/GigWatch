import type { DailyReport, MonitoringConfig, MonitoringPayload, SearchLogRecord } from "@gigwatch/shared";

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
  async saveMonitoring(payload: MonitoringPayload) {
    const res = await fetch("/api/config/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return expectJson<{ ok: boolean }>(res);
  }
};

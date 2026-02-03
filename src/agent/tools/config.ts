import { writeFileSync } from "node:fs";
import { getConfigPath, loadConfig } from "../../config";
import type { MonitoringConfig } from "../../types";
import type { Tool } from "./base";

const normalizeList = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);

const applyListUpdate = (current: string[], mode: "add" | "remove" | "set", values: string[]) => {
  const normalized = normalizeList(values);
  if (mode === "set") return normalized;
  if (mode === "remove") {
    const removeSet = new Set(normalized);
    return current.filter((item) => !removeSet.has(item));
  }
  const set = new Set(current);
  for (const item of normalized) {
    set.add(item);
  }
  return Array.from(set);
};

const saveConfig = (config: MonitoringConfig) => {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  return path;
};

export const createGetConfigTool = (): Tool => ({
  name: "get_config",
  description: "读取当前 GigWatch 配置（monitoring.json）。",
  parameters: {
    type: "object",
    properties: {}
  },
  execute: async () => {
    try {
      const config = loadConfig();
      return { success: true, data: { config } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

export const createUpdateMonitoringConfigTool = (): Tool => ({
  name: "update_monitoring_config",
  description: "更新监控配置的列表字段（关注艺人、城市、风格、关键词）。",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "要更新的字段",
        enum: ["focusArtists", "cityCodes", "showStyles", "keywords"]
      },
      mode: {
        type: "string",
        description: "更新方式：add/ remove/ set（覆盖）",
        enum: ["add", "remove", "set"]
      },
      values: {
        type: "array",
        description: "要操作的值列表",
        items: { type: "string" }
      }
    },
    required: ["target", "mode", "values"]
  },
  execute: async ({ target, mode, values }: { target: string; mode: "add" | "remove" | "set"; values: string[] }) => {
    try {
      const config = loadConfig();
      if (!config.monitoring) {
        config.monitoring = { focusArtists: [] };
      }
      const current = config.monitoring[target as keyof MonitoringConfig["monitoring"]];
      const list = Array.isArray(current) ? current : [];
      const updated = applyListUpdate(list, mode, values);
      config.monitoring[target as keyof MonitoringConfig["monitoring"]] = updated;
      const path = saveConfig(config);
      return { success: true, data: { target, mode, values: updated, path } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

export const createUpdateAppConfigTool = (): Tool => ({
  name: "update_app_config",
  description: "更新 app 配置（时区、报告时间窗口等）。",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，例如 Asia/Shanghai"
      },
      reportWindowHours: {
        type: "number",
        description: "报告时间窗口（小时）"
      }
    }
  },
  execute: async ({ timezone, reportWindowHours }: { timezone?: string; reportWindowHours?: number }) => {
    try {
      const config = loadConfig();
      config.app = config.app || {};
      if (timezone) config.app.timezone = timezone;
      if (typeof reportWindowHours === "number") {
        config.app.reportWindowHours = reportWindowHours;
      }
      const path = saveConfig(config);
      return { success: true, data: { app: config.app, path } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

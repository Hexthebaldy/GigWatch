import type { Tool } from "./base";
import { showstartCities } from "../../dictionary/showstartCities";
import { showstartShowStyles } from "../../dictionary/showstartShowStyles";

const matchByName = (items: Array<{ code: string; name: string }>, name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const exact = items.filter((item) => item.name === trimmed);
  if (exact.length > 0) return exact;
  const lower = trimmed.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().includes(lower));
};

export const resolveCityCodeTool: Tool = {
  name: "resolve_city_code",
  description: "根据城市名称匹配秀动城市代码。",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "城市名称（例如 上海、北京）"
      }
    },
    required: ["name"]
  },
  execute: async ({ name }: { name: string }) => {
    try {
      const matches = matchByName(showstartCities, name);
      return { success: true, data: { matches } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

export const resolveShowStyleTool: Tool = {
  name: "resolve_show_style",
  description: "根据演出风格名称匹配秀动风格 ID。",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "演出风格名称（例如 摇滚、民谣）"
      }
    },
    required: ["name"]
  },
  execute: async ({ name }: { name: string }) => {
    try {
      const matches = matchByName(showstartShowStyles, name);
      return { success: true, data: { matches } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};

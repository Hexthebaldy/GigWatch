import type { Tool } from "./base";
import { fetchShowStartEvents, type ShowStartSearchParams } from "../../clients/showstart";

export const showstartTool: Tool = {
  name: "fetch_showstart_events",
  description: "从秀动（ShowStart）平台抓取演出列表。支持按城市、关键词、演出风格筛选，自动翻页获取所有结果。",
  parameters: {
    type: "object",
    properties: {
      cityCode: {
        type: "string",
        description: "城市代码，如 '21' 为广州，'10' 为上海"
      },
      keyword: {
        type: "string",
        description: "搜索关键词，可以是艺人名、演出名称等"
      },
      showStyle: {
        type: "string",
        description: "演出风格 ID，如 2 为摇滚，3 为民谣"
      },
      page: {
        type: "number",
        description: "页码，默认从 1 开始",
        default: 1
      },
      pageSize: {
        type: "number",
        description: "每页数量，默认 50",
        default: 50
      },
      url: {
        type: "string",
        description: "自定义 URL，如果提供则忽略其他参数"
      }
    }
  },
  execute: async (params: ShowStartSearchParams) => {
    try {
      const { events, url } = await fetchShowStartEvents(params);
      return {
        success: true,
        data: {
          events,
          count: events.length,
          url
        }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
};

import type { MonitoringConfig, MonitoringQuery } from "../types";

export type AgentTaskType = "event_monitoring" | "sentiment_analysis" | "investment_research";

export type AgentTask = {
  id: string;
  type: AgentTaskType;
  objective: string;
  context: Record<string, any>;
  constraints: string[];
  priority: "critical" | "high" | "normal";
};

export type AgentResult = {
  taskId: string;
  success: boolean;
  summary: string;
  data: any;
  error?: string;
  toolExecutions: Array<{
    toolName: string;
    parameters: any;
    result: any;
  }>;
};

//根据 monitoring.json 中的配置构建任务
export const buildEventMonitoringTask = (config: MonitoringConfig, queries: MonitoringQuery[]): AgentTask => {
  const focusArtists = config.monitoring.focusArtists || [];
  const cityCodes = config.monitoring.cityCodes || [];
  const showStyles = config.monitoring.showStyles || [];
  const keywords = config.monitoring.keywords || [];
  const reportWindowHours = config.app?.reportWindowHours || 24;

  // 构建更详细的目标描述
  const objectiveParts = [`监控演出信息，执行 ${queries.length} 个抓取任务`];

  if (focusArtists.length > 0) {
    objectiveParts.push(`【关注艺人】${focusArtists.join("、")}（${focusArtists.length} 个任务）`);
  }

  if (cityCodes.length > 0 && showStyles.length > 0) {
    const combinationCount = cityCodes.length * showStyles.length;
    objectiveParts.push(`【城市×风格】${cityCodes.length} 个城市 × ${showStyles.length} 种风格（${combinationCount} 个任务）`);
  } else if (cityCodes.length > 0) {
    objectiveParts.push(`【城市】${cityCodes.join("、")}（${cityCodes.length} 个任务）`);
  } else if (showStyles.length > 0) {
    objectiveParts.push(`【演出风格】${showStyles.join("、")}（${showStyles.length} 个任务）`);
  }

  if (keywords.length > 0) {
    objectiveParts.push(`【关键词】${keywords.join("、")}（${keywords.length} 个任务）`);
  }

  objectiveParts.push(`时间窗口：最近 ${reportWindowHours} 小时`);

  return {
    id: `event_monitoring_${new Date().getTime()}`,
    type: "event_monitoring",
    objective: objectiveParts.join("；"),
    context: {
      queries,
      focusArtists,
      cityCodes,
      showStyles,
      keywords,
      reportWindowHours,
      timezone: config.app?.timezone || "Asia/Shanghai"
    },
    constraints: [
      "必须执行所有配置的查询",
      "所有演出信息必须保存到数据库",
      "每次查询必须记录搜索日志",
      "关注艺人的演出绝对不能遗漏"
    ],
    priority: "high"
  };
};

import OpenAI from "openai";
import type { DamaiProject, DailyReport } from "../types";
import type { BaiduReference } from "../types";
import { loadEnv } from "../config";

export const generateReportWithModel = async (input: {
  timezone: string;
  runAt: string;
  projects: DamaiProject[];
  focusUpdates: Record<string, BaiduReference[]>;
}): Promise<DailyReport> => {
  const env = loadEnv();
  if (!env.openaiApiKey) {
    return generateHeuristicReport(input);
  }

  const client = new OpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl
  });

  const prompt = {
    role: "user" as const,
    content: `你是演出信息日报助理。请基于以下数据输出中文日报JSON。要求:\n- 输出 JSON 严格符合 DailyReport 类型字段\n- summary 为 3-5 句中文总结\n- highlights 为 3-6 条要点\n- focusArtists 按艺人输出更新，每条包含 1-3 个更新\n- 如果没有更新或项目，说明原因\n\nrunAt: ${input.runAt}\ntimezone: ${input.timezone}\n\nDamaiProjects: ${JSON.stringify(input.projects)}\n\nFocusUpdates: ${JSON.stringify(input.focusUpdates)}`
  };

  const response = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0.4,
    messages: [prompt]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return generateHeuristicReport(input);
  }

  try {
    const jsonText = extractJson(content);
    return JSON.parse(jsonText) as DailyReport;
  } catch (error) {
    return generateHeuristicReport(input, content);
  }
};

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
  if (fenced?.[1]) return fenced[1];
  return content.trim();
};

const generateHeuristicReport = (
  input: {
    timezone: string;
    runAt: string;
    projects: DamaiProject[];
    focusUpdates: Record<string, BaiduReference[]>;
  },
  rawSummary?: string
): DailyReport => {
  const total = input.projects.length;
  const byCity = new Map<string, number>();
  for (const project of input.projects) {
    const city = project.city_name || project.venue_city || "未知";
    byCity.set(city, (byCity.get(city) || 0) + 1);
  }

  const highlights = [...byCity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => `${city} ${count} 场`);

  const focusArtists = Object.entries(input.focusUpdates).map(([artist, updates]) => ({
    artist,
    updates: updates.slice(0, 3).map((item) => ({
      title: item.title,
      url: item.url,
      date: item.date,
      content: item.content
    }))
  }));

  return {
    runAt: input.runAt,
    timezone: input.timezone,
    summary:
      rawSummary ||
      `今日共汇总 ${total} 条演出项目，覆盖 ${byCity.size} 个城市。重点艺人更新共 ${Object.keys(input.focusUpdates).length} 位。`,
    highlights,
    focusArtists,
    projects: input.projects
  };
};

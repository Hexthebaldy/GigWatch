import OpenAI from "openai";
import type { DailyReport, ShowStartEvent } from "../types";
import type { AppEnv } from "../config";

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1];
  return content.trim();
};

export const generateReportWithModel = async (input: {
  timezone: string;
  runAt: string;
  events: ShowStartEvent[];
  focusArtists: Array<{ artist: string; events: ShowStartEvent[] }>;
  env: AppEnv;
  fallback: () => DailyReport;
}): Promise<DailyReport> => {
  const { env } = input;
  if (!env.openaiApiKey) return input.fallback();

  const client = new OpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是演出监控日报助手。请输出严格符合 DailyReport 结构的 JSON，不要包含多余字段。Chinese output."
    },
    {
      role: "user",
      content: `生成演出监控日报，字段：runAt, timezone, summary(3-5句), highlights(3-8条), focusArtists(每个艺人含 events 列表，事件含 title/url/city/site/showTime/price)，events(原始演出列表)。
runAt: ${input.runAt}
timezone: ${input.timezone}
Events: ${JSON.stringify(input.events)}
FocusArtists: ${JSON.stringify(
        input.focusArtists.map((f) => ({
          artist: f.artist,
          events: f.events.map((e) => ({
            title: e.title,
            url: e.url,
            city: e.cityName,
            site: e.siteName,
            showTime: e.showTime,
            price: e.price
          }))
        }))
      )}`
    }
  ];

  try {
    const completion = await client.chat.completions.create({
      model: env.openaiModel || "kimi-k2-turbo-preview",
      messages,
      temperature: 0.4
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return input.fallback();
    const json = extractJson(content);
    return JSON.parse(json) as DailyReport;
  } catch (error) {
    console.error("OpenAI report generation failed, fallback to heuristic:", error);
    return input.fallback();
  }
};

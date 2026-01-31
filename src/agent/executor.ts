import type { Database } from "bun:sqlite";
import type { AgentTask, AgentResult } from "./task";
import type { ToolRegistry } from "./tools/registry";
import { logInfo, logError, logWarn } from "../logger";
import { toIso } from "../utils";

export class AgentExecutor {
  constructor(
    private db: Database,
    private tools: ToolRegistry
  ) { }

  async execute(task: AgentTask): Promise<AgentResult> {
    logInfo(`[Agent] Starting task: ${task.id}, type: ${task.type}`);
    logInfo(`[Agent] Objective: ${task.objective}`);

    const toolExecutions: Array<{ toolName: string; parameters: any; result: any }> = []; //记录所有工具调用
    const fetchedAt = toIso(new Date()); //当前时间

    try {
      //根据任务类型分发（暂时只会有演出监控）
      if (task.type === "event_monitoring") {
        return await this.executeEventMonitoring(task, fetchedAt, toolExecutions);
      }

      return {
        taskId: task.id,
        success: false,
        summary: `Unsupported task type: ${task.type}`,
        data: {},
        error: `Task type "${task.type}" is not implemented`,
        toolExecutions
      };
    } catch (error) {
      logError(`[Agent] Task ${task.id} failed: ${String(error)}`);
      return {
        taskId: task.id,
        success: false,
        summary: `Task execution failed: ${String(error)}`,
        data: {},
        error: String(error),
        toolExecutions
      };
    }
  }

  private async executeEventMonitoring(
    task: AgentTask,
    fetchedAt: string,
    toolExecutions: Array<{ toolName: string; parameters: any; result: any }>
  ): Promise<AgentResult> {
    const { queries, focusArtists, reportWindowHours } = task.context;

    //检查是否有查询任务
    if (!Array.isArray(queries) || queries.length === 0) {
      logWarn("[Agent] No monitoring queries configured; skipping scrape.");
      return {
        taskId: task.id,
        success: true,
        summary: "No queries configured, nothing to monitor",
        data: { eventsCount: 0 },
        toolExecutions
      };
    }

    logInfo(`[Agent] Processing ${queries.length} queries`);
    let totalEvents = 0; // 统计总共抓取的演出数

    // 从工具注册表获取需要的工具
    const fetchTool = this.tools.get("fetch_showstart_events");
    const upsertTool = this.tools.get("upsert_event");
    const logSearchTool = this.tools.get("log_search");

    if (!fetchTool || !upsertTool || !logSearchTool) {
      throw new Error("Required tools not found in registry");
    }

    for (const query of queries) {
      try {
        logInfo(`[Agent] Fetching query "${query.name}"...`);

        const startTime = Date.now();
        //抓取演出
        const fetchResult = await fetchTool.execute({
          cityCode: query.cityCode,
          keyword: query.keyword,
          showStyle: query.showStyle,
          page: query.page,
          pageSize: query.pageSize,
          url: query.url
        });

        //记录工具调用
        toolExecutions.push({
          toolName: "fetch_showstart_events",
          parameters: query,
          result: fetchResult
        });

        //处理失败
        if (!fetchResult.success) {
          logError(`[Agent] Query "${query.name}" failed: ${fetchResult.error}`);
          //记录失败日志
          await logSearchTool.execute({
            queryName: query.name,
            url: query.url || "unknown",
            cityCode: query.cityCode,
            keyword: query.keyword,
            runAt: fetchedAt,
            resultsCount: 0
          });
          continue;
        }

        //处理成功的抓取
        const { events, url } = fetchResult.data;
        const sample = events.slice(0, 3).map((e: any) => e.title || "无标题").join(" | ");
        logInfo(`[Agent] Query "${query.name}" fetched ${events.length} events, sample=[${sample}]`);

        //保存所有演出到数据库
        for (const event of events) {
          const upsertResult = await upsertTool.execute({ event, fetchedAt });
          if (!upsertResult.success) {
            logError(`[Agent] Failed to upsert event ${event.id}: ${upsertResult.error}`);
          }
        }

        //记录成功的搜索日志
        await logSearchTool.execute({
          queryName: query.name,
          url,
          cityCode: query.cityCode,
          keyword: query.keyword,
          runAt: fetchedAt,
          resultsCount: events.length
        });

        totalEvents += events.length;
        logInfo(`[Agent] Query "${query.name}" completed successfully`);
      } catch (error) {
        logError(`[Agent] Query "${query.name}" encountered error: ${String(error)}`);
        toolExecutions.push({
          toolName: "fetch_showstart_events",
          parameters: query,
          result: { success: false, error: String(error) }
        });
      }
    }

    const loadEventsTool = this.tools.get("load_recent_events");
    if (!loadEventsTool) {
      throw new Error("load_recent_events tool not found");
    }

    const since = new Date(Date.now() - reportWindowHours * 60 * 60 * 1000).toISOString();
    const loadResult = await loadEventsTool.execute({ sinceIso: since });

    toolExecutions.push({
      toolName: "load_recent_events",
      parameters: { sinceIso: since },
      result: loadResult
    });

    if (!loadResult.success) {
      throw new Error(`Failed to load recent events: ${loadResult.error}`);
    }

    const recentEvents = loadResult.data.events;
    logInfo(`[Agent] Loaded ${recentEvents.length} recent events since ${since}`);

    const focusMatches = focusArtists.map((artist: string) => ({
      artist,
      events: recentEvents.filter(
        (evt: any) =>
          evt.title?.toLowerCase().includes(artist.toLowerCase()) ||
          evt.performers?.toLowerCase().includes(artist.toLowerCase())
      )
    }));

    return {
      taskId: task.id,
      success: true,
      summary: `成功抓取 ${totalEvents} 条演出信息，最近 ${reportWindowHours} 小时内共有 ${recentEvents.length} 条新演出`,
      data: {
        queriesExecuted: queries.length,
        totalEventsFetched: totalEvents,
        recentEventsCount: recentEvents.length,
        focusMatches,
        events: recentEvents
      },
      toolExecutions
    };
  }
}

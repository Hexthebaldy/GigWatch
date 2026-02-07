import type { Database } from "bun:sqlite";
import type { AgentTask, AgentResult } from "./task";
import type { ToolRegistry } from "./tools/registry";
import type { AppEnv } from "../config";
import { logInfo, logError, logWarn } from "../utils/logger";
import { toIso } from "../utils/datetime";
import OpenAI from "openai";
import { resolveModelTemperature } from "../clients/modelTemperature";

export class AgentExecutor {
  private llmClient?: OpenAI;
  private llmModel?: string;
  private llmTemperature = 1;

  constructor(
    private db: Database,
    private tools: ToolRegistry,
    private env?: AppEnv
  ) {
    // Initialize LLM client if API key is available
    if (env?.openaiApiKey) {
      this.llmClient = new OpenAI({
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl
      });
      this.llmModel = env.openaiModel || "kimi-k2-turbo-preview";
      this.llmTemperature = resolveModelTemperature(this.llmModel, env.openaiTemperature, 1);
    }
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    logInfo(`[Agent] Starting task: ${task.id}, type: ${task.type}`);
    logInfo(`[Agent] Objective: ${task.objective}`);

    const toolExecutions: Array<{ toolName: string; parameters: any; result: any }> = []; //记录所有工具调用
    const fetchedAt = toIso(new Date()); //当前时间

    try {
      // Use LLM-driven execution if available, otherwise fall back to rule-based
      if (this.llmClient && task.type === "event_monitoring") {
        logInfo("[Agent] Using LLM-driven execution");
        return await this.executeWithLLM(task, fetchedAt, toolExecutions);
      }

      //根据任务类型分发（rule-based fallback）
      if (task.type === "event_monitoring") {
        logWarn("[Agent] LLM not available, using rule-based execution");
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

  /**
   * LLM-driven execution (Phase 2)
   * Agent autonomously decides which tools to call and when to notify
   */
  private async executeWithLLM(
    task: AgentTask,
    fetchedAt: string,
    toolExecutions: Array<{ toolName: string; parameters: any; result: any }>
  ): Promise<AgentResult> {
    if (!this.llmClient || !this.llmModel) {
      throw new Error("LLM client not initialized");
    }

    const { queries, focusArtists, reportWindowHours } = task.context;

    // Build system prompt for autonomous agent
    const systemPrompt = `你是一个演出监控 Agent。你的任务是：
1. 执行演出抓取查询
2. 分析结果，判断是否有值得通知用户的演出
3. 如果有重要演出，使用 Telegram 发送通知

**通知策略：**
- 【紧急】关注艺人有演出 → 立即发送 Telegram（priority: urgent）
- 【普通】新演出匹配流派+城市或关键词 → 发送摘要（priority: normal）
- 【静默】无相关演出 → 不发送通知

**工作内容：**
1. 使用 fetch_showstart_events 抓取每个查询的演出
2. 使用 upsert_event 保存演出到数据库
3. 使用 log_search 记录搜索日志
4. 使用 load_recent_events 加载最近时间窗口内的演出
5. 分析演出，判断是否匹配关注艺人或监控维度
6. 如果有重要演出，使用 send_telegram 发送通知
7. 返回最终摘要

当前时间：${fetchedAt}
关注艺人：${focusArtists.join("、")}
时间窗口：最近 ${reportWindowHours} 小时
可使用 web_search 获取外部信息，不限制使用时机。

请开始执行任务。`;

    const userPrompt = `请执行以下监控任务：
${task.objective}

需要执行的查询：
${queries.map((q: any, i: number) => `${i + 1}. ${q.name}: ${JSON.stringify(q)}`).join("\n")}

请按照工作流程执行，并根据结果决定是否发送 Telegram 通知。`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const availableTools = this.tools.toFunctionSchemas();
    let continueLoop = true;
    let iterationCount = 0;
    const maxIterations = 50; // Prevent infinite loops

    logInfo(`[Agent] Starting LLM-driven execution with ${availableTools.length} tools`);

    while (continueLoop && iterationCount < maxIterations) {
      iterationCount++;
      logInfo(`[Agent] LLM iteration ${iterationCount}`);

      try {
        const response = await this.llmClient.chat.completions.create({
          model: this.llmModel,
          messages,
          tools: availableTools,
          tool_choice: "auto",
          temperature: this.llmTemperature
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new Error("No response from LLM");
        }

        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        // Check if LLM wants to call tools
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          logInfo(`[Agent] LLM requested ${assistantMessage.tool_calls.length} tool calls`);

          // Execute all tool calls
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            logInfo(`[Agent] Executing tool: ${toolName}`);
            logInfo(`[Agent] Parameters: ${JSON.stringify(toolArgs)}`);

            const tool = this.tools.get(toolName);
            if (!tool) {
              const errorMsg = `Tool "${toolName}" not found`;
              logError(`[Agent] ${errorMsg}`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: errorMsg })
              });
              continue;
            }

            try {
              const result = await tool.execute(toolArgs);
              toolExecutions.push({ toolName, parameters: toolArgs, result });

              logInfo(`[Agent] Tool ${toolName} result: ${result.success ? "success" : "failed"}`);

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
              });
            } catch (error) {
              const errorResult = { success: false, error: String(error) };
              toolExecutions.push({ toolName, parameters: toolArgs, result: errorResult });

              logError(`[Agent] Tool ${toolName} error: ${String(error)}`);

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(errorResult)
              });
            }
          }
        } else {
          // LLM finished, no more tool calls
          continueLoop = false;
          const finalMessage = assistantMessage.content || "任务完成";
          logInfo(`[Agent] LLM finished: ${finalMessage}`);

          // Extract data from tool executions
          const loadEventsExecution = toolExecutions.find((ex) => ex.toolName === "load_recent_events");
          const recentEvents = loadEventsExecution?.result?.success
            ? loadEventsExecution.result.data.events
            : [];

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
            summary: finalMessage,
            data: {
              queriesExecuted: queries.length,
              totalEventsFetched: toolExecutions.filter((ex) => ex.toolName === "fetch_showstart_events" && ex.result.success).length,
              recentEventsCount: recentEvents.length,
              focusMatches,
              events: recentEvents,
              llmIterations: iterationCount
            },
            toolExecutions
          };
        }
      } catch (error) {
        logError(`[Agent] LLM iteration ${iterationCount} failed: ${String(error)}`);
        throw error;
      }
    }

    if (iterationCount >= maxIterations) {
      logWarn(`[Agent] Reached max iterations (${maxIterations}), stopping`);
    }

    return {
      taskId: task.id,
      success: true,
      summary: `Agent completed after ${iterationCount} iterations`,
      data: { llmIterations: iterationCount },
      toolExecutions
    };
  }
}

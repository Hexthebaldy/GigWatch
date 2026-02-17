import type { Database } from "bun:sqlite";
import { toIso } from "../../utils/datetime";
import type { AgentRun, AgentStep, ChatRole, ContextSummary, StoredChatMessage } from "./types";

type ChatMessageInsert = {
  role: ChatRole;
  content: string;
  source: string;
  externalChatId?: string;
  externalUserId?: string;
  visible?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

const parseJson = <T>(input: string | null | undefined, fallback: T): T => {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
};

export class ChatRepository {
  // 绑定 sqlite 连接，统一处理聊天与上下文相关的持久化操作。
  constructor(private db: Database) {}

  // 写入一条聊天消息并返回标准化后的存储结果。
  insertMessage(input: ChatMessageInsert): StoredChatMessage {
    const createdAt = input.createdAt || toIso(new Date());
    const visible = input.visible === false ? 0 : 1;
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (
        role,
        content,
        source,
        external_chat_id,
        external_user_id,
        visible,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.role,
      input.content,
      input.source,
      input.externalChatId || null,
      input.externalUserId || null,
      visible,
      metadataJson,
      createdAt
    );
    return {
      id: Number(result.lastInsertRowid),
      role: input.role,
      content: input.content,
      source: input.source,
      externalChatId: input.externalChatId,
      externalUserId: input.externalUserId,
      visible: visible === 1,
      metadata: input.metadata,
      createdAt
    };
  }

  // 读取不大于指定消息 ID 的可见消息（含该 ID），用于构造稳定的上下文快照。
  listVisibleMessagesBeforeOrAt(maxMessageId: number, limit = 200): StoredChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        role,
        content,
        source,
        external_chat_id,
        external_user_id,
        visible,
        metadata_json,
        created_at
      FROM chat_messages
      WHERE visible = 1 AND id <= ?
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(maxMessageId, limit) as Array<{
      id: number;
      role: ChatRole;
      content: string;
      source: string;
      external_chat_id?: string;
      external_user_id?: string;
      visible: number;
      metadata_json?: string;
      created_at: string;
    }>;
    return rows
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        source: row.source,
        externalChatId: row.external_chat_id,
        externalUserId: row.external_user_id,
        visible: row.visible === 1,
        metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
        createdAt: row.created_at
      }))
      .sort((a, b) => a.id - b.id);
  }

  // 读取最新的可见消息，主要给前端历史列表展示使用。
  listVisibleLatest(limit = 200): StoredChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        role,
        content,
        source,
        external_chat_id,
        external_user_id,
        visible,
        metadata_json,
        created_at
      FROM chat_messages
      WHERE visible = 1
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: number;
      role: ChatRole;
      content: string;
      source: string;
      external_chat_id?: string;
      external_user_id?: string;
      visible: number;
      metadata_json?: string;
      created_at: string;
    }>;
    return rows
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        source: row.source,
        externalChatId: row.external_chat_id,
        externalUserId: row.external_user_id,
        visible: row.visible === 1,
        metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
        createdAt: row.created_at
      }))
      .sort((a, b) => a.id - b.id);
  }

  // 按游标读取后续可见消息，主要用于摘要压缩流程。
  listVisibleMessagesAfter(minMessageId: number, limit = 500): StoredChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        role,
        content,
        source,
        external_chat_id,
        external_user_id,
        visible,
        metadata_json,
        created_at
      FROM chat_messages
      WHERE visible = 1 AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `);
    const rows = stmt.all(minMessageId, limit) as Array<{
      id: number;
      role: ChatRole;
      content: string;
      source: string;
      external_chat_id?: string;
      external_user_id?: string;
      visible: number;
      metadata_json?: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      source: row.source,
      externalChatId: row.external_chat_id,
      externalUserId: row.external_user_id,
      visible: row.visible === 1,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  // 按 scope 读取上下文摘要；若不存在则初始化一条空摘要记录。
  getSummary(scope = "global"): ContextSummary {
    const stmt = this.db.prepare(`
      SELECT scope, until_message_id, summary_text, updated_at
      FROM chat_context_summaries
      WHERE scope = ?
      LIMIT 1
    `);
    const row = stmt.get(scope) as
      | {
          scope: string;
          until_message_id: number;
          summary_text: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      const now = toIso(new Date());
      const insertStmt = this.db.prepare(`
        INSERT INTO chat_context_summaries (scope, until_message_id, summary_text, updated_at)
        VALUES (?, 0, '', ?)
      `);
      insertStmt.run(scope, now);
      return {
        scope,
        untilMessageId: 0,
        summaryText: "",
        updatedAt: now
      };
    }
    return {
      scope: row.scope,
      untilMessageId: row.until_message_id,
      summaryText: row.summary_text,
      updatedAt: row.updated_at
    };
  }

  // 更新或插入摘要与游标，供后续对话复用压缩后的长期记忆。
  upsertSummary(scope: string, untilMessageId: number, summaryText: string): ContextSummary {
    const updatedAt = toIso(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO chat_context_summaries (scope, until_message_id, summary_text, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        until_message_id = excluded.until_message_id,
        summary_text = excluded.summary_text,
        updated_at = excluded.updated_at
    `);
    stmt.run(scope, untilMessageId, summaryText, updatedAt);
    return {
      scope,
      untilMessageId,
      summaryText,
      updatedAt
    };
  }

  // 创建一条 agent 运行记录，初始状态为 running。
  startAgentRun(input: {
    triggerMessageId?: number;
    source: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }): AgentRun {
    const startedAt = toIso(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (
        trigger_message_id,
        source,
        status,
        model,
        started_at,
        metadata_json
      ) VALUES (?, ?, 'running', ?, ?, ?)
    `);
    const result = stmt.run(
      input.triggerMessageId || null,
      input.source,
      input.model || null,
      startedAt,
      input.metadata ? JSON.stringify(input.metadata) : null
    );
    return {
      id: Number(result.lastInsertRowid),
      triggerMessageId: input.triggerMessageId,
      source: input.source,
      status: "running",
      model: input.model,
      startedAt,
      metadata: input.metadata
    };
  }

  // 将运行状态标记为 success/failed，并记录结束时间。
  finishAgentRun(runId: number, status: "success" | "failed", error?: string) {
    const finishedAt = toIso(new Date());
    const stmt = this.db.prepare(`
      UPDATE agent_runs
      SET status = ?, error = ?, finished_at = ?
      WHERE id = ?
    `);
    stmt.run(status, error || null, finishedAt, runId);
  }

  // 在指定 run 下追加一步执行轨迹（assistant/tool/error）。
  insertAgentStep(runId: number, stepIndex: number, step: AgentStep) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_run_steps (
        run_id,
        step_index,
        step_type,
        tool_name,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      runId,
      stepIndex,
      step.stepType,
      step.toolName || null,
      JSON.stringify(step.payload),
      toIso(new Date())
    );
  }
}

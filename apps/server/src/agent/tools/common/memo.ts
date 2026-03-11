import type { Database } from "bun:sqlite";
import { MemoRepository } from "../../../memo/memoRepository";
import type { Tool } from "../base";

type MemoOperation = "add" | "remove";

export const createEditMemoTool = (db: Database): Tool => {
  const repository = new MemoRepository(db);

  return {
    name: "edit_memo",
    description: "编辑备忘录事项。用于新增/删除单条备忘记录",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation type: add or remove",
          enum: ["add", "remove"]
        },
        content: {
          type: "string",
          description: "备忘录内容，按完整内容新增或移除"
        }
      },
      required: ["operation", "content"]
    },
    execute: async ({ operation, content }: { operation: MemoOperation; content: string }) => {
      try {
        const normalized = typeof content === "string" ? content.trim() : "";
        if (!normalized) {
          return {
            success: false,
            error: "Memo content cannot be empty"
          };
        }

        if (operation === "add") {
          const result = repository.add(normalized);
          return {
            success: true,
            data: {
              operation,
              status: result.created ? "created" : "already_exists",
              memo: result.memo
            }
          };
        }

        if (operation === "remove") {
          const result = repository.remove(normalized);
          return {
            success: true,
            data: {
              operation,
              status: result.removed ? "removed" : "not_found",
              memo: result.memo,
              content: normalized
            }
          };
        }

        return {
          success: false,
          error: `Unsupported memo operation: ${String(operation)}`
        };
      } catch (error) {
        return {
          success: false,
          error: String(error)
        };
      }
    }
  };
};

export const createListMemosTool = (db: Database): Tool => {
  const repository = new MemoRepository(db);

  return {
    name: "list_memos",
    description: "读取当前备忘录列表。可用于确认已记录事项、检查是否已存在某条备忘录，或先读取再决定是否新增/删除。",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "可选。按关键字过滤备忘录内容"
        },
        limit: {
          type: "number",
          description: "可选。返回条数上限，默认 50，最大 200"
        }
      }
    },
    execute: async ({ keyword, limit }: { keyword?: string; limit?: number }) => {
      try {
        const normalizedKeyword = typeof keyword === "string" ? keyword.trim() : "";
        const normalizedLimit = Math.min(Math.max(Math.floor(limit || 50), 1), 200);
        const allMemos = repository.listAll();
        const filtered = normalizedKeyword
          ? allMemos.filter((memo) => memo.content.includes(normalizedKeyword))
          : allMemos;
        const memos = filtered.slice(0, normalizedLimit);

        return {
          success: true,
          data: {
            memos,
            count: memos.length,
            total: filtered.length,
            keyword: normalizedKeyword || undefined
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
};

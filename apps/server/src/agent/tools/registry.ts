import { jsonSchema, type Tool as VercelTool } from "ai";
import type { Tool } from "./base";
import { compactToolResult } from "./compactResult";

type AnyVercelTool = VercelTool<any, any>;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // 转换为 Vercel AI SDK 的 tool 格式
  toVercelTools(): Record<string, AnyVercelTool> {
    const result: Record<string, AnyVercelTool> = {};
    for (const t of this.getAll()) {
      result[t.name] = {
        description: t.description,
        inputSchema: jsonSchema(t.parameters),
        execute: async (args: any) => {
          const raw = await t.execute(args);
          return compactToolResult(raw);
        },
      };
    }
    return result;
  }
}

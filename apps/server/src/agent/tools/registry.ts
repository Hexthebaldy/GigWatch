import type { Tool } from "./base";

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

  //把Tool对象转换为LLM API要求的格式
  toFunctionSchemas(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    return this.getAll().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}

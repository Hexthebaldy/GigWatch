export type JSONSchemaType = "string" | "number" | "boolean" | "object" | "array";

export interface JSONSchemaProperty {
  type: JSONSchemaType;
  description?: string;
  enum?: any[];
  default?: any;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any) => Promise<any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  executedAt: string;
  durationMs: number;
}

export interface ToolExecution {
  toolName: string;
  parameters: any;
  result: ToolResult;
}

import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Tool } from "../base";

const ALLOWED_ROOTS = [
  "/Users/yangwenhao11/personal_dev_space/GigWatch/config",
  "/Users/yangwenhao11/personal_dev_space/GigWatch/src/dictionary",
  "/Users/yangwenhao11/personal_dev_space/GigWatch/data"
];

const isAllowedPath = (filePath: string) => {
  const resolved = resolve(filePath);
  return ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + sep));
};

export const createReadFileTool = (): Tool => ({
  name: "read_file",
  description: "读取指定文件内容（仅允许访问白名单目录）。",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "要读取的文件路径（必须在允许的目录内）"
      },
      maxBytes: {
        type: "number",
        description: "最大读取字节数，默认 200000",
        default: 200000
      }
    },
    required: ["path"]
  },
  execute: async ({ path, maxBytes }: { path: string; maxBytes?: number }) => {
    try {
      if (!isAllowedPath(path)) {
        return { success: false, error: "Path not allowed" };
      }
      const stat = statSync(path);
      if (!stat.isFile()) {
        return { success: false, error: "Path is not a file" };
      }
      const limit = typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : 200000;
      if (stat.size > limit) {
        return { success: false, error: `File too large (${stat.size} bytes)` };
      }
      const content = readFileSync(path, "utf-8");
      return { success: true, data: { path, size: stat.size, content } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

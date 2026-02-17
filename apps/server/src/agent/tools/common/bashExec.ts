import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { Tool } from "../base";

/**
 * bash_exec 工具简介
 *
 * 作用：
 * - 让 Agent 在 当前项目工作目录 内执行受限命令，完成检索、查看、统计等本地操作。
 *
 * 设计边界：
 * - 仅支持 `command + args`（不支持 shell 脚本拼接）；
 * - 仅允许系统原生命令白名单，避免依赖额外安装的第三方 CLI；
 * - 执行目录固定为 `process.cwd()`；
 * - 对路径型参数做工作区边界检查，禁止越界访问；
 * - 对高风险命令做黑名单拦截；
 * - 对执行时长与输出大小做上限控制，避免卡死和上下文膨胀。
 *
 * 目标：
 * - 在保留可用性的前提下，把命令执行能力限制在可审计、可控的安全范围内。
 */

// 执行时间限制：默认 15s，最长 60s，防止命令长时间挂起占用 worker。
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

// 输出限制：避免一次命令返回超大内容把上下文撑爆了。
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;
const MAX_OUTPUT_CHARS = 20_000;

// 高风险命令黑名单：
// 1) 可启动二级解释器并绕过参数约束（bash/node/python）
// 2) 可能触发远程访问或提权（ssh/sudo）
// 3) 可能进行大范围文件同步或覆盖（rsync/scp）
const BLOCKED_COMMANDS = new Set([
  "bash",
  "sh",
  "zsh",
  "fish",
  "python",
  "python3",
  "node",
  "bun",
  "perl",
  "ruby",
  "pwsh",
  "powershell",
  "sudo",
  "ssh",
  "scp",
  "rsync"
]);

// 只允许常见 Unix/macOS 原生命令，避免模型随意依赖额外安装的工具（如 rg/jq 等）。
const NATIVE_UNIX_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "cp",
  "cut",
  "date",
  "dirname",
  "echo",
  "env",
  "find",
  "git",
  "grep",
  "head",
  "id",
  "ls",
  "mkdir",
  "mv",
  "paste",
  "pwd",
  "realpath",
  "rm",
  "sed",
  "sort",
  "stat",
  "tail",
  "touch",
  "tr",
  "uname",
  "uniq",
  "wc",
  "whoami",
  "xargs"
]);

// 禁止参数中出现控制字符，防止注入换行等非常规输入。
const CONTROL_CHAR_REGEX = /[\r\n\t\0]/;
// 命令名仅允许安全字符，避免通过分号、空格等拼接额外命令。
const COMMAND_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

// 粗粒度识别“看起来像路径”的参数，后续做工作区边界校验。
const isPathLikeArg = (arg: string) => {
  if (!arg || arg.startsWith("-")) return false;
  if (arg === "." || arg === "..") return true;
  return arg.includes("/") || arg.startsWith(".");
};

// 校验路径是否落在 root 内：
// - 拒绝绝对路径
// - 用 resolve + relative 规避 ../ 穿越
const isInsideRoot = (root: string, inputPath: string) => {
  if (!inputPath) return true;
  if (isAbsolute(inputPath)) return false;
  const abs = resolve(root, inputPath);
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// 归一化超时参数，避免过小/过大值导致行为异常。
const sanitizeTimeout = (input: unknown) => {
  const n = typeof input === "number" && Number.isFinite(input) ? Math.floor(input) : DEFAULT_TIMEOUT_MS;
  return Math.max(500, Math.min(MAX_TIMEOUT_MS, n));
};

// 归一化输出上限，控制返回负载大小。
const sanitizeMaxOutput = (input: unknown) => {
  const n = typeof input === "number" && Number.isFinite(input) ? Math.floor(input) : DEFAULT_MAX_OUTPUT_CHARS;
  return Math.max(500, Math.min(MAX_OUTPUT_CHARS, n));
};

// 按字符上限拼接流式输出，超限时打 truncated 标记而不是抛错。
const appendLimited = (base: string, chunk: string, limit: number) => {
  if (base.length >= limit) return { value: base, truncated: true };
  const next = base + chunk;
  if (next.length <= limit) return { value: next, truncated: false };
  return { value: next.slice(0, limit), truncated: true };
};

export const bashExecTool: Tool = {
  name: "bash_exec",
  description: "在当前项目目录内执行受限命令（仅支持 command + args，不支持 shell 脚本）。",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的命令名（仅限系统原生命令），例如 find、grep、ls、cat"
      },
      args: {
        type: "array",
        description: "命令参数数组，例如 [\"-n\", \"TODO\", \"src\"]",
        items: {
          type: "string"
        }
      },
      timeoutMs: {
        type: "number",
        description: "超时时间（毫秒），默认 15000，最大 60000",
        default: DEFAULT_TIMEOUT_MS
      },
      maxOutputChars: {
        type: "number",
        description: "stdout/stderr 最大返回字符数，默认 8000，最大 20000",
        default: DEFAULT_MAX_OUTPUT_CHARS
      }
    },
    required: ["command"]
  },
  execute: async ({
    command,
    args,
    timeoutMs,
    maxOutputChars
  }: {
    command?: string;
    args?: unknown;
    timeoutMs?: number;
    maxOutputChars?: number;
  }) => {
    try {
      // 1) 基础命令校验（必填、格式、黑名单）
      const cmd = (command || "").trim();
      if (!cmd) return { success: false, error: "command is required" };
      if (!COMMAND_NAME_REGEX.test(cmd)) {
        return { success: false, error: "invalid command name" };
      }
      if (BLOCKED_COMMANDS.has(cmd)) {
        return { success: false, error: `command "${cmd}" is blocked` };
      }
      if (!NATIVE_UNIX_COMMANDS.has(cmd)) {
        return {
          success: false,
          error:
            `command "${cmd}" is not allowed. Only native macOS commands are supported by bash_exec.`
        };
      }

      // 2) 参数标准化 + 控制字符检查
      const argv = Array.isArray(args) ? args.map((item) => String(item)) : [];
      for (const arg of argv) {
        if (CONTROL_CHAR_REGEX.test(arg)) {
          return { success: false, error: "args contain control characters" };
        }
      }

      // 3) 路径边界检查：只允许访问当前工作区目录
      const root = process.cwd();
      for (const arg of argv) {
        if (!isPathLikeArg(arg)) continue;
        if (!isInsideRoot(root, arg)) {
          return { success: false, error: `path arg is outside workspace: ${arg}` };
        }
      }

      // 4) 执行参数收敛（超时、输出上限）
      const timeout = sanitizeTimeout(timeoutMs);
      const outputLimit = sanitizeMaxOutput(maxOutputChars);

      // 5) 使用 spawn 直接执行 command + args，不经过 shell，降低注入面。
      const child = spawn(cmd, argv, {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;

      // 6) 流式采集 stdout/stderr，并按上限截断。
      child.stdout.on("data", (buf) => {
        const next = appendLimited(stdout, buf.toString("utf-8"), outputLimit);
        stdout = next.value;
        stdoutTruncated = stdoutTruncated || next.truncated;
      });
      child.stderr.on("data", (buf) => {
        const next = appendLimited(stderr, buf.toString("utf-8"), outputLimit);
        stderr = next.value;
        stderrTruncated = stderrTruncated || next.truncated;
      });

      // 7) 超时兜底：到时强制 kill，防止命令卡死。
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeout);

      // 8) 等待子进程结束，并把「正常结束」与「启动失败」统一收敛为一个结果对象。
      //    这里必须同时监听 close + error：
      //    - close: 进程已启动并结束，返回退出码 code（可能为 0 / 非 0 / null）
      //    - error: 进程启动阶段失败（例如命令不存在 ENOENT、无执行权限 EACCES）
      //    如果只等 close，不监听 error，某些场景会抛未处理错误并影响主进程稳定性。
      const { exitCode, spawnError } = await new Promise<{ exitCode: number | null; spawnError?: string }>(
        (resolveResult) => {
          // 防重入保护：error 和 close 在边界情况下可能先后触发，只允许 resolve 一次。
          let settled = false;
          const finalize = (result: { exitCode: number | null; spawnError?: string }) => {
            if (settled) return;
            settled = true;
            resolveResult(result);
          };

          // 启动失败分支：将异常转成字符串写入 spawnError，exitCode 置为 null。
          child.once("error", (error) => {
            const message = error instanceof Error ? error.message : String(error);
            finalize({ exitCode: null, spawnError: message });
          });

          // 正常结束分支：记录进程退出码。即使 code 为 null，也由上层统一处理。
          child.once("close", (code) => finalize({ exitCode: code }));
        }
      ).finally(() => clearTimeout(timeoutHandle)); // 无论成功/失败都清理超时定时器，避免泄漏。

      // 9) 超时和正常结束分别返回结构化结果，便于上层决策与日志审计。
      if (timedOut) {
        return {
          success: false,
          error: `command timed out after ${timeout}ms`,
          data: {
            command: cmd,
            args: argv,
            cwd: root,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated
          }
        };
      }

      if (spawnError) {
        return {
          success: false,
          error: `failed to start command: ${spawnError}`,
          data: {
            command: cmd,
            args: argv,
            cwd: root,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated
          }
        };
      }

      return {
        success: exitCode === 0,
        error: exitCode === 0 ? undefined : `command exited with code ${String(exitCode)}`,
        data: {
          command: cmd,
          args: argv,
          cwd: root,
          exitCode,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated
        }
      };
    } catch (error) {
      // 捕获执行期异常，保证工具层不会抛未处理异常给 Agent runtime。
      return { success: false, error: String(error) };
    }
  }
};

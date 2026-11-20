// plugin-fs-search：glob / grep 工具件（interfaces.md §fs / D-065）。
// 纯适配器：能力与守卫全部在 fs 服务（D-049）；grep 为 JS 引擎（零外部二进制，
// rg 加速挂账）。工具 md 见本包 tools/。

import path from "node:path";
import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type FsGate,
  type FsGrepOptions,
  type FsGrepResult,
  type ToolDefinition,
} from "@henira/protocol";

function gateFor(
  ctx: Parameters<ToolDefinition["execute"]>[1],
  tool: string,
  args: unknown,
): FsGate {
  return {
    tool,
    args,
    signal: ctx.signal,
    requestPermission: ctx.requestPermission,
  };
}

/** 区内文件显示相对路径（省 token），区外保留绝对路径 */
function displayPath(cwd: string, file: string): string {
  const rel = path.relative(cwd, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return file;
  return rel;
}

/** grep 三模式渲染——截断注记判据分开：files 模式按文件数（totalFiles），
 *  count / content 按命中行数（totalSeen）；单测在 index.test.ts */
export function formatGrepResult(
  r: FsGrepResult,
  opts: FsGrepOptions,
  display: (file: string) => string = (f) => f,
): string {
  if (r.totalSeen === 0) return "No matches found";
  const mode = opts.outputMode ?? "files_with_matches";
  const headLimit = opts.headLimit ?? 250;
  const filesLabel = (n: number): string => (n === 1 ? "1 file" : `${n} files`);
  if (mode === "files_with_matches") {
    const files = r.files ?? [];
    const totalFiles = r.totalFiles ?? files.length;
    const out = `Found ${filesLabel(files.length)}\n${files.map(display).join("\n")}`;
    if (totalFiles > files.length) {
      return `${out}\n(Truncated at head_limit=${headLimit}; ${totalFiles} matching files in total. Raise head_limit or refine the pattern.)`;
    }
    return out;
  }
  if (mode === "count") {
    const counts = r.counts ?? [];
    const rows = counts.map((c) => `${display(c.file)}:${c.count}`);
    const total = counts.reduce((s, c) => s + c.count, 0);
    const lines = total === 1 ? "line" : "lines";
    const out = `${rows.join("\n")}\nFound ${total} total matching ${lines} across ${filesLabel(counts.length)}.`;
    if (r.totalSeen > total) {
      return `${out}\n(Truncated at head_limit=${headLimit}; ${r.totalSeen} matching lines seen in total.)`;
    }
    return out;
  }
  // 行号（-n，默认开）与命中/上下文区分：上下文行（match:false）用 `-` 分隔（rg 同形
  // file:12:hit / file-13-context）
  const lineNumbers = opts.lineNumbers !== false;
  const out = r.matches
    .map((m) => {
      const sep = m.match === false ? "-" : ":";
      return lineNumbers
        ? `${display(m.file)}${sep}${m.line}${sep}${m.text}`
        : `${display(m.file)}${sep}${m.text}`;
    })
    .join("\n");
  if (r.totalSeen > r.matches.length) {
    return `${out}\n(Truncated at head_limit=${headLimit}; ${r.totalSeen} matching lines seen in total. Refine the pattern or raise head_limit.)`;
  }
  return out;
}

/** 官方 glob/grep 工具件（不占槽位；inject tools + fs——D-049 工具件形状） */
export function fsSearchPlugin(): ServiceDefinition {
  return {
    inject: ["tools", "fs"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      const fs = cx.get("fs");
      const tools = cx.get("tools");
      const cwd = cx.get("config").cwd;

      const glob: ToolDefinition = {
        description:
          "Find files by glob pattern (supports **, *, ?, {a,b}). Returns absolute paths sorted by " +
          "modification time (newest first), capped at 100 results. .git/.hg/.svn/node_modules are skipped. " +
          "Paths outside the session workspace require approval.",
        name: "glob",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: 'Glob pattern, e.g. "src/**/*.ts"' },
            path: {
              type: "string",
              description:
                "Base directory (absolute, or relative to the session cwd; default = session cwd)",
            },
          },
          required: ["pattern"],
        },
        isConcurrencySafe: true,
        execute: async (args, ctx) => {
          const r = await fs.glob(String(args.pattern), gateFor(ctx, "glob", args), {
            path: typeof args.path === "string" ? args.path : undefined,
          });
          const shown = r.files.map((f) => displayPath(cwd, f));
          if (r.files.length === 0) {
            return { content: "No files found", __meta: { kind: "glob", files: [], total: 0 } };
          }
          let out = shown.join("\n");
          if (r.total > r.files.length) {
            out += `\n(Results are truncated: showing ${r.files.length} of ${r.total}. Consider using a more specific path or pattern.)`;
          }
          // 带外元数据：路径数组供搜索卡分组渲染（显示路径与 content 同源）
          return { content: out, __meta: { kind: "glob", files: shown, total: r.total } };
        },
      };

      const grep: ToolDefinition = {
        description:
          "Search file contents with a regular expression (JavaScript regex, line-based). " +
          "output_mode: files_with_matches (default) lists files newest-first; content prints path:line:text " +
          "with optional context lines (-A/-B/-C); count prints path:count per file. Binary files and " +
          "files over 10MB are skipped; .git/.hg/.svn/node_modules are skipped. " +
          "Paths outside the session workspace require approval.",
        name: "grep",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regular expression" },
            path: {
              type: "string",
              description: "Base directory or a single file (default = session cwd)",
            },
            glob: { type: "string", description: 'Filename filter, e.g. "*.ts"' },
            output_mode: {
              type: "string",
              enum: ["content", "files_with_matches", "count"],
              description: "Default files_with_matches",
            },
            "-i": { type: "boolean", description: "Case-insensitive (default false)" },
            "-n": { type: "boolean", description: "Line numbers in content mode (default true)" },
            "-A": { type: "integer", description: "Lines of context after (content mode, 0-10)" },
            "-B": { type: "integer", description: "Lines of context before (content mode, 0-10)" },
            "-C": {
              type: "integer",
              description: "Lines of context both sides (content mode, 0-10)",
            },
            head_limit: { type: "integer", description: "Max results (default 250)" },
          },
          required: ["pattern"],
        },
        isConcurrencySafe: true,
        execute: async (args, ctx) => {
          const a = args as Record<string, unknown>;
          // -A/-B/-C 归并为对称 context（服务 v1 只收对称窗口；不对称挂账）
          const context = Math.max(
            typeof a["-C"] === "number" ? a["-C"] : 0,
            typeof a["-B"] === "number" ? a["-B"] : 0,
            typeof a["-A"] === "number" ? a["-A"] : 0,
          );
          const opts: FsGrepOptions = {
            path: typeof a.path === "string" ? a.path : undefined,
            include: typeof a.glob === "string" ? a.glob : undefined,
            outputMode:
              a.output_mode === "content" || a.output_mode === "count"
                ? a.output_mode
                : "files_with_matches",
            ignoreCase: a["-i"] === true,
            lineNumbers: a["-n"] !== false,
            context,
            headLimit: typeof a.head_limit === "number" ? a.head_limit : undefined,
          };
          const r = await fs.grep(String(a.pattern), gateFor(ctx, "grep", args), opts);
          const show = (f: string): string => displayPath(cwd, f);
          // 带外元数据：结构化 matches 供搜索卡按文件分组（显示路径与 content 同源；
          // totalSeen/totalFiles/headLimit 供截断注记）
          return {
            content: formatGrepResult(r, opts, show),
            __meta: {
              kind: "grep",
              mode: opts.outputMode ?? "files_with_matches",
              matches: r.matches.map((m) => ({ ...m, file: show(m.file) })),
              ...(r.files !== undefined ? { files: r.files.map(show) } : {}),
              ...(r.counts !== undefined
                ? { counts: r.counts.map((c) => ({ ...c, file: show(c.file) })) }
                : {}),
              totalSeen: r.totalSeen,
              ...(r.totalFiles !== undefined ? { totalFiles: r.totalFiles } : {}),
              headLimit: opts.headLimit ?? 250,
            },
          };
        },
      };

      tools.register(glob);
      tools.register(grep);
    },
  };
}

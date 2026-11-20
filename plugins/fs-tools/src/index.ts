// plugin-fs-tools：read / write / edit 工具件（interfaces.md §fs / D-065）。
// 纯适配器：能力与守卫全部在 fs 服务（D-049），本件只做 ToolDefinition 形状与结果格式化；
// 不自带任何文件实现。工具 md 见本包 tools/。

import type { ServiceDefinition } from "@henira/kernel";
import { asHeniraContext, type FsGate, type ToolDefinition } from "@henira/protocol";

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

/** read：`N\t` 行号（cat -n），尾注带续读提示（D-065 决定 2） */
export function formatRead(args: {
  path: string;
  result: {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncatedByBytes?: boolean;
  };
}): string {
  const { path: p, result } = args;
  if (result.totalLines === 0) return `(${p} — empty file)`;
  const lines = result.content.split("\n").map((text, i) => `${result.startLine + i}\t${text}`);
  let out = lines.join("\n");
  if (result.truncatedByBytes === true) {
    out += `\n(Output capped. Showing lines ${result.startLine}-${result.endLine}. Use offset=${result.endLine + 1} to continue.)`;
  } else if (result.endLine < result.totalLines) {
    out += `\n(Showing lines ${result.startLine}-${result.endLine} of ${result.totalLines}. Use offset=${result.endLine + 1} to continue.)`;
  } else {
    out += `\n(End of file — total ${result.totalLines} lines)`;
  }
  return out;
}

/** 官方 read/write/edit 工具件（不占槽位；inject tools + fs——D-049 工具件形状） */
export function fsToolsPlugin(): ServiceDefinition {
  return {
    inject: ["tools", "fs"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      const fs = cx.get("fs");
      const tools = cx.get("tools");

      const read: ToolDefinition = {
        description:
          "Read a text file with line numbers. Returns up to 2000 lines (50KB) starting at offset; " +
          "the footer says how to continue with offset. Binary files are rejected. " +
          "Paths resolve against the session cwd; paths outside the session workspace require approval.",
        name: "read",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "File path (absolute, or relative to the session cwd)",
            },
            offset: { type: "integer", description: "1-based start line (default 1)" },
            limit: { type: "integer", description: "Lines to read (default 2000, cap 2000)" },
          },
          required: ["file_path"],
        },
        isConcurrencySafe: true,
        execute: async (args, ctx) => {
          const filePath = String(args.file_path);
          const result = await fs.read(filePath, gateFor(ctx, "read", args), {
            offset: typeof args.offset === "number" ? args.offset : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          });
          const absolute = fs.resolve(filePath).absolute;
          // 带外元数据：分页事实供读取卡行窗渲染（行号本身在 content 的 `N\t` 格式里，UI 拆 gutter）
          return {
            content: formatRead({ path: absolute, result }),
            __meta: {
              kind: "read",
              path: absolute,
              startLine: result.startLine,
              endLine: result.endLine,
              totalLines: result.totalLines,
              ...(result.truncatedByBytes !== undefined
                ? { truncatedByBytes: result.truncatedByBytes }
                : {}),
            },
          };
        },
      };

      const write: ToolDefinition = {
        description:
          "Create or overwrite a text file. Missing parent directories are created automatically. " +
          "An existing file must be read first (and not modified since the read). Line endings are written as given. " +
          "Paths outside the session workspace require approval.",
        name: "write",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "File path (absolute, or relative to the session cwd)",
            },
            content: { type: "string", description: "Full file content" },
          },
          required: ["file_path", "content"],
        },
        execute: async (args, ctx) => {
          const r = await fs.write(
            String(args.file_path),
            String(args.content),
            gateFor(ctx, "write", args),
          );
          return {
            content: r.created
              ? `File created successfully at: ${r.path}`
              : `The file ${r.path} has been updated successfully. (file state is current in your context — no need to Read it back)`,
            __meta: { kind: "write", path: r.path, created: r.created },
          };
        },
      };

      const edit: ToolDefinition = {
        description:
          "Replace an exact string in a text file. The file must be read first. old_string must match " +
          "exactly once unless replace_all is true; matching is line-ending tolerant (LF/CRLF) but otherwise exact. " +
          "An empty new_string deletes. Paths outside the session workspace require approval.",
        name: "edit",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "File path (absolute, or relative to the session cwd)",
            },
            old_string: {
              type: "string",
              description: "Exact text to replace (must be unique unless replace_all)",
            },
            new_string: { type: "string", description: "Replacement text (empty string deletes)" },
            replace_all: {
              type: "boolean",
              description: "Replace every occurrence (default false)",
            },
          },
          required: ["file_path", "old_string", "new_string"],
        },
        execute: async (args, ctx) => {
          const r = await fs.edit(
            String(args.file_path),
            {
              old: String(args.old_string),
              new: String(args.new_string),
              replaceAll: args.replace_all === true,
            },
            gateFor(ctx, "edit", args),
          );
          return {
            content:
              r.replacements > 1
                ? `Replaced ${r.replacements} occurrences in ${r.path}.`
                : `The file ${r.path} has been updated successfully.`,
            // 带外元数据：替换计数供 diff 卡「N 处替换」徽章；old/new 在行 input JSON 里（UI 自算 hunk）
            __meta: { kind: "edit", path: r.path, replacements: r.replacements },
          };
        },
      };

      // 注册即会话生命周期（harness dispose 随装配整体撤销，无需逐工具注销）
      tools.register(read);
      tools.register(write);
      tools.register(edit);
    },
  };
}

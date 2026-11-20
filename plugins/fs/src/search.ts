// glob / grep 能力（interfaces.md §fs，D-065）：JS 引擎零外部二进制。
// 目录行走跳 .git/.hg/.svn/node_modules 与 symlink；grep 跳二进制与 >10MB 文件、
// 单行预览 2000 字符；mtime 降序（glob 结果与 files_with_matches 文件序）。

import { promises as fsp } from "node:fs";
import path from "node:path";
import type {
  FsGate,
  FsGlobResult,
  FsGrepMatch,
  FsGrepOptions,
  FsGrepResult,
} from "@henira/protocol";
import { type Fence, FsError } from "./fence.js";

export const GLOB_MAX_RESULTS = 100;
/** 候选收集帽（mtime 排序在这些候选内做；超出即停走，total 含截断事实） */
const GLOB_MAX_CANDIDATES = 2000;
export const GREP_DEFAULT_HEAD_LIMIT = 250;
const GREP_MAX_LINE_CHARS = 2000;
const GREP_MAX_FILE_BYTES = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

const SKIP_DIRS = new Set([".git", ".hg", ".svn", "node_modules"]);

async function walkFiles(
  base: string,
  visit: (file: string) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  const queue: string[] = [base];
  while (queue.length > 0) {
    if (signal?.aborted) throw new FsError("aborted", "search aborted");
    const dir = queue.shift() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 权限 / 已删除：跳过该子树
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(full);
      } else if (entry.isFile()) {
        await visit(full);
      }
      // symlink（isSymbolicLink）一概不进——防环，v1 语义挂账
    }
  }
}

/** 极简 glob → RegExp：支持 `**`（跨段）、`*`（段内）、`?`（单字符）、`{a,b}` 展开 */
export function globToRegExp(pattern: string): RegExp {
  const braces = expandBraces(pattern);
  const parts = braces.map((p) => globToRegExpSingle(p));
  if (parts.length === 1) return parts[0] as RegExp;
  return new RegExp(parts.map((r) => `(?:${r.source})`).join("|"));
}

function expandBraces(pattern: string): string[] {
  const at = pattern.indexOf("{");
  if (at === -1) return [pattern];
  const end = pattern.indexOf("}", at);
  if (end === -1) return [pattern];
  const head = pattern.slice(0, at);
  const tail = pattern.slice(end + 1);
  const alts = pattern.slice(at + 1, end).split(",");
  return alts.flatMap((alt) => expandBraces(`${head}${alt}${tail}`));
}

function globToRegExpSingle(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**`：跨段任意（吃掉后续的段分隔符语义简化为任意字符）
        i++;
        if (pattern[i + 1] === "/") i++;
        re += "[\\s\\S]*";
      } else {
        re += "[^/\\\\]*";
      }
    } else if (c === "?") {
      re += "[^/\\\\]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  // 匹配对象是相对 base 的正斜杠路径
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

const relPosix = (base: string, full: string): string =>
  path.relative(base, full).replaceAll("\\", "/");

export function createSearch({ fence }: { fence: Fence }) {
  async function resolveBase(base: string | undefined, gate: FsGate): Promise<string> {
    const { absolute, inside } = fence.resolve(base ?? ".");
    await fence.ensureAccess({
      absolute,
      inside,
      tool: gate.tool,
      callArgs: gate.args ?? { path: base ?? "." },
      signal: gate.signal,
      requestPermission: gate.requestPermission,
    });
    let st: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      st = await fsp.stat(absolute);
    } catch {
      throw new FsError("not_found", `search path does not exist: "${absolute}"`);
    }
    if (!st.isDirectory()) {
      throw new FsError("not_directory", `search path is not a directory: "${absolute}"`);
    }
    return absolute;
  }

  return {
    async glob(pattern: string, gate: FsGate, opts?: { path?: string }): Promise<FsGlobResult> {
      if (typeof pattern !== "string" || pattern === "") {
        throw new FsError("invalid_args", "pattern must be a non-empty string");
      }
      const base = await resolveBase(opts?.path, gate);
      const re = globToRegExp(pattern);
      const candidates: { file: string; mtimeMs: number }[] = [];
      await walkFiles(
        base,
        async (file) => {
          if (candidates.length >= GLOB_MAX_CANDIDATES) return;
          if (!re.test(relPosix(base, file))) return;
          try {
            const st = await fsp.stat(file);
            candidates.push({ file, mtimeMs: st.mtimeMs });
          } catch {
            /* 竞态消失：跳过 */
          }
        },
        gate.signal,
      );
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.file < b.file ? -1 : 1));
      const files = candidates.slice(0, GLOB_MAX_RESULTS).map((c) => c.file);
      return { files, total: candidates.length };
    },

    async grep(pattern: string, gate: FsGate, opts?: FsGrepOptions): Promise<FsGrepResult> {
      if (typeof pattern !== "string" || pattern === "") {
        throw new FsError("invalid_args", "pattern must be a non-empty string");
      }
      let re: RegExp;
      try {
        re = new RegExp(pattern, opts?.ignoreCase ? "i" : "");
      } catch (err) {
        throw new FsError(
          "invalid_pattern",
          `Invalid regex pattern: ${String((err as Error).message)}`,
        );
      }
      const base = await resolveBase(opts?.path, gate);
      const includeRe = opts?.include ? globToRegExpSingle(opts.include) : undefined;
      const mode = opts?.outputMode ?? "files_with_matches";
      const headLimit = Math.max(1, opts?.headLimit ?? GREP_DEFAULT_HEAD_LIMIT);
      const context = Math.max(0, Math.min(opts?.context ?? 0, 10));

      const matches: FsGrepMatch[] = [];
      const fileSet = new Map<string, { mtimeMs: number; count: number; firstSeq: number }>();
      let totalSeen = 0;
      let seq = 0;

      await walkFiles(
        base,
        async (file) => {
          if (includeRe !== undefined && !includeRe.test(path.basename(file))) return;
          const st = await fsp.stat(file).catch(() => null);
          if (st === null || st.size > GREP_MAX_FILE_BYTES) return;
          const buf = await fsp.readFile(file).catch(() => null);
          if (buf === null) return;
          if (buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES)).includes(0)) return;
          const text = buf.toString("utf8");
          const lines = text.split("\n");
          const matchedIdx: number[] = [];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] as string;
            if (!re.test(line)) continue;
            matchedIdx.push(i);
            totalSeen++;
          }
          if (matchedIdx.length === 0) return;
          seq++;
          fileSet.set(file, { mtimeMs: st.mtimeMs, count: matchedIdx.length, firstSeq: seq });

          if (mode === "content") {
            const emitted = new Set<number>();
            for (const idx of matchedIdx) {
              for (
                let j = Math.max(0, idx - context);
                j <= Math.min(lines.length - 1, idx + context);
                j++
              ) {
                if (!emitted.has(j)) {
                  emitted.add(j);
                  const raw = (lines[j] as string).endsWith("\r")
                    ? (lines[j] as string).slice(0, -1)
                    : (lines[j] as string);
                  matches.push({
                    file,
                    line: j + 1,
                    text: raw.slice(0, GREP_MAX_LINE_CHARS),
                  });
                }
              }
              if (matches.length >= headLimit) return;
            }
          }
        },
        gate.signal,
      );

      // 文件序：mtime 降序（Claude Code files_with_matches 同款）；content 模式保持行走序
      const filesSorted = [...fileSet.entries()]
        .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs || (a[0] < b[0] ? -1 : 1))
        .map(([f]) => f);

      if (mode === "files_with_matches") {
        return { matches: [], files: filesSorted.slice(0, headLimit), totalSeen };
      }
      if (mode === "count") {
        const counts = filesSorted
          .slice(0, headLimit)
          .map((f) => ({ file: f, count: fileSet.get(f)?.count ?? 0 }));
        return { matches: [], counts, totalSeen };
      }
      return { matches: matches.slice(0, headLimit), totalSeen };
    },
  };
}

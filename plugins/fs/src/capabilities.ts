// read / write / edit 能力（interfaces.md §fs，D-065）：守卫住服务层——
// read-before-mutate（未见 / stale / 部分读三类）、edit 唯一性、LF 归一匹配保留原换行符。
// read 参数语义照四仓共识：默认/上限 2000 行、每行 2000 字符、选区 50KB。

import { promises as fsp } from "node:fs";
import path from "node:path";
import type { FsGate, FsReadResult } from "@henira/protocol";
import { type Fence, FsError } from "./fence.js";

export const READ_MAX_LINES = 2000;
export const READ_MAX_LINE_CHARS = 2000;
export const READ_MAX_BYTES = 50 * 1024;
/** read / edit 的整文件扫描帽（超过直接报错；流式扫描挂账） */
export const MAX_SCAN_BYTES = 50 * 1024 * 1024;
/** 二进制探测窗口（首段含 NUL 即判二进制） */
const BINARY_SNIFF_BYTES = 8000;

export interface ReadStateEntry {
  mtimeMs: number;
  sizeBytes: number;
  /** 带 offset/limit 或被字节帽截断的读 = 部分读，不满足覆盖条件 */
  partial: boolean;
}

const stateKey = (absolute: string): string =>
  process.platform === "win32" ? absolute.toLowerCase() : absolute;

export class ReadState {
  readonly #map = new Map<string, ReadStateEntry>();

  get(absolute: string): ReadStateEntry | undefined {
    return this.#map.get(stateKey(absolute));
  }

  record(absolute: string, entry: ReadStateEntry): void {
    // delete-then-set：后写的键靠后（淘汰顺序与写入序一致）
    this.#map.delete(stateKey(absolute));
    this.#map.set(stateKey(absolute), entry);
  }

  get size(): number {
    return this.#map.size;
  }
}

async function statOrNull(
  absolute: string,
): Promise<{ mtimeMs: number; sizeBytes: number } | null> {
  try {
    const st = await fsp.stat(absolute);
    if (!st.isFile()) {
      throw new FsError("not_regular_file", `"${absolute}" is not a regular file`);
    }
    return { mtimeMs: st.mtimeMs, sizeBytes: st.size };
  } catch (err) {
    if (err instanceof FsError) throw err;
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    if (code === "EISDIR") {
      throw new FsError("is_directory", `"${absolute}" is a directory`);
    }
    throw new FsError("io_error", `cannot stat "${absolute}": ${String(code ?? err)}`);
  }
}

async function readTextFile(absolute: string): Promise<string> {
  let buf: Buffer;
  try {
    buf = await fsp.readFile(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new FsError("not_found", `cannot read "${absolute}": not found`);
    if (code === "EISDIR")
      throw new FsError("is_directory", `cannot read "${absolute}": is a directory`);
    throw new FsError("io_error", `cannot read "${absolute}": ${String(code ?? err)}`);
  }
  if (buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES)).includes(0)) {
    throw new FsError("binary_file", `cannot read "${absolute}": binary file`);
  }
  return buf.toString("utf8");
}

function enforceReadState(
  target: string,
  entry: ReadStateEntry | undefined,
  existed: boolean,
  current?: { mtimeMs: number },
): void {
  if (!existed) return;
  if (entry === undefined) {
    throw new FsError(
      "not_read",
      `File has not been read yet. Read it first before writing to it. (${target})`,
    );
  }
  if (entry.partial) {
    throw new FsError(
      "partial_read",
      `File has not been fully read (the last read was partial). Read the whole file before writing to it. (${target})`,
    );
  }
  if (current !== undefined && Math.abs(current.mtimeMs - entry.mtimeMs) > 1) {
    throw new FsError(
      "stale_read",
      `File has been modified since read, either by the user or by another process. Read it again before writing to it. (${target})`,
    );
  }
}

async function atomicWrite(absolute: string, data: string): Promise<void> {
  const dir = path.dirname(absolute);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absolute)}.henira-tmp-${process.pid}-${Date.now()}`);
  await fsp.writeFile(tmp, data, "utf8");
  try {
    await fsp.rename(tmp, absolute);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw new FsError("io_error", `cannot write "${absolute}": ${String((err as Error).message)}`);
  }
}

export interface CapabilityDeps {
  fence: Fence;
  readState: ReadState;
}

export function createCapabilities({ fence, readState }: CapabilityDeps) {
  async function ensureWriteAccess(target: string, gate: FsGate): Promise<string> {
    const { absolute, inside } = fence.resolve(target);
    await fence.ensureAccess({
      absolute,
      inside,
      tool: gate.tool,
      callArgs: gate.args ?? { path: target },
      signal: gate.signal,
      requestPermission: gate.requestPermission,
    });
    return absolute;
  }

  return {
    async read(
      target: string,
      gate: FsGate,
      opts?: { offset?: number; limit?: number },
    ): Promise<FsReadResult> {
      const absolute = await ensureWriteAccess(target, gate);
      if (gate.signal?.aborted) throw new FsError("aborted", "read aborted");
      const stat = await statOrNull(absolute);
      if (stat === null) {
        throw new FsError("not_found", `cannot read "${absolute}": not found`);
      }
      if (stat.sizeBytes > MAX_SCAN_BYTES) {
        // 先帽后读：read 走整文件读（流式扫描挂账），>50MB 直接拒——不把大文件拉进内存
        throw new FsError(
          "too_large",
          `file too large to read (>${MAX_SCAN_BYTES} bytes): "${absolute}"`,
        );
      }
      const text = await readTextFile(absolute);
      // split 后末元素恒为空串（文件以 \n 结尾）或残行；统一去掉
      const rawLines = text.split("\n");
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
      const lines = rawLines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
      const totalLines = lines.length;

      const offset = Math.max(1, Math.floor(opts?.offset ?? 1));
      if (offset > totalLines && totalLines > 0) {
        throw new FsError(
          "offset_out_of_range",
          `offset ${offset} is out of range for "${absolute}" (${totalLines} lines)`,
        );
      }
      const limit = Math.max(
        1,
        Math.min(Math.floor(opts?.limit ?? READ_MAX_LINES), READ_MAX_LINES),
      );

      let content = "";
      let byteBudget = READ_MAX_BYTES;
      let endLine = Math.min(offset + limit - 1, totalLines);
      let truncatedByBytes = false;
      for (let i = offset; i <= endLine; i++) {
        let line = lines[i - 1] ?? "";
        if (line.length > READ_MAX_LINE_CHARS) {
          line = `${line.slice(0, READ_MAX_LINE_CHARS)}… (line truncated to ${READ_MAX_LINE_CHARS} chars)`;
        }
        const piece = i === offset ? line : `\n${line}`;
        const size = Buffer.byteLength(piece, "utf8");
        if (size > byteBudget) {
          truncatedByBytes = true;
          endLine = i - 1;
          break;
        }
        byteBudget -= size;
        content += piece;
      }
      if (endLine < offset) endLine = offset - 1;

      // 部分读 = 没把文件读完（字节帽截断 / 从中间起读 / 到尾部前停）——显式 limit 若覆盖全文件
      // 不算部分读（此前 Boolean(limit) 一律判部分，读全 5 行后 write 被误拒）
      const partial = truncatedByBytes || offset > 1 || endLine < totalLines;
      readState.record(absolute, {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.sizeBytes,
        partial,
      });
      return {
        content,
        startLine: offset,
        endLine,
        totalLines,
        ...(truncatedByBytes ? { truncatedByBytes } : {}),
      };
    },

    async write(
      target: string,
      content: string,
      gate: FsGate,
    ): Promise<{ created: boolean; path: string }> {
      if (typeof content !== "string") {
        throw new FsError("invalid_args", "content must be a string");
      }
      const absolute = await ensureWriteAccess(target, gate);
      if (gate.signal?.aborted) throw new FsError("aborted", "write aborted");
      const stat = await statOrNull(absolute);
      enforceReadState(
        absolute,
        stat === null ? undefined : readState.get(absolute),
        stat !== null,
        stat ?? undefined,
      );
      await atomicWrite(absolute, content);
      const after = await statOrNull(absolute);
      readState.record(absolute, {
        mtimeMs: after?.mtimeMs ?? Date.now(),
        sizeBytes: after?.sizeBytes ?? Buffer.byteLength(content, "utf8"),
        partial: false,
      });
      return { created: stat === null, path: absolute };
    },

    async edit(
      target: string,
      op: { old: string; new: string; replaceAll?: boolean },
      gate: FsGate,
    ): Promise<{ replacements: number; path: string }> {
      if (typeof op.old !== "string" || op.old === "") {
        throw new FsError(
          "invalid_args",
          "old_string must be a non-empty string; use write to create or overwrite a file",
        );
      }
      if (typeof op.new !== "string") {
        throw new FsError("invalid_args", "new_string must be a string");
      }
      if (op.old === op.new) {
        throw new FsError(
          "no_change",
          "No changes to make: old_string and new_string are exactly the same.",
        );
      }
      const absolute = await ensureWriteAccess(target, gate);
      if (gate.signal?.aborted) throw new FsError("aborted", "edit aborted");
      const stat = await statOrNull(absolute);
      if (stat === null) {
        throw new FsError("not_found", `cannot edit "${absolute}": not found`);
      }
      enforceReadState(absolute, readState.get(absolute), true, stat);

      const original = await readTextFile(absolute);
      if (Buffer.byteLength(original, "utf8") > MAX_SCAN_BYTES) {
        throw new FsError(
          "too_large",
          `file too large to edit (>${MAX_SCAN_BYTES} bytes): "${absolute}"`,
        );
      }
      const hadCrlf = original.includes("\r\n");
      const hadBareLf = /(^|[^\r])\n/.test(original);
      const mixed = hadCrlf && hadBareLf;
      if (mixed && (op.old.includes("\n") || op.old.includes("\r"))) {
        // 混合换行的多行匹配：归一写回会把全线尾改成一种，拒绝优于静默改全文
        throw new FsError(
          "mixed_line_endings",
          `"${absolute}" has mixed line endings (CRLF and LF); a multi-line edit cannot preserve them. Normalize the file's line endings first.`,
        );
      }
      // 纯 LF / 纯 CRLF：归一视图匹配、写回还原原换行符；
      // 混合文件只受理单行编辑（原样匹配，其余行纹丝不动）
      const content = mixed ? original : hadCrlf ? original.replaceAll("\r\n", "\n") : original;
      const oldN = mixed ? op.old : op.old.replaceAll("\r\n", "\n");
      const newN = mixed ? op.new : op.new.replaceAll("\r\n", "\n");

      let count = 0;
      let at = content.indexOf(oldN);
      while (at !== -1) {
        count++;
        at = content.indexOf(oldN, at + oldN.length);
      }
      if (count === 0) {
        const hint = content.includes(newN)
          ? " Note: new_string is already present in the file — the edit may have been applied already."
          : "";
        throw new FsError(
          "not_found",
          `String to replace not found in "${absolute}". It must match exactly, including whitespace and indentation.${hint}`,
        );
      }
      if (count > 1 && !op.replaceAll) {
        throw new FsError(
          "ambiguous",
          `Found ${count} matches of old_string in "${absolute}", but replace_all is false. Add more surrounding context to make it unique, or set replace_all to true.`,
        );
      }
      const replaced = op.replaceAll ? content.replaceAll(oldN, newN) : content.replace(oldN, newN);
      const out = !mixed && hadCrlf ? replaced.replaceAll("\n", "\r\n") : replaced;
      await atomicWrite(absolute, out);
      const after = await statOrNull(absolute);
      readState.record(absolute, {
        mtimeMs: after?.mtimeMs ?? Date.now(),
        sizeBytes: after?.sizeBytes ?? 0,
        partial: false,
      });
      return { replacements: op.replaceAll ? count : 1, path: absolute };
    },
  };
}

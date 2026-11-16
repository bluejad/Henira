// 统一出口限量（tools-approval §1.1 定稿）：默认 2000 行 / 50KB（量级照 OpenCode），
// 经 ConfigService 可配（插件 options），工具可自定更严上限（自行在 execute 里截）。
// 截断在码点边界收口（不切代理对）；超限完整输出落盘留路径 + 头部预览 + 截断尾注可见（P2）。

import { promises as fs } from "node:fs";
import path from "node:path";

export interface ExitLimits {
  maxLines: number;
  maxBytes: number;
}

export const DEFAULT_EXIT_LIMITS: ExitLimits = { maxLines: 2000, maxBytes: 50_000 };

export interface LimitedContent {
  content: string;
  truncated?: { path: string; preview: string };
}

/** 尾部丢整码点（低代理结尾连高代理一起丢——不切半） */
function cutToBytes(line: string, maxBytes: number): string {
  let s = line;
  while (s.length > 0 && Buffer.byteLength(s, "utf8") > maxBytes) {
    const last = s.charCodeAt(s.length - 1);
    const drop = last >= 0xdc00 && last <= 0xdfff ? 2 : 1;
    s = s.slice(0, s.length - drop);
  }
  return s;
}

export interface ExitLimitOptions {
  /** 落盘目录（会话目录 artifacts/）；缺省 = 不落盘，尾注明示"完整输出未保留" */
  spillDir?: string;
  /** 落盘文件名（调用方按 callId 命名，如 "c1.txt"） */
  spillName?: string;
}

/**
 * 出口限量：超限保留头部 + 尾注（截断事实 + 完整路径 / 未保留声明）；完整输出落盘时
 * ToolOutcome.truncated = { path, preview }（preview 供 UI 展示头部，不进模型上下文）。
 */
export async function applyExitLimits(
  text: string,
  limits: ExitLimits = DEFAULT_EXIT_LIMITS,
  opts: ExitLimitOptions = {},
): Promise<LimitedContent> {
  const lines = text.split("\n");
  const withinLines = lines.length <= limits.maxLines;
  const withinBytes = Buffer.byteLength(text, "utf8") <= limits.maxBytes;
  if (withinLines && withinBytes) return { content: text };

  // 保留头部：行数预算内逐行累积，字节预算内整行保留；超支的单行按码点收口
  const kept: string[] = [];
  let bytes = 0;
  let cutSingleLine = false;
  for (let i = 0; i < Math.min(lines.length, limits.maxLines); i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + lineBytes > limits.maxBytes) {
      const room = limits.maxBytes - bytes;
      kept.push(cutToBytes(line, Math.max(0, room)));
      cutSingleLine = true;
      break;
    }
    kept.push(line);
    bytes += lineBytes;
  }
  let head = kept.join("\n");
  if (cutSingleLine && head.length === 0) head = cutToBytes(lines[0], limits.maxBytes);

  const preview = head.slice(0, 2000);
  let fullPath: string | undefined;
  if (opts.spillDir && opts.spillName) {
    await fs.mkdir(opts.spillDir, { recursive: true });
    fullPath = path.join(opts.spillDir, opts.spillName);
    await fs.writeFile(fullPath, text, "utf8");
  }
  const where = fullPath ?? "（未配置落盘目录，完整输出未保留）";
  const content =
    `${head}\n[truncated] 输出超限（${lines.length} 行 / ${Buffer.byteLength(text, "utf8")} 字节），` +
    `已保留头部，完整输出：${where}`;
  return { content, truncated: fullPath ? { path: fullPath, preview } : undefined };
}

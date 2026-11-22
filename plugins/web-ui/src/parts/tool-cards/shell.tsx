// 行壳与 meta 工具（R178）：六卡共用窄化 helpers；行 chrome 走 ToolRow（row-chrome）。
import type { ToolRow } from "@henira/protocol";
import type { WebPartContext } from "../../types.js";

export interface CardProps {
  row: ToolRow;
  ctx: WebPartContext;
}

// ── meta 窄化 helpers（宁缺毋滥：字段形状不过一律降级通用卡）──

/** args 按键位提取人类摘要（审批痕迹/兼容出口使用；工具行本身已按工具给主信息） */
export function argsSummaryText(name: string, args: Record<string, unknown> | null): string | null {
  if (args === null) return null;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = str(args[k]);
      if (v !== null && v.trim() !== "") return v;
    }
    return null;
  };
  switch (name) {
    case "bash":
    case "powershell":
      return pick("command");
    case "read":
    case "write":
    case "edit":
      return pick("file_path", "path");
    case "glob":
    case "grep":
      return pick("pattern");
    default: {
      for (const v of Object.values(args)) {
        const s = str(v);
        if (s !== null && s.trim() !== "") return s;
      }
      return null;
    }
  }
}

/** 工具名人类化（mcp/第三方 wire 名 → Title Case；read_file → Read File） */
export function formatToolName(name: string): string {
  const words = name
    .replace(/^mcp__/, "")
    .replaceAll(/[_-]+/g, " ")
    .trim();
  if (words === "") return name;
  return words
    .split(/\s+/)
    .map((word) => (word[0] !== undefined ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** 失败状态词（仅失败时显示；成功不显示状态词——参照实现的行语义） */
export function toolFailure(row: ToolRow, t: (k: string) => string): string | undefined {
  return row.status === "error" ? t("row.status.error") : undefined;
}

function asMeta(row: ToolRow, kind: string): Record<string, unknown> | null {
  const m = row.output?.meta;
  if (m === null || typeof m !== "object" || Array.isArray(m)) return null;
  if (m.kind !== kind) return null;
  return m as Record<string, unknown>;
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** 行 input（模型原始 args JSON）容错解析；非对象 = null */
function parseInput(row: ToolRow): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(row.input);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 结果文本若是 JSON（对象/数组开头且可解析）→ 格式化；否则 null（审批预览复用） */
export function tryFormatJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(t) as unknown, null, 2);
  } catch {
    return null;
  }
}

/** meta 文本数组窄化（元素逐个校验，任一不过 = 整体 null） */
function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

/** mono pre 块（审批/兜底共用；卡内滚动上限走 maxHeight） */
export function MonoBlock(props: {
  text: string;
  color?: string;
  maxHeight?: number;
  className?: string;
}): React.ReactNode {
  return (
    <pre
      className={`henira-mono-block${props.className !== undefined ? ` ${props.className}` : ""}`}
      style={{
        color: props.color,
        maxHeight: props.maxHeight,
        overflowY: props.maxHeight !== undefined ? "auto" : undefined,
      }}
    >
      {props.text}
    </pre>
  );
}

/** 文件路径尾段（文件 chip 显示名） */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 工具行失败状态的可读原因（错误输出首行/退出码说明） */
export function failureTitle(row: ToolRow): string | undefined {
  if (row.output === undefined) return undefined;
  const first = row.output.content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first;
}

export { asMeta, num, parseInput, strArray };

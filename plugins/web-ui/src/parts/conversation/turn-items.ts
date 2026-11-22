// 轮内渲染项派生（R178）：过程分组以「项」计数——思考行也算一项，≥2 项才折叠；
// 未知工具/MCP 是边界不分组；完成轮历史折叠把过程收进「已工作」，最终回答留在外面。
// 纯函数、无 React；折叠裁决放 turn.tsx（需要运行态/手动开合）。
import type { AssistantRow, Row, ToolRow } from "@henira/protocol";

export type WorkCategory = "explore" | "run" | "change" | "session";

export interface WorkStats {
  explore: number;
  run: number;
  change: number;
  /** 修改了但路径未知（计数行显示「修改 N 次（路径未知）」） */
  unresolved: number;
  /** 会话类工具（当前官方工具集无；保留计数以兼容未来件） */
  session: number;
  /** 修改过的文件路径（去重、保持首现顺序——收起态组头显示文件名） */
  files: string[];
}

export type TurnItem = { kind: "row"; row: Row } | { kind: "group"; rows: Row[]; stats: WorkStats };

export interface TurnLayout {
  /** 前置用户行（不参与折叠） */
  leading: Row[];
  /** 过程项（折叠体/内联体共用） */
  process: TurnItem[];
  /** 最终回答行（折叠时留在折叠体外） */
  final?: Row;
  /** 最终回答之后的行（错误等，保持可见） */
  trailing: Row[];
  /** 是否可折叠（有过程 + 落在最终回答前，且全是 assistant/tool 行） */
  foldable: boolean;
  /** 异常终态（中断/错误）——默认展开过程 */
  abnormal: boolean;
}

/** 工具身份 → 过程类别；未知工具/MCP 返回 null（边界，不参与分组/统计）。 */
export function categoryOf(name: string): WorkCategory | null {
  if (name === "read" || name === "glob" || name === "grep") return "explore";
  if (name === "bash" || name === "powershell") return "run";
  if (name === "edit" || name === "write") return "change";
  return null;
}

function emptyStats(): WorkStats {
  return { explore: 0, run: 0, change: 0, unresolved: 0, session: 0, files: [] };
}

function isEmptyStep(row: Row): boolean {
  return (
    row.kind === "assistant" &&
    row.text === "" &&
    row.streaming !== true &&
    row.interrupted !== true &&
    (row.reasoning === undefined || row.reasoning === "")
  );
}

/** 可进过程组：有类别的工具行 + 纯思考步（带正文的 assistant 行是边界）。 */
function groupable(row: Row): boolean {
  if (row.kind === "tool") return categoryOf(row.name) !== null;
  if (row.kind !== "assistant") return false;
  if (row.text !== "" || row.streaming === true || row.interrupted === true) return false;
  return row.reasoning !== undefined && row.reasoning !== "";
}

/** edit/write 行 input 里的文件路径（change 统计按去重文件数）。 */
function filePathOf(row: ToolRow): string | null {
  try {
    const v: unknown = JSON.parse(row.input);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const rec = v as Record<string, unknown>;
    const path = rec.file_path ?? rec.path;
    return typeof path === "string" && path.trim() !== "" ? path : null;
  } catch {
    return null;
  }
}

/** 连续过程项分组：≥2 项（含思考）才折叠；组内思考不计数，只作为可组项。 */
export function buildProcessItems(rows: readonly Row[]): TurnItem[] {
  const items: TurnItem[] = [];
  let run: Row[] = [];
  let stats = emptyStats();
  const files = new Set<string>();
  const flush = (): void => {
    if (run.length >= 2) {
      items.push({
        kind: "group",
        rows: run,
        stats: { ...stats, change: files.size, files: [...files] },
      });
    } else {
      for (const row of run) items.push({ kind: "row", row });
    }
    run = [];
    stats = emptyStats();
    files.clear();
  };
  for (const row of rows) {
    if (isEmptyStep(row)) continue;
    if (groupable(row)) {
      run.push(row);
      if (row.kind === "tool") {
        const category = categoryOf(row.name);
        if (category === "change") {
          const path = filePathOf(row);
          if (path === null) stats.unresolved += 1;
          else files.add(path);
        } else if (category !== null) {
          stats[category] += 1;
        }
      }
      continue;
    }
    flush();
    items.push({ kind: "row", row });
  }
  flush();
  return items;
}

/** 最终回答行：最后一条非空、非流式的 assistant 文本行——且其后不能再有工具/正文。 */
function findFinalIndex(rows: readonly Row[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined || row.kind !== "assistant") continue;
    if (row.streaming === true) return -1;
    if (row.text.trim() === "") continue;
    for (let j = i + 1; j < rows.length; j++) {
      const after = rows[j];
      if (after === undefined) continue;
      if (after.kind === "tool") return -1;
      if (after.kind === "assistant" && after.text.trim() !== "") return -1;
    }
    return i;
  }
  return -1;
}

/** 轮布局：完成轮把「最终回答之前的过程」折出；运行中/无最终回答不折。
 *  审批/提问行不进官方对话流（参照实现的行模型无这两种交互行；data 仍留在 store）。 */
export function buildTurnLayout(rawRows: readonly Row[]): TurnLayout {
  const rows = rawRows.filter((row) => row.kind !== "approval" && row.kind !== "question");
  // 前置用户行（可有多条 steer）不进过程容器
  let leadEnd = 0;
  while (leadEnd < rows.length && rows[leadEnd]?.kind === "user") leadEnd += 1;
  const leading = rows.slice(0, leadEnd);
  const bodyRows = rows.slice(leadEnd);
  const finalIndex = findFinalIndex(bodyRows);
  const abnormal = rows.some(
    (row) => row.kind === "error" || (row.kind === "assistant" && row.interrupted === true),
  );
  if (finalIndex < 0) {
    return {
      leading,
      process: buildProcessItems(bodyRows),
      trailing: [],
      foldable: false,
      abnormal,
    };
  }
  const candidate = bodyRows.slice(0, finalIndex);
  const finalRow = bodyRows[finalIndex];
  const finalHasReasoning =
    finalRow?.kind === "assistant" && finalRow.reasoning !== undefined && finalRow.reasoning !== "";
  const allProcess = candidate.every((row) => row.kind === "assistant" || row.kind === "tool");
  if ((candidate.length > 0 || finalHasReasoning) && allProcess) {
    return {
      leading,
      process: buildProcessItems(candidate),
      final: bodyRows[finalIndex],
      trailing: bodyRows.slice(finalIndex + 1),
      foldable: true,
      abnormal,
    };
  }
  return {
    leading,
    process: buildProcessItems(bodyRows),
    trailing: [],
    foldable: false,
    abnormal,
  };
}

export type { AssistantRow };

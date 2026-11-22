// diff 卡（R178）：edit——类别词「已编辑/正在编辑」+ 文件链接 + ±N；展开 = 行号 diff（240px 上限）。
import { structuredPatch } from "diff";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { ToolView } from "./fallback.js";
import { FileChip } from "./file-preview.js";
import { type CardProps, failureTitle, parseInput, str, toolFailure } from "./shell.js";

interface DiffRow {
  kind: "add" | "del" | "context" | "note";
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** 超限整体替换 fallback 的行数上限：大文本一次性挂全部行会撑爆 DOM。 */
export const DIFF_FALLBACK_MAX_LINES = 1000;

/** jsdiff structuredPatch → 行序列。返回 null = 两串相同。 */
export function buildDiffRows(
  oldText: string,
  newText: string,
): { rows: DiffRow[]; added: number; removed: number; truncated?: boolean } | null {
  if (oldText === newText) return null;
  const patch = structuredPatch("a", "b", oldText, newText, "", "", {
    context: 3,
    maxEditLength: 2000,
  });
  const raw = patch?.hunks;
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  if (raw !== undefined && raw.length > 0) {
    for (const h of raw) {
      // 逐 hunk 推进：行号从各自 hunk.oldStart/newStart 起步（多 hunk 常态）。
      let oldLine = h.oldStart;
      let newLine = h.newStart;
      for (const line of h.lines) {
        const mark = line.charAt(0);
        const text = line.slice(1);
        if (mark === "+") {
          rows.push({ kind: "add", newLine, text });
          newLine += 1;
          added += 1;
        } else if (mark === "-") {
          rows.push({ kind: "del", oldLine, text });
          oldLine += 1;
          removed += 1;
        } else if (mark === "\\") {
          rows.push({ kind: "note", text: line });
        } else {
          rows.push({ kind: "context", oldLine, newLine, text });
          oldLine += 1;
          newLine += 1;
        }
      }
    }
    return { rows, added, removed };
  }
  // 超限 fallback：旧行全 del + 新行全 add，超千行截断（计数仍算全量）。
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const truncated = oldLines.length + newLines.length > DIFF_FALLBACK_MAX_LINES;
  const cap = truncated ? Math.floor(DIFF_FALLBACK_MAX_LINES / 2) : undefined;
  for (const [i, l] of oldLines.slice(0, cap).entries()) {
    rows.push({ kind: "del", oldLine: i + 1, text: l });
  }
  for (const [i, l] of newLines.slice(0, cap).entries()) {
    rows.push({ kind: "add", newLine: i + 1, text: l });
  }
  return {
    rows,
    added: newLines.length,
    removed: oldLines.length,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** diff 行序列渲染（行号双 gutter + 增删着色；240px 上限）。 */
export function DiffRowsView({ rows }: { rows: DiffRow[] }): React.ReactNode {
  return (
    <div className="henira-diff-view">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）
        <div key={i} className={`henira-diff-row is-${r.kind}`}>
          <span className="henira-diff-gutter">{r.kind === "note" ? "" : (r.oldLine ?? "")}</span>
          <span className="henira-diff-gutter">{r.kind === "note" ? "" : (r.newLine ?? "")}</span>
          <span className="henira-diff-mark">
            {r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}
          </span>
          <span className="henira-diff-text">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** ±N 计数（摘要后缀通道）。 */
export function DiffTotals({
  added,
  removed,
}: {
  added: number;
  removed: number;
}): React.ReactNode {
  return (
    <span className="henira-diff-totals">
      <span className="is-add">+{added}</span> <span className="is-del">-{removed}</span>
    </span>
  );
}

/** edit 卡：old/new 从行 input JSON 解析；行本身可展开看 diff。 */
export function EditCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const oldText = input === null ? null : str(input.old_string);
  const newText = input === null ? null : str(input.new_string);
  const filePath = input === null ? null : (str(input.file_path) ?? str(input.path));
  if (oldText === null || newText === null || filePath === null) {
    return <ToolView row={row} ctx={ctx} />;
  }
  const diff = buildDiffRows(oldText, newText);
  if (diff === null) return <ToolView row={row} ctx={ctx} />;
  const diffRows =
    diff.truncated === true
      ? [...diff.rows, { kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
      : diff.rows;
  const running = row.status === "running";
  return (
    <ToolRow
      icon={toolGlyph(row.name)}
      kindLabel={ctx.t(running ? "tool.kind.editing" : "tool.kind.edited")}
      primary={<FileChip path={filePath} />}
      diff={<DiffTotals added={diff.added} removed={diff.removed} />}
      busy={running}
      canToggle
      persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
      rowTitle={`${row.name} · ${row.callId}`}
      status={toolFailure(row, ctx.t)}
      statusTitle={failureTitle(row)}
    >
      <div className="henira-tool-card">
        <DiffRowsView rows={diffRows} />
      </div>
    </ToolRow>
  );
}

export type { DiffRow };

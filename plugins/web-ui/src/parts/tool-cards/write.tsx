// 写入卡（R178）：类别词「已写入/已更新」+ 文件链接 + +N；展开 = 全文 add diff（新建）
// 或新内容（覆盖——服务不回传旧内容，不伪造 diff）。
import { useState } from "react";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { DIFF_FALLBACK_MAX_LINES, DiffRowsView, DiffTotals } from "./diff.js";
import { ToolView } from "./fallback.js";
import { FileChip, FilePreviewDialog } from "./file-preview.js";
import {
  asMeta,
  bool,
  type CardProps,
  failureTitle,
  parseInput,
  str,
  toolFailure,
} from "./shell.js";

export function WriteCard({ row, ctx }: CardProps): React.ReactNode {
  const [localPreview, setLocalPreview] = useState(false);
  const input = parseInput(row);
  const content = input === null ? null : str(input.content);
  const filePath = input === null ? null : (str(input.file_path) ?? str(input.path));
  if (content === null || filePath === null) return <ToolView row={row} ctx={ctx} />;
  const meta = row.output === undefined ? null : asMeta(row, "write");
  const created = meta === null ? undefined : bool(meta.created);
  const lines = content.split("\n");
  const running = row.status === "running";
  const kind = running
    ? ctx.t("tool.kind.writing")
    : created === false
      ? ctx.t("tool.kind.updated")
      : ctx.t("tool.kind.wrote");
  return (
    <>
      <ToolRow
        icon={toolGlyph(row.name)}
        kindLabel={kind}
        primary={
          <FileChip
            path={filePath}
            onOpen={() => {
              // R202/D-085：旧宿主缺 preview → 本地弹窗（write 看新内容），不再退化成静态文本
              if (ctx.preview !== undefined) {
                ctx.preview.open({ kind: "file", path: filePath, rowId: row.rowId });
              } else {
                setLocalPreview(true);
              }
            }}
          />
        }
        diff={created === true ? <DiffTotals added={lines.length} removed={0} /> : undefined}
        busy={running}
        canToggle
        persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
        rowTitle={`${row.name} (${row.callId})`}
        status={toolFailure(row, ctx.t)}
        statusTitle={failureTitle(row)}
      >
        <div className="henira-tool-card">
          {created === true ? (
            <DiffRowsView
              rows={[
                ...lines
                  .slice(0, DIFF_FALLBACK_MAX_LINES)
                  .map((text, i) => ({ kind: "add" as const, newLine: i + 1, text })),
                ...(lines.length > DIFF_FALLBACK_MAX_LINES
                  ? [{ kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
                  : []),
              ]}
            />
          ) : (
            <pre className="henira-tool-pre">{content}</pre>
          )}
        </div>
      </ToolRow>
      {localPreview ? (
        <FilePreviewDialog
          title={filePath}
          content={content}
          closeLabel={ctx.t("filePreview.close")}
          onClose={() => setLocalPreview(false)}
        />
      ) : null}
    </>
  );
}

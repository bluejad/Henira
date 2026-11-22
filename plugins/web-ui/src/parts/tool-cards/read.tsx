// 读取卡（R178）：静态一行——类别词「已读取/正在读取」+ 文件名链接；没有行号范围、
// 没有耗时、行本身不可展开。文件内容点击文件名弹窗查看（内容取账本已捕获 tool output）。
import { useState } from "react";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { FileChip, FilePreviewDialog } from "./file-preview.js";
import { type CardProps, failureTitle, parseInput, str, toolFailure } from "./shell.js";

export function ReadCard({ row, ctx }: CardProps): React.ReactNode {
  const [preview, setPreview] = useState(false);
  const input = parseInput(row);
  const filePath = input === null ? null : (str(input.file_path) ?? str(input.path));
  const content = row.output?.content;
  const running = row.status === "running";
  return (
    <>
      <ToolRow
        icon={toolGlyph("read")}
        kindLabel={ctx.t(running ? "tool.kind.reading" : "tool.kind.read")}
        primary={
          filePath !== null ? (
            <FileChip
              path={filePath}
              onOpen={content === undefined ? undefined : () => setPreview(true)}
            />
          ) : null
        }
        busy={running}
        canToggle={false}
        rowTitle={`${row.name} · ${row.callId}`}
        status={toolFailure(row, ctx.t)}
        statusTitle={failureTitle(row)}
      />
      {preview && filePath !== null && content !== undefined ? (
        <FilePreviewDialog
          title={filePath}
          content={content}
          closeLabel={ctx.t("filePreview.close")}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </>
  );
}

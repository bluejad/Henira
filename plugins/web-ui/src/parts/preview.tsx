// 预览体与弹窗（R188）：右栏 tab 与居中弹窗共用同一个内容 resolver。
// 文件只存行引用（rowId）——正文每次从 store 的行解析，不进 ui-state；行已翻页出窗口时给
// 「重新打开」提示。图片直接用 src。第三方件拿 ctx.preview.open 同一入口。
import type { ToolRow } from "@henira/protocol";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import type { PreviewTarget, WebPartContext } from "../types.js";
import { XGlyph } from "./icons.js";
import { buildDiffRows, DiffRowsView, useDiffTokens } from "./tool-cards/diff.js";
import { parseInput, str } from "./tool-cards/shell.js";

/** 右栏 preview tab 的载荷形状（Kind 前缀固定；path/rowId 或 src/alt） */
export interface PreviewTabPayload {
  kind: "preview-file" | "preview-image";
  path?: string;
  rowId?: string;
  src?: string;
  alt?: string;
}

function EditPreviewBody(props: {
  oldText: string;
  newText: string;
  path: string;
  ctx: WebPartContext;
}): ReactNode {
  const tokens = useDiffTokens(props.ctx, props.oldText, props.newText, props.path);
  const diff = buildDiffRows(props.oldText, props.newText);
  if (diff === null) {
    return <div className="henira-preview-empty">{props.ctx.t("tool.noChanges")}</div>;
  }
  return (
    <div className="henira-preview-diff">
      <DiffRowsView rows={diff.rows} tokens={tokens} />
    </div>
  );
}

function FilePreviewBody(props: { row: ToolRow; ctx: WebPartContext }): ReactNode {
  const { row, ctx } = props;
  const input = parseInput(row);
  if (row.name === "edit") {
    const oldText = input === null ? null : str(input.old_string);
    const newText = input === null ? null : str(input.new_string);
    if (oldText === null || newText === null) {
      return <div className="henira-preview-empty">{ctx.t("preview.unsupported")}</div>;
    }
    const path = (input === null ? null : (str(input.file_path) ?? str(input.path))) ?? "";
    return <EditPreviewBody oldText={oldText} newText={newText} path={path} ctx={ctx} />;
  }
  const content =
    row.name === "write"
      ? ((input === null ? null : str(input.content)) ?? row.output?.content ?? "")
      : (row.output?.content ?? "");
  if (content === "") {
    return <div className="henira-preview-empty">{ctx.t("preview.empty")}</div>;
  }
  return <pre className="henira-preview-text">{content}</pre>;
}

/** 预览体：tab 形状进、内容出（右栏/弹窗共用）。 */
export function PreviewBody(props: { tab: PreviewTabPayload; ctx: WebPartContext }): ReactNode {
  const { tab, ctx } = props;
  const view = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId),
    () => ctx.store.getSession(ctx.sessionId),
  );
  if (tab.kind === "preview-image") {
    if (tab.src === undefined || tab.src === "") {
      return <div className="henira-preview-empty">{ctx.t("preview.missing")}</div>;
    }
    return (
      <div className="henira-preview-image-wrap">
        <img className="henira-preview-image" src={tab.src} alt={tab.alt ?? ""} />
      </div>
    );
  }
  const row = tab.rowId === undefined ? undefined : view.rows.find((r) => r.rowId === tab.rowId);
  if (row === undefined || row.kind !== "tool") {
    return <div className="henira-preview-empty">{ctx.t("preview.missing")}</div>;
  }
  return <FilePreviewBody row={row} ctx={ctx} />;
}

function tabOf(target: PreviewTarget): PreviewTabPayload {
  return target.kind === "file"
    ? { kind: "preview-file", path: target.path, rowId: target.rowId }
    : {
        kind: "preview-image",
        src: target.src,
        ...(target.alt !== undefined ? { alt: target.alt } : {}),
      };
}

/** 弹窗模式的预览层（框架件渲染；Esc / 点遮罩 / 关闭钮收）。 */
export function PreviewModal(props: {
  target: PreviewTarget;
  ctx: WebPartContext;
  onClose(): void;
}): ReactNode {
  const { target, ctx } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
  const title = target.kind === "file" ? target.path : (target.alt ?? ctx.t("preview.image"));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点遮罩关闭是鼠标辅助行为；键盘 Esc 另有监听，对话框本体有 role=dialog
    <div
      className="henira-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="henira-preview-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="henira-preview-head">
          <span className="henira-preview-path" title={title}>
            {title}
          </span>
          <button
            type="button"
            className="henira-iconbtn"
            aria-label={ctx.t("preview.close")}
            title={ctx.t("preview.close")}
            onClick={props.onClose}
          >
            <XGlyph size={14} />
          </button>
        </div>
        <div className="henira-preview-body">
          <PreviewBody tab={tabOf(target)} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

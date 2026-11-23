// 预览体与弹窗（R188；R190 接预览缝）：右栏 tab 与居中弹窗共用同一个内容 resolver。
// 文件只存行引用（rowId+path）——正文优先从 store 的行解析（行快照 = 当时内容），
// 行已翻页出窗时按工作区路径读当前磁盘文本（read()，不锚定工具行）。图片直接用 src。
// R190：sidebar.right.preview.<后缀> 有件用件（官方兜底体注册在通配 *），无件回落内置体；
// 件渲染崩溃由 SlotBoundary 隔离并回落内置体。
import type { ToolRow, WorkspaceFileContent } from "@henira/protocol";
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { PreviewTabPayload, PreviewTarget, PreviewView, WebPartContext } from "../types.js";
import { XGlyph } from "./icons.js";
import { PREVIEW_SLOT_PREFIX, pickPreviewSlot, previewExt } from "./preview-slot.js";
import { SlotBoundary } from "./slot-boundary.js";
import { buildDiffRows, DiffRowsView, useDiffTokens } from "./tool-cards/diff.js";
import { parseInput, str } from "./tool-cards/shell.js";

export type { PreviewTabPayload } from "../types.js";

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

type DiskState =
  | { status: "loading" }
  | { status: "ready"; text: string; truncated: boolean }
  | { status: "failed" };

/** 行出窗回落：按工作区路径读当前磁盘文本（二进制/超限/失败 = missing） */
function DiskPreviewBody(props: {
  read: () => Promise<WorkspaceFileContent>;
  ctx: WebPartContext;
}): ReactNode {
  const { read, ctx } = props;
  const [state, setState] = useState<DiskState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    read().then(
      (file) => {
        if (!active) return;
        if (file.encoding !== "utf8") {
          setState({ status: "failed" });
          return;
        }
        setState({ status: "ready", text: file.content, truncated: file.truncated === true });
      },
      () => {
        if (active) setState({ status: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [read]);
  if (state.status === "loading") {
    return <div className="henira-preview-empty">{ctx.t("preview.loading")}</div>;
  }
  if (state.status === "failed") {
    return <div className="henira-preview-empty">{ctx.t("preview.missing")}</div>;
  }
  if (state.text === "") {
    return <div className="henira-preview-empty">{ctx.t("preview.empty")}</div>;
  }
  return (
    <div className="henira-preview-disk">
      <div className="henira-preview-note">
        {ctx.t("preview.diskCurrent")}
        {state.truncated ? ` · ${ctx.t("preview.truncated")}` : ""}
      </div>
      <pre className="henira-preview-text">{state.text}</pre>
    </div>
  );
}

/** 官方内置预览体（也是注册到 sidebar.right.preview.* 的兜底件）：行在窗 = 行快照。 */
function BuiltinPreviewBody(props: {
  tab: PreviewTabPayload;
  ctx: WebPartContext;
  row?: ToolRow;
  read: () => Promise<WorkspaceFileContent>;
}): ReactNode {
  const { tab, ctx } = props;
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
  if (props.row !== undefined) {
    return <FilePreviewBody row={props.row} ctx={ctx} />;
  }
  if (tab.path === undefined || tab.path === "") {
    return <div className="henira-preview-empty">{ctx.t("preview.missing")}</div>;
  }
  return <DiskPreviewBody read={props.read} ctx={ctx} />;
}

/** 官方兜底件（module.ts 注册到通配键 sidebar.right.preview.*，与第三方同一注册路径）。 */
export const OfficialPreviewView: PreviewView = (args) => (
  <BuiltinPreviewBody tab={args.target} ctx={args.ctx} row={args.row} read={args.read} />
);

/** 预览体：tab 形状进、内容出（右栏/弹窗共用）。先查预览缝，无件/崩溃回落官方内置体。 */
export function PreviewBody(props: { tab: PreviewTabPayload; ctx: WebPartContext }): ReactNode {
  const { tab, ctx } = props;
  const view = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId),
    () => ctx.store.getSession(ctx.sessionId),
  );
  const row =
    tab.kind === "preview-file" && tab.rowId !== undefined
      ? view.rows.find((r) => r.rowId === tab.rowId)
      : undefined;
  const toolRow = row?.kind === "tool" ? row : undefined;
  const read = useCallback(async (): Promise<WorkspaceFileContent> => {
    if (tab.kind !== "preview-file" || tab.path === undefined || tab.path === "") {
      throw new Error("preview target has no file path");
    }
    const reader = ctx.host.readWorkspaceFile;
    if (reader === undefined) throw new Error("host cannot read workspace files");
    return reader(tab.path);
  }, [ctx.host, tab.kind, tab.path]);
  const ext = tab.kind === "preview-file" ? previewExt(tab.path) : "";
  const seam = pickPreviewSlot(
    ctx.slots.keys(),
    tab.kind === "preview-file" ? tab.path : undefined,
  );
  const builtin = (): ReactNode => (
    <BuiltinPreviewBody tab={tab} ctx={ctx} row={toolRow} read={read} />
  );
  const Seam =
    seam === undefined ? undefined : (ctx.slots.get(seam.name)?.[0] as PreviewView | undefined);
  if (seam !== undefined && Seam !== undefined) {
    return (
      <SlotBoundary key={seam.name} label={seam.name} fallback={builtin}>
        <Seam ctx={ctx} target={tab} ext={ext} row={toolRow} read={read} />
      </SlotBoundary>
    );
  }
  return builtin();
}

/** 预览缝的保留键（文档与测试用；宿主词表同源前缀） */
export const PREVIEW_WILDCARD_SLOT = `${PREVIEW_SLOT_PREFIX}*`;

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

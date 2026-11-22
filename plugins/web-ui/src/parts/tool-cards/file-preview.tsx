// 文件链接与预览弹窗（R178）：read 的文件名本身就是入口——内联文件图标+文件名，
// 不用行尾胶囊、不占展开位。内容取账本已捕获的 tool output，不新增后端接口。
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FileGlyph } from "../icons.js";
import { baseName } from "./shell.js";

export function FilePreviewDialog(props: {
  title: string;
  subtitle?: string;
  content: string;
  closeLabel?: string;
  onClose(): void;
}): React.ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  const node = (
    <div className="henira-preview-overlay">
      <div
        className="henira-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div className="henira-preview-head">
          <span className="henira-preview-path" title={props.title}>
            {props.title}
          </span>
          {props.subtitle !== undefined ? <span>{props.subtitle}</span> : null}
          <button
            type="button"
            className="henira-iconbtn"
            aria-label={props.closeLabel ?? "close"}
            onClick={props.onClose}
          >
            ×
          </button>
        </div>
        <div className="henira-preview-body">
          <pre>{props.content}</pre>
        </div>
      </div>
    </div>
  );
  const host = typeof document !== "undefined" ? document.querySelector(".henira-app") : null;
  return createPortal(node, host ?? document.body);
}

/** 文件链接（read 主信息：图标 + 文件名；有内容才可点开预览） */
export function FileChip(props: {
  path: string;
  label?: string;
  onOpen?(): void;
}): React.ReactNode {
  const name = props.label ?? baseName(props.path);
  if (props.onOpen === undefined) {
    return (
      <span className="henira-file-link is-static" title={props.path}>
        <FileGlyph size={16} />
        <span className="henira-file-link-name">{name}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="henira-file-link"
      title={props.path}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen?.();
      }}
    >
      <FileGlyph size={16} />
      <span className="henira-file-link-name">{name}</span>
    </button>
  );
}

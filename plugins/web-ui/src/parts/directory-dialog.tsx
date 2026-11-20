// 官方件：新增目录弹窗（槽内组件，非独立槽位）——服务端目录树 + 路径输入框双通道选目录，
// 浏览器可拿完整路径（此电脑 → 盘符 → 目录逐级懒展开；
// 单击回填路径框；手敲绝对路径直接确定）。数据经 browseDirs/addDir 承重缝（可选方法，
// 宿主缺方法时本弹窗不渲染——调用侧 feature-detect）。

import type { RegisteredDir } from "@henira/protocol";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { WebPartContext } from "../types.js";
import { CaretDownGlyph, CaretGlyph, XGlyph } from "./icons.js";

const DRIVES_ROOT = "__drives__";

interface DirTreeNode {
  path: string;
  label: string;
  kind: "root" | "drive" | "dir";
  expanded: boolean;
  loaded: boolean;
  children: DirTreeNode[];
}

/** 不可变树更新：按路径替换目标节点（浅层递归，弹窗树深度有限） */
function updateNode(
  nodes: DirTreeNode[],
  path: string,
  patch: (n: DirTreeNode) => DirTreeNode,
): DirTreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return patch(n);
    if (n.children.length === 0 && !n.expanded) return n;
    return { ...n, children: updateNode(n.children, path, patch) };
  });
}

export function DirectoryDialog(props: {
  ctx: WebPartContext;
  onAdded: (dir: RegisteredDir) => void;
  onClose: () => void;
}) {
  const { ctx } = props;
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tree, setTree] = useState<DirTreeNode[]>([
    {
      path: DRIVES_ROOT,
      label: ctx.t("dirs.computer"),
      kind: "root",
      expanded: true,
      loaded: false,
      children: [],
    },
  ]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [props.onClose]);

  // 挂载即拉盘符（不依赖用户点箭头；失败按空树处理不阻塞手敲路径）
  useEffect(() => {
    let cancelled = false;
    const browse = ctx.client.browseDirs;
    if (browse === undefined) return;
    void browse(DRIVES_ROOT)
      .then((res) => {
        if (cancelled) return;
        setTree((t) =>
          updateNode(t, DRIVES_ROOT, (n) => ({
            ...n,
            loaded: true,
            children: res.items.map((i) => ({
              path: i.path,
              label: i.name,
              kind: i.type === "drive" ? "drive" : "dir",
              expanded: false,
              loaded: false,
              children: [],
            })),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setTree((t) => updateNode(t, DRIVES_ROOT, (n) => ({ ...n, loaded: true })));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.client]);

  /** 懒加载一层子目录 */
  const expand = (node: DirTreeNode): void => {
    const browse = ctx.client.browseDirs;
    if (browse === undefined) return;
    setTree((t) => updateNode(t, node.path, (n) => ({ ...n, expanded: true })));
    void browse(node.path)
      .then((res) => {
        setTree((t) =>
          updateNode(t, node.path, (n) => ({
            ...n,
            loaded: true,
            expanded: true,
            children: res.items.map((i) => ({
              path: i.path,
              label: i.name,
              kind: "dir" as const,
              expanded: false,
              loaded: false,
              children: [],
            })),
          })),
        );
      })
      .catch(() => {
        setTree((t) => updateNode(t, node.path, (n) => ({ ...n, loaded: true, expanded: false })));
      });
  };

  const submit = (): void => {
    const trimmed = path.trim();
    if (trimmed === "") {
      setError(ctx.t("dirs.pathHint"));
      return;
    }
    const add = ctx.client.addDir;
    if (add === undefined) return;
    setBusy(true);
    setError(null);
    void add(trimmed)
      .then((dir) => {
        props.onAdded(dir);
        props.onClose();
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const renderNodes = (nodes: readonly DirTreeNode[], depth: number): ReactNode =>
    nodes.map((n) => (
      <div key={n.path}>
        <div className="henira-dir-row" style={{ paddingLeft: `${depth * 14}px` }}>
          <button
            type="button"
            className="henira-dir-caret"
            aria-label={n.expanded ? "-" : "+"}
            onClick={(e) => {
              e.stopPropagation();
              if (n.kind === "root" || n.loaded) {
                setTree((t) => updateNode(t, n.path, (x) => ({ ...x, expanded: !x.expanded })));
              } else {
                expand(n);
              }
            }}
          >
            {n.expanded ? <CaretDownGlyph size={12} /> : <CaretGlyph size={12} />}
          </button>
          <button
            type="button"
            className="henira-dir-label"
            aria-current={n.kind !== "root" && n.path === path ? "true" : undefined}
            title={n.path}
            onClick={() => {
              if (n.kind !== "root") setPath(n.path); // 单击回填路径框
            }}
            onDoubleClick={() => {
              if (n.kind !== "root" && !n.loaded) expand(n);
            }}
          >
            {n.kind === "drive" ? "💽" : n.kind === "dir" ? "📁" : "💻"} {n.label}
          </button>
        </div>
        {n.expanded && n.loaded ? (
          renderNodes(n.children, depth + 1)
        ) : n.expanded && !n.loaded ? (
          <div className="henira-dir-row" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
            <span className="henira-dir-label">{ctx.t("dirs.loading")}</span>
          </div>
        ) : null}
      </div>
    ));

  return (
    <div className="henira-overlay" role="presentation">
      <div className="henira-dialog" role="dialog" aria-label={ctx.t("dirs.add")}>
        <div className="henira-dialog-head">
          <strong>{ctx.t("dirs.add")}</strong>
          <button type="button" aria-label={ctx.t("common.cancel")} onClick={props.onClose}>
            <XGlyph size={14} />
          </button>
        </div>
        <label className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("dirs.path")}</div>
          <input
            ref={inputRef}
            className="henira-input"
            value={path}
            placeholder={ctx.t("dirs.pathPlaceholder")}
            onChange={(e) => {
              setPath(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) submit();
            }}
          />
          <div className="henira-field-hint">{ctx.t("dirs.pathHint")}</div>
        </label>
        <div className="henira-dir-tree">{renderNodes(tree, 0)}</div>
        {error !== null ? (
          <p role="alert" className="henira-send-error">
            {error}
          </p>
        ) : null}
        <div className="henira-dialog-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            {ctx.t("common.cancel")}
          </button>
          <button
            type="button"
            className="henira-primary"
            onClick={submit}
            disabled={busy || path.trim() === ""}
          >
            {busy ? ctx.t("dirs.loading") : ctx.t("dirs.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

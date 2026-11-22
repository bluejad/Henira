// 侧栏右键菜单（R177 拆分）：目录/会话两种目标。
import { type ReactNode, useEffect, useRef } from "react";
import type { WebPartContext } from "../../types.js";
import type { MenuState, PendingDelete } from "./groups.js";

/** 右键菜单（非模态，点外/Escape 关）：目录=新建会话/复制路径/删除目录；会话=删除 */
function ContextMenu(props: {
  menu: Exclude<MenuState, null>;
  ctx: WebPartContext;
  onClose(): void;
  onCreate(cwd: string): void;
  onCopy(cwd: string): void;
  onDelete(target: PendingDelete): void;
}) {
  const { menu, ctx } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [props]);

  const item = (
    label: string,
    action: () => void,
    opts?: { danger?: boolean; disabled?: boolean; title?: string },
  ): ReactNode => (
    <button
      type="button"
      className="henira-menu-item"
      data-danger={opts?.danger === true ? "true" : undefined}
      disabled={opts?.disabled}
      title={opts?.title}
      onClick={action}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="henira-context-menu" style={{ left: menu.x, top: menu.y }}>
      {menu.kind === "dir" ? (
        <>
          {item(ctx.t("menu.newSession"), () => props.onCreate(menu.dir.cwd))}
          {item(ctx.t("menu.copyPath"), () => props.onCopy(menu.dir.cwd))}
          <div className="henira-menu-sep" />
          {item(ctx.t("menu.deleteDir"), () => props.onDelete({ kind: "dir", dir: menu.dir }), {
            danger: true,
          })}
        </>
      ) : (
        item(
          ctx.t("menu.delete"),
          () => props.onDelete({ kind: "session", session: menu.session }),
          {
            danger: true,
            disabled: menu.session.busy,
            title: menu.session.busy ? ctx.t("menu.deleteBusy") : undefined,
          },
        )
      )}
    </div>
  );
}

export { ContextMenu };

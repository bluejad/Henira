// 官方件：权限 chip（D-080，输入卡工具排左端——参照物行为层：ZCode 左下模式 chip / dsh
// conversation.input.permission 席，形状是自己的）。两值菜单（改前询问 / 完全访问）+
// 切「完全访问」的风险确认卡（勾选确认才可提交；切回询问不确认）。
// 状态全部来自 ctx.composer（ComposerApi.permission / setPermission）——本件零私存；
// 显式会话记忆 → settings 新会话默认 → ask 的生效值由 composer-state 运行时归一。
// full 态 chip 警示色（danger 对），恢复会话时 chip 即是提醒（v1 不做横幅，D-080）。

import type { PermissionMode } from "@henira/protocol";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { useDismiss } from "./dropdown.js";
import { CaretDownGlyph, ShieldGlyph, WarnGlyph } from "./icons.js";

const MODES: PermissionMode[] = ["ask", "full"];

function ConfirmDialog(props: {
  ctx: WebPartContext;
  onConfirm(): void;
  onCancel(): void;
}): ReactNode {
  const { ctx } = props;
  const [acked, setAcked] = useState(false);
  const ackId = useId();
  // Esc 取消（与设置弹窗同一惯例：遮罩 / Esc 都能退，确认才需要勾选）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
  return (
    <div
      className="henira-overlay"
      role="dialog"
      aria-label={ctx.t("composer.permission.confirmTitle")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div className="henira-dialog">
        <div className="henira-dialog-head">
          <strong className="henira-permission-confirm-title">
            <WarnGlyph size={14} />
            {ctx.t("composer.permission.confirmTitle")}
          </strong>
        </div>
        <p className="henira-dialog-message">{ctx.t("composer.permission.confirmBody")}</p>
        <label className="henira-permission-ack" htmlFor={ackId}>
          <input
            id={ackId}
            type="checkbox"
            checked={acked}
            onChange={(e) => {
              setAcked(e.target.checked);
            }}
          />
          <span>{ctx.t("composer.permission.confirmAck")}</span>
        </label>
        <div className="henira-dialog-actions">
          <button type="button" onClick={props.onCancel}>
            {ctx.t("common.cancel")}
          </button>
          <button
            type="button"
            className="henira-danger"
            disabled={!acked}
            onClick={props.onConfirm}
          >
            {ctx.t("composer.permission.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 两值菜单（触点相对定位由外层 wrap 承担；open 期间才挂载——useDismiss 常真即对） */
function PermissionMenu(props: {
  ctx: WebPartContext;
  current: PermissionMode;
  onPick(mode: PermissionMode): void;
}): ReactNode {
  const { ctx } = props;
  const wrapRef = useRef<HTMLSpanElement>(null);
  useDismiss(true, wrapRef, () => props.onPick(props.current)); // 外点/Esc = 收起不换档
  return (
    <span ref={wrapRef} className="henira-permission-pop" role="menu">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="menuitemradio"
          aria-checked={props.current === mode}
          className="henira-permission-option"
          data-active={props.current === mode ? "true" : undefined}
          onClick={() => {
            props.onPick(mode);
          }}
        >
          <span className="henira-permission-option-label">
            {ctx.t(`composer.permission.${mode}`)}
          </span>
          <span className="henira-permission-option-desc">
            {ctx.t(`composer.permission.${mode}Desc`)}
          </span>
        </button>
      ))}
    </span>
  );
}

export const PermissionChip: WebPart = (ctx) => {
  const api = ctx.composer;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (api === undefined) return null;
  const full = api.permission === "full";

  const pick = (mode: PermissionMode): void => {
    setMenuOpen(false);
    if (mode === api.permission) return;
    if (mode === "full") {
      setConfirming(true); // 升格必过确认卡；降格直接生效
      return;
    }
    api.setPermission("ask");
  };

  return (
    <span className="henira-permission">
      <button
        type="button"
        className="henira-permission-trigger"
        data-full={full ? "true" : undefined}
        aria-label={ctx.t("composer.permission")}
        title={full ? ctx.t("composer.permission.fullTip") : ctx.t("composer.permission.askDesc")}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? "true" : undefined}
        onClick={() => {
          setMenuOpen((v) => !v);
        }}
      >
        <ShieldGlyph size={14} />
        <span className="henira-permission-trigger-label">
          {ctx.t(full ? "composer.permission.full" : "composer.permission.ask")}
        </span>
        <CaretDownGlyph size={10} />
      </button>
      {menuOpen ? <PermissionMenu ctx={ctx} current={api.permission} onPick={pick} /> : null}
      {confirming ? (
        <ConfirmDialog
          ctx={ctx}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            api.setPermission("full");
          }}
        />
      ) : null}
    </span>
  );
};

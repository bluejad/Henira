// 官方件：权限 chip（D-080，输入卡工具排左端——参照物行为层：ZCode 左下模式 chip / dsh
// conversation.input.permission 席，形状是自己的）。两值菜单（改前询问 / 完全访问）+
// 切「完全访问」的风险确认卡（勾选确认才可提交；切回询问不确认）。
// 状态全部来自 ctx.composer（ComposerApi.permission / setPermission）——本件零私存；
// 显式会话记忆 → settings 新会话默认 → ask 的生效值由 composer-state 运行时归一。
// full 态 chip 警示色（danger 对），恢复会话时 chip 即是提醒（v1 不做横幅，D-080）。

import {
  type PermissionMode,
  type PermissionRule,
  type PermissionSnapshot,
  permissionRuleKey,
  uniquePermissionRules,
} from "@henira/protocol";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { useDismiss } from "./dropdown.js";
import { CaretDownGlyph, HandGlyph, ShieldWarnGlyph, WarnGlyph } from "./icons.js";
import { PermissionRuleLine } from "./permission-rule.js";

const MODES: PermissionMode[] = ["ask", "full"];

/** 每档一个图标（菜单项与芯片触发钮共用）：询问 = 手掌止步，完全访问 = 警示盾 */
const MODE_GLYPHS: Record<PermissionMode, (props: { size?: number }) => ReactNode> = {
  ask: HandGlyph,
  full: ShieldWarnGlyph,
};

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

/** 两值菜单 + 本会话规则面板（同一 wrapper 内视图切换；open 期间才挂载——useDismiss 常真即对）。
 *  外点/Esc 收起整个弹层（不换档）；规则面板的返回键回模式菜单。 */
function PermissionMenu(props: {
  ctx: WebPartContext;
  current: PermissionMode;
  onPick(mode: PermissionMode): void;
}): ReactNode {
  const { ctx } = props;
  const wrapRef = useRef<HTMLSpanElement>(null);
  useDismiss(true, wrapRef, () => props.onPick(props.current)); // 外点/Esc = 收起不换档
  // 允许区（R198/R199）：打开菜单时拉一次快照；撤销是设置动作（账本落 approval/revoked）
  const [snapshot, setSnapshot] = useState<PermissionSnapshot | null>(null);
  const [view, setView] = useState<"menu" | "rules">("menu");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = ctx.client;
  const sessionId = ctx.sessionId;
  useEffect(() => {
    if (sessionId === null || client.sessionPermissions === undefined) return;
    let alive = true;
    void client
      .sessionPermissions(sessionId)
      .then((next) => {
        if (alive) setSnapshot(next);
      })
      .catch(() => {
        // 旧宿主 / 网络失败：不显示允许区（模式选择不受影响）
      });
    return () => {
      alive = false;
    };
  }, [sessionId, client]);
  const sessionRules = snapshot === null ? [] : uniquePermissionRules(snapshot.session.rules);
  const sessionTools = snapshot?.session.tools ?? [];
  const sessionCount = sessionRules.length + sessionTools.length;
  // 只数 allow：项目文件可手写 deny（deny 也是策略，但不是「本项目允许」）
  const projectCount =
    snapshot === null ? 0 : snapshot.project.filter((rule) => rule.decision === "allow").length;
  const canRevoke = client.revokeSessionApprovals !== undefined;
  const busy = revoking !== null;
  const refresh = async (): Promise<void> => {
    const read = client.sessionPermissions;
    if (read === undefined || sessionId === null) return;
    try {
      setSnapshot(await read(sessionId));
    } catch {
      setError(ctx.t("composer.permission.revokeFailed"));
    }
  };
  const revoke = (opts?: { tool?: string; rule?: PermissionRule }): void => {
    const run = client.revokeSessionApprovals;
    if (run === undefined || sessionId === null) return;
    const key =
      opts === undefined
        ? "all"
        : opts.rule !== undefined
          ? `rule:${permissionRuleKey(opts.rule)}`
          : `tool:${opts.tool ?? ""}`;
    setRevoking(key);
    setError(null);
    const result = opts === undefined ? run(sessionId) : run(sessionId, opts);
    void result
      .then(refresh)
      .catch(() => {
        setError(ctx.t("composer.permission.revokeFailed"));
      })
      .finally(() => {
        setRevoking(null);
      });
  };
  return (
    <span ref={wrapRef} className="henira-permission-pop" data-view={view}>
      {view === "menu" ? (
        <div className="henira-permission-view" role="menu">
          {MODES.map((mode) => {
            const Glyph = MODE_GLYPHS[mode];
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={props.current === mode}
                className="henira-permission-option"
                data-mode={mode}
                data-active={props.current === mode ? "true" : undefined}
                onClick={() => {
                  props.onPick(mode);
                }}
              >
                <span className="henira-permission-option-icon" aria-hidden="true">
                  <Glyph size={16} />
                </span>
                <span className="henira-permission-option-text">
                  <span className="henira-permission-option-label">
                    {ctx.t(`composer.permission.${mode}`)}
                  </span>
                  <span className="henira-permission-option-desc">
                    {ctx.t(`composer.permission.${mode}Desc`)}
                  </span>
                </span>
              </button>
            );
          })}
          {sessionCount > 0 || projectCount > 0 ? (
            <div className="henira-permission-extra">
              {sessionCount > 0 ? (
                <button
                  type="button"
                  className="henira-permission-extra-row henira-permission-extra-entry"
                  onClick={() => {
                    setView("rules");
                  }}
                >
                  <span>{ctx.t("composer.permission.sessionAllowed")}</span>
                  <span className="henira-permission-extra-count">
                    {sessionCount} {ctx.t("composer.permission.unit")}
                  </span>
                  <span className="henira-permission-extra-link">
                    {ctx.t("composer.permission.viewRules")} ›
                  </span>
                </button>
              ) : null}
              {projectCount > 0 ? (
                ctx.openSettings !== undefined ? (
                  <button
                    type="button"
                    className="henira-permission-extra-row henira-permission-extra-entry"
                    onClick={() => {
                      props.onPick(props.current);
                      ctx.openSettings?.("permission");
                    }}
                  >
                    <span>{ctx.t("composer.permission.projectAllowed")}</span>
                    <span className="henira-permission-extra-count">
                      {projectCount} {ctx.t("composer.permission.unit")}
                    </span>
                    <span className="henira-permission-extra-link">
                      {ctx.t("composer.permission.manageInSettings")} ›
                    </span>
                  </button>
                ) : (
                  <div className="henira-permission-extra-row">
                    <span>{ctx.t("composer.permission.projectAllowed")}</span>
                    <span className="henira-permission-extra-count">
                      {projectCount} {ctx.t("composer.permission.unit")}
                    </span>
                  </div>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="henira-permission-view"
          role="dialog"
          aria-label={ctx.t("composer.permission.sessionRulesTitle")}
        >
          <div className="henira-permission-rules-head">
            <button
              type="button"
              className="henira-permission-rules-back"
              aria-label={ctx.t("composer.permission.back")}
              onClick={() => {
                setView("menu");
              }}
            >
              ‹
            </button>
            <strong>{ctx.t("composer.permission.sessionRulesTitle")}</strong>
            <span className="henira-permission-extra-count">
              {sessionCount} {ctx.t("composer.permission.unit")}
            </span>
          </div>
          <div className="henira-permission-rules-body">
            {sessionCount === 0 ? (
              <div className="henira-permission-rules-empty">
                {ctx.t("composer.permission.sessionRulesEmpty")}
              </div>
            ) : (
              <div className="henira-permission-rules-list">
                {sessionRules.map((rule) => (
                  <PermissionRuleLine
                    key={permissionRuleKey(rule)}
                    ctx={ctx}
                    rule={rule}
                    action={
                      <button
                        type="button"
                        className="henira-permission-rule-revoke"
                        disabled={!canRevoke || busy}
                        onClick={() => {
                          revoke({ rule });
                        }}
                      >
                        {ctx.t("permission.rule.revoke")}
                      </button>
                    }
                  />
                ))}
                {sessionTools.map((tool) => (
                  <PermissionRuleLine
                    key={`tool:${tool}`}
                    ctx={ctx}
                    tool={tool}
                    action={
                      <button
                        type="button"
                        className="henira-permission-rule-revoke"
                        disabled={!canRevoke || busy}
                        onClick={() => {
                          revoke({ tool });
                        }}
                      >
                        {ctx.t("permission.rule.revoke")}
                      </button>
                    }
                  />
                ))}
              </div>
            )}
            <p className="henira-permission-rules-hint">
              {ctx.t("composer.permission.revokeHint")}
            </p>
            {error !== null ? <p className="henira-permission-rules-error">{error}</p> : null}
          </div>
          <div className="henira-permission-rules-foot">
            <button
              type="button"
              className="henira-permission-revoke"
              disabled={!canRevoke || busy || sessionCount === 0}
              onClick={() => {
                revoke();
              }}
            >
              {ctx.t("composer.permission.revokeAll")}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export const PermissionChip: WebPart = (ctx) => {
  const api = ctx.composer;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (api === undefined) return null;
  const full = api.permission === "full";
  const ModeGlyph = MODE_GLYPHS[api.permission];

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
        <ModeGlyph size={14} />
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

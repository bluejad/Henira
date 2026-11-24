// 权限页（D-080 第五页）：新会话默认权限模式。会话内可单独切换（输入框左侧 chip）且随
// 会话记忆——本页只管「新会话从哪档起步」；改后无显式记忆的会话即时跟随（设置关闭时
// composer 运行时重拉 getSettings，D-080）。
import type { PermissionMode } from "@henira/protocol";
import { type ReactNode, useEffect, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { HeniraSelect } from "../dropdown.js";

const MODES: PermissionMode[] = ["ask", "full"];

function PermissionPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [value, setValue] = useState<PermissionMode | undefined>(undefined);
  // 挂载读当前默认（读取失败保持 undefined → 选择器暂显占位档 ask，写面不受影响）
  useEffect(() => {
    let alive = true;
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (alive) setValue(s.permissionMode ?? "ask");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  return (
    <div className="henira-settings-page">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.permission.title")}</h2>
        <p>{ctx.t("settings.permission.hint")}</p>
      </header>
      <div className="henira-settings-card">
        <div className="henira-settings-row">
          <div className="henira-settings-row-text">
            <div className="henira-settings-row-label">{ctx.t("settings.permission.default")}</div>
            <div className="henira-settings-row-hint">
              {ctx.t("settings.permission.defaultHint")}
            </div>
          </div>
          <HeniraSelect
            variant="input"
            ariaLabel={ctx.t("settings.permission.default")}
            value={value ?? "ask"}
            options={MODES.map((mode) => ({
              value: mode,
              label: ctx.t(`composer.permission.${mode}`),
            }))}
            onChange={(next) => {
              setValue(next as PermissionMode);
              // 旧服务器/宿主无 putSettings 静默跳过（外观页同惯例）
              void ctx.client
                .putSettings?.({ permissionMode: next as PermissionMode })
                .catch(() => {});
            }}
          />
        </div>
        <div className="henira-settings-row">
          <div className="henira-settings-row-text">
            <div className="henira-settings-row-label">{ctx.t("settings.permission.scope")}</div>
            <div className="henira-settings-row-hint">{ctx.t("settings.permission.scopeHint")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { PermissionPage };

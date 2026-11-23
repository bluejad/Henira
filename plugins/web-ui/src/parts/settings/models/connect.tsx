// 模型管理·连接已知厂商视图（R187 拆分；R188 版式收口：页头/顶部返回/限宽表单卡）。
import { type ReactNode, useState } from "react";
import type { WebPartContext } from "../../../types.js";

export function KnownProviderForm(props: {
  ctx: WebPartContext;
  targetId: string;
  targetName: string;
  busy: boolean;
  error: string | null;
  onSubmit(key: string): void;
  onCancel(): void;
}): ReactNode {
  const { ctx } = props;
  const [key, setKey] = useState("");
  // 空 key 本地拦（词表文案）——服务端 400 原文是英文，不该直出到用户眼前（审查 P2 2026-11-19）
  const [localError, setLocalError] = useState<string | null>(null);
  const err = localError ?? props.error;
  const submit = (): void => {
    if (key.trim() === "") {
      setLocalError(ctx.t("settings.models.errKey"));
      return;
    }
    setLocalError(null);
    props.onSubmit(key);
  };
  return (
    <div className="henira-settings-page henira-models-form">
      <header className="henira-settings-page-head">
        <h2>
          {ctx.t("settings.models.connectTitle")} {props.targetName}
        </h2>
        <p>{ctx.t("settings.models.keyHint")}</p>
      </header>
      <div className="henira-models-toolbar">
        <button type="button" className="henira-ghost" onClick={props.onCancel}>
          {ctx.t("settings.models.back")}
        </button>
        <span className="henira-models-toolbar-space" />
      </div>
      <div className="henira-form-card">
        <label className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.keyLabel")}</div>
          <input
            className="henira-input"
            type="password"
            value={key}
            placeholder={ctx.t("settings.models.keyPlaceholder")}
            onChange={(e) => {
              setKey(e.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !props.busy) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>
        {err !== null ? <div className="henira-models-error">{err}</div> : null}
        <div className="henira-model-form-actions">
          <button type="button" className="henira-primary" disabled={props.busy} onClick={submit}>
            {props.busy ? ctx.t("settings.models.submitting") : ctx.t("settings.models.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

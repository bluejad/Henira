// 删除确认弹窗（R177 拆分）：硬删不可恢复，目录删除带 busy 守卫。
import type { SessionSummary } from "@henira/protocol";
import { useState } from "react";
import type { WebPartContext } from "../../types.js";
import { XGlyph } from "../icons.js";
import { type PendingDelete, sameCwd } from "./groups.js";

/** 删除确认弹窗（硬删除不可恢复；目录删除带 busy 前置守卫） */
function DeleteConfirm(props: {
  ctx: WebPartContext;
  target: PendingDelete;
  sessions: readonly SessionSummary[];
  onClose(): void;
  onDone(): void;
}) {
  const { ctx, target } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = ctx.t;

  const blockedCount =
    target.kind === "dir"
      ? props.sessions.filter((s) => sameCwd(s.cwd, target.dir.cwd) && s.busy).length
      : 0;
  const title = target.kind === "dir" ? t("dirs.deleteTitle") : t("sessions.deleteTitle");
  const message = target.kind === "dir" ? t("dirs.deleteMessage") : t("sessions.deleteMessage");

  const confirm = (): void => {
    setBusy(true);
    setError(null);
    const job =
      target.kind === "dir"
        ? ctx.client.deleteDir?.(target.dir.id)
        : ctx.client.deleteSession?.(target.session.id);
    if (job === undefined) return;
    void job.then(props.onDone).catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="henira-overlay" role="presentation">
      <div className="henira-dialog" role="dialog" aria-label={title}>
        <div className="henira-dialog-head">
          <strong>{title}</strong>
          <button
            type="button"
            aria-label={t("common.cancel")}
            onClick={props.onClose}
            disabled={busy}
          >
            <XGlyph size={14} />
          </button>
        </div>
        <p className="henira-dialog-message">{message}</p>
        {target.kind === "dir" ? <p className="henira-dialog-path">{target.dir.cwd}</p> : null}
        {blockedCount > 0 ? (
          <p role="alert" className="henira-send-error">
            {t("dirs.deleteBusy").replace("{n}", String(blockedCount))}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="henira-send-error">
            {t("dirs.deleteFailed")}：{error}
          </p>
        ) : null}
        <div className="henira-dialog-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="henira-danger"
            onClick={confirm}
            disabled={busy || blockedCount > 0}
          >
            {busy ? t("dirs.loading") : t("menu.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export { DeleteConfirm };

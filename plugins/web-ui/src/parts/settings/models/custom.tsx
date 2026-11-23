// 模型管理·自定义 OpenAI 兼容厂商视图（R187 拆分：原 settings/models.tsx CustomProviderForm，行为零变化）。
import { type ReactNode, useRef, useState } from "react";
import type { WebPartContext } from "../../../types.js";
import { XGlyph } from "../../icons.js";

interface CustomModelRow {
  key: number;
  model: string;
  label: string;
}

export function CustomProviderForm(props: {
  ctx: WebPartContext;
  busy: boolean;
  error: string | null;
  onSubmit(input: {
    label?: string;
    baseUrl: string;
    key?: string;
    models: Array<{ model: string; label?: string }>;
  }): void;
  onCancel(): void;
}): ReactNode {
  const { ctx } = props;
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const nextKey = useRef(1);
  const [rows, setRows] = useState<CustomModelRow[]>([{ key: 0, model: "", label: "" }]);
  const [localError, setLocalError] = useState<string | null>(null);
  const err = localError ?? props.error;

  return (
    <div className="henira-settings-page henira-models-form">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.models.customTitle")}</h2>
        <p>{ctx.t("settings.models.customHint")}</p>
      </header>
      <div className="henira-models-toolbar">
        <button type="button" className="henira-ghost" onClick={props.onCancel}>
          {ctx.t("settings.models.back")}
        </button>
        <span className="henira-models-toolbar-space" />
      </div>
      <div className="henira-form-card">
        <label className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.formLabel")}</div>
          <input
            className="henira-input"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
        </label>
        <label className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.formBaseUrl")}</div>
          <input
            className="henira-input"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(e) => {
              setBaseUrl(e.target.value);
            }}
          />
        </label>
        <label className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.formKey")}</div>
          <input
            className="henira-input"
            type="password"
            value={key}
            placeholder={ctx.t("settings.models.keyPlaceholder")}
            onChange={(e) => {
              setKey(e.target.value);
            }}
          />
        </label>
        <div className="henira-field-label">{ctx.t("settings.models.formModels")}</div>
        {rows.map((row, i) => (
          <div key={row.key} className="henira-custom-model-row">
            <input
              className="henira-input"
              placeholder={ctx.t("settings.models.formModelId")}
              value={row.model}
              onChange={(e) => {
                setRows(rows.map((r, j) => (j === i ? { ...r, model: e.target.value } : r)));
              }}
            />
            <input
              className="henira-input"
              placeholder={ctx.t("settings.models.formModelName")}
              value={row.label}
              onChange={(e) => {
                setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)));
              }}
            />
            <button
              type="button"
              className="henira-iconbtn"
              title={ctx.t("settings.models.removeModel")}
              onClick={() => {
                setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);
              }}
            >
              <XGlyph size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="henira-ghost"
          onClick={() => {
            setRows([...rows, { key: nextKey.current++, model: "", label: "" }]);
          }}
        >
          {ctx.t("settings.models.addModel")}
        </button>
        {err !== null ? <div className="henira-models-error">{err}</div> : null}
        <div className="henira-model-form-actions">
          <button
            type="button"
            className="henira-primary"
            disabled={props.busy}
            onClick={() => {
              if (baseUrl.trim() === "") {
                setLocalError(ctx.t("settings.models.errBaseUrl"));
                return;
              }
              const valid = rows.filter((r) => r.model.trim() !== "");
              if (valid.length === 0) {
                setLocalError(ctx.t("settings.models.errModels"));
                return;
              }
              setLocalError(null);
              props.onSubmit({
                ...(label.trim() === "" ? {} : { label: label.trim() }),
                baseUrl: baseUrl.trim(),
                ...(key.trim() === "" ? {} : { key: key.trim() }),
                models: valid.map((r) => ({
                  model: r.model.trim(),
                  ...(r.label.trim() === "" ? {} : { label: r.label.trim() }),
                })),
              });
            }}
          >
            {props.busy ? ctx.t("settings.models.submitting") : ctx.t("settings.models.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

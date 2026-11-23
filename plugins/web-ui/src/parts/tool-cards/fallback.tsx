// 通用卡（R178）：keyed 缝查不到官方卡 / meta 校验不过 / 第三方工具的三路兜底。
// 参数是键值表（扁平对象不露花括号），结果是文本/代码块；失败只给状态词不自动展开。
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import {
  type CardProps,
  failureTitle,
  formatToolName,
  parseInput,
  toolFailure,
  tryFormatJson,
} from "./shell.js";

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value, null, 2) ?? "";
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => item === null || typeof item !== "object");
}

/** 参数区：扁平对象 = 两列键值表；嵌套对象/数组 = 格式化 JSON；空对象 = 一句无参数。 */
function ParameterBlock({
  input,
  emptyLabel,
}: {
  input: Record<string, unknown> | null;
  emptyLabel: string;
}) {
  if (input === null) return null;
  if (isFlatObject(input)) {
    const entries = Object.entries(input);
    if (entries.length === 0) {
      return <p className="henira-tool-empty">{emptyLabel}</p>;
    }
    return (
      <dl className="henira-param-list">
        {entries.map(([key, value]) => (
          <div key={key} className="henira-param-row">
            <dt>{key}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre className="henira-tool-pre is-args">{JSON.stringify(input, null, 2)}</pre>;
}

export function ToolView({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const running = row.status === "running";
  const failed = row.status === "error" || row.output?.isError === true;
  const kind = formatToolName(row.name);
  const status = failed
    ? ctx.t("row.status.error")
    : running
      ? ctx.t("row.status.running")
      : ctx.t("tool.kind.done");
  return (
    <ToolRow
      icon={toolGlyph(row.name)}
      kindLabel={kind}
      secondary={status}
      busy={running}
      canToggle={input !== null || row.output !== undefined}
      persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
      rowTitle={`${row.name} (${row.callId})`}
      status={toolFailure(row, ctx.t)}
      statusTitle={failureTitle(row)}
    >
      <div className="henira-tool-card">
        {input !== null ? (
          <section className="henira-tool-section">
            <h4 className="henira-tool-label">{ctx.t("tool.params")}</h4>
            <ParameterBlock input={input} emptyLabel={ctx.t("tool.noParams")} />
          </section>
        ) : null}
        <section className="henira-tool-section">
          <h4 className="henira-tool-label">
            {failed ? ctx.t("tool.error") : ctx.t("tool.result")}
          </h4>
          {row.output !== undefined && row.output.content !== "" ? (
            <pre className={`henira-tool-pre${failed ? " is-error" : ""}`}>
              {tryFormatJson(row.output.content) ?? row.output.content}
            </pre>
          ) : (
            <p className="henira-tool-empty">
              {running ? ctx.t("tool.waiting") : ctx.t("tool.noResult")}
            </p>
          )}
          {row.output?.truncated !== undefined ? (
            <p className="henira-tool-note" title={row.output.truncated.path}>
              {ctx.t("row.truncated")}
            </p>
          ) : null}
        </section>
      </div>
    </ToolRow>
  );
}

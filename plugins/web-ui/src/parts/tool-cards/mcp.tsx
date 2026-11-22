// MCP 卡（R178）：类别词「MCP」+ server + 工具名；展开先给结果（短结果小卡 / 长结果代码块），
// 参数收进二级「调用详情」——不再把 {…} 参数对象摊在卡顶。
import { CopyButton } from "../copy-button.js";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { ToolView } from "./fallback.js";
import {
  asMeta,
  type CardProps,
  failureTitle,
  formatToolName,
  parseInput,
  str,
  toolFailure,
  tryFormatJson,
} from "./shell.js";

const COMPACT_RESULT_MAX_LENGTH = 160;

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isCompactResult(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= COMPACT_RESULT_MAX_LENGTH &&
    !trimmed.includes("\n") &&
    !looksLikeJson(trimmed)
  );
}

export function McpCard({ row, ctx }: CardProps): React.ReactNode {
  let server: string | undefined;
  let tool: string | undefined;
  const meta = row.output === undefined ? null : asMeta(row, "mcp");
  if (meta !== null) {
    server = str(meta.server) ?? undefined;
    tool = str(meta.tool) ?? undefined;
  }
  if (server === undefined || tool === undefined) {
    const parts = row.name.split("__");
    if (parts.length >= 3 && parts[0] === "mcp") {
      server = parts[1];
      tool = parts.slice(2).join("__");
    }
  }
  if (server === undefined || tool === undefined) return <ToolView row={row} ctx={ctx} />;
  const input = parseInput(row);
  const output = row.output;
  const running = row.status === "running";
  const resultText = output?.content ?? "";
  const failed = output?.isError === true || row.status === "error";
  return (
    <ToolRow
      icon={toolGlyph("mcp")}
      kindLabel={ctx.t("tool.kind.mcp")}
      kindDetail={server}
      primary={formatToolName(tool)}
      busy={running}
      canToggle={output !== undefined || input !== null}
      persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
      rowTitle={`${row.name} · ${row.callId}`}
      status={failed ? ctx.t("row.status.error") : toolFailure(row, ctx.t)}
      statusTitle={failureTitle(row)}
    >
      <div className="henira-tool-card">
        {resultText !== "" ? (
          failed ? (
            <p className="henira-mcp-result is-error">{resultText}</p>
          ) : isCompactResult(resultText) ? (
            <p className="henira-mcp-result is-compact">{resultText.trim()}</p>
          ) : (
            <div className="henira-mcp-result is-code">
              <div className="henira-mcp-result-head">
                <span>{ctx.t("tool.result")}</span>
                <CopyButton text={resultText} t={ctx.t} className="henira-mcp-copy" />
              </div>
              <pre className="henira-tool-pre">{tryFormatJson(resultText) ?? resultText}</pre>
            </div>
          )
        ) : running ? (
          <p className="henira-tool-empty">{ctx.t("tool.waiting")}</p>
        ) : (
          <p className="henira-tool-empty">{ctx.t("tool.noResult")}</p>
        )}
        {input !== null ? (
          <details className="henira-mcp-details">
            <summary>{ctx.t("tool.callDetails")}</summary>
            <pre className="henira-tool-pre is-args">{JSON.stringify(input, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </ToolRow>
  );
}

// 行级视图（R177 重做）：RowView 分发 + user/assistant/error 行；样式走 CSS 类
//（中间区零内联布局样式——参照实现 层级：正文裸排、用户右气泡、错误语义底）。
import type { AssistantRow, ErrorRow, Row, UserRow } from "@henira/protocol";
import { memo } from "react";
import type { WebPart, WebPartContext } from "../../types.js";
import { CopyButton } from "../copy-button.js";
import { Pill } from "../row-chrome.js";
import { SlotBoundary } from "../slot-boundary.js";
import { formatTurnClock } from "./format.js";
import { ReasoningView } from "./reasoning.js";
import { ToolRowView } from "./tool-row.js";

const RowView = memo(
  function RowView({
    row,
    ctx,
    skipReasoning,
  }: {
    row: Row;
    ctx: WebPartContext;
    skipReasoning?: boolean;
  }): React.ReactNode {
    switch (row.kind) {
      case "user":
        return <UserView row={row} ctx={ctx} />;
      case "assistant":
        return <AssistantView row={row} ctx={ctx} skipReasoning={skipReasoning} />;
      case "tool":
        return <ToolRowView row={row} ctx={ctx} />;
      case "approval":
        // 官方对话流不渲染审批痕迹（参照实现的行模型无 approval 行；pending 在输入区 dock，
        // settled 后数据仍留在 store，自定义 conversation 区域可自行消费）。
        return null;
      case "question":
        // 提问行同理不进正文流：挂起卡在输入区 dock，痕迹由 ask_user 工具卡承载（R184）
        return null;
      case "error":
        return <ErrorView row={row} ctx={ctx} />;
    }
  },
  // ctx 本体每渲染都是新对象（宿主 <Part {...ctxValue} /> spread）——比较稳定子集：
  // row 同引用（store 契约）+ t/host/slots 同引用（shell useMemo；字典/插件变更时正确重渲刷新）
  (a, b) =>
    a.row === b.row &&
    a.ctx.t === b.ctx.t &&
    a.ctx.host === b.ctx.host &&
    a.ctx.slots === b.ctx.slots &&
    a.skipReasoning === b.skipReasoning,
);

function UserView({ row, ctx }: { row: UserRow; ctx: WebPartContext }) {
  return (
    <div className="henira-user-group">
      {row.source === "steer" || row.source === "veto" || row.source === "breaker" ? (
        <div className="henira-user-source">
          <Pill bg="var(--henira-info-bg)" color="var(--henira-info-text)">
            {row.source}
          </Pill>
        </div>
      ) : null}
      <div className="henira-user-bubble">{row.text}</div>
      <div className="henira-user-actions" data-actions-reveal="hover">
        {row.time !== undefined ? (
          <span className="henira-turn-time">{formatTurnClock(row.time)}</span>
        ) : null}
        <CopyButton text={row.text} t={ctx.t} />
      </div>
    </div>
  );
}

function AssistantView({
  row,
  ctx,
  skipReasoning,
}: {
  row: AssistantRow;
  ctx: WebPartContext;
  skipReasoning?: boolean;
}): React.ReactNode {
  const streaming = row.streaming;
  const gallery = ctx.slots.get("conversation.images")?.[0] as WebPart | undefined;
  const reasoning = row.reasoning !== undefined && row.reasoning !== "" ? row.reasoning : undefined;
  return (
    <div className="henira-assistant">
      {reasoning !== undefined && skipReasoning !== true ? (
        <ReasoningView reasoning={reasoning} streaming={streaming === true} ctx={ctx} />
      ) : null}
      <div className={streaming ? "henira-streaming" : undefined}>
        {ctx.host.renderMarkdown(row.text, { streaming })}
      </div>
      {gallery !== undefined
        ? (() => {
            const Gallery = gallery; // 组件渲染（hooks 合法——批 C 修正）
            return (
              <SlotBoundary label="conversation.images">
                <Gallery {...ctx} />
              </SlotBoundary>
            );
          })()
        : null}
    </div>
  );
}

function ErrorView({ row, ctx }: { row: ErrorRow; ctx: WebPartContext }) {
  // 已知配置类错误翻成可行动中文（模型目录收敛批：闸门后用户本不该走到这——兜底），
  // 原文折叠保留（排障仍要英文原文）；其余错误照旧直出
  const hint = row.message.includes("no credential for provider")
    ? ctx.t("error.noCredentialHint")
    : row.message.includes("has no baseUrl")
      ? ctx.t("error.noBaseUrlHint")
      : undefined;
  return (
    <div role="alert" className="henira-error-row">
      <strong>{ctx.t("error.title")}</strong>
      {row.code !== undefined ? <span className="henira-error-code">{row.code}</span> : null}
      {hint !== undefined ? (
        <>
          <div className="henira-error-hint">{hint}</div>
          <details className="henira-error-details">
            <summary>{ctx.t("error.rawDetail")}</summary>
            <span className="henira-error-raw">{row.message}</span>
          </details>
        </>
      ) : (
        <span className="henira-error-raw">{row.message}</span>
      )}
    </div>
  );
}

export { AssistantView, ErrorView, RowView, UserView };

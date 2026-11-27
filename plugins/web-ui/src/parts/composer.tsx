// 官方件：输入栏（单槽 composer.bar，R182；ComposerDock 的 fallback）。
// R183：草稿/模型/发送状态上移到 composer-state（ComposerApi），本件退成纯视图——
// 两层卡（输入行上、工具排下）+ 四个座位位：模型席（composer.model，单槽）、左右追加位
// （composer.left / composer.right，官方空）、dock（composer.dock，卡外，ComposerDock 渲染）。
// 接管（审批/提问）不在本件：ComposerDock 经 composer.takeover chain 选举接管条目，本件在
// 接管期间保持挂载但 display:none（草稿不丢）。发送/停止语义照 ZCode（showStopControl =
// canStop && !hasDraftToSubmit）：忙+有草稿=发送（排队插话）、忙+空草稿=停止——有字时圆钮恒为
// 发送，杜绝「打着字点按钮却停了回合」的歧义。prompt 失败不静默：草稿回填 + 行内错误提示。
// D-092：手动压缩只从输入框出去——首词 /compact 与消息走同一个发送键 / 同一个 submit（识别在
// composer-state）；本件只负责把提交后的行内原因 / 回执说明画出来。
// 本件必须在 ComposerDock 内渲染（需要 ctx.composer）；单独装配请用 ComposerDock 整座。

import { COMPACT_COMMAND } from "@henira/protocol";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ComposerApi, WebPart, WebPartContext } from "../types.js";
import { ContextUsageButton } from "./context-usage.js";
import { SendGlyph, StopGlyph } from "./icons.js";
import { PermissionChip } from "./permission-menu.js";
import { SlotBoundary } from "./slot-boundary.js";

const TEXTAREA_MAX_HEIGHT = 160; // ZCode max-h-40（CSS 同值；autoGrow 上限）

/** 座位列表（list/single 通用渲染；空席不占位）。件拿 partCtx（含 ctx.composer） */
function ComposerSeats({ ctx, name }: { ctx: WebPartContext; name: string }): ReactNode {
  const parts = (ctx.slots.get(name) ?? []) as WebPart[];
  if (parts.length === 0) return null;
  return (
    <span className="henira-composer-seat">
      {parts.map((Part) => (
        <SlotBoundary key={Part.name} label={name}>
          <Part {...ctx} />
        </SlotBoundary>
      ))}
    </span>
  );
}

/** 压缩熔断横幅（F-7/F-8）：自动压缩已停；重试 = 手动压缩（成功即解除），
 *  或新开会话。常驻到手动成功 / 插件广播解除。重试与余量面板同一出口：把命令交给
 *  输入框、由用户点发送（D-092——手动压缩不从按钮直发）。 */
function CompactionBanner({ ctx }: { ctx: WebPartContext }): ReactNode {
  const reason = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.compactionBreaker,
    () => undefined,
  );
  if (reason === undefined || ctx.sessionId === null) return null;
  const retry = (): void => {
    ctx.host.prefill({ text: COMPACT_COMMAND });
    ctx.composer?.focus(); // 输入框已有草稿时不覆盖——把视线带回输入框
  };
  const createNew = (): void => {
    const cwd = ctx.host.getSession()?.cwd;
    void ctx.client
      .createSession(cwd !== undefined ? { cwd } : undefined)
      .then((created) => {
        ctx.selectSession(created.id);
      })
      .catch(() => {});
  };
  return (
    <div className="henria-compaction-banner" role="status">
      <span className="henira-compaction-banner-text">
        {ctx.t(`composer.compactionBreaker.${reason}`)}
      </span>
      <span className="henira-compaction-banner-actions">
        <button type="button" onClick={retry} disabled={ctx.client.compact === undefined}>
          {ctx.t("composer.compactionRetry")}
        </button>
        <button type="button" onClick={createNew}>
          {ctx.t("composer.compactionNewSession")}
        </button>
      </span>
    </div>
  );
}

export const Composer: WebPart = (ctx) => {
  const api = ctx.composer;
  if (api === undefined) {
    // 官方 bar 只在 ComposerDock 内装配（草稿/焦点是座位共享状态）
    throw new Error("Composer must be rendered inside ComposerDock (missing ctx.composer)");
  }
  return <ComposerBar ctx={ctx} api={api} />;
};

function ComposerBar({ ctx, api }: { ctx: WebPartContext; api: ComposerApi }): ReactNode {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { draft, registerInput } = api;
  // 压缩是会话级活动（活态总线）：闲时手动压缩也占用停止钮（compaction.md §4.11）
  const compacting = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.compacting === true,
    () => false,
  );

  const setArea = useCallback(
    (el: HTMLTextAreaElement | null): void => {
      areaRef.current = el;
      registerInput(el); // focus() 目标（座位件/接管结束用）
    },
    [registerInput],
  );

  useEffect(() => {
    // 草稿清空（发送成功）后复位自动增高
    const el = areaRef.current;
    if (el !== null && draft === "") el.style.height = "";
  }, [draft]);

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  };

  const hasDraft = draft.trim() !== "";
  // D-092：压缩也是一段「该排队」的活跃时段——发送键/占位与回合忙时同口径
  const waiting = api.busy || compacting;
  const showStop = waiting && !hasDraft; // 有草稿恒为发送（排队）；压缩中空草稿 = 停止
  // 忙/压缩+有草稿：发送=排队、Ctrl+Enter=插话（E1 发送模式 UI——按钮文案同步切换）
  const sendLabel = waiting ? ctx.t("composer.queueSend") : ctx.t("composer.send");

  // 占位三态（ZCode 行为层）：忙=排队提示 / 空会话=新提问 / 有历史=追问。键盘说明退场
  //（Enter/Shift+Enter 属平台惯例，修饰键提示由发送钮 tooltip 承担）。
  const placeholder = waiting
    ? ctx.t("composer.placeholder.queue")
    : api.isEmpty
      ? ctx.t("composer.placeholder")
      : ctx.t("composer.placeholder.followUp");

  return (
    <div className="henira-composer">
      {api.sendFailed ? (
        <p role="alert" className="henira-send-error">
          {api.sendErrorText ?? ctx.t("composer.sendFailed")}
        </p>
      ) : api.sendNotice !== undefined ? (
        // 提交回执说明（非失败，草稿已清）：与失败行同版式、中性配色
        <p role="status" className="henira-send-error henira-send-notice">
          {api.sendNotice}
        </p>
      ) : null}
      <CompactionBanner ctx={ctx} />
      <div className="henira-composer-card">
        <textarea
          ref={setArea}
          value={draft}
          rows={1}
          data-testid="composer-input"
          placeholder={placeholder}
          onChange={(e) => {
            api.setDraft(e.target.value); // 本地态 + 宿主合并防抖落盘（D-063）
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              api.submit(undefined, { steer: e.ctrlKey || e.metaKey }); // Enter=排队 / Ctrl+Enter=插话
            }
          }}
        />
        <div className="henira-composer-bar">
          {/* 权限 chip（D-080）：模型席左侧；不是槽——引擎安全语义的直通控件（同发送/停止） */}
          <PermissionChip {...ctx} />
          {/* 模型席（单槽）：官方默认件 = ModelSeat（模型 + 思考档）；第三方 replaceSlot 顶替 */}
          <ComposerSeats ctx={ctx} name="composer.model" />
          {/* 工具排左追加位（官方空；插件 registerSlot 追加） */}
          <ComposerSeats ctx={ctx} name="composer.left" />
          <span className="henira-composer-spacer" />
          {/* 工具排右追加位（官方空；发送/停止之前的插件按钮区） */}
          <ComposerSeats ctx={ctx} name="composer.right" />
          {/* 余量入口（compaction.md §4.11）：常驻圆环，不是槽——引擎计量活态的直通控件 */}
          <ContextUsageButton ctx={ctx} />
          {showStop ? (
            <button
              type="button"
              className="henira-icon-round henira-stop"
              aria-label={ctx.t("composer.stop")}
              title={ctx.t("composer.stop")}
              onClick={() => {
                api.stop();
              }}
            >
              <StopGlyph size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="henira-icon-round henira-primary"
              aria-label={sendLabel}
              title={api.busy ? ctx.t("composer.sendHint") : sendLabel}
              onClick={() => {
                api.submit();
              }}
              disabled={!hasDraft || api.sessionId === null}
            >
              <SendGlyph size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

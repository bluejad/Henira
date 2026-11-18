// 官方件：输入区（槽 composer）。两层卡（ZCode ConversationComposer 行为层：输入行上、工具排下）。
// 发送/停止语义照 ZCode（showStopControl = canStop && !hasDraftToSubmit）：忙+有草稿=发送（排队
// 插话）、忙+空草稿=停止——有字时圆钮恒为发送，杜绝「打着字点按钮却停了回合」的歧义。
// 审批接管 dock（M4 批 A 视觉二轮）：pending 审批卡渲染在输入卡上方，Enter 让位语义照旧。
// prompt 失败不静默：草稿回填 + 行内错误提示。
// 模型/思考按次绑定（BC 语义，骨架批）：选择=会话级绑定（ui-state 记忆，回填一次），权威在
// 每次请求携带（prompt opts）；不再写全局 settings.model（那是设置弹窗·模型管理页的职责）。
// 思考档按厂商能力表置灰（none=「—」不可调——deepseek 原生思考不可控等）。

import type { ApprovalRow, Row } from "@henira/protocol";
import {
  type ReasoningCapability,
  type ReasoningEffort,
  reasoningCapability,
} from "@henira/protocol";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { ApprovalCard } from "./approval-card.js";
import { BrainGlyph, CaretGlyph, SendGlyph, StopGlyph } from "./icons.js";
import { ModelSelect } from "./model-select.js";

const TEXTAREA_MAX_HEIGHT = 200;
const EMPTY_ROWS: readonly Row[] = [];
const EMPTY_CATALOG: Record<string, { baseUrl?: string; models?: string[] }> = {};
const THINKING_LEVELS: ReasoningEffort[] = ["off", "low", "medium", "high"];

export const Composer: WebPart = (ctx: WebPartContext) => {
  const [draft, setDraft] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort | null>(null);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  // 草稿随会话走（D-063）：宿主加载好的 uiState 到位后按会话回填一次；此后本地态直跑
  // （逐键渲染全树不可取），输入经 updateUiState 交宿主合并防抖落盘。同一会话内缓存已
  // 与本地同步（updateUiState 同步合并），不再回灌。
  const draftSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.uiState === undefined) return; // 未加载 / 宿主未实装——保持现状
    if (ctx.sessionId === draftSyncedFor.current) return;
    draftSyncedFor.current = ctx.sessionId;
    setDraft(ctx.uiState.draft ?? "");
    // 模型/思考会话级记忆（BC 语义：composer 回填；权威在每次请求携带）
    if (ctx.uiState.model !== undefined) setModel(ctx.uiState.model);
    setEffort(ctx.uiState.reasoningEffort ?? null);
  }, [ctx.sessionId, ctx.uiState]);
  // 两个稳定维度分开订阅（busy 布尔 / rows 数组引用）——不取整个快照对象
  // （store 契约只保证行数组引用稳定；getSnapshot 每次新对象会让 useSyncExternalStore 死循环）
  const busy = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.busy,
    () => false,
  );
  const rows = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).rows,
    () => EMPTY_ROWS,
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 审批接管：pending 卡在 dock 渲染；键盘直选期间 composer 提交让位
  const pendingApprovals = rows.filter(
    (row: Row): row is ApprovalRow => row.kind === "approval" && row.status === "pending",
  );

  // 模型/思考控件（宿主方法齐备才接；缺任一则整体不渲染）
  const settingsReady = ctx.client.getSettings !== undefined && ctx.client.listModels !== undefined;
  // 全局默认模型兜底：仅本地还没有值时（会话级记忆优先——settings.model 是全局缺省不是绑定）；
  // 每会话重跑一次——切到无绑定的会话时兜底回填
  useEffect(() => {
    if (!settingsReady || ctx.sessionId === null) return; // 未选中不拉默认（拉了也无从发送）
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (s.model !== undefined) {
          setModel((prev) => (prev === "" ? (s.model as string) : prev));
        }
      })
      .catch(() => {});
  }, [ctx.client, settingsReady, ctx.sessionId]);
  // 厂商能力表（思考档置灰依据；清单同时下传 ModelSelect 免二次拉取）
  useEffect(() => {
    if (!settingsReady) return;
    let alive = true;
    void ctx.client
      .listModels?.()
      .then((modelCatalog) => {
        if (alive) setCatalog(modelCatalog.providers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client, settingsReady]);
  const capability: ReasoningCapability =
    model === "" ? "none" : reasoningCapability(model.split("/")[0] ?? "");

  useEffect(() => {
    // 草稿清空（发送成功）后复位自动增高
    const el = areaRef.current;
    if (el !== null && draft === "") el.style.height = "";
  }, [draft]);

  const submit = (): void => {
    const text = draft.trim();
    if (text === "" || ctx.sessionId === null) return;
    if (pendingApprovals.length > 0) return; // 审批接管中：Enter 已被审批卡消费
    setDraft("");
    ctx.updateUiState?.({ draft: "" }); // 持久层同步清空（否则重启还原出旧草稿）
    setSendFailed(false);
    void ctx.client
      .prompt(ctx.sessionId, text, {
        modelId: model !== "" ? model : undefined,
        reasoningEffort: effort ?? undefined,
      })
      .catch(() => {
        // 发送失败回填草稿（用户不丢输入）+ 行内可见提示（不静默，R125）
        setDraft(text);
        ctx.updateUiState?.({ draft: text });
        setSendFailed(true);
      });
  };

  const stop = (): void => {
    if (ctx.sessionId !== null) void ctx.client.interrupt(ctx.sessionId);
  };

  const changeModel = useCallback(
    (next: string): void => {
      setModel(next);
      ctx.updateUiState?.({ model: next }); // 会话级绑定记忆（全局默认归设置弹窗·模型管理页）
    },
    [ctx],
  );

  const changeEffort = useCallback(
    (next: ReasoningEffort): void => {
      setEffort(next);
      ctx.updateUiState?.({ reasoningEffort: next }); // 会话级记忆
    },
    [ctx],
  );

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  };

  const hasDraft = draft.trim() !== "";
  const showStop = busy && !hasDraft; // ZCode 语义：流式中空草稿才是停止；有草稿恒为发送（排队）

  return (
    <div className="henira-composer">
      {sendFailed ? (
        <p role="alert" className="henira-send-error">
          {ctx.t("composer.sendFailed")}
        </p>
      ) : null}
      {pendingApprovals.map((row) => (
        <ApprovalCard key={row.rowId} row={row} ctx={ctx} />
      ))}
      <div className="henira-composer-card">
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          placeholder={ctx.t("composer.placeholder")}
          onChange={(e) => {
            setDraft(e.target.value);
            ctx.updateUiState?.({ draft: e.target.value }); // 宿主合并防抖落盘（D-063）
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="henira-composer-bar">
          {settingsReady ? (
            <ModelSelect
              ctx={ctx}
              value={model}
              onChange={changeModel}
              ariaLabel={ctx.t("composer.model")}
              direction="up"
              providers={catalog}
            />
          ) : null}
          {/* 思考档（BC ReasoningSelect 行为层）：capability=none 置灰「—」（deepseek 原生不可控等） */}
          {settingsReady ? (
            capability === "none" ? (
              <span
                className="henira-thinking-select"
                data-disabled="true"
                title={ctx.t("composer.thinking.none")}
              >
                <BrainGlyph size={13} />
                <span aria-hidden="true">—</span>
              </span>
            ) : (
              <span className="henira-thinking-select">
                <BrainGlyph size={13} />
                <select
                  aria-label={ctx.t("composer.thinking")}
                  value={effort ?? "off"}
                  onChange={(e) => {
                    changeEffort(e.target.value as ReasoningEffort);
                  }}
                >
                  {THINKING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {ctx.t(`composer.thinking.${level}`)}
                    </option>
                  ))}
                </select>
                <span className="henira-model-caret">
                  <CaretGlyph size={10} />
                </span>
              </span>
            )
          ) : null}
          {busy ? (
            <span className="henira-composer-hint">{ctx.t("composer.steerHint")}</span>
          ) : null}
          <span style={{ marginLeft: "auto" }} />
          {showStop ? (
            <button
              type="button"
              className="henira-icon-round henira-stop"
              aria-label={ctx.t("composer.stop")}
              title={ctx.t("composer.stop")}
              onClick={stop}
            >
              <StopGlyph size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="henira-icon-round henira-primary"
              aria-label={ctx.t("composer.send")}
              title={ctx.t("composer.send")}
              onClick={submit}
              disabled={!hasDraft || ctx.sessionId === null}
            >
              <SendGlyph size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

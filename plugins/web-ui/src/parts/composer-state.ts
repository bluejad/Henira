// 输入座位运行时（R183）：草稿/按次模型绑定/发送失败的唯一真源，产出 ComposerApi 注入
// composer.* 子树（ComposerDock 构造；bar 与四席共用）。状态从 Composer 上移——排队卡
// （composer.dock）与座位件都要读写草稿/焦点，不能再长在 bar 私有 state 里。
// 与 R182 相同：接管期间 bar 保持挂载（display:none），草稿/DOM 态不丢；草稿随会话走
// （D-063：宿主加载好的 uiState 到位后按会话回填一次，此后本地态直跑，输入经 updateUiState
// 交宿主合并防抖落盘）。模型目录重拉三触发：mount / 设置关闭 / 设置内写操作广播。

import type { ReasoningEffort, Row } from "@henira/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComposerApi, ModelCatalog, SettingsSection, WebPartContext } from "../types.js";

const EMPTY_ROWS: readonly Row[] = [];
const EMPTY_CATALOG: ModelCatalog = {};

/** 运行时 = ComposerApi 去掉审批面（审批面由 ComposerDock 的乐观集合与 chain owner 提供） */
export type ComposerRuntime = Omit<
  ComposerApi,
  "pendingApproval" | "approvalQueueTotal" | "onApprovalDecided" | "onApprovalFailed"
>;

/** @param approvalPending 未答审批在位（ComposerDock 的 answered 过滤后判据）——提交让位。
 *  已点击决定、settle 尚未回传的审批不算（卡已离场、输入栏已回来，提交不该被静默吞——
 *  审查 P2 修复；旧实现同样只看未答 pending）。 */
export function useComposerRuntime(ctx: WebPartContext, approvalPending: boolean): ComposerRuntime {
  const [draft, setDraftState] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [model, setModelState] = useState("");
  const [effort, setEffortState] = useState<ReasoningEffort | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_CATALOG);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 草稿随会话走（D-063）：uiState 到位后按会话回填一次；此后本地态直跑（逐键渲染全树
  // 不可取），输入经 updateUiState 交宿主合并防抖落盘。同一会话内缓存已与本地同步，不再回灌。
  const draftSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.uiState === undefined) return; // 未加载 / 宿主未实装——保持现状
    if (ctx.sessionId === draftSyncedFor.current) return;
    draftSyncedFor.current = ctx.sessionId;
    setDraftState(ctx.uiState.draft ?? "");
    // 模型/思考会话级记忆（权威在每次请求携带）
    if (ctx.uiState.model !== undefined) setModelState(ctx.uiState.model);
    setEffortState(ctx.uiState.reasoningEffort ?? null);
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

  // 模型/思考控件（宿主方法齐备才接；缺任一则模型席不渲染控件）
  const settingsReady = ctx.client.getSettings !== undefined && ctx.client.listModels !== undefined;
  // 全局默认模型兜底：仅本地还没有值时（会话级记忆优先——settings.model 是全局缺省不是绑定）；
  // 每会话重跑一次——切到无绑定的会话时兜底回填
  useEffect(() => {
    if (!settingsReady || ctx.sessionId === null) return; // 未选中不拉默认（拉了也无从发送）
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (s.model !== undefined) {
          setModelState((prev) => (prev === "" ? (s.model as string) : prev));
        }
      })
      .catch(() => {});
  }, [ctx.client, settingsReady, ctx.sessionId]);
  // 厂商能力表（模型席档位置灰依据；清单同时下传 ModelSelect 免二次拉取）。目录重拉三触发：
  // mount / 设置关闭（下段）/ **设置内写操作广播**（modelCatalogVersion 自增——断开当场回落，
  // 不用等弹窗关，2026-11-19 用户纠偏）
  // biome-ignore lint/correctness/useExhaustiveDependencies: modelCatalogVersion 是纯重拉触发信号（版本号只供依赖比较，体内不消费——断开/连接/开关后目录即时刷新）
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
  }, [ctx.client, settingsReady, ctx.modelCatalogVersion]);
  // 设置弹窗关上（非 null → null）重拉目录——模型管理里新连/开关的厂商立即可选，免整页刷新
  const prevSettingsSection = useRef<SettingsSection | null>(null);
  useEffect(() => {
    const prev = prevSettingsSection.current;
    prevSettingsSection.current = ctx.settingsSection ?? null;
    if (!settingsReady || prev === null || ctx.settingsSection !== null) return;
    void ctx.client
      .listModels?.()
      .then((modelCatalog) => {
        setCatalog(modelCatalog.providers);
      })
      .catch(() => {});
  }, [ctx.client, settingsReady, ctx.settingsSection]);

  const setDraft = useCallback(
    (text: string): void => {
      setDraftState(text);
      ctx.updateUiState?.({ draft: text }); // 宿主合并防抖落盘（D-063）
    },
    [ctx],
  );

  const focus = useCallback((): void => {
    inputRef.current?.focus();
  }, []);

  const registerInput = useCallback((el: HTMLTextAreaElement | null): void => {
    inputRef.current = el;
  }, []);

  const setModel = useCallback(
    (next: string): void => {
      setModelState(next);
      ctx.updateUiState?.({ model: next }); // 会话级绑定记忆（全局默认归设置弹窗·模型管理页）
    },
    [ctx],
  );

  const setEffort = useCallback(
    (next: ReasoningEffort): void => {
      setEffortState(next);
      ctx.updateUiState?.({ reasoningEffort: next }); // 会话级记忆
    },
    [ctx],
  );

  const submit = useCallback(
    (text?: string, opts?: { steer?: boolean }): void => {
      const submitted = (text ?? draft).trim();
      if (submitted === "" || ctx.sessionId === null) return;
      // 接管兜底：未答审批在位时输入栏虽隐藏，键盘/程序化触发也不得越过审批（可见态由
      // ComposerDock 管）。判据来自 ComposerDock 的 answered 过滤结果——乐观已答不再拦
      //（卡已离场、输入栏已回来，拦 = 发送被静默吞掉，审查 P2）
      if (approvalPending) return;
      setDraftState("");
      ctx.updateUiState?.({ draft: "" }); // 持久层同步清空（否则重启还原出旧草稿）
      setSendFailed(false);
      void ctx.client
        .prompt(ctx.sessionId, submitted, {
          steer: opts?.steer || undefined, // E1：忙时 Ctrl+Enter = 插话入队（下一 step 边界进场）
          modelId: model !== "" ? model : undefined,
          reasoningEffort: effort ?? undefined,
        })
        .catch(() => {
          // 发送失败回填草稿（用户不丢输入）+ 行内可见提示（不静默，R125）
          setDraftState(submitted);
          ctx.updateUiState?.({ draft: submitted });
          setSendFailed(true);
        });
    },
    [ctx, draft, model, effort, approvalPending],
  );

  const stop = useCallback((): void => {
    if (ctx.sessionId !== null) void ctx.client.interrupt(ctx.sessionId);
  }, [ctx]);

  return useMemo<ComposerRuntime>(
    () => ({
      sessionId: ctx.sessionId,
      draft,
      setDraft,
      focus,
      busy,
      isEmpty: rows.length === 0,
      sendFailed,
      model,
      setModel,
      effort,
      setEffort,
      catalog,
      settingsReady,
      submit,
      stop,
      registerInput,
    }),
    [
      ctx.sessionId,
      draft,
      setDraft,
      focus,
      busy,
      rows.length,
      sendFailed,
      model,
      setModel,
      effort,
      setEffort,
      catalog,
      settingsReady,
      submit,
      stop,
      registerInput,
    ],
  );
}

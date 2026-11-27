// 输入座位运行时（R183）：草稿/按次模型绑定/发送失败的唯一真源，产出 ComposerApi 注入
// composer.* 子树（ComposerDock 构造；bar 与四席共用）。状态从 Composer 上移——排队卡
// （composer.dock）与座位件都要读写草稿/焦点，不能再长在 bar 私有 state 里。
// 与 R182 相同：接管期间 bar 保持挂载（display:none），草稿/DOM 态不丢；草稿随会话走
// （D-063：宿主加载好的 uiState 到位后按会话回填一次，此后本地态直跑，输入经 updateUiState
// 交宿主合并防抖落盘）。模型目录重拉三触发：mount / 设置关闭 / 设置内写操作广播。
// D-092：手动压缩只从输入框出去——提交函数识别首词 /compact（与消息同一个 submit，终点换成
// 压缩入队）；宿主 prefill 请求（面板「压缩」/ 横幅「重试」交来的命令）在这里回填草稿，只回填不发送。

import {
  COMPACT_COMMAND,
  COMPACTION_INSTRUCTIONS_MAX,
  type PermissionMode,
  type ReasoningEffort,
  type Row,
} from "@henira/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ComposerApi,
  ModelCatalog,
  PrefillRequest,
  SettingsSection,
  WebPartContext,
} from "../types.js";

const EMPTY_ROWS: readonly Row[] = [];
const EMPTY_CATALOG: ModelCatalog = {};

/** 手动压缩命令（D-092）：去首尾空白后首词为 COMPACT_COMMAND（大小写不敏感），其后为说明
 *  （可空）。只认整条输入的首词——正文里出现的 `/compact` 不是命令，照常当消息发。
 *  返回 undefined = 不是压缩命令。 */
export function parseCompactCommand(text: string): { instructions?: string } | undefined {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match?.[1]?.toLowerCase() !== COMPACT_COMMAND.slice(1)) return undefined;
  const instructions = match[2]?.trim();
  return instructions === undefined || instructions === "" ? {} : { instructions };
}

/** 压缩提交被拒的原因文案键（D-092；键集沿用 context.compact*——与余量面板同一批词） */
function compactRejectKey(reason: string | undefined): string {
  switch (reason) {
    case "compaction-in-progress":
      return "context.compactBusy";
    case "compaction-unavailable":
      return "context.compactUnavailable";
    case "instructions-too-long":
      return "context.compactTooLong";
    case "interrupted":
      return "context.compactInterrupted";
    case "no-model":
      return "context.compactNoModel";
    default:
      return "context.compactFailed";
  }
}

/** 运行时 = ComposerApi 去掉交互面（审批/提问由 ComposerDock 的乐观集合与 chain owner 提供） */
export type ComposerRuntime = Omit<
  ComposerApi,
  | "pendingApproval"
  | "approvalQueueTotal"
  | "onApprovalDecided"
  | "onApprovalFailed"
  | "pendingQuestion"
  | "questionQueueTotal"
  | "onQuestionDecided"
  | "onQuestionFailed"
>;

/** @param interactionPending 未答交互在位（审批或提问；ComposerDock 的 answered 过滤后判据）
 *  ——提交让位。已点击决定、settle 尚未回传的交互不算（卡已离场、输入栏已回来，提交不该被
 *  静默吞——审查 P2 修复；R184 提问并入同一判据）。 */
export function useComposerRuntime(
  ctx: WebPartContext,
  interactionPending: boolean,
): ComposerRuntime {
  const [draft, setDraftState] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [sendErrorText, setSendErrorText] = useState<string | undefined>(undefined);
  const [sendNotice, setSendNotice] = useState<string | undefined>(undefined);

  // 手动压缩被跳过的即时回执（D-092）：历史不足要到消费时才知道，受理响应早已返回——走宿主
  // 活态 SessionState.compactionNotice。按 id 变化提示一次；快照里带来的旧回执（刷新 / 重开 /
  // 切会话）不重放；回执退场（下一次压缩开始）与切会话（回执属会话，不跟人走——2026-11-27
  // 用户纠偏：旧实现切走不清，提示跟着到别的会话）时一并收起，连同 sendFailed / sendErrorText
  // （同属上一会话的行内反馈）。
  const compactionNoticeId = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.compactionNotice?.id,
    () => undefined,
  );
  const shownNotice = useRef<{ session: string | null; id: string | undefined }>({
    session: ctx.sessionId,
    id: compactionNoticeId,
  });
  useEffect(() => {
    if (shownNotice.current.session !== ctx.sessionId) {
      shownNotice.current = { session: ctx.sessionId, id: compactionNoticeId };
      setSendNotice(undefined);
      setSendFailed(false);
      setSendErrorText(undefined);
      return;
    }
    if (compactionNoticeId === shownNotice.current.id) return;
    shownNotice.current.id = compactionNoticeId;
    setSendNotice(compactionNoticeId === undefined ? undefined : ctx.t("context.compactSkipped"));
  }, [compactionNoticeId, ctx.sessionId, ctx]);
  const [model, setModelState] = useState("");
  const [effort, setEffortState] = useState<ReasoningEffort | null>(null);
  // 权限模式（D-080）：显式会话记忆（null = 本会话未设）+ settings 新会话默认，兜底 ask
  const [permission, setPermissionState] = useState<PermissionMode | null>(null);
  const [defaultPermission, setDefaultPermission] = useState<PermissionMode>("ask");
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_CATALOG);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 草稿随会话走（D-063）：uiState 到位后按会话回填一次；此后本地态直跑（逐键渲染全树
  // 不可取），输入经 updateUiState 交宿主合并防抖落盘。同一会话内缓存已与本地同步，不再回灌。
  const draftSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.uiState === undefined) return; // 未加载 / 宿主未实装——保持现状
    if (ctx.sessionId === draftSyncedFor.current) return;
    // 首会话回填保护：boot 往返（建会话 + 拉 uiState）未完时用户可能已打字——空草稿回填
    // 会把它抹掉（真浏览器 e2e 慢机抓出：fill 后发送钮永久置灰）。保住输入并立即归属
    // 当前会话；此后按会话切换照旧整份回填（切换窗内输入仍按新会话处理）。
    if (draftSyncedFor.current === null && draft !== "") {
      draftSyncedFor.current = ctx.sessionId;
      ctx.updateUiState?.({ draft });
    } else {
      draftSyncedFor.current = ctx.sessionId;
      setDraftState(ctx.uiState.draft ?? "");
    }
    // 模型/思考会话级记忆（权威在每次请求携带）
    if (ctx.uiState.model !== undefined) setModelState(ctx.uiState.model);
    setEffortState(ctx.uiState.reasoningEffort ?? null);
  }, [ctx.sessionId, ctx.uiState, draft, ctx.updateUiState]);

  // 权限模式随会话走（D-080，与草稿/模型同一条）：显式记忆优先；uiState 未到 = 先按默认
  //（fail-closed，绝不把上一会话的 full 带进新会话）
  const permissionSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.sessionId === permissionSyncedFor.current) return;
    if (ctx.uiState === undefined) {
      setPermissionState(null);
      return; // 不标记已同步——uiState 到位后这条还会再跑一次
    }
    permissionSyncedFor.current = ctx.sessionId;
    setPermissionState(ctx.uiState.permissionMode ?? null);
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
        // 新会话默认权限（D-080）：settings 是兜底默认，显式会话记忆仍压过它
        if (s.permissionMode !== undefined) setDefaultPermission(s.permissionMode);
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
    // 设置关闭：权限默认值同样重拉（权限页改默认 → 无显式记忆的会话即时跟随）
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (s.permissionMode !== undefined) setDefaultPermission(s.permissionMode);
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

  // 交给输入框（host.prefill → ctx.prefillRequest，D-092）：只回填不发送。请求常驻 ctx 直到被
  // 消费——处理完（回填，或因已有草稿跳过）调 ack() 让宿主清除。草稿为空才回填并聚焦：已有
  // 草稿不覆盖（入口要提示得自己先看 draft）。同一请求对象只处理一次：ack 后、宿主清除前的
  // 重渲里请求仍在 ctx 上，回填引发的草稿变化不得让它二次生效。
  const handledPrefill = useRef<PrefillRequest | undefined>(undefined);
  useEffect(() => {
    const request = ctx.prefillRequest;
    if (request === undefined || handledPrefill.current === request) return;
    handledPrefill.current = request;
    request.ack();
    if (draft.trim() !== "") return;
    setDraft(request.text);
    inputRef.current?.focus();
  }, [ctx, draft, setDraft]);

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

  const setPermission = useCallback(
    (next: PermissionMode): void => {
      setPermissionState(next);
      ctx.updateUiState?.({ permissionMode: next }); // 会话级记忆（D-080，同模型/思考档）
    },
    [ctx],
  );

  const submit = useCallback(
    (text?: string, opts?: { steer?: boolean }): void => {
      const submitted = (text ?? draft).trim();
      if (submitted === "" || ctx.sessionId === null) return;
      // 接管兜底：未答交互（审批/提问）在位时输入栏虽隐藏，键盘/程序化触发也不得越过
      //（可见态由 ComposerDock 管）。判据来自 answered 过滤结果——乐观已答不再拦
      //（卡已离场、输入栏已回来，拦 = 发送被静默吞掉，审查 P2）
      if (interactionPending) return;
      setSendFailed(false);
      setSendErrorText(undefined);
      setSendNotice(undefined);
      const clearDraft = (): void => {
        setDraftState("");
        ctx.updateUiState?.({ draft: "" }); // 持久层同步清空（否则重启还原出旧草稿）
      };
      const restoreDraft = (message?: string): void => {
        // 失败回填草稿（用户不丢输入）+ 行内可见提示（不静默，R125）；message 缺省回落
        // composer.sendFailed 文案（消息 / 压缩命令同一套）
        setDraftState(submitted);
        ctx.updateUiState?.({ draft: submitted });
        setSendFailed(true);
        setSendErrorText(message);
      };
      // 首词 /compact = 手动压缩（D-092）：与消息同一个提交函数，只是终点换成压缩入队——
      // 仍进同一条队列，忙时照常排队。steer 对压缩无意义，忽略。
      const compact = parseCompactCommand(submitted);
      if (compact !== undefined) {
        if (ctx.client.compact === undefined) {
          restoreDraft(ctx.t("context.compactUnavailable"));
          return;
        }
        const instructions = compact.instructions;
        if (instructions !== undefined && [...instructions].length > COMPACTION_INSTRUCTIONS_MAX) {
          restoreDraft(ctx.t("context.compactTooLong")); // 提交前拦下，不等 REST 400
          return;
        }
        clearDraft();
        void ctx.client
          .compact(ctx.sessionId, instructions)
          .then((result) => {
            if (result.state !== "rejected") return; // 已受理：进度看排队卡 / 压缩行（skipped 走活态）
            restoreDraft(ctx.t(compactRejectKey(result.reason)));
          })
          .catch(() => {
            restoreDraft(ctx.t("context.compactFailed"));
          });
        return;
      }
      clearDraft();
      void ctx.client
        .prompt(ctx.sessionId, submitted, {
          steer: opts?.steer || undefined, // E1：忙时 Ctrl+Enter = 插话入队（下一 step 边界进场）
          modelId: model !== "" ? model : undefined,
          reasoningEffort: effort ?? undefined,
          // 权限模式按次携带（D-080）：显式记忆 → 设置默认 → ask（fail-closed）
          permissionMode: permission ?? defaultPermission,
        })
        .catch(() => {
          restoreDraft();
        });
    },
    [ctx, draft, model, effort, permission, defaultPermission, interactionPending],
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
      sendErrorText,
      sendNotice,
      model,
      setModel,
      effort,
      setEffort,
      permission: permission ?? defaultPermission,
      setPermission,
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
      sendErrorText,
      sendNotice,
      model,
      setModel,
      effort,
      setEffort,
      permission,
      defaultPermission,
      setPermission,
      catalog,
      settingsReady,
      submit,
      stop,
      registerInput,
    ],
  );
}

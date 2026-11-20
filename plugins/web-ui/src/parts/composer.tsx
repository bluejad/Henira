// 官方件：输入区（槽 composer）。两层卡（ZCode ConversationComposer 行为层：输入行上、工具排下）。
// 发送/停止语义照 ZCode（showStopControl = canStop && !hasDraftToSubmit）：忙+有草稿=发送（排队
// 插话）、忙+空草稿=停止——有字时圆钮恒为发送，杜绝「打着字点按钮却停了回合」的歧义。
// 审批接管 dock（M4 批 A 视觉二轮）：pending 审批卡渲染在输入卡上方，Enter 让位语义照旧。
// prompt 失败不静默：草稿回填 + 行内错误提示。
// 模型/思考按次绑定（骨架批）：选择=会话级绑定（ui-state 记忆，回填一次），权威在
// 每次请求携带（prompt opts）；不再写全局 settings.model（那是设置弹窗·模型管理页的职责）。
// 思考档数据驱动（思考档批 2026-11-19）：档位集合来自模型条目 reasoningOptions（models.dev
// 真源——toggle=关/开两档、effort=厂商档位映射四档子集）；目录未到/无数据 → 形状表兜底；
// 形状族 none 或仅 budget 声明 → 置灰「—」。切模型后当前档不在新集合 → clamp（不渲染不存在的档）。

import type { ApprovalRow, ReasoningOption, Row } from "@henira/protocol";
import {
  type ReasoningCapability,
  type ReasoningEffort,
  reasoningCapability,
  reasoningLevels,
} from "@henira/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SettingsSection, WebPart, WebPartContext } from "../types.js";
import { ApprovalCard } from "./approval-card.js";
import { HeniraSelect } from "./dropdown.js";
import { BrainGlyph, SendGlyph, StopGlyph } from "./icons.js";
import { ModelSelect, type PickerProviders } from "./model-select.js";
import { QueuePanel } from "./queue-panel.js";

const TEXTAREA_MAX_HEIGHT = 200;
const EMPTY_ROWS: readonly Row[] = [];
const EMPTY_CATALOG: PickerProviders = {};

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
    // 模型/思考会话级记忆（composer 回填；权威在每次请求携带）
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
  // 厂商能力表（思考档置灰依据；清单同时下传 ModelSelect 免二次拉取）。目录重拉三触发：
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
  const capability: ReasoningCapability =
    model === "" ? "none" : reasoningCapability(model.split("/")[0] ?? "");
  // 档位集合：模型级数据真源（catalog 条目的 reasoningOptions）；目录未到/无数据 → 形状表兜底
  const providerId = model === "" ? "" : (model.split("/")[0] ?? "");
  const modelId = model === "" ? "" : model.slice(providerId.length + 1);
  const modelOptions: ReasoningOption[] | undefined = catalog[providerId]?.models?.find(
    (m) => m.id === modelId,
  )?.reasoningOptions;
  const levels = useMemo(
    () => reasoningLevels(capability, modelOptions),
    [capability, modelOptions],
  );
  // toggle-only 模型（如 agnes）：两档文案「关/开」（「开」承载值 medium——server 枚举只认四值）。
  // 开关族且数据无 effort 档（含目录数据缺省）即按开关呈现
  const toggleOnly =
    (capability === "thinking" || capability === "enable" || capability === "template-enable") &&
    modelOptions?.some((o) => o.type === "effort") !== true;

  // 切模型后档位校验：当前值不在新可选集合 → clamp 到首个非 off（toggle 模型优先「开」=medium）；
  // 置灰（集合空）不动存储值——切回可调模型时恢复
  useEffect(() => {
    if (levels.length === 0) return;
    const current = effort ?? "off";
    if (levels.includes(current)) return;
    const next = levels.includes("medium") ? "medium" : (levels.find((l) => l !== "off") ?? "off");
    setEffort(next);
    ctx.updateUiState?.({ reasoningEffort: next });
  }, [ctx, levels, effort]);

  useEffect(() => {
    // 草稿清空（发送成功）后复位自动增高
    const el = areaRef.current;
    if (el !== null && draft === "") el.style.height = "";
  }, [draft]);

  const submit = (steer = false): void => {
    const text = draft.trim();
    if (text === "" || ctx.sessionId === null) return;
    if (pendingApprovals.length > 0) return; // 审批接管中：Enter 已被审批卡消费
    setDraft("");
    ctx.updateUiState?.({ draft: "" }); // 持久层同步清空（否则重启还原出旧草稿）
    setSendFailed(false);
    void ctx.client
      .prompt(ctx.sessionId, text, {
        steer: steer || undefined, // E1：忙时 Ctrl+Enter = 插话入队（下一 step 边界进场）
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
  // 忙+有草稿：发送=排队、Ctrl+Enter=插话（E1 发送模式 UI——按钮文案与 hint 同步切换）
  const sendLabel = busy ? ctx.t("composer.queueSend") : ctx.t("composer.send");

  // 排队卡编辑回填：条目文本进草稿（覆盖语义；跨窗口冻结锁挂账 50-open）
  const editQueued = useCallback(
    (text: string): void => {
      setDraft(text);
      ctx.updateUiState?.({ draft: text });
      areaRef.current?.focus();
    },
    [ctx],
  );

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
      <QueuePanel ctx={ctx} onEdit={editQueued} />
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(e.ctrlKey || e.metaKey); // Enter=排队 / Ctrl+Enter=插话（E1 发送模式）
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
          {/* 思考档：档位集合数据驱动（模型 reasoningOptions）——
              空集合（none/budget/形状未收录）置灰「—」；toggle-only 两档「关/开」；
              弹层 = HeniraSelect 自制面板（原生 select 系统菜单退场，基础件批 2026-11-20） */}
          {settingsReady ? (
            levels.length === 0 ? (
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
                <HeniraSelect
                  ariaLabel={ctx.t("composer.thinking")}
                  value={effort ?? "off"}
                  direction="up"
                  options={levels.map((level) => ({
                    value: level,
                    label: ctx.t(
                      toggleOnly && level === "medium"
                        ? "composer.thinking.on"
                        : `composer.thinking.${level}`,
                    ),
                  }))}
                  onChange={(next) => {
                    changeEffort(next as ReasoningEffort);
                  }}
                />
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
              aria-label={sendLabel}
              title={busy ? ctx.t("composer.sendHint") : sendLabel}
              onClick={() => submit(false)}
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

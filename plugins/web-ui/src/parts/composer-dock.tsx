// 官方件：输入座位（槽 composer，R182；dsh conversation.composer chain 行为层）。
// 子槽/座位（R183）：
//   composer.bar      —— 常驻输入栏（single；官方默认件 = Composer，fallback）
//   composer.model    —— 模型席（single；官方默认件 = ModelSeat）
//   composer.left     —— 工具排左追加位（list；官方空）
//   composer.right    —— 工具排右追加位（list；官方空）
//   composer.dock     —— 输入卡外通栏条目（list；官方默认件 = QueueDock，接管时仍可见）
//   composer.takeover —— 接管条目（chain）：条目 select 首个命中者当选（priority 升序）
// 接管时 fallback 保持挂载、display:none（草稿/编辑器 DOM 态不丢——dsh overlay 语义），
// 审批卡占同一座位；无接管 = 只渲染输入栏。审批「队首单卡 + 点击即退场」的 answered
// 乐观集合在此持有（原在 Composer 内；R184 提问条目后到，同槽加 entry 即可）。
// 官方条目同走 chain 注册路径：第三方 replaceChainSlot 顶替、卸载按登记回落。
// R183：草稿/模型/发送状态在 useComposerRuntime（唯一真源），本件把运行时合成 ComposerApi，
// 以 `{...ctx, composer}` 注入全部 composer.* 件（bar / 四席 / 接管条目）——座位件不私存状态。

import type { ApprovalRow, QuestionRow, Row } from "@henira/protocol";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { defineChainEntry, electChain } from "../chain.js";
import type { ComposerApi, WebPart, WebPartContext } from "../types.js";
import { ApprovalQueueCard } from "./approval-card.js";
import { useComposerRuntime } from "./composer-state.js";
import { QuestionCard } from "./question-card.js";
import { SlotBoundary } from "./slot-boundary.js";

const EMPTY_ROWS: readonly Row[] = [];

/** chain 选举 owner：ComposerDock 每渲染构一份（select 纯函数只读它） */
export interface ComposerTakeoverOwner {
  pendingApproval: ApprovalRow | undefined;
  approvalQueueTotal: number;
  onDecided(requestId: string): void;
  onDecideFailed(requestId: string): void;
  /** 提问面（R184）：未答提问队首 + 计数（questionTakeover 消费） */
  pendingQuestion: QuestionRow | undefined;
  questionQueueTotal: number;
  onQuestionDecided(requestId: string): void;
  onQuestionFailed(requestId: string): void;
}

/** 接管卡当选后交给 Component 的数据（key = 挂载身份：换卡重挂复位崩溃态） */
export interface ComposerTakeoverMatched {
  key: string;
  row: ApprovalRow | QuestionRow;
  queueTotal: number;
}

/** 审批接管（官方默认条目）：pending 队首 = 当选；无 pending = 让位给下一条/fallback。
 * priority 10；提问条目 priority 5（先显示——dsh 客户端优先级：提问压过审批）。 */
export const approvalTakeover = defineChainEntry<ComposerTakeoverOwner, ComposerTakeoverMatched>({
  id: "approval",
  priority: 10,
  select: (owner) =>
    owner.pendingApproval === undefined
      ? null
      : {
          key: owner.pendingApproval.requestId,
          row: owner.pendingApproval,
          queueTotal: owner.approvalQueueTotal,
        },
  Component: ({ ctx, matched, owner }) => {
    const row = matched.row;
    if (row.kind !== "approval") return null;
    return (
      <ApprovalQueueCard
        row={row}
        ctx={ctx}
        queueTotal={matched.queueTotal}
        onDecided={owner.onDecided}
        onDecideFailed={owner.onDecideFailed}
      />
    );
  },
});

/** 提问接管（官方默认条目，R184）：priority 5 压过审批（到达序相同也先显示提问；
 * dsh 客户端 precedence 1 > 0 行为层）。问答应答走 client.settleQuestion。 */
export const questionTakeover = defineChainEntry<ComposerTakeoverOwner, ComposerTakeoverMatched>({
  id: "question",
  priority: 5,
  select: (owner) =>
    owner.pendingQuestion === undefined
      ? null
      : {
          key: owner.pendingQuestion.requestId,
          row: owner.pendingQuestion,
          queueTotal: owner.questionQueueTotal,
        },
  Component: ({ ctx, matched, owner }) => {
    const row = matched.row;
    if (row.kind !== "question") return null;
    return (
      <QuestionCard
        row={row}
        ctx={ctx}
        queueTotal={matched.queueTotal}
        onAnswered={owner.onQuestionDecided}
        onAnswerFailed={owner.onQuestionFailed}
      />
    );
  },
});

export const ComposerDock: WebPart = (ctx: WebPartContext) => {
  const rows = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).rows,
    () => EMPTY_ROWS,
  );
  // 点击即退场（R171）：settled SSE 到达前卡片已离场；settle 失败回滚（卡回 dock 可重试）
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const onDecided = useCallback((requestId: string): void => {
    setAnswered((prev) => {
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });
  }, []);
  const onDecideFailed = useCallback((requestId: string): void => {
    setAnswered((prev) => {
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);
  const pendingApprovals = useMemo(
    () =>
      rows.filter(
        (row): row is ApprovalRow =>
          row.kind === "approval" && row.status === "pending" && !answered.has(row.requestId),
      ),
    [rows, answered],
  );
  // 未答提问（R184）：与审批共用 answered 乐观集合（requestId 全局唯一）
  const pendingQuestions = useMemo(
    () =>
      rows.filter(
        (row): row is QuestionRow =>
          row.kind === "question" && row.status === "pending" && !answered.has(row.requestId),
      ),
    [rows, answered],
  );

  // 运行时（草稿/模型/发送/目录）——座位共享状态的唯一真源。提交让位判据 = answered
  // 过滤后的未答交互（审批或提问；乐观已答不拦——审查 P2）
  const runtime = useComposerRuntime(
    ctx,
    pendingApprovals.length > 0 || pendingQuestions.length > 0,
  );
  const api = useMemo<ComposerApi>(
    () => ({
      ...runtime,
      pendingApproval: pendingApprovals[0],
      approvalQueueTotal: pendingApprovals.length,
      onApprovalDecided: onDecided,
      onApprovalFailed: onDecideFailed,
      pendingQuestion: pendingQuestions[0],
      questionQueueTotal: pendingQuestions.length,
      onQuestionDecided: onDecided,
      onQuestionFailed: onDecideFailed,
    }),
    [runtime, pendingApprovals, pendingQuestions, onDecided, onDecideFailed],
  );
  // 全部 composer.* 件共用同一 ctx + API（第三方座位件同入口）
  const partCtx = useMemo<WebPartContext>(() => ({ ...ctx, composer: api }), [ctx, api]);

  const owner = useMemo<ComposerTakeoverOwner>(
    () => ({
      pendingApproval: pendingApprovals[0],
      approvalQueueTotal: pendingApprovals.length,
      onDecided,
      onDecideFailed,
      pendingQuestion: pendingQuestions[0],
      questionQueueTotal: pendingQuestions.length,
      onQuestionDecided: onDecided,
      onQuestionFailed: onDecideFailed,
    }),
    [pendingApprovals, pendingQuestions, onDecided, onDecideFailed],
  );
  const elected = useMemo(
    () => electChain<ComposerTakeoverMatched>(ctx.chains.get("composer.takeover"), owner),
    [ctx.chains, owner],
  );
  const takeoverKey = elected === null ? null : `${elected.entry.id}:${elected.matched.key}`;

  // 焦点：接管出现 → 接管容器（tabIndex=-1，条目内部再落到卡/选项）；接管结束 → 输入框。
  // 只在焦点仍在座位内/body（用户没去点设置等别处）时才回焦，不抢用户焦点。
  const dockRef = useRef<HTMLDivElement>(null);
  const wasTakeover = useRef(false);
  // 回焦走登记输入框（runtime.focus）而不是 querySelector("textarea")：composer.dock 也是
  // dockRef 子树，插件条目里的 textarea 会抢走回焦（审查 P3——R183 把 dock 挪进这里后放大）
  const focusInput = runtime.focus;
  useEffect(() => {
    if (takeoverKey !== null) {
      wasTakeover.current = true;
      dockRef.current?.querySelector<HTMLElement>(".henira-composer-takeover")?.focus();
      return;
    }
    if (!wasTakeover.current) return;
    wasTakeover.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body || dockRef.current?.contains(active) === true) {
      focusInput();
    }
  }, [takeoverKey, focusInput]);

  const dock = (ctx.slots.get("composer.dock") ?? []) as WebPart[];
  const bar = (ctx.slots.get("composer.bar") ?? []) as WebPart[];
  const Elected =
    elected === null
      ? null
      : (elected.entry.Component as (props: {
          ctx: WebPartContext;
          matched: ComposerTakeoverMatched;
          owner: ComposerTakeoverOwner;
        }) => ReactNode);

  return (
    <div className="henira-composer-dock" ref={dockRef}>
      {/* 卡外条目（官方 = 排队面板）：接管期间仍可见（R183——不再随 bar 隐藏） */}
      {dock.map((Part) => (
        <SlotBoundary key={Part.name} label="composer.dock">
          <Part {...partCtx} />
        </SlotBoundary>
      ))}
      {elected !== null && Elected !== null ? (
        <div className="henira-composer-takeover" tabIndex={-1}>
          <SlotBoundary
            key={takeoverKey}
            label={`composer.takeover.${elected.entry.id}`}
            // 接管是唯一应答通道：顶替/官方条目崩溃都必须回落一张可答卡（E6 审查 F1 同款）。
            // 按行种类分派（审批卡 / 提问卡）；未知形状渲染 null（由条目自己的边界负责）。
            fallback={() => {
              const matched = elected.matched as Partial<ComposerTakeoverMatched>;
              if (matched.row === undefined) return null;
              if (matched.row.kind === "question") {
                return (
                  <QuestionCard
                    row={matched.row}
                    ctx={partCtx}
                    queueTotal={matched.queueTotal ?? 1}
                    onAnswered={owner.onQuestionDecided}
                    onAnswerFailed={owner.onQuestionFailed}
                  />
                );
              }
              return (
                <ApprovalQueueCard
                  row={matched.row}
                  ctx={partCtx}
                  queueTotal={matched.queueTotal ?? 1}
                  onDecided={owner.onDecided}
                  onDecideFailed={owner.onDecideFailed}
                />
              );
            }}
          >
            <Elected ctx={partCtx} matched={elected.matched} owner={owner} />
          </SlotBoundary>
        </div>
      ) : null}
      <div
        className="henira-composer-bar-slot"
        style={elected !== null ? { display: "none" } : undefined}
      >
        {bar.map((Part) => (
          <SlotBoundary key={Part.name} label="composer.bar">
            <Part {...partCtx} />
          </SlotBoundary>
        ))}
      </div>
    </div>
  );
};

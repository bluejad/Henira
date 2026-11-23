// 官方件：提问卡（R184）。机制 = 专用 ask_user 工具（dsh 行为层：普通工具 await 答复，答复即
// 工具结果；与审批通道分离）。卡片语义参照成熟实现的提问卡：无预选（焦点不等于选中）、选项
// hand-rolled 按钮 + ARIA（单选 option / 多选 checkbox）、自定义输入恒在末位（模型不得自带
// Other）、逐题分页 1/N、Space 勾选、Enter 单选选中并推进 / 多选确认并推进 / 末题提交、
// Ctrl/Cmd+Enter 随时提交、Esc 首题取消整个请求 / 后续题回上一题、IME 组合期间 Enter 不提交、
// 空选提交 = 明确跳过。答案经 ctx.client.settleQuestion 收回（幂等先答者赢）；乐观摘卡与
// 审批同款：提交/取消即 onAnswered，settle 失败回滚（404 = 已解决，不回滚）。
// R192 交互修正：单选 = 唯一答案（选选项清空自定义、输入自定义清空选项、点选即推进，
// 与 Enter 同路径）；多选允许选项 + 自定义并存。多题导航常驻页头右端（← 页码 →，到端禁用）。

import {
  QUESTION_CUSTOM_MAX,
  type QuestionAnswer,
  type QuestionRow,
  type QuestionSpec,
} from "@henira/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WebPartContext } from "../types.js";
import { CaretGlyph, CaretLeftGlyph, CheckGlyph } from "./icons.js";

interface Draft {
  selected: string[];
  custom: string;
}

const EMPTY_DRAFT: Draft = { selected: [], custom: "" };

/** IME 组合期间（中文/日文候选确认）不得把 Enter 当提交 */
function isImeComposing(e: React.KeyboardEvent): boolean {
  const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return native.isComposing === true || e.keyCode === 229;
}

function draftOf(drafts: Record<string, Draft>, id: string): Draft {
  return drafts[id] ?? EMPTY_DRAFT;
}

/** 选项切换的纯计算（单选=替换并清空自定义；多选=勾选/取消）；状态更新与「末题提交覆盖草稿」共用 */
function toggleSelection(question: QuestionSpec, base: Draft, label: string): Draft {
  if (question.multiSelect !== true) {
    // 单选 = 唯一答案：选中选项即清空自定义输入（互斥）；点击已选项保持选中
    return { selected: [label], custom: "" };
  }
  const selected = base.selected.includes(label)
    ? base.selected.filter((l) => l !== label)
    : [...base.selected, label];
  return { ...base, selected };
}

/** 逐题答案构造：所有题都出现在答案里（未作答 = selected [] 跳过），custom 仅非空时带 */
export function buildAnswers(
  questions: readonly QuestionSpec[],
  drafts: Record<string, Draft>,
): QuestionAnswer[] {
  return questions.map((q) => {
    const draft = draftOf(drafts, q.id);
    const custom = draft.custom.trim() === "" ? undefined : draft.custom;
    return {
      id: q.id,
      selected: [...draft.selected],
      ...(custom !== undefined ? { custom } : {}),
    };
  });
}

export function QuestionCard(props: {
  row: QuestionRow;
  ctx: WebPartContext;
  /** 队列总数（>1 时显示「待提问 N」） */
  queueTotal?: number;
  /** 提交/取消发起即回调（乐观摘卡） */
  onAnswered?: (requestId: string) => void;
  /** settle 失败回调（回滚——卡回 dock 可重试） */
  onAnswerFailed?: (requestId: string) => void;
}): React.ReactNode {
  const { row, ctx } = props;
  const questions = row.questions;
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [settling, setSettling] = useState(false);
  /** 键盘聚焦的选项下标（=选项数时表示自定义输入；-1 = 卡片容器）。
   *  与 DOM 焦点分开记：点「继续」时按钮会夺焦，仍要知道用户聚焦过哪一项。 */
  const [activeIndex, setActiveIndex] = useState(-1);
  const pending = row.status === "pending" && !settling;
  const settleQuestion = ctx.client.settleQuestion;
  const total = questions.length;
  const current = questions[Math.min(page, total - 1)];

  const cardRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 挂载/换题时容器自聚焦并清掉上一题的键盘焦点下标（无预选——焦点只表示键盘位置，不表示已选中）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换题/换请求要回焦卡片；依赖是触发信号，体内只读 ref
  useEffect(() => {
    setActiveIndex(-1);
    cardRef.current?.focus();
  }, [row.requestId, page]);

  /** 自定义输入：单选下与选项互斥（写自定义即清空已选），多选下与选项并存 */
  const updateCustom = useCallback((question: QuestionSpec, value: string): void => {
    setDrafts((prev) => {
      const base = draftOf(prev, question.id);
      return {
        ...prev,
        [question.id]:
          question.multiSelect === true
            ? { ...base, custom: value }
            : { selected: [], custom: value },
      };
    });
  }, []);

  /** 选项/自定义输入之间的键盘焦点移动（卡片容器 ↑↓ 与自定义输入框 ↑↓ 共用） */
  const moveOptionFocus = useCallback((step: 1 | -1): void => {
    const focusables: HTMLElement[] = optionRefs.current.filter(
      (el): el is HTMLButtonElement => el !== null,
    );
    if (customRef.current !== null) focusables.push(customRef.current);
    if (focusables.length === 0) return;
    const idx = focusables.indexOf(document.activeElement as HTMLElement);
    const next =
      idx < 0
        ? focusables[step > 0 ? 0 : focusables.length - 1]
        : focusables[(idx + step + focusables.length) % focusables.length];
    next?.focus();
  }, []);

  const toggleOption = useCallback(
    (question: QuestionSpec, label: string): Draft => {
      const next = toggleSelection(question, draftOf(drafts, question.id), label);
      // 函数式更新：同一批里连点两下（闭包 drafts 仍是旧值）不能互相覆盖——活体实锤
      setDrafts((prev) => ({
        ...prev,
        [question.id]: toggleSelection(question, draftOf(prev, question.id), label),
      }));
      return next;
    },
    [drafts],
  );

  const submit = useCallback(
    (effective?: Record<string, Draft>): void => {
      if (!pending || ctx.sessionId === null || settleQuestion === undefined) return;
      const answers = buildAnswers(questions, effective ?? drafts);
      setSettling(true);
      props.onAnswered?.(row.requestId);
      void settleQuestion(ctx.sessionId, row.requestId, answers).catch((err: unknown) => {
        // 404 = 提问已不存在（重启收口/另一窗口已答）——当已解决，不回滚（R175 同款）
        if ((err as { status?: number } | undefined)?.status === 404) return;
        setSettling(false);
        props.onAnswerFailed?.(row.requestId);
      });
    },
    [ctx.sessionId, drafts, pending, props, questions, row.requestId, settleQuestion],
  );

  const cancelRequest = useCallback((): void => {
    if (!pending || ctx.sessionId === null || settleQuestion === undefined) return;
    setSettling(true);
    props.onAnswered?.(row.requestId);
    void settleQuestion(ctx.sessionId, row.requestId, { cancelled: true }).catch((err: unknown) => {
      if ((err as { status?: number } | undefined)?.status === 404) return;
      setSettling(false);
      props.onAnswerFailed?.(row.requestId);
    });
  }, [ctx.sessionId, pending, props, row.requestId, settleQuestion]);

  /** 单选「聚焦但未选」时按继续：自动补选当前聚焦项（参照行为——焦点移动即意图，不是跳过） */
  const withAutoSelectedOption = useCallback((): Record<string, Draft> => {
    const question = current;
    if (question === undefined || question.multiSelect === true) return drafts;
    const draft = draftOf(drafts, question.id);
    if (draft.selected.length > 0 || draft.custom.trim() !== "") return drafts;
    const options = question.options ?? [];
    if (activeIndex < 0 || activeIndex >= options.length) return drafts;
    const option = options[activeIndex];
    if (option === undefined) return drafts;
    return { ...drafts, [question.id]: toggleSelection(question, draft, option.label) };
  }, [activeIndex, current, drafts]);

  /** Enter 推进语义：非末题 → 下一页；末题 → 提交（空选 = 跳过）。
   *  单选聚焦项未选时先补选并把补选写回草稿（回退上一题仍可见）；显式草稿（选项 Enter）优先。 */
  const advanceOrSubmit = useCallback(
    (effective?: Record<string, Draft>): void => {
      const source = effective ?? withAutoSelectedOption();
      if (source !== drafts) setDrafts(source);
      if (page + 1 < total) setPage(page + 1);
      else submit(source);
    },
    [drafts, page, submit, total, withAutoSelectedOption],
  );

  const goBack = useCallback((): void => {
    if (page > 0) setPage(page - 1);
    else cancelRequest();
  }, [cancelRequest, page]);

  // 卡片容器键控（焦点在容器/选项时不冲突：选项自己的 Enter 已 stopPropagation）
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!pending || isImeComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      goBack();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      advanceOrSubmit();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // 选项间移动（容器/选项上）；自定义输入框自己处理（onCustomKeyDown）
      if (e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      moveOptionFocus(e.key === "ArrowDown" ? 1 : -1);
    }
  };

  const onOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, label: string): void => {
    if (!pending || current === undefined || isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (current.multiSelect === true) {
        // 多选 Enter = 确认当前勾选并推进
        advanceOrSubmit();
      } else {
        const next = toggleOption(current, label);
        // 末题提交要用刚选中的草稿（setState 异步——闭包里的 drafts 还是旧值）
        advanceOrSubmit({ ...drafts, [current.id]: next });
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      goBack();
    }
  };

  const onCustomKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!pending || isImeComposing(e)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // 输入框也是「末位选项」：↑↓ 离开输入框回到选项（参照行为；Tab 兜底仍可用）
      e.preventDefault();
      e.stopPropagation();
      moveOptionFocus(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      goBack();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      submit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // 单行自定义回答：Enter 同题目推进/提交（Shift+Enter 留给换行）
      e.preventDefault();
      e.stopPropagation();
      advanceOrSubmit();
    }
  };

  if (current === undefined) return null;
  const draft = draftOf(drafts, current.id);
  const customFilled = draft.custom.trim() !== "";
  const header = current.header;
  const multiple = total > 1;

  return (
    <div
      className="henira-question"
      ref={cardRef}
      tabIndex={-1}
      role="dialog"
      aria-label={ctx.t("question.title")}
      onFocus={(event) => {
        // 焦点回到卡本体（点击空白区/换题回焦）= 不再有「聚焦过的选项」——防止旧 activeIndex 被补选
        if (event.target === event.currentTarget) setActiveIndex(-1);
      }}
      onKeyDown={onCardKeyDown}
    >
      <div className="henira-question-head">
        <span className="henira-question-title">{ctx.t("question.title")}</span>
        {header !== undefined ? <span className="henira-question-chip">{header}</span> : null}
        {(props.queueTotal ?? 1) > 1 ? (
          <span className="henira-question-queue">
            {ctx.t("question.queueCount")} {(props.queueTotal ?? 1) - 1}
          </span>
        ) : null}
        <span className="henira-question-spacer" />
        {multiple ? (
          <span className="henira-question-nav">
            <button
              type="button"
              className="henira-question-navbtn"
              aria-label={ctx.t("question.previous")}
              disabled={!pending || page === 0}
              onClick={() => {
                setPage((currentPage) => Math.max(0, currentPage - 1));
              }}
            >
              <CaretLeftGlyph size={14} />
            </button>
            <span className="henira-question-pager">
              {page + 1} / {total}
            </span>
            <button
              type="button"
              className="henira-question-navbtn"
              aria-label={ctx.t("question.next")}
              disabled={!pending || page + 1 >= total}
              onClick={() => {
                // 页头下一页与「继续」同语义（单选聚焦项自动补选并写回）；末题禁用，不会误提交
                advanceOrSubmit();
              }}
            >
              <CaretGlyph size={14} />
            </button>
          </span>
        ) : null}
        {row.status === "settled" ? (
          <span className="henira-question-status">
            {row.outcome === "cancelled"
              ? ctx.t("question.cancelled")
              : row.outcome === "invalidated"
                ? ctx.t("question.invalidated")
                : ctx.t("question.answered")}
          </span>
        ) : null}
      </div>
      <div className="henira-question-text">{current.question}</div>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role 由 multiSelect 动态决定（group/listbox 两形，均支持 aria-label） */}
      <div
        className="henira-question-options"
        role={current.multiSelect === true ? "group" : "listbox"}
        aria-label={current.question}
      >
        {(current.options ?? []).map((option, index) => {
          const selected = draft.selected.includes(option.label);
          return (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role 由 multiSelect 动态决定（checkbox/option 两形，各配 aria-checked/aria-selected）
            <button
              key={option.label}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              className={`henira-question-option${selected ? " is-selected" : ""}`}
              role={current.multiSelect === true ? "checkbox" : "option"}
              aria-checked={current.multiSelect === true ? selected : undefined}
              aria-selected={current.multiSelect === true ? undefined : selected}
              disabled={!pending}
              onFocus={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                // 不把焦点收回卡片：按钮保留焦点，Space 连选 / ↓ 逐项才走得通（R185 审查——
                // 收回后 ArrowDown 对容器 indexOf 得 -1，永远跳回第一项）
                const next = toggleOption(current, option.label);
                // 单选点选 = 选中并推进（与键盘 Enter 同路径）；多选只切换勾选、留在本题
                if (current.multiSelect !== true) {
                  advanceOrSubmit({ ...drafts, [current.id]: next });
                }
              }}
              onKeyDown={(e) => {
                onOptionKeyDown(e, option.label);
              }}
            >
              <span className="henira-question-mark" aria-hidden="true">
                {current.multiSelect === true ? (
                  <span className={`henira-question-check${selected ? " is-on" : ""}`}>
                    {selected ? <CheckGlyph size={12} /> : null}
                  </span>
                ) : (
                  `${index + 1}.`
                )}
              </span>
              <span className="henira-question-option-text">
                <span className="henira-question-option-label">{option.label}</span>
                {option.description !== undefined ? (
                  <span className="henira-question-option-desc">{option.description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
        {/* 自定义输入恒在末位（相当于第 N+1 项；无标签，与参照物一致）——label 包裹 =
            点整行聚焦输入框（原生关联，不挂 click 处理器）。单选=数字序号；多选=勾选框
            （有内容即勾选，与上面的选项行同形）。 */}
        <label className={`henira-question-custom${customFilled ? " is-selected" : ""}`}>
          <span className="henira-question-mark" aria-hidden="true">
            {current.multiSelect === true ? (
              <span className={`henira-question-check${customFilled ? " is-on" : ""}`}>
                {customFilled ? <CheckGlyph size={12} /> : null}
              </span>
            ) : (
              `${(current.options?.length ?? 0) + 1}.`
            )}
          </span>
          <textarea
            ref={customRef}
            className="henira-question-input"
            rows={1}
            maxLength={QUESTION_CUSTOM_MAX}
            placeholder={ctx.t("question.customPlaceholder")}
            value={draft.custom}
            disabled={!pending}
            onFocus={() => {
              setActiveIndex(current.options?.length ?? 0);
            }}
            onChange={(e) => {
              updateCustom(current, e.target.value);
            }}
            onKeyDown={onCustomKeyDown}
          />
        </label>
      </div>
      <div className="henira-question-foot">
        <span className="henira-question-hint">{ctx.t("question.keyboardHint")}</span>
        <button
          type="button"
          className="henira-question-cancel"
          disabled={!pending || settleQuestion === undefined}
          onClick={cancelRequest}
        >
          {ctx.t("question.cancel")}
        </button>
        <button
          type="button"
          className="henira-question-submit henira-primary"
          disabled={!pending || settleQuestion === undefined}
          onClick={() => {
            advanceOrSubmit();
          }}
        >
          {page + 1 < total ? ctx.t("question.continue") : ctx.t("question.submit")}
        </button>
      </div>
      {settleQuestion === undefined ? (
        <div className="henira-question-hint">{ctx.t("question.unsupported")}</div>
      ) : null}
    </div>
  );
}

/** 痕迹行内的问答对（工具卡的已答态共用） */
export function QuestionAnswers({
  questions,
  answers,
  ctx,
}: {
  questions: readonly QuestionSpec[];
  answers: readonly QuestionAnswer[];
  ctx: WebPartContext;
}): React.ReactNode {
  return (
    <ul className="henira-question-answers">
      {questions.map((q) => {
        const answer = answers.find((a) => a.id === q.id);
        const picked = answer === undefined ? [] : [...answer.selected];
        if (answer?.custom !== undefined) picked.push(answer.custom);
        return (
          <li key={q.id} className="henira-question-answer">
            <span className="henira-question-answer-q">{q.question}</span>
            <span className="henira-question-answer-a">
              {picked.length === 0
                ? ctx.t("question.skipped")
                : picked.join(ctx.t("question.answerJoin"))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

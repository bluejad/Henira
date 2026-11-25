// 官方件：审批卡。pending 态 = 输入区上方接管 dock 卡（dsh ApprovalPanel / ZCode V4InteractionDialogs
// 同位行为层参照：审批接管 composer 而非对话流内嵌；composer 提交让位）。
// E6 富化：①per-tool 预览体（approval-preview.tsx——args 完整原样窄化，D-046「挂起自足可渲染」
// 落地）②「本会话允许」三选项（scope:'session' 生产者落地，tools-approval §3.1 机器点亮）
// ③队列计数（队首单卡由 composer 渲染，多卡 Enter 全中 bug 随单卡化消除）④keyed 缝
// approval.view.<工具名>（D-057 延伸：官方默认件注册进缝、插件 replaceSlot 顶替、卸载回落通用卡
// ——R163 slot-registry 语义直接复用）。收答经 client.settleApproval——幂等先答者赢（另一窗口
// 已答时 applied=false）；settled 状态经行流同步（rowId p:<requestId>）。
// D-087：选项按工具族给精度——命令类「此命令」、write/edit「此路径」、其余工具级；拒绝说明
// 是独立一行输入（ZCode 行为层：写进输入框回车即「拒绝 + 说明」，纯拒绝仍是自己的行）。
// D-088（R205）：键盘模型照 ZCode 桌面弹窗——选中态 + 焦点跟随（默认第 1 行）、↑↓/←→/Tab
// 移动、Enter 确认当前行、常驻确认按钮（说明行选中且为空时禁用）；说明行是独立导航行，聚焦
// 即选中。鼠标点未选中行先选中、再点才裁决。Esc=拒绝保留（ZCode TUI 语义；桌面弹窗无，说明框
// 内只失焦）；座位内全局 Enter/Esc 兜底，卡外控件不抢键。
// D-089（R206）：Tab/Shift+Tab 只在「选项 + 说明行」循环（说明框 Tab 与 ↑↓ 同路走 moveSelection；
// 确认钮是鼠标件，键盘用 Enter）；moveSelection 先清说明框焦点守卫——↑↓/Tab 移出后光标跟选中
// 回选项；卡根 Tab 兜底把确认钮/卡容器上的 Tab 送回选中行，Tab 不出卡。

import { APPROVAL_FEEDBACK_MAX, type ApprovalRow } from "@henira/protocol";
import { useEffect, useRef, useState } from "react";
import type { ApprovalCardView, WebPartContext } from "../types.js";
import { ApprovalPreview } from "./approval-preview.js";
import { CheckGlyph, XGlyph } from "./icons.js";
import { DisclosureRow } from "./row-chrome.js";
import { SlotBoundary } from "./slot-boundary.js";
import { argsSummaryText, MonoBlock } from "./tool-cards.js";

type Decision = "allowed-once" | "rejected";

/** 座位内全局键的模块级互斥登记（审查 F8）：同屏多 Shell 时后挂者胜——只命中一张卡 */
let activeKeyHandler: ((e: KeyboardEvent) => void) | undefined;

/** 命令类工具（R198）：本会话/本项目允许都落「精确命令」规则（同命令才免问）； */
/** 路径类工具（D-087）：write/edit 落「精确路径」规则（同文件才免问，两工具互相命中）。 */
function shellTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell";
}

function pathTool(toolName: string): boolean {
  return toolName === "write" || toolName === "edit";
}

/** args.command 窄化：非空字符串才算可落精确规则（否则退回工具级/一次） */
function commandOf(args: unknown): string | undefined {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" && command.trim() !== "" ? command : undefined;
}

/** args 里的目标文件（write/edit 的 file_path 优先，其次 path）；取不到 = 无路径精度 */
function filePathOf(args: unknown): string | undefined {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as { file_path?: unknown; path?: unknown };
  for (const key of ["file_path", "path"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** args 超限丢弃后按真实 callId 从同会话 tool/call 行回查（R202/D-085：dsh 引用式自足）；
 *  行不在 store（旧账本 / 已翻出窗口）时返回 undefined，卡片回落 digest-only */
function resolveApprovalArgs(row: ApprovalRow, ctx: WebPartContext): unknown {
  if (row.args !== undefined) return row.args;
  if (row.callId === undefined) return undefined;
  try {
    const view = ctx.store.getSession(ctx.sessionId);
    const tool = view.rows.find((r) => r.kind === "tool" && r.callId === row.callId);
    if (tool?.kind !== "tool") return undefined;
    return tool.input.trim() === "" ? {} : (JSON.parse(tool.input) as unknown);
  } catch {
    return undefined;
  }
}

/** IME 组合中不抢键（提问卡同款：原生 isComposing / 老浏览器 keyCode 229） */
function isImeComposing(event: React.KeyboardEvent<Element>): boolean {
  const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return native.isComposing === true || event.keyCode === 229;
}

/** 审批卡外壳（导出——第三方 keyed 顶替件复用同一 chrome，D-057 观感协调）：warn 边框卡 +
 * 标题行（权限请求 + 队列计数 + pending/settled 徽章 + 工具名）+ reason 解释行 + 预览 children +
 * 编号选项 + 拒绝说明行 + 键盘提示 + 常驻确认按钮。D-088 交互：selectedIndex 默认 0，焦点
 * 跟随选中；鼠标点未选中行只选中，再点/Enter/确认按钮才裁决。点击即退场（R171——参照产品/
 * opencode/dsh 三家同款乐观移除）：onDecided 在发起瞬间回调（composer 本地摘卡，不等 SSE
 * settled 回传）；settle 网络失败 onDecideFailed 回滚（卡回 dock 可重试）。幂等先答者赢
 * （另一窗口已答时 applied=false）。 */
export function ApprovalCardShell(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  /** 队列总数（composer 队首单卡传入；>1 时显示「待审批 N」计数徽标——CC/ZCode FIFO 单卡同款） */
  queueTotal?: number;
  /** 决定发起即回调（乐观摘卡——点击即走，不等回传） */
  onDecided?: (requestId: string) => void;
  /** settle 失败回调（回滚乐观摘除——卡回 pending 可重试） */
  onDecideFailed?: (requestId: string) => void;
  children?: React.ReactNode;
}): React.ReactNode {
  const { row, ctx } = props;
  const [settling, setSettling] = useState(false);
  const [feedback, setFeedback] = useState("");
  /** 选中行：0..options.length-1 = 选项，options.length = 说明行（ZCode 同款；默认第 1 行） */
  const [selectedIndex, setSelectedIndex] = useState(0);
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 说明框持有焦点（RAF 自聚焦不得抢走正在输入的焦点——ZCode 同款守卫） */
  const feedbackFocusedRef = useRef(false);
  /** 首次聚焦已落位：之后选中变化即时跟随；首次走座位守卫（不夺设置/外部输入焦点） */
  const focusedOnceRef = useRef(false);
  const pending = row.status === "pending" && !settling;

  const decide = (decision: Decision, scope?: "session" | "project", text?: string): void => {
    if (ctx.sessionId === null) return;
    setSettling(true);
    props.onDecided?.(row.requestId); // 乐观摘卡（点击即走——失败走 onDecideFailed 回滚）
    // 参数形状按需展开：无 scope/说明时保持三参调用（既有字节面与断言等价）
    const call =
      text !== undefined
        ? ctx.client.settleApproval(ctx.sessionId, row.requestId, decision, scope, text)
        : scope !== undefined
          ? ctx.client.settleApproval(ctx.sessionId, row.requestId, decision, scope)
          : ctx.client.settleApproval(ctx.sessionId, row.requestId, decision);
    void call.catch((err: unknown) => {
      // 404 = 审批对象已不存在（服务重启收口/已答）——当已解决，卡保持离场不回滚
      //（回滚会让死卡复活、再点再炸死循环；参照物「404 视为已解决」同款语义）
      if ((err as { status?: number } | undefined)?.status === 404) return;
      setSettling(false); // 网络失败回到待处理（重试语义）
      props.onDecideFailed?.(row.requestId);
    });
  };

  // 精确档（R198/D-087）：命令类看命令、write/edit 看路径；有料才给会话/项目精确档，
  // 缺料（args 超限 / 旧账本）= 降级一次——整工具放行过宽，宁可不落。
  const shell = shellTool(row.toolName);
  const pathScoped = pathTool(row.toolName);
  const preciseCommand = shell && commandOf(row.args) !== undefined;
  const precisePath = pathScoped && filePathOf(row.args) !== undefined;
  const precise = preciseCommand || precisePath;
  // 选项行（参照：编号 + 主文案 + 说明；D-088 起点击先选中，再点/Enter/确认钮裁决）
  const options: {
    label: string;
    description: string;
    decision: Decision;
    scope?: "session" | "project";
  }[] = [
    {
      label: ctx.t("approval.allow"),
      description: ctx.t("approval.allowDesc"),
      decision: "allowed-once",
    },
  ];
  if (shell || pathScoped) {
    // 精确工具：缺命令/路径时不给中间档（一次 / 拒绝 / 说明）
    if (precise) {
      options.push({
        label: preciseCommand
          ? ctx.t("approval.sessionAllowCommand")
          : ctx.t("approval.sessionAllowPath"),
        description: preciseCommand
          ? ctx.t("approval.sessionAllowCommandDesc")
          : ctx.t("approval.sessionAllowPathDesc"),
        decision: "allowed-once",
        scope: "session",
      });
    }
  } else {
    // 其余工具（MCP 等）：没有可精确的参数字段，保留工具级本会话允许
    options.push({
      label: ctx.t("approval.sessionAllow"),
      description: ctx.t("approval.sessionAllowDesc"),
      decision: "allowed-once",
      scope: "session",
    });
  }
  if (precise) {
    options.push({
      label: preciseCommand
        ? ctx.t("approval.projectAllowCommand")
        : ctx.t("approval.projectAllowPath"),
      description: preciseCommand
        ? ctx.t("approval.projectAllowCommandDesc")
        : ctx.t("approval.projectAllowPathDesc"),
      decision: "allowed-once",
      scope: "project",
    });
  }
  options.push({
    label: ctx.t("approval.deny"),
    description: ctx.t("approval.denyDesc"),
    decision: "rejected",
  });

  /** 说明行下标 = 选项数（末位独立导航行——不是挂在拒绝按钮上） */
  const feedbackIndex = options.length;
  const isFeedbackSelected = selectedIndex === feedbackIndex;

  const decideOption = (option: (typeof options)[number]): void => {
    decide(
      option.decision,
      option.scope,
      // 拒绝时把说明框草稿一起带上（ZCode 同款）；允许/一次忽略草稿
      option.decision === "rejected" ? feedback.trim() || undefined : undefined,
    );
  };

  /** 说明框回车 = 拒绝 + 说明（trim 空不提交——空内容不是拒绝理由） */
  const submitFeedback = (): void => {
    const text = feedback.trim();
    if (text === "") return;
    decide("rejected", undefined, text);
  };

  /** Enter / 确认按钮：提交当前选中行（说明行 = 拒绝 + 说明；选项行 = 该选项裁决） */
  const confirmSelection = (): void => {
    if (isFeedbackSelected) {
      submitFeedback();
      return;
    }
    const option = options[selectedIndex];
    if (option !== undefined) decideOption(option);
  };

  /** 选中移动（选项 + 说明行循环；焦点由效果跟随）。
   *  先放下「说明框持有焦点」守卫：↑↓/Tab 从输入框移出是用户主动导航，守卫若不放，
   *  聚焦效果会被 `:268` 的 early-return 挡住，光标留在输入框（ZCode moveSelection 同款）。 */
  const moveSelection = (step: 1 | -1): void => {
    feedbackFocusedRef.current = false;
    const total = options.length + 1;
    setSelectedIndex((current) => (current + step + total) % total);
  };

  // 换请求即复位（ZCode 同款）：草稿/选中/乐观离场不跨请求泄漏
  // biome-ignore lint/correctness/useExhaustiveDependencies: requestId 是复位触发信号（effect 体不读它）
  useEffect(() => {
    setSelectedIndex(0);
    setFeedback("");
    setSettling(false);
    feedbackFocusedRef.current = false;
    focusedOnceRef.current = false;
  }, [row.requestId]);

  // args 迟到（callId 回查）导致选项数变少时，选中不越界
  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, feedbackIndex));
  }, [feedbackIndex]);

  // 焦点跟随选中：首次自聚焦走座位守卫（焦点在 body / 卡内 / 接管宿主内才落位——不抢
  // 设置弹窗等座位外焦点，R185 审查 P3③ 纪律）。**不用 RAF**：后台/嵌入式浏览器标签页的
  // RAF 可能停摆（IAB 实锤 visibilityState=visible 但 rAF 不回调），首帧焦点会永远留在接管
  // 容器上。dock 父 effect 可能在本 effect 之后才聚焦接管容器，所以首帧同时排一个 setTimeout(0)
  // 兜底：只接管「容器 / 卡本体 / 卡内已有焦点 / body」，说明框输入中或座位外不抢。
  // `focusedOnceRef` 可能由 focusin 转投（dock 聚焦容器 → 选中行）先落位，所以首帧判定必须
  // 把「卡内已有焦点」也算作已落位：否则 ArrowDown 改选中时仍走首帧分支，焦点不跟随。
  useEffect(() => {
    if (!pending) return;
    const focusSelected = (): void => {
      if (isFeedbackSelected) feedbackRef.current?.focus();
      else optionRefs.current[selectedIndex]?.focus();
    };
    if (!focusedOnceRef.current) {
      if (feedbackFocusedRef.current) return;
      const root = rootRef.current;
      if (root === null) return;
      const host = root.closest<HTMLElement>(".henira-composer-takeover") ?? null;
      const focusIfCardHolds = (): void => {
        if (feedbackFocusedRef.current) return;
        const active = document.activeElement;
        const inside =
          active === null ||
          active === document.body ||
          active === root ||
          active === host ||
          root.contains(active);
        if (!inside) return;
        focusedOnceRef.current = true;
        focusSelected();
      };
      focusIfCardHolds();
      const timer = window.setTimeout(focusIfCardHolds, 0);
      return () => window.clearTimeout(timer);
    }
    if (feedbackFocusedRef.current) return;
    focusSelected();
  }, [selectedIndex, isFeedbackSelected, pending]);

  // 接管容器被 dock 聚焦（或用户点卡片空白）时，把焦点落到选中行：dock 的职责是「焦点进座位」，
  // 卡内的键盘通道在选中行上——只停在容器 DIV 上会让 Enter/↑↓ 全盲（活体实锤：dock 的
  // 回焦 effect 晚于首帧自聚焦时把焦点抢回容器）。
  useEffect(() => {
    if (!pending) return;
    const root = rootRef.current;
    const host = root?.closest<HTMLElement>(".henira-composer-takeover") ?? null;
    if (root === null || host === null) return;
    const onFocusIn = (event: FocusEvent): void => {
      // 只接管「焦点落在容器/卡本体」的场景；预览展开钮等卡内控件保持自己的焦点
      if (event.target !== host && event.target !== root) return;
      if (feedbackFocusedRef.current) return;
      // 转投成功 = 卡已接管焦点；后续选中变化必须直接跟随，不再走首帧守卫
      focusedOnceRef.current = true;
      if (isFeedbackSelected) feedbackRef.current?.focus();
      else optionRefs.current[selectedIndex]?.focus();
    };
    host.addEventListener("focusin", onFocusIn);
    return () => host.removeEventListener("focusin", onFocusIn);
  }, [isFeedbackSelected, pending, selectedIndex]);

  // 座位内全局键兜底（队首单卡）：焦点在 body / 卡内 / 接管宿主内，且目标不是可编辑控件、
  // 卡内处理器未消费时——Enter = 确认当前选中行、Esc = 拒绝（ZCode TUI 语义：Esc 是拒绝通道
  // 不是中断；桌面弹窗说明框内只失焦，见 textarea）。按钮的排除只对 Enter 生效（原生 click /
  // 预览展开钮自己的 Enter 语义）：Esc 必须对按钮也生效——默认焦点就在首行选项按钮上，否则
  // 「Esc=拒绝」名存实亡（R206 审查回归）。
  // 模块级互斥（审查 F8）：同屏多 Shell 时后挂者胜，一次按键只命中一张卡。
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("input, textarea, select, [contenteditable='true']") !== null) return;
      const root = rootRef.current;
      if (root === null) return;
      const host = root.closest(".henira-composer-takeover");
      const withinSeat =
        target === document.body || root.contains(target) || host?.contains(target);
      if (!withinSeat) return;
      if (e.key === "Enter") {
        // 按钮保留自己的 Enter 语义（R205：焦点在预览展开钮上按 Enter 曾同时放行审批）
        if (target.closest("button") !== null) return;
        e.preventDefault();
        confirmSelection();
      } else if (e.key === "Escape") {
        e.preventDefault();
        decide("rejected");
      }
    };
    if (activeKeyHandler !== undefined) {
      window.removeEventListener("keydown", activeKeyHandler);
    }
    activeKeyHandler = onKey;
    window.addEventListener("keydown", onKey);
    return () => {
      if (activeKeyHandler === onKey) activeKeyHandler = undefined;
      window.removeEventListener("keydown", onKey);
    };
  });

  /** 选项行键位：↑↓/←→ 移动、Tab/Shift+Tab 在「选项 + 说明行」循环、Enter 确认当前行、
   *  数字 1..N 直接裁决 / N+1 聚焦说明行（ZCode 同款，选项数通用化）。确认钮是鼠标件，
   *  键盘用 Enter 确认——ZCode 的 Tab 从可选行到不了确认钮，Tab 也不出卡。 */
  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (isImeComposing(event)) return;
    // 裸数字才裁决：Ctrl/Cmd/Alt+数字是浏览器/系统快捷键，不能误放行（R206 审查）
    if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
      const digit = Number(event.key);
      const option = options[digit - 1];
      if (option !== undefined) {
        event.preventDefault();
        setSelectedIndex(digit - 1);
        decideOption(option);
        return;
      }
      if (digit === feedbackIndex + 1) {
        event.preventDefault();
        setSelectedIndex(feedbackIndex);
        return;
      }
    }
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(-1);
        return;
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveSelection(1);
        return;
      case "Tab":
        // ZCode 同款：Tab/Shift+Tab 都只在可选行里循环（普通审批窗上方没有控件，
        // 不做第一行反向出口——出了卡就会落到设置/侧栏，用户明确要求围栏）
        event.preventDefault();
        moveSelection(event.shiftKey ? -1 : 1);
        return;
      case "Enter":
        event.preventDefault();
        confirmSelection();
        return;
      default:
        return;
    }
  };

  /** 说明框键位：↑↓ 离开输入框回选项；Tab/Shift+Tab 与 ↑↓ 同路——都走 moveSelection
   *  在「选项 + 说明行」里循环（ZCode handleFeedbackKeyDown 同款，Tab 不放行到确认钮）；
   *  Enter = 拒绝 + 说明（空内容不提交，Shift+Enter 保留换行）、Esc 只失焦 */
  const onFeedbackKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isImeComposing(event)) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      submitFeedback();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
    }
  };

  /** 卡根 Tab 兜底：选项/说明框自己的处理器已 preventDefault，能走到这里的只有确认钮
   *  （或卡容器本身）。ZCode 的确认钮是鼠标件，Tab 从可选行到不了它；用户若先点它再按
   *  Tab，也必须留在卡内——回到当前选中行。 */
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab" || event.defaultPrevented || isImeComposing(event)) return;
    event.preventDefault();
    if (isFeedbackSelected) feedbackRef.current?.focus();
    else optionRefs.current[selectedIndex]?.focus();
  };

  /** 说明框高度跟随内容（1–5 行，超出内部滚动——窄屏不挤掉选项） */
  const resizeFeedback = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={ctx.t("approval.title")}
      tabIndex={-1}
      className="henira-approval"
      onKeyDown={onCardKeyDown}
    >
      <div className="henira-approval-head">
        <span className="henira-approval-title">{ctx.t("approval.title")}</span>
        {pending && props.queueTotal !== undefined && props.queueTotal > 1 ? (
          <span className="henira-approval-queue">
            {`${ctx.t("approval.queueCount")} ${props.queueTotal}`}
          </span>
        ) : null}
        {!pending ? (
          <span className="henira-approval-queue">{ctx.t("approval.settled")}</span>
        ) : null}
      </div>
      {row.reason !== undefined ? <p className="henira-approval-reason">{row.reason}</p> : null}
      {props.children}
      {pending ? (
        <>
          <div className="henira-approval-options">
            {options.map((option, index) => (
              <button
                key={`${option.decision}:${option.scope ?? "once"}`}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                className={`henira-approval-option${index === selectedIndex ? " is-selected" : ""}`}
                aria-label={option.label}
                tabIndex={index === selectedIndex ? 0 : -1}
                // 不挂 onFocus 同步选中：真实鼠标 click = mousedown（聚焦）→ click 的顺序，
                // onFocus 先把选中改到本行会让第一下点击直接裁决（e2e 实锤）。选中由 click
                // 分支移动；程序化聚焦前选中已就位，键盘/读屏只落在已选中行（roving tabIndex）。
                onKeyDown={onOptionKeyDown}
                onClick={() => {
                  // 点未选中行 = 只选中（ZCode 同款）；再点 / Enter / 确认按钮才裁决
                  if (index === selectedIndex) decideOption(option);
                  else setSelectedIndex(index);
                }}
              >
                <span className="henira-approval-index">{index + 1}.</span>
                <span className="henira-approval-option-text">
                  <span className="henira-approval-option-label">{option.label}</span>
                  <span className="henira-approval-option-desc">{option.description}</span>
                </span>
              </button>
            ))}
            {/* D-087：拒绝说明独立一行（不是挂在拒绝按钮上的输入框）；D-088：聚焦即选中
                末行（点整行 = 点输入框），↑↓ 移回选项。空内容回车不提交；Esc 只失焦。 */}
            <label
              className={`henira-approval-feedback${isFeedbackSelected ? " is-selected" : ""}`}
            >
              <span className="henira-approval-index">{options.length + 1}.</span>
              <textarea
                ref={feedbackRef}
                rows={1}
                className="henira-approval-feedback-input"
                aria-label={ctx.t("approval.feedbackAria")}
                placeholder={ctx.t("approval.feedbackPlaceholder")}
                maxLength={APPROVAL_FEEDBACK_MAX}
                value={feedback}
                onFocus={() => {
                  feedbackFocusedRef.current = true;
                  setSelectedIndex(feedbackIndex);
                }}
                onBlur={() => {
                  feedbackFocusedRef.current = false;
                }}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  resizeFeedback(event.currentTarget);
                }}
                onKeyDown={onFeedbackKeyDown}
              />
            </label>
          </div>
          <div className="henira-approval-foot">
            <p className="henira-approval-hint">{ctx.t("approval.keyboardHint")}</p>
            <button
              type="button"
              className="henira-approval-confirm henira-primary"
              disabled={ctx.sessionId === null || (isFeedbackSelected && feedback.trim() === "")}
              onClick={confirmSelection}
            >
              {ctx.t("approval.confirm")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 通用审批卡（fallback）：外壳 + per-tool 预览体。args 缺（旧账本/超尺寸闸丢弃）→
 * digest 弱色行（「digest 保留作关联指纹」的数据通道承诺对齐——审查 F6） */
export function ApprovalCard(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  queueTotal?: number;
  onDecided?: (requestId: string) => void;
  onDecideFailed?: (requestId: string) => void;
}): React.ReactNode {
  // 超限 args 丢弃后按 callId 回查（R202/D-085）；回查结果同时供预览体与命令级规则使用
  const resolved = resolveApprovalArgs(props.row, props.ctx);
  const row =
    props.row.args === undefined && resolved !== undefined
      ? { ...props.row, args: resolved }
      : props.row;
  return (
    <ApprovalCardShell
      row={row}
      ctx={props.ctx}
      queueTotal={props.queueTotal}
      onDecided={props.onDecided}
      onDecideFailed={props.onDecideFailed}
    >
      {row.args !== undefined ? (
        <ApprovalPreview row={row} ctx={props.ctx} />
      ) : row.argsSummary !== undefined ? (
        <div className="henira-approval-digest">{row.argsSummary}</div>
      ) : null}
    </ApprovalCardShell>
  );
}

/** 队首审批卡路由（E6 keyed 缝 approval.view.<工具名>）：精确 key → 通用卡兜底。composer
 * 只渲染队首一张（FIFO，CC/ZCode 同款）；SlotBoundary 行级隔离 + **崩溃回落官方卡**（审查
 * F1：审批 dock 是唯一应答通道，顶替件崩溃渲染 null = composer 被无卡永久阻塞——必须回落）。
 * 队首更替由 composer 的 key={rowId} 重挂复位崩溃态。 */
export function ApprovalQueueCard(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  queueTotal: number;
  onDecided?: (requestId: string) => void;
  onDecideFailed?: (requestId: string) => void;
}): React.ReactNode {
  const view = props.ctx.slots.get(`approval.view.${props.row.toolName}`)?.[0] as
    | ApprovalCardView
    | undefined;
  const routed = (children: React.ReactNode): React.ReactNode => (
    <SlotBoundary
      label={`approval.view.${props.row.toolName}`}
      fallback={() => (
        <ApprovalCard
          row={props.row}
          ctx={props.ctx}
          queueTotal={props.queueTotal}
          onDecided={props.onDecided}
          onDecideFailed={props.onDecideFailed}
        />
      )}
    >
      {children}
    </SlotBoundary>
  );
  if (view !== undefined) {
    const View = view; // 组件渲染（hooks 合法）
    return routed(
      <View
        ctx={props.ctx}
        row={props.row}
        queueTotal={props.queueTotal}
        onDecided={props.onDecided}
        onDecideFailed={props.onDecideFailed}
      />,
    );
  }
  return (
    <ApprovalCard
      row={props.row}
      ctx={props.ctx}
      queueTotal={props.queueTotal}
      onDecided={props.onDecided}
      onDecideFailed={props.onDecideFailed}
    />
  );
}

/** settled 紧凑结果行（对话流内留痕——R171 升级：中文决策词 + 参数摘要 + 可展开看全文，
 *  与工具行同一行 chrome；决策原文不再裸显英文）。展开体 = args 完整 JSON / 说明 / digest 弱色行。 */
export function ApprovalSettledRow({
  row,
  ctx,
}: {
  row: ApprovalRow;
  ctx: WebPartContext;
}): React.ReactNode {
  const allowed = row.decision === "allowed-once";
  const decisionLabel =
    row.decision === undefined
      ? ctx.t("approval.settled")
      : row.decision === "invalidated"
        ? ctx.t("approval.decision.invalidated")
        : allowed
          ? row.scope === "project"
            ? ctx.t("approval.decision.project")
            : row.scope === "session"
              ? ctx.t("approval.decision.session")
              : ctx.t("approval.decision.allowed")
          : ctx.t("approval.decision.rejected");
  const argValue = resolveApprovalArgs(row, ctx);
  const args =
    argValue !== null && typeof argValue === "object" && !Array.isArray(argValue)
      ? (argValue as Record<string, unknown>)
      : null;
  const summary = argsSummaryText(row.toolName, args);
  const fullText = args !== null ? JSON.stringify(args, null, 2) : (row.argsSummary ?? "");
  return (
    <DisclosureRow
      icon={
        allowed ? (
          <CheckGlyph size={14} color="var(--henira-ok-text)" />
        ) : (
          <XGlyph size={14} color="var(--henira-danger-text)" />
        )
      }
      title={decisionLabel}
      meta={row.toolName}
      rowTitle={fullText !== "" ? `${row.toolName} ${row.decision ?? ""}` : undefined}
      summary={
        summary !== null ? (
          <span className="henira-row-summary" title={summary}>
            {summary}
          </span>
        ) : null
      }
    >
      {row.feedback !== undefined ? (
        <p className="henira-approval-feedback-note">
          {`${ctx.t("approval.feedbackLabel")} ${row.feedback}`}
        </p>
      ) : null}
      {fullText !== "" ? <MonoBlock text={fullText} maxHeight={240} /> : null}
    </DisclosureRow>
  );
}

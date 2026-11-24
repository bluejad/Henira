// interaction 槽位契约（interfaces.md protocol 段，2026-11-16 定稿；question 种类 R184 落码）。
// 引擎所在进程的宿主实现（①=server；③=cli / sdk 嵌入方，sdk 自带缺省实现；
// 测试与 examples 用 mock 自动应答）。两类交互：
//   approval —— 工具执行前的权限请求（Decision 闭合词表）；
//   question —— 模型执行中向用户提问（R184，专用工具 ask_user；答案即工具结果的来源，
//               不与审批合并——dsh 同层：权限请求是闭合裁决，澄清表单是自由输入，两种
//               产品概念，复用会把它们压扁）。
// 挂起语义两类一致：请求活着 = 宿主内存表 + 账本 asked 行；答案经 settle 收回。

import type { Decision } from "./approval.js";

/** 单个选项（ZCode schema 行为层：label 1–5 词 + 可选描述；自定义输入由客户端恒提供，
 *  模型不得自带 "Other" 选项——工具描述与校验层拦） */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** 单题（dsh ask_user_question 参数 + ZCode header/preview 取舍）：options 缺席 = 纯自由
 *  文本题；multiSelect 只对带 options 的题有意义 */
export interface QuestionSpec {
  id: string;
  question: string;
  /** 卡片 chip 短标签（≤12 字符） */
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

/** 单题答案：selected 为空数组 = 明确跳过；custom = 自定义输入文本（有 options 时与选择
 *  并存，纯文本题只带 custom） */
export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/** 单题自定义回答长度上限（码点计数）：UI 输入框 / REST 校验 / 引擎归一 / 账本校验四处
 *  同源。自由文本无上限 = 任意长粘贴撑爆账本与模型上下文（R175 家族，R186 收尾）。 */
export const QUESTION_CUSTOM_MAX = 2000;

export type ApprovalInteractionRequest = {
  kind: "approval";
  requestId: string;
  toolName: string;
  args: unknown;
  reason?: string;
};

export type QuestionInteractionRequest = {
  kind: "question";
  requestId: string;
  toolName: string;
  questions: QuestionSpec[];
};

export type InteractionRequest = ApprovalInteractionRequest | QuestionInteractionRequest;

export type ApprovalInteractionAnswer = {
  kind: "approval";
  requestId: string;
  decision: Decision;
  /** 允许范围（E6/R198）：settle 携带 → decided{scope} 落账。session = 本会话免问（命令类
   * 工具落精确规则、其余工具级）；project = 写项目 permissions.json 的精确命令规则。
   * 缺省不带键——once 语义与既有字节面等价 */
  scope?: "session" | "project";
};

/** 问答应答：answers 在场 = 已答（逐题，含空选跳过）；cancelled:true = 用户取消整个请求
 *（工具收 Error 结果、回合继续——dsh ASK_CANCELLED 行为层）。两变体互斥。 */
export type QuestionInteractionAnswer =
  | { kind: "question"; requestId: string; answers: QuestionAnswer[] }
  | { kind: "question"; requestId: string; cancelled: true };

export type InteractionAnswer = ApprovalInteractionAnswer | QuestionInteractionAnswer;

export interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  /** 幂等，先答者赢；未知 requestId 返回 false */
  settle(requestId: string, answer: InteractionAnswer): boolean;
  /** 该 requestId 是否曾为本服务所知（现在挂起或已答过）——settle false 后区分「已答过」
   * 与「从不存在」（REST 层对后者 404；R175 重启收口：幽灵卡点击不再假成功）。可选，
   * 缺省实现（autoReject 等）可不提供 */
  knows?(requestId: string): boolean;
  /** 断线 / 刷新重放（P5：交互状态属于会话而非连接） */
  listPending(): readonly InteractionRequest[];
}

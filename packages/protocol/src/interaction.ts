// interaction 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// 引擎所在进程的宿主实现（①=server；③=cli / sdk 嵌入方，sdk 自带缺省实现；
// 测试与 examples 用 mock 自动应答）。M2 只定审批交互；question 类随其首个
// 消费者定稿时扩展（D-013③：没有消费者的形状不进协议）。

import type { Decision } from "./approval.js";

export type InteractionRequest = {
  kind: "approval";
  requestId: string;
  toolName: string;
  args: unknown;
  reason?: string;
};

export type InteractionAnswer = {
  kind: "approval";
  requestId: string;
  decision: Decision;
};

export interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  /** 幂等，先答者赢；未知 requestId 返回 false */
  settle(requestId: string, answer: InteractionAnswer): boolean;
  /** 断线 / 刷新重放（P5：审批状态属于会话而非连接） */
  listPending(): readonly InteractionRequest[];
}

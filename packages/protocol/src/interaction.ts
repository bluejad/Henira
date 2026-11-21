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
  /** 会话级允许（E6）：settle 携带 → decided{scope:'session'} 落账 → 同工具后续调用免 ask
   * （tools-approval §3.1 折叠）。缺省不带键——once 语义与既有字节面等价 */
  scope?: "session";
};

export interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  /** 幂等，先答者赢；未知 requestId 返回 false */
  settle(requestId: string, answer: InteractionAnswer): boolean;
  /** 该 requestId 是否曾为本服务所知（现在挂起或已答过）——settle false 后区分「已答过」
   * 与「从不存在」（REST 层对后者 404；R175 重启收口：幽灵卡点击不再假成功）。可选，
   * 缺省实现（autoReject 等）可不提供 */
  knows?(requestId: string): boolean;
  /** 断线 / 刷新重放（P5：审批状态属于会话而非连接） */
  listPending(): readonly InteractionRequest[];
}

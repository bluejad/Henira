// 压缩槽位契约（compaction.md §4.10、§4.12）：`compaction` 槽由 @henira/plugin-compaction
// 占据（默认预设、可停用）。计量与阈值不在本槽（住 loop/protocol，停用插件照常成立）。
// 手动入口的响应四态与原因字段在这一层写死——REST / SDK / 界面同源校验。

/** 手动压缩说明上限（码点；compaction.md §4.10）——与摘要指令预留同一量级 */
export const COMPACTION_INSTRUCTIONS_MAX = 2_000;

/** 手动压缩请求（说明可空；trim 后空串按缺省处理） */
export interface CompactionRequest {
  instructions?: string;
}

/** 请求受理四态：accepted = 已入队且立即消费；queued = 已入队、排在前面工作之后；
 *  skipped/rejected 带 reason（D-092：手动压缩是队列意图，消费结果不再由本响应携带） */
export const COMPACTION_REQUEST_STATES = ["accepted", "queued", "skipped", "rejected"] as const;
export type CompactionRequestState = (typeof COMPACTION_REQUEST_STATES)[number];

export interface CompactionResponse {
  state: CompactionRequestState;
  /** 只在 skipped / rejected 时出现（历史不足 / 重复请求 / 压缩不可用） */
  reason?: string;
}

export interface CompactionService {
  /** 手动压缩：校验/去重后作为 kind=compact 队列意图入队（D-092、compaction.md §4.10）；
   *  未装压缩插件时槽缺失 */
  request(req?: CompactionRequest): Promise<CompactionResponse>;
}

/** 压缩触发因（行上呈现） */
export const COMPACTION_TRIGGERS = ["auto", "manual"] as const;
export type CompactionTrigger = (typeof COMPACTION_TRIGGERS)[number];

/** 压缩行四态（compaction.md §4.11）：running 只存在于活态，悬挂 start 由投影收口为 interrupted */
export const COMPACTION_STATES = ["running", "completed", "failed", "interrupted"] as const;
export type CompactionState = (typeof COMPACTION_STATES)[number];

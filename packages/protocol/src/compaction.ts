// 压缩槽位契约（compaction.md §4.10、§4.12）：`compaction` 槽由 @henira/plugin-compaction
// 占据（默认预设、可停用）。计量与阈值不在本槽（住 loop/protocol，停用插件照常成立）。
// 手动入口的响应四态与原因字段在这一层写死——REST / SDK / 界面同源校验。

/** 手动压缩说明上限（码点；compaction.md §4.10）——与摘要指令预留同一量级 */
export const COMPACTION_INSTRUCTIONS_MAX = 2_000;

/** 手动压缩请求（说明可空；trim 后空串按缺省处理） */
export interface CompactionRequest {
  instructions?: string;
}

/** 请求受理四态：accepted = 立即执行；queued = 下一步边界执行；skipped/rejected 带 reason */
export const COMPACTION_REQUEST_STATES = ["accepted", "queued", "skipped", "rejected"] as const;
export type CompactionRequestState = (typeof COMPACTION_REQUEST_STATES)[number];

export interface CompactionResponse {
  state: CompactionRequestState;
  /** 只在 skipped / rejected 时出现（历史不足 / 重复请求 / 熔断） */
  reason?: string;
}

export interface CompactionService {
  /** 手动压缩：闲时立即、忙时排队到下一个步边界；未装压缩插件时槽缺失 */
  request(req?: CompactionRequest): Promise<CompactionResponse>;
}

/** 压缩触发因（行上呈现） */
export const COMPACTION_TRIGGERS = ["auto", "manual"] as const;
export type CompactionTrigger = (typeof COMPACTION_TRIGGERS)[number];

/** 压缩行四态（compaction.md §4.11）：running 只存在于活态，悬挂 start 由投影收口为 interrupted */
export const COMPACTION_STATES = ["running", "completed", "failed", "interrupted"] as const;
export type CompactionState = (typeof COMPACTION_STATES)[number];

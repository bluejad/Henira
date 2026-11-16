// 槽位契约（M1 定稿范围：SessionService + 派生消息 DTO）。
// 其余槽位接口（llm / tools / approval / interaction / config / loop / commands）仍为
// interfaces.md 形状级草案，各包落码前定稿、随定稿进入本文件（packages.md 能力服务表）。

import type { SessionEvent, SessionEventInput, SessionHeader } from "./envelope.js";

/** 附件引用：路径必须相对会话目录（session.md §2.2——禁止绝对路径、禁止嵌 sessionId，fork 零改写的前提） */
export interface SessionAttachment {
  path: string;
  /** 可选：MIME 提示 */
  mime?: string;
  /** 可选：展示名 */
  name?: string;
}

/** 派生历史里的工具调用：arguments 恒为模型原始 JSON 文本（P3-1 argsText 不变量在日志侧的对偶） */
export interface ToolCallDraft {
  callId: string;
  name: string;
  arguments: string;
}

/** 引擎内消息形状：deriveMessages 的产物；llm 适配器（M2）翻译成 provider 格式 */
export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; attachments?: SessionAttachment[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCallDraft[] }
  | { role: "tool"; callId: string; name: string; content: string; isError: boolean };

/** 会话槽位契约（interfaces.md protocol 段，2026-11-16 定稿） */
export interface SessionService {
  /** 文件第 1 行的不可变身份（含 version） */
  header(): SessionHeader;
  /** 会话目录（queue.json / attachments 等伴生文件的住处，data-directory.md §2.1） */
  readonly directory: string;
  /** 校验 → 分配 seq → 追加 → fsync */
  append(input: SessionEventInput): Promise<SessionEvent>;
  /** 内存中的全部事件（追加序） */
  events(): readonly SessionEvent[];
  /** 应用 surfaceOp 后的模型历史（session.md §4 派生规则） */
  deriveMessages(): ModelMessage[];
  /** 复制前缀；半回合切点补 turn/end{forked}（session.md §6） */
  fork(atSeq?: number): Promise<SessionService>;
  /** 把日志重放给消费者（UI 回放、调试、未来的评测输入） */
  replay(visitor: (e: SessionEvent) => void | Promise<void>): Promise<void>;
}

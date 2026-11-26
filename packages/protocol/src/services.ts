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
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCallDraft[];
      /** 思维链文本（账本 assistant/message.reasoning）：开思考且模型声明 interleaved 时
       * 适配器回传 provider（DeepSeek V4.1+ 带 tool_calls 不回传 400——端点实证） */
      reasoning?: string;
    }
  | { role: "tool"; callId: string; name: string; content: string; isError: boolean };

/** 派生表面的一条消息：seq = 账本锚点（替换摘要在区间起点、孤儿结果在 call 处）。
 *  计量器靠它切「锚点之后」的增量（compaction.md §4.2、I-1） */
export interface SurfaceEntry {
  seq: number;
  message: ModelMessage;
}

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
  /** 同一次折叠，每条带 seq（计量器读数来源——与 deriveMessages() 共用一份实现，I-1） */
  deriveSurface(): SurfaceEntry[];
  /** 复制前缀；半回合切点补 turn/end{forked}（session.md §6） */
  fork(atSeq?: number): Promise<SessionService>;
  /** 把日志重放给消费者（UI 回放、调试、未来的评测输入） */
  replay(visitor: (e: SessionEvent) => void | Promise<void>): Promise<void>;
}

/** MCP server 声明（interfaces.md §mcp 契约小节，D-064）：宿主扫描 mcp/*.json 后喂 plugin-mcp，
 *  模板变量与 `${credential:}` 已展开——本形状里不含密钥引用，只含解析后的值 */
export interface McpServerSpec {
  pluginId: string;
  /** server 名（mcp/<名>.json 文件名去 .json；跨插件 D-032 去重后的唯一名） */
  server: string;
  kind: "stdio" | "remote";
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  url?: string;
  headers?: Readonly<Record<string, string>>;
}

/** McpService.call 的结果：text join（非文本项占位行）+ isError 透传（D-064） */
export interface McpCallResult {
  content: string;
  isError?: boolean;
}

/** mcp 槽位契约（interfaces.md §mcp 契约小节，D-064）：最小面——useResource 数据泵与
 *  未来消费者的唯一通道；工具转接进 tools 注册表不经本服务 */
export interface McpService {
  /** 调一个已连接 server 的工具；server 未声明 / 未连接 → 抛错 */
  call(
    target: { pluginId: string; server: string; tool: string },
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
}

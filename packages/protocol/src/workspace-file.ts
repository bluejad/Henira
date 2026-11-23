// 会话工作区文件读取（R190 预览缝）：读取权威 = 会话 + 路径，不是工具行。
// 服务端与 SDK 双形态共用同一形状与上限；正文只进响应，不进 ui-state、不落盘。

/** 单次预览读取上限：文本超出截断（truncated），二进制超出直接拒绝（残缺字节不可用） */
export const WORKSPACE_FILE_MAX_BYTES = 1024 * 1024;

/** 工作区文件内容（预览读取响应；utf8 文本可能截断，base64 二进制始终完整） */
export interface WorkspaceFileContent {
  /** 服务端实际读取的绝对路径（会话 cwd 围栏内） */
  path: string;
  /** utf8 = 文本；base64 = 二进制 */
  encoding: "utf8" | "base64";
  content: string;
  /** 磁盘文件总字节数（截断前；判断「看到的是否全文」用） */
  size: number;
  /** 文本超过上限被截断 */
  truncated?: boolean;
}

/** 二进制嗅探：前 8KB 含 NUL 视为二进制（与 fs read 工具同判据，预览侧同口径） */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

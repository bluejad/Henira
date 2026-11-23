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

/** 按上限截断 UTF-8 字节并解码（R191 自审）：截断点落在多字节序列中间时回退到
 *  序列起点，避免尾部出现残码（U+FFFD）。无效字节序列按 TextDecoder 默认替换处理。 */
export function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  const end = Math.min(bytes.byteLength, Math.max(0, maxBytes));
  if (end === 0) return "";
  if (end === bytes.byteLength) return new TextDecoder().decode(bytes);
  let cut = end;
  // 向前跳过续字节（最多 3 个，4 字节序列上限），定位截断点之前的最后一个序列起点
  let lead = end - 1;
  for (let steps = 0; lead >= 0 && steps < 4; steps += 1) {
    const byte = bytes[lead] ?? 0;
    if ((byte & 0xc0) === 0x80) {
      lead -= 1;
      continue;
    }
    const need =
      byte < 0x80
        ? 1
        : (byte & 0xe0) === 0xc0
          ? 2
          : (byte & 0xf0) === 0xe0
            ? 3
            : (byte & 0xf8) === 0xf0
              ? 4
              : 1; // 非法起点按单字节处理（交给解码器替换）
    if (lead + need > end) cut = lead; // 序列未完整落入上限——整段回退
    break;
  }
  return new TextDecoder().decode(bytes.subarray(0, cut));
}

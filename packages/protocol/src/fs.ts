// fs 槽位契约（interfaces.md §fs，D-065）：文件能力 + 路径围栏（D-049 围栏跟着能力走）。
// 进出全为字符串 / 结构化数据、零 Node 句柄零流——沙箱 fs 同槽替换时围栏从「区外问」
// 变硬 containment，工具件与注入者零改动（第二实现思想实验，D-065）。

import type { ApprovalOptions, PermissionRequest, PermissionResult } from "./approval.js";

/** 围栏放行通道：区外访问经判定链问（floor:"ask" 抬高默认放行层）——服务不绕链直问 interaction。
 *  tool / args = 调用方工具名与原始 args（区外弹卡 PermissionRequest 用，卡上显示真实调用） */
export interface FsGate {
  tool: string;
  args?: unknown;
  signal?: AbortSignal;
  requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<PermissionResult>;
}

/** read 的结果：原始内容切片 + 分页事实；行号渲染与尾注归工具件 */
export interface FsReadResult {
  /** 请求区间内的文件文本（每行已截 2000 字符；不含行号前缀） */
  content: string;
  /** 本切片起始行（1 起）与结束行 */
  startLine: number;
  endLine: number;
  /** 文件总行数（截至本次扫描；二进制报错时无意义） */
  totalLines: number;
  /** 选区超过 50KB 时截断为 true（content 只含放得下的头部行） */
  truncatedByBytes?: boolean;
}

export interface FsGlobResult {
  /** 绝对路径；mtime 降序（新→旧） */
  files: string[];
  /** 扫描命中的全部路径数（可能 > files.length——上限 100 截断） */
  total: number;
}

export interface FsGrepOptions {
  /** 相对 cwd 或绝对；目录或单个文件（单文件 = 只扫该文件）；缺省 = 会话 cwd */
  path?: string;
  /** 文件名 glob 过滤（如 "*.ts"；只收一个正向 glob） */
  include?: string;
  outputMode?: "content" | "files_with_matches" | "count";
  /** 忽略大小写 */
  ignoreCase?: boolean;
  /** content 模式行号（默认 true） */
  lineNumbers?: boolean;
  /** content 模式上下文行数（各向同值；0–10 钳制） */
  context?: number;
  /** 命中上限（默认 250） */
  headLimit?: number;
}

export interface FsGrepMatch {
  file: string;
  line: number;
  text: string;
  /** content 模式：true = 命中行，false = 上下文行（-A/-B/-C 展开）；
   *  缺省按命中行处理（:/- 前缀渲染归工具件） */
  match?: boolean;
}

export interface FsGrepResult {
  matches: FsGrepMatch[];
  /** files_with_matches 模式：命中文件（mtime 降序） */
  files?: string[];
  /** count 模式：每文件命中数 */
  counts?: { file: string; count: number }[];
  /** 扫描看到的命中总数（可能 > 返回条数——head_limit 截断） */
  totalSeen: number;
  /** 扫描命中的文件总数（files_with_matches / count 模式的截断注记按它判——totalSeen 是行数） */
  totalFiles?: number;
}

/** fs 槽位契约（interfaces.md §fs，D-065）：六能力 + 会话级读态（read-before-mutate 守卫）。
 *  围栏强制点唯一住服务层：区内直行（判定链照常）、区外 → gate.requestPermission(floor:"ask")；
 *  区外 write / edit 会见两张卡（链卡 + 区外卡）——有意为之（fail-closed 显式二次确认）。
 *  词法围栏是给模型的护栏不是对抗恶意进程的沙箱（审批链才是闸）。 */
export interface FsService {
  /** 解析相对路径（相对会话 cwd）+ 区内 / 区外判定（win32 大小写不敏感；~ 展开到 home） */
  resolve(path: string): { absolute: string; inside: boolean };
  read(
    path: string,
    gate: FsGate,
    opts?: { offset?: number; limit?: number },
  ): Promise<FsReadResult>;
  /** 已存在的文件必须先 read（未见 / stale / 部分读三类守卫）；新建自动建父目录；写后刷新读态 */
  write(path: string, content: string, gate: FsGate): Promise<{ created: boolean; path: string }>;
  /** old_string 唯一性强制（>1 命中且未 replaceAll → 抛错带计数）；LF 归一匹配、保留原换行符；
   *  空 new = 删除；成功后刷新读态 */
  edit(
    path: string,
    op: { old: string; new: string; replaceAll?: boolean },
    gate: FsGate,
  ): Promise<{ replacements: number; path: string }>;
  /** 跳 .git/.hg/.svn/node_modules；上限 100、mtime 降序、绝对路径返回 */
  glob(pattern: string, gate: FsGate, opts?: { path?: string }): Promise<FsGlobResult>;
  /** JS 引擎（零外部二进制）；path 可为目录或单文件；跳二进制与 >10MB 文件；单行预览 2000 字符 */
  grep(pattern: string, gate: FsGate, opts?: FsGrepOptions): Promise<FsGrepResult>;
}

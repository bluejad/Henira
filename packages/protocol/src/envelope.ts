// 会话事件信封与首行头（session.md §2 逐字落地，已定稿）。
// type 排第一：读一行就知道是什么事件，不必先解析载荷；
// version 在 header：读文件的人必须先知道版本才能解析事件。

/** 会话事件：追加式日志的唯一样式；seq 会话内单调递增，从 1 开始 */
export interface SessionEvent<T extends string = string> {
  /** 'tool/call'；首段是语义域（保留域见 RESERVED_DOMAINS，插件事件用包名前缀） */
  type: T;
  seq: number;
  /** epoch ms */
  time: number;
  /** 由注册表按 type 校验（EventValidator） */
  data: unknown;
  /** 缺省 false：未知类型即拒读（fail-closed 在事件层的形态，session.md §2.5） */
  ignorable?: boolean;
}

/** 文件第 1 行，不是事件、没有 seq，永不修改 */
export interface SessionHeader {
  version: 1;
  id: string;
  createdAt: number;
  cwd: string;
  /** fork / 侧问指向源会话 */
  parentSession?: string;
  /** 云端归属（D-036）：部署时写入的用户标识，本地缺省；写入后不改 */
  user?: string;
}

/** append 入口载荷：seq / time 由 session 分配，调用方只给语义 */
export interface SessionEventInput {
  type: string;
  data: unknown;
  ignorable?: boolean;
}

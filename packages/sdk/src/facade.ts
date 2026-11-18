// 统一门面（D-037 / interfaces.md sdk 段定稿）：进程内 runtime 与远端 client 实现同一接口、
// 吐同一 ServerEvent 词表——"进程内与远程行为一致"由同一测试套件对双形态跑锁。
// 纯 TS 零 React（sdk 不携带界面，D-037）。

import type { UiAssets } from "@henira/config-loader";
import type {
  Decision,
  DirBrowse,
  GlobalUiState,
  PromptReceipt,
  RegisteredDir,
  RowsPage,
  ServerFrame,
  SessionSnapshot,
  SessionSummary,
  SessionUiState,
} from "@henira/protocol";

export interface SettingsData {
  version: 1;
  model?: string;
  ui?: { theme?: string; locale?: string };
}

export interface DirEntry {
  name: string;
  kind: "file" | "dir";
  size?: number;
  mtime?: number;
}

export interface ModelCatalog {
  providers: Record<string, { baseUrl?: string; models?: string[] }>;
}

export interface HeniraFacade {
  /** 收尾：runtime 释放会话锁与句柄；client 断开 SSE 连接 */
  stop(): Promise<void>;
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  /** D-045 单口：闲直跑 / 忙入队（id = 排队条目） */
  prompt(sessionId: string, text: string): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  /** settle 幂等先答者赢；未知 requestId 返回 false */
  settleApproval(sessionId: string, requestId: string, decision: Decision): Promise<boolean>;
  /** 初始渲染 + 断档重拉共用出口（快照永远从账本重建；长会话 = 尾部窗口，历史经 sessionRows 翻页） */
  snapshot(sessionId: string): Promise<SessionSnapshot>;
  /** 行翻页（长会话历史：before = rowSeq 排他游标；页不切轮；缺省 = 尾部一页） */
  sessionRows(sessionId: string, opts?: { before?: number; limit?: number }): Promise<RowsPage>;
  /** 设置读（settings.json；凭据永不出现，D-030） */
  getSettings(): Promise<SettingsData>;
  /** 设置写（程序写；data-directory §2.3） */
  putSettings(patch: {
    model?: string;
    ui?: { theme?: string; locale?: string };
  }): Promise<SettingsData>;
  /** 模型目录（手写覆盖 + models.dev 快照清单；无密钥） */
  listModels(): Promise<ModelCatalog>;
  /** 密钥写入（credentials.json 0600；无对应读取面——D-030 明文永不回读） */
  putCredential(providerId: string, key: string): Promise<void>;
  /** 界面资产清单（D-059 语言包/主题包；runtime 进程内直扫 globalDir、client 走 /api/ui-assets） */
  listUiAssets(): Promise<UiAssets>;
  /** 会话工作区文件列表（只限会话 cwd；隐藏项不返） */
  listDir(sessionId: string, dirPath?: string): Promise<DirEntry[]>;
  /** 登记工作目录列表（data-directory §4 projects.json——权威工作区列表，含自愈） */
  listDirs(): Promise<RegisteredDir[]>;
  /** 登记工作目录（校验：绝对路径 + 存在 + 是目录；非法抛错） */
  addDir(cwd: string): Promise<RegisteredDir>;
  /** 删登记目录：该 cwd 全部会话数据 + 登记条目（盘上工作目录本身不动，data-directory §7）；
   *  目录下有会话在跑 → 抛错（信息含 busy 会话 id——先中断再删） */
  deleteDir(id: string): Promise<void>;
  /** 全局目录浏览一层（新增目录弹窗数据源；path 缺省 homedir，__drives__ = 盘符列表根） */
  browseDirs(path?: string): Promise<DirBrowse>;
  /** 删单个会话（账本目录整棵；busy → 抛错——先中断再删） */
  deleteSession(id: string): Promise<void>;
  /** 全局"上次选中"（state/ui.json——运行态不进 settings.json，D-063；启动还原读之） */
  getUiState(): Promise<GlobalUiState>;
  /** 全局界面态写（选中变化时调用；整份换，D-063） */
  putUiState(doc: GlobalUiState): Promise<void>;
  /** 每会话界面绑定态读（<sessionDir>/ui-state.json：草稿/折叠组/面板宽度；选中时拉取回填） */
  getSessionUiState(sessionId: string): Promise<SessionUiState>;
  /** 每会话界面绑定态写（整份原子重写，后写者赢；服务端只验证不解释 + 64KB 上限，D-063） */
  putSessionUiState(sessionId: string, doc: SessionUiState): Promise<void>;
  /** 全局帧流（connected → 逐会话快照 → 增量）；远端形态内置重连 + 断档不猜（跳号即重拉快照换发） */
  events(): AsyncIterable<ServerFrame>;
}

/** 有界帧队列 → AsyncIterable（进程内形态与 SSE 连接共用；溢出即断——volatile 契约） */
export function frameQueue(cap = 256): {
  push: (frame: ServerFrame) => void;
  stream: () => AsyncGenerator<ServerFrame>;
} {
  const buffer: ServerFrame[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  return {
    push(frame) {
      if (ended) return;
      if (buffer.length >= cap) {
        ended = true; // 溢出断开：消费者 stream 结束，重连/重建职责在调用方
        wake?.();
        return;
      }
      buffer.push(frame);
      wake?.();
    },
    async *stream() {
      try {
        while (true) {
          while (buffer.length > 0) {
            yield buffer.shift() as ServerFrame;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        ended = true;
      }
    },
  };
}

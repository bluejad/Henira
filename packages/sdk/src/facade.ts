// 统一门面（D-037 / interfaces.md sdk 段定稿）：进程内 runtime 与远端 client 实现同一接口、
// 吐同一 ServerEvent 词表——"进程内与远程行为一致"由同一测试套件对双形态跑锁。
// 纯 TS 零 React（sdk 不携带界面，D-037）。

import type { PluginState, UiAssets } from "@henira/config-loader";
import type {
  Decision,
  DirBrowse,
  GlobalUiState,
  PreviewOpenSettings,
  PromptOptions,
  PromptReceipt,
  QuestionAnswer,
  ReasoningCapability,
  ReasoningOption,
  RegisteredDir,
  ResourceReply,
  RowsPage,
  ServerFrame,
  SessionSnapshot,
  SessionSummary,
  SessionUiState,
  WorkspaceFileContent,
} from "@henira/protocol";

export interface SettingsData {
  version: 1;
  model?: string;
  ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
}

export interface DirEntry {
  name: string;
  kind: "file" | "dir";
  size?: number;
  mtime?: number;
}

/** 选择器单模型条目（显示名/上下文窗/徽章位——模型目录收敛批；思考档批
 * 2026-11-19 增 reasoningOptions——档位集合真源，UI 按数据驱动） */
export interface CatalogModel {
  id: string;
  name?: string;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
  reasoningOptions?: ReasoningOption[];
}

export interface ModelCatalog {
  providers: Record<
    string,
    { name?: string; baseUrl?: string; reasoning?: ReasoningCapability; models?: CatalogModel[] }
  >;
}

/** 管理面单模型条目（开关/显示名/上下文窗——模型管理分组消费） */
export interface ProviderModelEntry {
  id: string;
  name?: string;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
  reasoningOptions?: ReasoningOption[];
  enabled: boolean;
}

/** 模型管理分组（连接态 + 显隐开关；无密钥——D-030） */
export interface ProviderCatalogEntry {
  id: string;
  name?: string;
  baseUrl?: string;
  reasoning?: ReasoningCapability;
  connected: boolean;
  models: ProviderModelEntry[];
}

/** 厂商选择页预设全表（快照 + 本地缓存字典视图；无密钥） */
export interface ModelPresets {
  presets: Record<
    string,
    { name?: string; models: Record<string, { name?: string; contextWindow?: number }> }
  >;
}

/** 自定义 OpenAI 兼容厂商入参（请求头引擎不消费——不收假配置） */
export interface CustomProviderInput {
  label?: string;
  baseUrl: string;
  key?: string;
  models: Array<{ model: string; label?: string }>;
}

/** 链路状态（R193）：connected = 事件流连接活着；reconnecting = 已断/正在退避重连。
 *  只表达「传输层」事实——模型静默是引擎层另一件事（llm 空闲看门狗），两者不混 */
export type LinkState = "connected" | "reconnecting";

export interface HeniraFacade {
  /** 收尾：runtime 释放会话锁与句柄；client 断开 SSE 连接 */
  stop(): Promise<void>;
  /** 链路状态订阅（仅远端 client 实现；进程内 runtime 无链路，缺省 undefined）。
   *  返回退订函数；状态只在变化时通知（首连也发 connected） */
  onLinkState?(listener: (state: LinkState) => void): () => void;
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  /** D-045 单口：闲直跑 / 忙入队（id = 排队条目）；opts = 模型/思考按次覆盖 +
   *  steer=true 忙时直接以插话身份入队（下一 step 边界进场） */
  prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions & { steer?: boolean },
  ): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  /** 立即发送（抢占式）：停止当前回合并以该条开新回合；条目不存在返回 false */
  promoteQueueEntry(sessionId: string, entryId: string): Promise<boolean>;
  /** 删除排队条目（排队卡行级操作）；条目不存在返回 false */
  removeQueueEntry(sessionId: string, entryId: string): Promise<boolean>;
  /** 恢复中断冻结的队列冲刷（取队头开新回合）；无冻结/无条目/忙时返回 false */
  resumeQueue(sessionId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  /** 轮尾分叉（E4；session.md §6）：按账本 seq 前缀复制出新会话（parentSession 指源，
   *  半回合切点补写 turn/end{forked}），子会话装配入册；返回子会话 id。atSeq 缺省 = 复制到最新 */
  fork(sessionId: string, atSeq?: number): Promise<string>;
  /** settle 幂等先答者赢；未知 requestId 返回 false。scope:'session' = 会话级允许（E6：
   * decided{scope} 落账 → 同工具后续调用免 ask，tools-approval §3.1） */
  settleApproval(
    sessionId: string,
    requestId: string,
    decision: Decision,
    scope?: "session",
  ): Promise<boolean>;
  /** 提问收答（R184）：answers 逐题（空选择 = 跳过）或 {cancelled:true}（工具收 Error 结果、
   *  回合继续）。幂等先答者赢；未知 requestId 返回 false */
  settleQuestion(
    sessionId: string,
    requestId: string,
    answer: readonly QuestionAnswer[] | { cancelled: true },
  ): Promise<boolean>;
  /** 初始渲染 + 断档重拉共用出口（快照永远从账本重建；长会话 = 尾部窗口，历史经 sessionRows 翻页） */
  snapshot(sessionId: string): Promise<SessionSnapshot>;
  /** 行翻页（长会话历史：before = rowSeq 排他游标；页不切轮；缺省 = 尾部一页） */
  sessionRows(sessionId: string, opts?: { before?: number; limit?: number }): Promise<RowsPage>;
  /** 设置读（settings.json；凭据永不出现，D-030） */
  getSettings(): Promise<SettingsData>;
  /** 设置写（程序写；data-directory §2.3） */
  putSettings(patch: {
    model?: string;
    ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
  }): Promise<SettingsData>;
  /** 模型目录（手写覆盖 + models.dev 快照清单 + 凭据在册厂商；无密钥） */
  listModels(): Promise<ModelCatalog>;
  /** 模型管理分组（连接态 / 显隐开关 / 上下文窗——管理页主视图数据源） */
  listProviders(): Promise<{ providers: ProviderCatalogEntry[] }>;
  /** 厂商选择页预设全表（快照 + 本地缓存） */
  listModelPresets(): Promise<ModelPresets>;
  /** 在线刷新模型目录（成功 ok:true；失败保留快照/缓存现状） */
  refreshModelPresets(): Promise<{ ok: boolean }>;
  /** 连接已知厂商（key 必填——无 env 兜底；缺 baseUrl 从快照 endpoint 自动种；D-030 只进 credentials.json 0600） */
  connectProvider(providerId: string, key: string): Promise<void>;
  /** 断开厂商（credentials.json 摘键；models.json 分档——已知厂商只清显隐保 baseUrl/label，自定义整条删；幂等） */
  disconnectProvider(providerId: string): Promise<void>;
  /** 模型显隐开关（models.json hidden 清单——开 = 移出，关 = 加入） */
  setModelEnabled(providerId: string, model: string, enabled: boolean): Promise<void>;
  /** 自定义 OpenAI 兼容厂商（显式 models 清单 + baseUrl；返回生成的 provider id） */
  putCustomProvider(input: CustomProviderInput): Promise<{ id: string }>;
  /** 密钥写入（credentials.json 0600；无对应读取面——D-030 明文永不回读） */
  putCredential(providerId: string, key: string): Promise<void>;
  /** 界面资产清单（D-059 语言包/主题包；runtime 进程内直扫 globalDir、client 走 /api/ui-assets） */
  listUiAssets(): Promise<UiAssets>;
  /** 插件清单（批 C：GET /api/plugins 同源——状态 enabled≠loaded + 指纹；UI 宿主轮询重装用） */
  listPlugins(): Promise<{ plugins: PluginState[]; fingerprint: string }>;
  /** 确认卡放行（engine 件首次生效 / 版本升级；写 settings.plugins.<id>.confirmedVersion） */
  confirmPlugin(id: string, version: string): Promise<void>;
  /** 插件启停（settings.plugins.<id>.enabled；官方件拒绝——§5 :222） */
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  /** 插件版本钉（settings.plugins.<id>.version；新会话生效；官方件拒绝） */
  setPluginVersion(id: string, version: string): Promise<void>;
  /** 卸载插件（删 plugins/<id> 整目录；plugins-data 默认保留；官方件拒绝） */
  removePlugin(id: string): Promise<void>;
  /** MCP 变更确认放行（D-030/D-064：写 settings.plugins.<id>.mcpFingerprint，新会话 spawn） */
  confirmPluginMcp(id: string): Promise<void>;
  /** useResource 数据泵单跳（plugins.md §4：地址 = henira-data://<pluginId>/<server>/<tool>?args=…；
   *  所有权闸越权 403、30s 超时、200 × 1024 字符截断；执行失败 200 + {ok:false}——失败保旧数据由宿主泵负责） */
  executeResource(sessionId: string, pluginId: string, address: string): Promise<ResourceReply>;
  /** 会话工作区文件列表（只限会话 cwd；隐藏项不返） */
  listDir(sessionId: string, dirPath?: string): Promise<DirEntry[]>;
  /** 会话工作区文件读取（R190 预览缝）：path 相对会话 cwd 或 cwd 内绝对路径；
   *  cwd 围栏 + 符号链接复核；文本 utf8（1 MiB 截断）、二进制 base64（超限报错）。
   *  读取权威 = 会话 + 路径，不锚定工具行——行翻页出窗后预览仍可重读。 */
  readWorkspaceFile(sessionId: string, path: string): Promise<WorkspaceFileContent>;
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

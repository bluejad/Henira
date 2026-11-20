import * as React from "react";
import { createElement } from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOMClient from "react-dom/client";
import { createRoot, type Root } from "react-dom/client";
// 职责：帧流消费（喂 store）/ PluginUiHost 门面实现（13 方法 M3 子集）/ UI 模块激活
// （公共注册路径）或安全模式（编译期出口默认组合）/ 主题接线 / 双击 Alt 切安全模式 /
// 第三方 UI 件装载与免刷新重装（批 C）。
// 渲染 = 只挂 layout 槽的官方框架件（D-062 整页框架槽）——宿主零界面 JSX，一切可见物
// 都在 plugin-web-ui 件（框架件同一注册声明子槽，声明=独占渲染权，dsh AppFrame 行为层）。

import {
  defaultParts,
  defaultToolViews,
  type LayoutOption,
  makeT,
  type PluginUiHost,
  type ResourceSnapshot,
  type SettingsSection,
  type SlotPart,
  type UiModuleContext,
  type WebPart,
  type WebPartContext,
  type WebSlotName,
  webUiModule,
} from "@henira/plugin-web-ui";
import type { GlobalUiState, ServerFrame, SessionSummary, SessionUiState } from "@henira/protocol";
import type { HeniraFacade } from "@henira/sdk";
import { markdownNode } from "./markdown.js";
import { createResourcePump } from "./resource-pump.js";
import { createSlotRegistry } from "./slot-registry.js";
import { RowStore } from "./store.js";
import { streamingMarkdownNode } from "./streaming-markdown.js";

/** 整页布局选项（形状真源在 plugin-web-ui types.LayoutOption；API 兼容别名） */
export type Layout = LayoutOption;

// 第三方 UI 共享实例表（批 C）：宿主 React family 挂 window，server 伺服的小 ESM shim
// （/api/ui-shims/*）从这里 re-export——import map 把 "react" 等说明符指到 shim，
// 插件与宿主零复制共用唯一实例（plugins.md §4 :227 口子）。SSR/无 window 环境跳过。
if (typeof window !== "undefined") {
  (window as unknown as { __HENIRA_UI__?: { modules: Record<string, unknown> } }).__HENIRA_UI__ = {
    modules: {
      react: React,
      "react/jsx-runtime": ReactJsxRuntime,
      "react-dom/client": ReactDOMClient,
    },
  };
}

export interface WebAppOptions {
  client: HeniraFacade;
  layout?: Layout;
  /** 初始主题 id（官方 light/dark 或已装主题包名，D-059；缺省浅色） */
  theme?: string;
  /** 强制安全模式（URL ?ui=safe 由入口解析后传入；双击 Alt 运行时切换） */
  safeMode?: boolean;
}

export interface WebApp {
  mount(el: HTMLElement): void;
  dispose(): Promise<void>;
  /** 切主题：官方 id 或主题包名；主题包须带 cssUrl（宿主注入 <link>，D-059） */
  setTheme(theme: string, cssUrl?: string): void;
  /** 安全模式运行时切换（双击 Alt 的宿主入口） */
  setSafeMode(on: boolean): void;
}

export function createWebApp(opts: WebAppOptions): WebApp {
  const store = new RowStore();
  let root: Root | undefined;
  let container: HTMLElement | undefined;
  let sessionId: string | null = null;
  let sessionCwd = "";
  let theme: string = opts.theme ?? "light";
  /** 当前生效语言 id（官方 zh 或语言包 lang）：设置弹窗语言页显示生效值（审查 P3-b） */
  let localeLang = "zh";
  /** 外观已被显式选择（用户手选/嵌入方 setTheme）——boot 还原竞态守卫：getSettings 晚到的
   *  磁盘旧值不翻回用户刚做的选择（审查 P3-a；与语言侧 override 判据同旨） */
  let appearanceTouched = false;
  /** 已知主题包的 css 资产地址（onTheme 传入；applyTheme 据此注入 <link>，D-059） */
  const themeUrls = new Map<string, string>();
  let themeLink: HTMLLinkElement | undefined;
  /** 语言包覆盖字典（D-059：缺 key 回落官方 zh；undefined = 官方 zh） */
  let localeOverride: Record<string, string> | undefined;
  let safeMode = opts.safeMode ?? false;
  const turnListeners = new Set<
    (result: { ok: boolean; text?: string; reason?: string }) => void
  >();
  const frameListeners = new Set<(frame: ServerFrame) => void>();
  let lastBusy = false;
  let frameAbort: AbortController | undefined;
  let moduleDispose: (() => void) | undefined;
  let keyListener: ((e: KeyboardEvent) => void) | undefined;
  let pageHideListener: (() => void) | undefined;
  // ── 会话绑定界面状态协调器（D-063）：宿主是唯一写者——部件/布局交 patch，此处顶层合并
  //    + 统一 500ms 防抖整份 PUT；切会话前冲刷、pagehide 冲刷。undefined = 新会话文档未加载。
  let uiState: SessionUiState | undefined;
  let uiStateTimer: ReturnType<typeof setTimeout> | undefined;
  /** 设置弹窗当前分区（null = 关闭；宿主持有开合，框架件经 ctx 读渲染） */
  let settingsSection: SettingsSection | null = null;
  /** 模型目录版本号：设置内写操作（连接/断开/开关/自定义/刷新）成功 → 自增重渲 → composer
   * 即时重拉 listModels（断开当场回落，不等设置关闭——2026-11-19） */
  let modelCatalogVersion = 0;
  /** 取字工厂引用稳定（行 memo 比较器比 ctx.t 引用——语言包变化才换新） */
  let t = makeT(localeOverride);

  function flushUiState(): Promise<void> {
    if (uiStateTimer !== undefined) {
      clearTimeout(uiStateTimer);
      uiStateTimer = undefined;
    }
    const id = sessionId;
    const doc = uiState;
    if (id === null || doc === undefined) return Promise.resolve();
    if (opts.client.putSessionUiState === undefined) return Promise.resolve(); // 旧宿主端点缺席
    return opts.client.putSessionUiState(id, doc).catch(() => {});
  }

  function updateUiState(patch: SessionUiState): void {
    if (sessionId === null) return;
    uiState = { ...(uiState ?? {}), ...patch };
    if (uiStateTimer !== undefined) clearTimeout(uiStateTimer);
    uiStateTimer = setTimeout(() => {
      uiStateTimer = undefined;
      void flushUiState();
    }, 500);
    render(); // 缓存已同步——消费 uiState 的件（折叠组等）要看到新值
  }

  /** 加载指定会话的界面绑定态（旧服务器无端点 / 加载失败 = 空文档，不阻塞选中） */
  function loadUiState(id: string): void {
    const job =
      opts.client.getSessionUiState !== undefined
        ? opts.client.getSessionUiState(id)
        : Promise.resolve({} as SessionUiState);
    void job
      .then((doc) => {
        if (sessionId !== id) return; // 期间用户已切走——丢弃过期文档
        uiState = doc;
        render();
      })
      .catch(() => {
        if (sessionId === id) {
          uiState = {};
          render();
        }
      });
  }

  // ── 槽位管理：激活 UI 模块（公共注册路径）或安全模式直用编译期出口 ──
  // 词表（D-033 区域 + D-043 官方槽 + D-057 keyed 前缀 + D-062 结构性/右栏）；词表外 =
  // 完全未知 → 告警并忽略（§7.2；别的宿主词表随移动端词表落地再区分）。keyed 前缀合法、后缀自由。
  const REGION_SLOTS = new Set([
    "layout",
    "sidebar",
    "conversation",
    "composer",
    "sidebar.right",
    "sidebar.right.tab",
    "turn.tail",
    "conversation.images",
  ]);
  const KEYED_PREFIXES = ["tool.call.view.", "sidebar.right.preview."];
  const slotAccepted = (name: string): boolean =>
    REGION_SLOTS.has(name) || KEYED_PREFIXES.some((prefix) => name.startsWith(prefix));
  /** UI 装载告警（管理面 C3 消费；先 console + 收集） */
  const uiWarnings: string[] = [];
  // 槽位登记簿（slot-registry.ts，可单测）：官方默认件可被插件 replaceSlot 顶替、卸载回落
  //（D-057/D-048 全语义——审查 F3：旧「占位即报错」判据在 E5 官方注册七键后会把第三方
  // 整个 UI 模块挡在装载门外，承诺的顶替路径从此不通）
  const registry = createSlotRegistry({
    slotAccepted,
    onUnknownSlot: (name) => {
      const message = `unknown UI slot, ignored: ${name}`;
      console.warn(`[henira] ${message}`);
      uiWarnings.push(message);
    },
    officialId: "plugin-web-ui",
  });
  const slots = registry.slots;
  let moduleCtx: UiModuleContext | undefined;

  function makeModuleContext(callerPluginId: string): UiModuleContext {
    return { ...registry.apiFor(callerPluginId), host: hostFor(callerPluginId) };
  }

  function renderSlots(): void {
    // 清登记簿在第三方 dispose 之前：重建期卸载回落不得复活旧列表（dispose 闭包查不到
    // 登记 = no-op），清场后全量重装
    registry.reset();
    disposeThirdPartyUi();
    if (safeMode) {
      for (const [name, part] of Object.entries(defaultParts) as [WebSlotName, WebPart][]) {
        slots.set(name, [part]);
      }
      // per-tool 官方卡同灌（E5）：安全模式也是「同一零件库的直接组装」——缺了它工具行
      // 全退化成通用卡，与插件通道观感不一致
      for (const [name, view] of Object.entries(defaultToolViews)) {
        slots.set(name, [view as SlotPart]);
      }
    } else {
      moduleCtx = makeModuleContext("plugin-web-ui");
      moduleDispose = webUiModule(moduleCtx);
      void syncThirdPartyUi();
    }
  }

  // ── 第三方 UI 件装载（批 C）：清单 → 动态 import → apply(ctx)；指纹轮询免刷新重装
  //（plugins.md §4 :206 升级口径：版本化 URL，停用/启用/切版本 = dispose + 重装，不刷新页面）
  interface ThirdPartyEntry {
    version: string;
    dispose?: () => void;
  }
  const thirdParty = new Map<string, ThirdPartyEntry>();
  let lastFingerprint = "";
  let uiPollTimer: ReturnType<typeof setInterval> | undefined;

  function disposeThirdPartyUi(): void {
    for (const [id, entry] of [...thirdParty]) {
      try {
        entry.dispose?.();
      } catch (err) {
        console.warn(`[henira] UI plugin dispose failed ${id}:`, err);
      }
      thirdParty.delete(id);
    }
    if (uiPollTimer !== undefined) {
      clearInterval(uiPollTimer);
      uiPollTimer = undefined;
    }
    lastFingerprint = "";
    // 数据泵随件退订清场（重装后由新件的 effect 重新首拉）
    resourcePump.clearAll();
  }

  async function syncThirdPartyUi(): Promise<void> {
    if (safeMode || moduleCtx === undefined) return;
    if (typeof opts.client.listPlugins !== "function") return; // 旧 facade / 假 client
    let snapshot: Awaited<ReturnType<HeniraFacade["listPlugins"]>>;
    try {
      snapshot = await opts.client.listPlugins();
    } catch {
      return; // 目录拉不到不挡官方界面
    }
    if (uiPollTimer === undefined) {
      uiPollTimer = setInterval(() => {
        void syncThirdPartyUi();
      }, 2000); // 指纹轮询：新版本目录 / 开关变化 → 免刷新重装
    }
    if (safeMode) return; // 轮询期间切了安全模式
    if (snapshot.fingerprint === lastFingerprint) return;
    lastFingerprint = snapshot.fingerprint;
    for (const [id, entry] of [...thirdParty]) {
      try {
        entry.dispose?.();
      } catch (err) {
        console.warn(`[henira] UI plugin dispose-before-reload failed ${id}:`, err);
      }
      thirdParty.delete(id);
    }
    const targets = snapshot.plugins.filter(
      (plugin) =>
        plugin.enabled &&
        plugin.state === "loaded" &&
        plugin.forms.includes("ui") &&
        plugin.ui !== undefined,
    );
    for (const plugin of targets) {
      const entryPath = plugin.ui?.entry;
      if (entryPath === undefined) continue;
      const url = `/api/ui-assets/${encodeURIComponent(plugin.id)}/${encodeURIComponent(
        plugin.version,
      )}/file/${entryPath}?v=${encodeURIComponent(plugin.version)}`;
      try {
        const mod = (await import(/* @vite-ignore */ url)) as {
          apply?: unknown;
          default?: unknown;
        };
        const candidate =
          typeof mod.apply === "function"
            ? mod.apply
            : typeof (mod.default as { apply?: unknown } | undefined)?.apply === "function"
              ? (mod.default as { apply: (ctx: UiModuleContext) => unknown }).apply
              : typeof mod.default === "function"
                ? (mod.default as (ctx: UiModuleContext) => unknown)
                : undefined;
        if (candidate === undefined) throw new Error("module does not export apply(ctx)");
        // per-module ctx：host 绑定该插件 id（useResource 所有权闸按插件隔离）+ 注册 API
        // 同步按该插件 id 绑定（partOwners 所有权 → replaceSlot 顶替语义按插件判定，审查 F3）
        const moduleUiCtx: UiModuleContext = {
          ...moduleCtx,
          ...registry.apiFor(plugin.id),
          host: hostFor(plugin.id),
        };
        const dispose = await (candidate as (ctx: UiModuleContext) => unknown)(moduleUiCtx);
        thirdParty.set(plugin.id, {
          version: plugin.version,
          dispose: typeof dispose === "function" ? (dispose as () => void) : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[henira] UI plugin load failed ${plugin.id}: ${message}`);
        uiWarnings.push(`UI load failed ${plugin.id}: ${message}`);
      }
    }
    render();
  }

  // ── useResource 数据泵（plugins.md §4 / D-064）：实现在 resource-pump.ts（可单测）；
  //    所有权闸在此——绑定 pluginId 必须 = 地址 pluginId（hostFacade 共享，第三方件拿
  //    per-module 绑定 host）──
  const resourcePump = createResourcePump({
    execute: (sid, pluginId, address) => {
      const execute = opts.client.executeResource;
      if (execute === undefined) {
        return Promise.resolve({
          ok: false,
          error: "resource endpoint not available",
          updatedAt: Date.now(),
        });
      }
      return execute(sid, pluginId, address);
    },
    getSessionId: () => sessionId,
  });

  function parseAddressPluginId(address: string): string | undefined {
    const m = /^henira-data:\/\/([^/?#]+)\//.exec(address);
    if (m === null) return undefined;
    try {
      return decodeURIComponent(m[1] ?? "");
    } catch {
      return undefined;
    }
  }

  /** per-module 绑定的 useResource（React hook 语义——只被 UI 件的 render 期调用，plugins.md §4；
   *  biome 的 hook 规则看不见跨模块调用约定，两处调用行具名豁免） */
  function resourceSnapshotFor(callerPluginId: string, address: string): ResourceSnapshot {
    const owned = parseAddressPluginId(address) === callerPluginId;
    // biome-ignore lint/correctness/useHookAtTopLevel: 仅在 UI 件组件 render 期调用（门面契约）
    const [snapshot, setSnapshot] = React.useState<ResourceSnapshot>(() =>
      owned ? (resourcePump.snapshotOf(address) ?? { status: "loading" }) : { status: "loading" },
    );
    // biome-ignore lint/correctness/useHookAtTopLevel: 同上
    React.useEffect(() => {
      if (!owned) return; // 越权地址：不订阅不拉取（failed 语义在下方快照呈现）
      return resourcePump.subscribe(address, callerPluginId, setSnapshot);
    }, [address, owned, callerPluginId]);
    if (!owned) {
      return {
        status: "failed",
        error: "resource ownership violated (address plugin mismatch)",
      };
    }
    return snapshot;
  }

  /** per-module host 绑定：官方件 = plugin-web-ui；第三方件 = 各自插件 id（useResource 所有权闸） */
  function hostFor(pluginId: string): PluginUiHost {
    return {
      ...hostFacade,
      useResource: (address: string) => resourceSnapshotFor(pluginId, address),
    };
  }

  // ── PluginUiHost 门面（官方件共享基座；第三方件经 hostFor(pluginId) 拿绑定副本）──
  const hostFacade: PluginUiHost = {
    async sendPrompt(text: string) {
      if (sessionId === null) throw new Error("no active session");
      const receipt = await opts.client.prompt(sessionId, text);
      return { messageId: receipt.id, sessionId };
    },
    subscribe(filter: { sessionId?: string }, cb: (frame: ServerFrame) => void): () => void {
      const listener = (frame: ServerFrame): void => {
        if (frame.kind === "connected") return;
        if (filter.sessionId !== undefined && frame.sessionId !== filter.sessionId) return;
        cb(frame);
      };
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    onTurnFinished(cb: (result: { ok: boolean; text?: string; reason?: string }) => void) {
      turnListeners.add(cb);
      return () => {
        turnListeners.delete(cb);
      };
    },
    prefill(_input: { text: string }) {}, // M3：官方输入框自管草稿；prefill 随命令进输入框批接线
    renderMarkdown(text: string, opts?: { streaming?: boolean }) {
      // markdown 落地（M4 批 A；E2 增量管线）：settled 臂在 markdown.ts（GFM；raw HTML
      // 不渲染），流式臂在 streaming-markdown.ts（冻结已完成块、每帧只重渲尾段）。
      // t 由宿主注入（代码块复制钮文案跟随语言包）。
      return opts?.streaming === true
        ? streamingMarkdownNode(text, { t })
        : markdownNode(text, { t });
    },
    getSession() {
      return sessionId === null ? null : { sessionId, cwd: sessionCwd };
    },
    openInExplorer: async () => false, // 仅桌面宿主；web 恒 false（能力查询语义）
    openPlugin() {}, // M3 无插件面板（插件管理面随 M4）
    getInitialView() {
      return undefined;
    },
    async listDir(path: string) {
      if (sessionId === null) return [];
      return opts.client.listDir(sessionId, path);
    },
    async listSessionsByCwd(cwd: string) {
      const all: SessionSummary[] = await opts.client.listSessions();
      return all
        .filter((s) => s.cwd === cwd)
        .map((s) => ({ id: s.id, cwd: s.cwd, updatedAt: s.updatedAt }));
    },
    useResource: (address: string) => resourceSnapshotFor("plugin-web-ui", address),
    async listPlugins() {
      const snapshot = await opts.client.listPlugins();
      return snapshot.plugins
        .filter((plugin) => plugin.enabled)
        .map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          enabled: plugin.enabled,
        }));
    },
  };

  // ── 帧流消费：store 应用 + busy 终局结算（onTurnFinished 恰一次）+ 帧监听分发 ──
  store.setRefetch((id) => {
    void opts.client.snapshot(id).then((snapshot) => {
      store.applySnapshot({ kind: "snapshot", sessionId: id, snapshot });
    });
  });

  async function consumeFrames(): Promise<void> {
    frameAbort = new AbortController();
    for await (const frame of opts.client.events()) {
      if (frameAbort?.signal.aborted) break;
      if (frame.kind === "snapshot") store.applySnapshot(frame);
      else if (frame.kind === "delta") {
        store.applyFrame(frame);
        if (frame.delta.op === "state.updated") {
          const busy = frame.delta.state.busy;
          if (lastBusy && !busy) {
            for (const cb of turnListeners) cb({ ok: true });
          }
          lastBusy = busy;
        }
      }
      for (const listener of frameListeners) listener(frame);
    }
  }

  /** 主题落地：容器 data-theme + 第三方主题包 <link> 注入（官方 light/dark 无 link，D-059） */
  function applyTheme(): void {
    if (container === undefined) return;
    container.dataset.theme = theme;
    const url = themeUrls.get(theme);
    if (url === undefined) {
      themeLink?.remove();
      themeLink = undefined;
      return;
    }
    if (themeLink === undefined) {
      themeLink = document.createElement("link");
      themeLink.rel = "stylesheet";
      themeLink.dataset.heniraTheme = "true"; // 回落清理锚点（安全模式/官方主题移除用）
      document.head.append(themeLink);
    }
    themeLink.href = url;
  }

  /** D-059：安全模式回落官方默认——第三方主题/语言收起（官方 light/zh） */
  function enterSafeMode(): void {
    theme = "light";
    themeLink?.remove();
    themeLink = undefined;
    localeOverride = undefined;
    localeLang = "zh"; // 生效语言同步回落官方（语言页显示值跟手）
    t = makeT(undefined); // 取字工厂同步回落官方（残留第三方字典 = 安全模式漏字）
  }

  /**
   * 外观还原（①读侧）：官方主题直落／主题包按资产清单回查地址注入 <link>／磁盘 id 已不在场
   * （包卸载）回落官方默认；语言包 fetch 字典覆盖。boot 调一次（checkTouched=true——用户/
   * 嵌入方已显式选择则磁盘旧值不覆盖，竞态守卫）；安全模式退出重跑（checkTouched=false——
   * 进入时被强制官方，退出后从磁盘还原，不停留 light/zh 直到刷新，审查 P2）。
   * 旧服务器无 getSettings 静默跳过。
   */
  async function restoreAppearance(checkTouched: boolean): Promise<void> {
    if (safeMode || opts.client.getSettings === undefined) return;
    if (checkTouched && appearanceTouched) return;
    const s = await opts.client.getSettings();
    const assets =
      opts.client.listUiAssets !== undefined
        ? await opts.client.listUiAssets().catch(() => ({ locales: [], themes: [] }))
        : { locales: [], themes: [] };
    const wantedTheme = s.ui?.theme;
    if (wantedTheme !== undefined && wantedTheme !== theme) {
      const pack = assets.themes.find((x) => x.name === wantedTheme);
      if (pack !== undefined) {
        theme = wantedTheme;
        themeUrls.set(wantedTheme, pack.url);
      } else if (wantedTheme === "light" || wantedTheme === "dark") {
        theme = wantedTheme;
        themeLink?.remove(); // 官方主题无 link
        themeLink = undefined;
      } else {
        theme = "light"; // 磁盘 id 已不在场（主题包卸载）——回落官方默认
        themeLink?.remove();
        themeLink = undefined;
      }
      applyTheme();
      render();
    }
    const wantedLocale = s.ui?.locale;
    if (wantedLocale !== undefined && wantedLocale !== "zh" && localeOverride === undefined) {
      const pack = assets.locales.find((x) => x.lang === wantedLocale);
      if (pack !== undefined) {
        const dict = await fetch(pack.url)
          .then((r) => r.json() as Promise<Record<string, string>>)
          .catch(() => null);
        if (dict !== null && Object.keys(dict).length > 0) {
          localeOverride = dict;
          localeLang = wantedLocale; // 语言页显示值跟生效走（审查 P3-b）
          t = makeT(localeOverride); // 引用稳定纪律：语言包变化才换新
          render();
        }
      }
    }
  }

  /**
   * 激活会话——boot 还原与列表点选的唯一路径。曾分叉：boot 只摆"选中"不补拉快照，
   * 刷新/重启后 store 恒空、正文整片空白（活体 selftest8 抓到），而点击路径会补拉。
   * 两条路径合一即封闭这类"状态还原了、内容没了"的分叉回归。
   */
  function activateSession(id: string, cwd?: string): void {
    if (id === sessionId) return; // 重复点当前会话：无变更（boot 首帧 sessionId=null 不受影响）
    void flushUiState(); // 冲刷旧会话 pending（flush 捕获的是切换前的 id+doc，不会串写）
    sessionId = id;
    uiState = undefined; // 新会话文档未加载——件保持现状，到位后回填
    if (cwd !== undefined) {
      sessionCwd = cwd;
    } else {
      // cwd 就近回查（SessionList 只传 id；facade 的 getSession 带 cwd 供 listDir 等用）
      void opts.client
        .listSessions()
        .then((all) => {
          if (sessionId !== id) return; // 期间又切走
          sessionCwd = all.find((s) => s.id === id)?.cwd ?? "";
          render();
        })
        .catch(() => {});
    }
    // 全局"上次选中"（D-063）：重启/刷新还原的依据；boot 选定（含回落最新更新/新建）同样
    // 固化——不写则指针恒 null、回落随"最新更新"漂移（活体 selftest7 抓到）；旧服务器静默跳过
    if (opts.client.putUiState !== undefined) {
      void opts.client.putUiState({ lastSessionId: id }).catch(() => {});
    }
    // 磁盘历史会话（不在扇出范围）补拉快照——否则选中即空对话（SSE 快照帧只发在订会话）。
    // 刷新/重启后 store 恒空，boot 路径正踩这一支（selftest8：正文空白）
    if (!store.has(id)) {
      void opts.client
        .snapshot(id)
        .then((snapshot) => {
          if (sessionId !== id) return; // 期间又切走——丢弃过期快照
          store.applySnapshot({ kind: "snapshot", sessionId: id, snapshot });
          render();
        })
        .catch(() => {});
    }
    render();
    loadUiState(id);
  }

  function render(): void {
    if (root === undefined || container === undefined) return;
    applyTheme();
    const ctx: WebPartContext = {
      client: opts.client,
      sessionId,
      selectSession: (id) => {
        if (id === null) {
          // 列表受控选中恒有会话——null 属签名兜底：清选中不补拉
          void flushUiState();
          sessionId = null;
          uiState = undefined;
          render();
          return;
        }
        activateSession(id); // 与 boot 还原同一路径（补拉快照/写指针/载文档都在里面）
      },
      t,
      theme,
      locale: localeLang,
      store,
      host: hostFacade,
      slots,
      uiState,
      updateUiState,
      layout: opts.layout ?? "full",
      safeMode,
      sessionCwd,
      onTheme: (next, cssUrl) => {
        appearanceTouched = true; // 显式选择——boot 还原不再覆盖（审查 P3-a）
        theme = next;
        if (cssUrl !== undefined) themeUrls.set(next, cssUrl);
        applyTheme();
        render(); // 主题变了要重渲 React 侧——漏了则设置弹窗显示值与实际主题脱节（R125）
      },
      onLocale: (dict, lang) => {
        appearanceTouched = true; // 同上（语言侧）
        localeOverride = dict !== undefined && Object.keys(dict).length > 0 ? dict : undefined;
        localeLang = lang ?? "zh"; // 生效语言跟手（审查 P3-b）
        t = makeT(localeOverride); // 引用稳定纪律：语言包变化才换新（行 memo 比较器比 ctx.t）
        render();
      },
      openSettings: (section) => {
        settingsSection = section ?? "theme";
        render();
      },
      closeSettings: () => {
        settingsSection = null;
        render();
      },
      settingsSection,
      notifyModelCatalogChanged: () => {
        modelCatalogVersion += 1; // 设置内写操作广播——消费方（composer 目录）重渲染即重拉
        render();
      },
      modelCatalogVersion,
    };
    // root 只挂 layout 槽的官方框架件（D-062 整页框架槽；顶替者经 replaceSlot("layout")
    // 占槽即整页重排——官方区域件声明随框架件消失，安全模式回落官方框架）
    const [framePart] = (slots.get("layout") ?? []) as WebPart[];
    root.render(framePart === undefined ? null : createElement(framePart, ctx));
  }

  return {
    mount(el) {
      container = el;
      container.classList.add("henira-app");
      renderSlots();
      root = createRoot(el);
      render();
      void consumeFrames().catch(() => {});
      // 初始选择（D-063 还原语义）：全局"上次选中"在列表则选它；否则最新更新（列表首）/建新。
      // 旧服务器无 getUiState 端点 → 回落原行为，不阻塞启动
      void (async () => {
        const bootUi: Promise<GlobalUiState> =
          opts.client.getUiState !== undefined
            ? opts.client.getUiState().catch(() => ({ lastSessionId: null }))
            : Promise.resolve({ lastSessionId: null });
        const [all, ui] = await Promise.all([opts.client.listSessions(), bootUi]);
        const restored =
          ui.lastSessionId !== null ? all.find((s) => s.id === ui.lastSessionId) : undefined;
        const picked = restored ?? (all.length === 0 ? await opts.client.createSession() : all[0]);
        // 与点击切换同一路径（activateSession）：补拉快照 + 写全局指针 + 载会话文档。
        // 曾在此直接赋 sessionId 分叉——刷新/重启后正文空白（活体 selftest8）
        activateSession(picked.id, picked.cwd);
      })().catch(() => {});
      // 启动还原外观（补全①：设置弹窗已写 ui.theme/ui.locale 落盘，改前启动不读——
      // 选深色刷新回落亮色）。语义全在 restoreAppearance（boot 带 touched 守卫——
      // 用户在还原窗口内已手选则磁盘旧值不覆盖，审查 P3-a）。
      void restoreAppearance(true).catch(() => {});
      // 关页前尽力冲刷草稿（D-063 写时机：防抖之外补冲刷；同源无 token 场景可靠，
      // 带 token 时 best-effort——防抖主通道通常已落盘）
      pageHideListener = (): void => {
        void flushUiState();
      };
      window.addEventListener("pagehide", pageHideListener);
      // 双击 Alt 切安全模式（判据④运行时入口；?ui=safe 由入口解析 opts.safeMode）
      let lastAlt = 0;
      keyListener = (e: KeyboardEvent): void => {
        if (e.key === "Alt" && !e.repeat) {
          const now = Date.now();
          if (now - lastAlt < 600) {
            safeMode = !safeMode;
            moduleDispose?.();
            moduleDispose = undefined;
            if (safeMode) enterSafeMode();
            else void restoreAppearance(false).catch(() => {}); // 双击 Alt 退出同样从磁盘还原（审查 P2——setSafeMode 同款）
            renderSlots();
            render();
            lastAlt = 0;
          } else {
            lastAlt = now;
          }
        }
      };
      window.addEventListener("keydown", keyListener);
    },
    async dispose() {
      frameAbort?.abort();
      if (keyListener !== undefined) window.removeEventListener("keydown", keyListener);
      if (pageHideListener !== undefined) window.removeEventListener("pagehide", pageHideListener);
      disposeThirdPartyUi();
      moduleDispose?.();
      root?.unmount();
      await opts.client.stop();
    },
    setTheme(next, cssUrl) {
      appearanceTouched = true; // 嵌入方显式选择——boot 还原不再覆盖（审查 P3-a）
      theme = next;
      if (cssUrl !== undefined) themeUrls.set(next, cssUrl);
      applyTheme();
    },
    setSafeMode(on) {
      safeMode = on;
      moduleDispose?.();
      moduleDispose = undefined;
      if (on) enterSafeMode();
      else void restoreAppearance(false).catch(() => {}); // 退出安全模式从磁盘还原（审查 P2——改前停留 light/zh 直到刷新）
      renderSlots();
      render();
    },
  };
}

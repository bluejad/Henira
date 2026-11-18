import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// 职责：帧流消费（喂 store）/ PluginUiHost 门面实现（13 方法 M3 子集）/ UI 模块激活
// （公共注册路径）或安全模式（编译期出口默认组合）/ 主题接线 / 双击 Alt 切安全模式。
// React 渲染委托 shell.tsx 的 Shell（本文件不写 JSX——createElement 走 shell 侧类型）。

import {
  defaultParts,
  type PluginUiHost,
  type SlotPart,
  type UiModuleContext,
  type WebPart,
  type WebSlotName,
  webUiModule,
} from "@henira/plugin-web-ui";
import type { ServerFrame, SessionSummary } from "@henira/protocol";
import type { HeniraFacade } from "@henira/sdk";
import { markdownNode } from "./markdown.js";
import { makeT, Shell, type ShellProps } from "./shell.js";
import { RowStore } from "./store.js";

export type Layout =
  | "full"
  | "center"
  | "composer"
  | { parts: Partial<Record<WebSlotName, WebPart>> };

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

  // ── 槽位管理：激活 UI 模块（公共注册路径）或安全模式直用编译期出口 ──
  // 词表（D-033 区域 + D-043 官方三槽 + D-057 keyed 前缀）；词表外静默忽略（别的宿主词表同款），
  // 告警基建随批 C 管理面补。keyed 前缀合法、后缀自由（工具名/扩展名——含插件自家工具名）。
  const REGION_SLOTS = new Set([
    "sidebar",
    "conversation",
    "composer",
    "turn.tail",
    "conversation.images",
  ]);
  const KEYED_PREFIXES = ["tool.call.view.", "sidebar.right.preview."];
  const slotAccepted = (name: string): boolean =>
    REGION_SLOTS.has(name) || KEYED_PREFIXES.some((prefix) => name.startsWith(prefix));
  const slots = new Map<string, SlotPart[]>();
  function activateModule(): void {
    const ctx: UiModuleContext = {
      registerSlot: (name, part) => {
        if (!slotAccepted(name)) return () => {};
        const list = slots.get(name) ?? [];
        list.push(part);
        slots.set(name, list);
        return () => {
          const current = slots.get(name);
          if (current === undefined) return;
          const index = current.indexOf(part);
          if (index >= 0) current.splice(index, 1);
        };
      },
      replaceSlot: (name, part) => {
        if (!slotAccepted(name)) return () => {};
        if (slots.has(name)) {
          throw new Error(`slot conflict: ${name} already has a default part (D-022)`);
        }
        slots.set(name, [part]);
        return () => {};
      },
      host: hostFacade,
    };
    moduleDispose = webUiModule(ctx);
  }
  function renderSlots(): void {
    slots.clear();
    if (safeMode) {
      for (const [name, part] of Object.entries(defaultParts) as [WebSlotName, WebPart][]) {
        slots.set(name, [part]);
      }
    } else {
      activateModule();
    }
  }

  // ── PluginUiHost 门面（M3 实装子集；useResource / listPlugins 为 M4 占位）──
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
      // markdown 落地（M4 批 A）：实现体在 markdown.ts（GFM；raw HTML 不渲染）。
      // t 由宿主注入（代码块复制钮文案跟随语言包）；streaming 透传（流式中不高亮）。
      return markdownNode(text, { streaming: opts?.streaming, t: makeT(localeOverride) });
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
    useResource: () => ({
      status: "failed" as const,
      error: "useResource lands with plugin-mcp (M4)",
    }),
    async listPlugins() {
      return [] as never[]; // M4 占位（插件管理面随 M4）
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
  }

  function render(): void {
    if (root === undefined || container === undefined) return;
    applyTheme();
    const props: ShellProps = {
      store,
      slots,
      client: opts.client,
      layout: opts.layout ?? "full",
      host: hostFacade,
      theme,
      localeOverride,
      safeMode,
      sessionId,
      onSelectSession: (id) => {
        sessionId = id;
        // cwd 就近回查（SessionList 只传 id；facade 的 getSession 带 cwd 供 listDir 等用）
        void opts.client
          .listSessions()
          .then((all) => {
            sessionCwd = all.find((s) => s.id === id)?.cwd ?? "";
          })
          .catch(() => {});
        // 磁盘历史会话（不在扇出范围）补拉快照——否则选中即空对话（SSE 快照帧只发在订会话）
        if (id !== null && !store.has(id)) {
          void opts.client
            .snapshot(id)
            .then((snapshot) => {
              store.applySnapshot({ kind: "snapshot", sessionId: id, snapshot });
              render();
            })
            .catch(() => {});
        }
        render();
      },
      onToggleSafe: (on) => {
        safeMode = on;
        moduleDispose?.();
        moduleDispose = undefined;
        if (on) enterSafeMode();
        renderSlots();
        render();
      },
      onTheme: (next, cssUrl) => {
        theme = next;
        if (cssUrl !== undefined) themeUrls.set(next, cssUrl);
        applyTheme();
        render(); // 主题变了要重渲 React 侧——漏了则设置浮层下拉显示值与实际主题脱节（R125）
      },
      onLocale: (dict) => {
        localeOverride = dict !== undefined && Object.keys(dict).length > 0 ? dict : undefined;
        render();
      },
    };
    root.render(createElement(Shell, props));
  }

  return {
    mount(el) {
      container = el;
      container.classList.add("henira-app");
      renderSlots();
      root = createRoot(el);
      render();
      void consumeFrames().catch(() => {});
      // 初始选择：已有会话选第一个；无则建一个（demo 友好）
      void opts.client
        .listSessions()
        .then(async (all) => {
          const picked = all.length === 0 ? await opts.client.createSession() : all[0];
          sessionId = picked.id;
          sessionCwd = picked.cwd;
          render();
        })
        .catch(() => {});
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
      moduleDispose?.();
      root?.unmount();
      await opts.client.stop();
    },
    setTheme(next, cssUrl) {
      theme = next;
      if (cssUrl !== undefined) themeUrls.set(next, cssUrl);
      applyTheme();
    },
    setSafeMode(on) {
      safeMode = on;
      moduleDispose?.();
      moduleDispose = undefined;
      if (on) enterSafeMode();
      renderSlots();
      render();
    },
  };
}

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// 职责：帧流消费（喂 store）/ PluginUiHost 门面实现（13 方法 M3 子集）/ UI 模块激活
// （公共注册路径）或安全模式（编译期出口默认组合）/ 主题接线 / 双击 Alt 切安全模式。
// React 渲染委托 shell.tsx 的 Shell（本文件不写 JSX——createElement 走 shell 侧类型）。

import { type PluginUiHost } from "@henira/plugin-web-ui";
import {
  defaultParts,
  webUiModule,
  type UiModuleContext,
  type WebPart,
  type WebSlotName,
} from "@henira/plugin-web-ui";
import type { ServerFrame, SessionSummary } from "@henira/protocol";
import type { HeniraFacade } from "@henira/sdk";
import { RowStore } from "./store.js";
import { Shell, type ShellProps } from "./shell.js";

export type Layout =
  | "full"
  | "center"
  | "composer"
  | { parts: Partial<Record<WebSlotName, WebPart>> };

export interface WebAppOptions {
  client: HeniraFacade;
  layout?: Layout;
  /** 初始主题（缺省浅色；设置页保存后经 setTheme 切换） */
  theme?: "light" | "dark";
  /** 强制安全模式（URL ?ui=safe 由入口解析后传入；双击 Alt 运行时切换） */
  safeMode?: boolean;
}

export interface WebApp {
  mount(el: HTMLElement): void;
  dispose(): Promise<void>;
  setTheme(theme: "light" | "dark"): void;
  /** 安全模式运行时切换（双击 Alt 的宿主入口） */
  setSafeMode(on: boolean): void;
}

export function createWebApp(opts: WebAppOptions): WebApp {
  const store = new RowStore();
  let root: Root | undefined;
  let container: HTMLElement | undefined;
  let sessionId: string | null = null;
  let sessionCwd = "";
  let theme: "light" | "dark" = opts.theme ?? "light";
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
  const slots = new Map<WebSlotName, WebPart[]>();
  function activateModule(): void {
    const ctx: UiModuleContext = {
      registerSlot: (name, part) => {
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
    renderMarkdown(text: string) {
      // M3 最小呈现（纯文本）；markdown 解析随插件生态需求再加
      return text;
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

  function render(): void {
    if (root === undefined || container === undefined) return;
    container.dataset.theme = theme;
    const props: ShellProps = {
      store,
      slots,
      client: opts.client,
      layout: opts.layout ?? "full",
      host: hostFacade,
      theme,
      safeMode,
      onToggleSafe: (on) => {
        safeMode = on;
        moduleDispose?.();
        moduleDispose = undefined;
        renderSlots();
        render();
      },
      onTheme: (next) => {
        theme = next;
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
    setTheme(next) {
      theme = next;
      render();
    },
    setSafeMode(on) {
      safeMode = on;
      moduleDispose?.();
      moduleDispose = undefined;
      renderSlots();
      render();
    },
  };
}

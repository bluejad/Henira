// 第三方 UI 模块的共享实例 shim（批 C——plugins.md §4 :227「import map 注入」口子的浏览器实现）：
// 宿主 bundle 把 react family 挂到 window.__HENIRA_UI__.modules（唯一实例）；本文件伺服的小 ESM
// 从同一张表 re-export——server 注入的 import map 把 "react" 等说明符指到这里，插件与宿主
// 共用同一份 React（零构建、零共享 chunk）。
// 命名导出清单固定：插件里不在清单的 API 用 React.xxx（文档写清）。

/** 宿主模块表的全局键（web 入口写入，shim 读取） */
export const UI_MODULES_GLOBAL = "__HENIRA_UI__";

const HEAD = `const ns = (globalThis.${UI_MODULES_GLOBAL} && globalThis.${UI_MODULES_GLOBAL}.modules) || {};`;

const REACT_SHIM = `${HEAD}
const R = ns.react || {};
export default R;
export const createElement = R.createElement;
export const cloneElement = R.cloneElement;
export const createContext = R.createContext;
export const forwardRef = R.forwardRef;
export const memo = R.memo;
export const Fragment = R.Fragment;
export const Children = R.Children;
export const Component = R.Component;
export const PureComponent = R.PureComponent;
export const StrictMode = R.StrictMode;
export const Suspense = R.Suspense;
export const lazy = R.lazy;
export const isValidElement = R.isValidElement;
export const startTransition = R.startTransition;
export const useState = R.useState;
export const useEffect = R.useEffect;
export const useLayoutEffect = R.useLayoutEffect;
export const useMemo = R.useMemo;
export const useRef = R.useRef;
export const useCallback = R.useCallback;
export const useContext = R.useContext;
export const useReducer = R.useReducer;
export const useSyncExternalStore = R.useSyncExternalStore;
export const useTransition = R.useTransition;
export const useDeferredValue = R.useDeferredValue;
`;

const JSX_RUNTIME_SHIM = `${HEAD}
const J = ns["react/jsx-runtime"] || {};
export const jsx = J.jsx;
export const jsxs = J.jsxs;
export const jsxDEV = J.jsxDEV;
export const Fragment = J.Fragment;
`;

const REACT_DOM_CLIENT_SHIM = `${HEAD}
const D = ns["react-dom/client"] || {};
export const createRoot = D.createRoot;
export const hydrateRoot = D.hydrateRoot;
`;

/** import map 的说明符 → 宿主 shim 路径（固定路径，无 hash——自托管静态路由） */
export const UI_SHIM_URLS = {
  react: "/api/ui-shims/react.js",
  "react/jsx-runtime": "/api/ui-shims/jsx-runtime.js",
  "react-dom/client": "/api/ui-shims/react-dom-client.js",
} as const;

const SHIMS: Record<string, string> = {
  "react.js": REACT_SHIM,
  "jsx-runtime.js": JSX_RUNTIME_SHIM,
  "react-dom-client.js": REACT_DOM_CLIENT_SHIM,
};

export function lookupUiShim(file: string): string | undefined {
  return Object.hasOwn(SHIMS, file) ? SHIMS[file] : undefined;
}

/**
 * index.html 注入 import map（必须在第一个 module script 之前——浏览器规范；
 * 已含 importmap = 不重复注入）。服务端静态托管 dist-web 时调用。
 */
export function injectImportMap(html: string): string {
  if (html.includes('type="importmap"')) return html;
  const tag = `<script type="importmap">${JSON.stringify({ imports: UI_SHIM_URLS })}</script>`;
  const idx = html.indexOf('<script type="module"');
  if (idx !== -1) return `${html.slice(0, idx)}${tag}\n    ${html.slice(idx)}`;
  return html.replace("</head>", `${tag}</head>`);
}

// D-050 取字工厂（D-059 语言包）：覆盖字典缺 key 回落官方 zh，zh 也缺才 fail-loud。
// 宿主侧同用（renderMarkdown 注入代码块复制钮文案——markdown 纯渲染层不持有字典）。

import { zh } from "./zh.js";

export const makeT =
  (override?: Record<string, string>): ((key: string) => string) =>
  (key: string): string => {
    const value = override?.[key] ?? (zh as Record<string, string>)[key];
    if (value === undefined) throw new Error(`missing locale key: ${key}`);
    return value;
  };

// 复制按钮（common.copy / common.copied）。t 可选注入（markdown 代码块头部条复用——
// 纯渲染层不持有字典，缺省英文兜底）；无 ctx 依赖，包根出口供插件/宿主共用。
// 原 conversation.tsx 内私有件——per-tool 卡（E5）也要复制动作，独立成文件断开循环引用。

import { useState } from "react";

export function CopyButton({
  text,
  t,
  className,
}: {
  text: string;
  t?: (key: string) => string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          })
          .catch(() => {});
      }}
      style={{
        fontSize: "var(--henira-fs-sm)",
        padding: "0 6px",
      }}
    >
      {copied ? (t?.("common.copied") ?? "Copied") : (t?.("common.copy") ?? "Copy")}
    </button>
  );
}

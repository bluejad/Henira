// 官方件：输入 dock（list 槽 composer.dock，R183；dsh conversation.input.dock 行为层——
// 卡外通栏条目，审批接管时仍可见）。官方默认条目 = 排队面板：R182 前它长在输入栏内，
// 接管时随 bar 一起 display:none；R183 移出 bar 后接管期间仍贴在审批卡上沿。
// 编辑回填走 ComposerApi（setDraft + focus）——草稿真源在运行时，不在本件。

import { useCallback } from "react";
import type { WebPart } from "../types.js";
import { QueuePanel } from "./queue-panel.js";

export const QueueDock: WebPart = (ctx) => {
  const api = ctx.composer;
  const editQueued = useCallback(
    (text: string): void => {
      // 排队卡编辑回填：条目文本进草稿（覆盖语义；跨窗口冻结锁挂账 50-open）
      api?.setDraft(text);
      api?.focus();
    },
    [api],
  );
  return <QueuePanel ctx={ctx} onEdit={editQueued} />;
};

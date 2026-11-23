// 空会话草稿态（R188）：问候 + 品牌水印 + 一句真实能力提示。
// 参照行为层 = ZCode ConversationDraftEmptyState（按小时换问候、品牌图形垫底、不超过两行）；
// 我们是自己的马具词源图形，不做 suggestion 卡片，不伪造功能。
import type { ReactNode } from "react";
import type { WebPartContext } from "../../types.js";
import { HorseGlyph } from "../icons.js";
import { greetingKey } from "./format.js";

export function ConversationEmpty(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const greeting = greetingKey(new Date().getHours());
  return (
    <div className="henira-empty">
      <div className="henira-empty-watermark" aria-hidden="true">
        <HorseGlyph size={280} />
      </div>
      <p className="henira-empty-greeting">{ctx.t(`empty.greeting.${greeting}`)}</p>
      <p className="henira-empty-hint">{ctx.t("empty.hint")}</p>
    </div>
  );
}

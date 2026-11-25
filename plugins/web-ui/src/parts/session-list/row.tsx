// 会话行（R177 拆分；R188 内容真值）：标题走服务端派生 title（缺省回落目录名），
// 右侧相对时间；busy 只留前置 spinner（不再每行一个无意义灰点+「进行中」文字）。
import type { SessionSummary } from "@henira/protocol";
import { memo } from "react";
import type { WebPartContext } from "../../types.js";
import { SpinnerGlyph } from "../icons.js";
import { dirBasename } from "./groups.js";
import { formatRelativeTime } from "./time.js";

/** 会话行（memo——侧栏每帧刷新只重渲 busy/选中变化的行；折叠组天然不渲染子行，
 *  ZCode 侧栏阈值虚拟化（>80 行）挂账 D-061——触发信号 = 实测卡顿或几百会话场景） */
const SessionRow = memo(
  function SessionRow(props: {
    session: SessionSummary;
    selected: boolean;
    ctx: WebPartContext;
    now: number;
    titleOverride?: string;
    canDelete: boolean;
    onSelect(sessionId: string): void;
    onContextMenu(session: SessionSummary, x: number, y: number): void;
  }) {
    const { session: s, selected, ctx, canDelete } = props;
    const title = props.titleOverride?.trim() || s.title?.trim() || dirBasename(s.cwd) || s.cwd;
    return (
      <li
        style={{ marginBottom: "2px" }}
        onContextMenu={(e) => {
          if (!canDelete) return; // 宿主无删除面 → 无会话菜单
          e.preventDefault();
          props.onContextMenu(s, e.clientX, e.clientY);
        }}
      >
        <button
          type="button"
          data-active={selected ? "true" : undefined}
          title={title}
          onClick={() => {
            props.onSelect(s.id);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--henira-space-2)",
            width: "100%",
            textAlign: "left",
            // background 不写内联（transparent 会压死 data-active 的选中底色——「点了不出
            // 选中状态」真因，界面持久化批抓修）；未选中透明收进 tokens 基础规则
            borderRadius: "var(--henira-radius)",
            padding: "6px 10px",
            minHeight: "32px",
            boxSizing: "border-box",
          }}
        >
          {s.busy ? (
            <span
              role="img"
              aria-label={ctx.t("sessions.busy")}
              title={ctx.t("sessions.busy")}
              style={{
                display: "inline-flex",
                width: 16,
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <SpinnerGlyph size={14} color="var(--henira-info-text)" />
            </span>
          ) : null}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: selected ? "var(--henira-text-strong)" : "var(--henira-text)",
            }}
          >
            {title}
          </span>
          {/* D-089：待我处理（审批/提问挂起）——ZCode 左栏 task 行同款徽标；
              title 带总数，窄栏只显示文案，多张卡时数字跟在后面。 */}
          {s.pendingInteraction !== undefined ? (
            <span
              data-session-pending={s.pendingInteraction.kind}
              title={`${ctx.t("sessions.awaiting")}${
                s.pendingInteraction.count > 1 ? ` ${s.pendingInteraction.count}` : ""
              }`}
              style={{
                flexShrink: 0,
                borderRadius: 999,
                padding: "0 6px",
                background: "var(--henira-ok-bg)",
                color: "var(--henira-ok-text)",
                fontSize: "var(--henira-fs-sm)",
                lineHeight: "18px",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {ctx.t("sessions.awaiting")}
              {s.pendingInteraction.count > 1 ? ` ${s.pendingInteraction.count}` : ""}
            </span>
          ) : null}
          <span
            style={{
              marginLeft: "auto",
              color: "var(--henira-text-subtlest)",
              fontSize: "var(--henira-fs-sm)",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatRelativeTime(s.updatedAt, ctx.t, props.now)}
          </span>
        </button>
      </li>
    );
  },
  (a, b) =>
    a.session === b.session && // 列表刷新未变会话同对象——跳过重渲
    a.selected === b.selected &&
    a.now === b.now &&
    a.titleOverride === b.titleOverride &&
    a.canDelete === b.canDelete &&
    a.ctx.t === b.ctx.t,
);

export { SessionRow };

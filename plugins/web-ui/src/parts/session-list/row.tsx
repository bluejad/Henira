// 会话行（R177 拆分）：memo——只重渲 busy/选中变化的行。
import type { SessionSummary } from "@henira/protocol";
import { memo } from "react";
import type { WebPartContext } from "../../types.js";
import { SpinnerGlyph } from "../icons.js";
import { dirBasename } from "./groups.js";

/** 会话行（memo——侧栏每帧刷新只重渲 busy/选中变化的行；折叠组天然不渲染子行，
 *  ZCode 侧栏阈值虚拟化（>80 行）挂账 D-061——触发信号 = 实测卡顿或几百会话场景） */
const SessionRow = memo(
  function SessionRow(props: {
    session: SessionSummary;
    selected: boolean;
    ctx: WebPartContext;
    canDelete: boolean;
    onSelect(sessionId: string): void;
    onContextMenu(session: SessionSummary, x: number, y: number): void;
  }) {
    const { session: s, selected, ctx, canDelete } = props;
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
          <span
            role="img"
            aria-label={s.busy ? ctx.t("sessions.busy") : ctx.t("sessions.idle")}
            style={{
              display: "inline-flex",
              width: 16,
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {s.busy ? (
              <SpinnerGlyph size={14} color="var(--henira-info-text)" />
            ) : (
              <span
                style={{
                  display: "inline-block",
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: "var(--henira-border-strong)",
                }}
              />
            )}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: selected ? "var(--henira-text-strong)" : "var(--henira-text)",
            }}
          >
            {dirBasename(s.cwd) || s.cwd}
          </span>
          {s.busy ? (
            <span
              style={{
                marginLeft: "auto",
                color: "var(--henira-text-muted)",
                fontSize: "var(--henira-fs-sm)",
                flexShrink: 0,
              }}
            >
              {ctx.t("sessions.busy")}
            </span>
          ) : null}
        </button>
      </li>
    );
  },
  (a, b) =>
    a.session === b.session && // 列表刷新未变会话同对象——跳过重渲
    a.selected === b.selected &&
    a.canDelete === b.canDelete &&
    a.ctx.t === b.ctx.t,
);

export { SessionRow };

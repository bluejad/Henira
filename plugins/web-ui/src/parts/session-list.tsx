// 官方件：会话列表（槽 sidebar）。哑渲染件——数据经承重缝（client + store）来，件自身只渲染与交互。
// 列表项 = 32px 行 + 16px 前置状态槽（busy 转圈 / idle 圆点——ZCode TaskListItem 行为层参照）。

import type { SessionSummary } from "@henira/protocol";
import { useCallback, useEffect, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { SpinnerGlyph } from "./icons.js";

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const refresh = useCallback((): void => {
    void ctx.client
      .listSessions()
      .then(setSessions)
      .catch(() => {}); // 拉取失败静默保留上次列表（下次帧再来）
  }, [ctx.client]);

  useEffect(() => {
    refresh();
    const off = ctx.store.subscribe(refresh); // busy 变化等经帧流触发刷新
    return () => {
      off();
    };
  }, [refresh, ctx.store]);

  const createSession = useCallback((): void => {
    void ctx.client
      .createSession()
      .then(() => refresh())
      .catch(() => {});
  }, [ctx.client, refresh]);

  return (
    <nav
      className="henira-sessions"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--henira-border)",
        background: "var(--henira-surface)",
        padding: "var(--henira-space-3)",
        boxSizing: "border-box",
        width: "var(--henira-sidebar-width)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--henira-space-3)",
        }}
      >
        <strong style={{ color: "var(--henira-text-strong)" }}>{ctx.t("sessions.title")}</strong>
        <button type="button" className="henira-primary" onClick={createSession}>
          + {ctx.t("sessions.new")}
        </button>
      </div>
      {sessions.length === 0 ? (
        <span style={{ color: "var(--henira-text-muted)" }}>{ctx.t("sessions.empty")}</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
          {sessions.map((s) => {
            const selected = ctx.sessionId === s.id;
            return (
              <li key={s.id} style={{ marginBottom: "2px" }}>
                <button
                  type="button"
                  data-active={selected ? "true" : undefined}
                  onClick={() => {
                    ctx.selectSession(s.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--henira-space-2)",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
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
                    {s.cwd.split(/[\\/]/).pop() || s.cwd}
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
          })}
        </ul>
      )}
    </nav>
  );
};

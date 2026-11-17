// 官方件：会话列表（槽 sidebar）——按工作目录分组（BC「目录」/ZCode projects view 行为层参照）。
// 组 = 折叠头（caret + 目录名 + 会话数徽标）+ 缩进子行；活跃会话所在组自动展开。
// 列表项 = 32px 行 + 16px 前置状态槽（busy 转圈 / idle 圆点——ZCode TaskListItem 行为层参照）。

import type { SessionSummary } from "@henira/protocol";
import { useCallback, useEffect, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { CaretGlyph, SpinnerGlyph } from "./icons.js";

/** 按 cwd 分组（保持出现序）；cwd 缺失归 ""（渲染为「其他」） */
function groupByCwd(sessions: readonly SessionSummary[]): Map<string, SessionSummary[]> {
  const groups = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = s.cwd ?? "";
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [s]);
    else list.push(s);
  }
  return groups;
}

const dirBasename = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? "";

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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

  // 活跃会话所在组自动展开（BC 行为：选中即见其组）
  useEffect(() => {
    if (ctx.sessionId === null) return;
    const hit = sessions.find((s) => s.id === ctx.sessionId);
    if (hit === undefined) return;
    setCollapsed((prev) => {
      if (!prev.has(hit.cwd ?? "")) return prev;
      const next = new Set(prev);
      next.delete(hit.cwd ?? "");
      return next;
    });
  }, [ctx.sessionId, sessions]);

  const createSession = useCallback((): void => {
    void ctx.client
      .createSession()
      .then(() => refresh())
      .catch(() => {});
  }, [ctx.client, refresh]);

  const toggle = useCallback((cwd: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }, []);

  const groups = groupByCwd(sessions);

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
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {[...groups.entries()].map(([cwd, list]) => {
            const open = !collapsed.has(cwd);
            return (
              <section
                key={cwd || "__ungrouped__"}
                style={{ marginBottom: "var(--henira-space-2)" }}
              >
                <button
                  type="button"
                  className="henira-session-group"
                  aria-expanded={open}
                  title={cwd}
                  onClick={() => {
                    toggle(cwd);
                  }}
                >
                  <span
                    className="henira-group-caret"
                    style={{ transform: open ? "rotate(90deg)" : "none" }}
                  >
                    <CaretGlyph size={12} />
                  </span>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {cwd === "" ? ctx.t("sessions.ungrouped") : dirBasename(cwd) || cwd}
                  </span>
                  <span className="henira-session-count">{list.length}</span>
                </button>
                {open ? (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: "0 0 0 var(--henira-space-4)",
                    }}
                  >
                    {list.map((s) => {
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
                                color: selected
                                  ? "var(--henira-text-strong)"
                                  : "var(--henira-text)",
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
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </nav>
  );
};

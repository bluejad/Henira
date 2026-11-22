// 侧栏目录区主件（R177 拆分）：目录 + 会话两层、刷新、弹窗与菜单接线。
import type { RegisteredDir, SessionSummary } from "@henira/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WebPart, WebPartContext } from "../../types.js";
import { DirectoryDialog } from "../directory-dialog.js";
import { CaretGlyph } from "../icons.js";
import { ContextMenu } from "./context-menu.js";
import { DeleteConfirm } from "./delete-confirm.js";
import { buildGroups, type MenuState, type PendingDelete } from "./groups.js";
import { SessionRow } from "./row.js";

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [dirs, setDirs] = useState<readonly RegisteredDir[] | null>(null);
  // 「目录」区标题行折叠/展开（纯本地态，用户确认 2026-11-19：不持久化——跟下面分组同玩法）
  const [dirsCollapsed, setDirsCollapsed] = useState(false);
  // 折叠组是纯本地态（用户裁决 2026-11-18：折叠不持久化——刷新/重启只展开选中会话所在组、
  // 其余组收起；平时的折叠/展开是临时操作，不落盘、不跨刷新还原）
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // 初始折叠种子锚：首次拿到「选中会话已在列表里」时播一次，此后纯本地
  const seededRef = useRef(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // 目录区交互 feature-detect：宿主五方法齐备才渲染（模型选择器三可选先例同款——
  // 不做半可用状态：缺任一方法 = 目录登记交互整体收起，退化为纯 cwd 分组）
  const hasDirSupport =
    ctx.client.listDirs !== undefined &&
    ctx.client.addDir !== undefined &&
    ctx.client.browseDirs !== undefined &&
    ctx.client.deleteDir !== undefined &&
    ctx.client.deleteSession !== undefined;
  const canDeleteSession = ctx.client.deleteSession !== undefined;

  // R176 列表保鲜（五家共识：装载一次 + 生命周期信号驱动；流式增量绝不碰列表）：
  // 单飞 + 脏标记（在飞时只标脏，落定后恰补一次——ZCode flight+dirty / opencode single-flight
  // 行为层）+ 250ms 去抖（一束信号一枪）+ 失败静默保旧列表不自动重试（列表 GET 0/5 重试铁律）。
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const sessionsRef = useRef<readonly SessionSummary[]>([]);
  const refreshRef = useRef<(() => void) | undefined>(undefined);

  const refresh = useCallback((): void => {
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    inFlightRef.current = true;
    const listDirs = ctx.client.listDirs;
    const requests: Promise<unknown>[] = [
      ctx.client.listSessions().then(
        (next) => {
          if (mountedRef.current) setSessions(next);
        },
        () => {}, // 失败：保旧列表，不重试（下一个信号再来）
      ),
    ];
    if (listDirs !== undefined) {
      requests.push(
        listDirs().then(
          (next) => {
            if (mountedRef.current) setDirs(next);
          },
          () => {},
        ),
      );
    }
    void Promise.allSettled(requests).then(() => {
      inFlightRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        refreshRef.current?.();
      }
    });
  }, [ctx.client]);
  refreshRef.current = refresh;

  const scheduleRefresh = useCallback((): void => {
    if (timerRef.current !== undefined) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      refreshRef.current?.();
    }, 250);
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 列表信号订阅（先订阅再首载：装载窗口内的变化不丢）：
  // sessions.changed = 列表事实变 → 去抖重载；state.updated = busy 推送翻内存（零请求）；
  // snapshot = 重连自愈（已知会话翻 busy；未知会话 = 断线期间新建 → 补一次重载）。
  useEffect(() => {
    mountedRef.current = true;
    const off = ctx.host.subscribe({}, (frame) => {
      if (frame.kind === "sessions.changed") {
        scheduleRefresh();
        return;
      }
      if (frame.kind === "delta") {
        if (frame.delta.op !== "state.updated") return; // 流式 token / 工具行增量一律不碰列表
        const busy = frame.delta.state.busy;
        setSessions((prev) =>
          prev.map((s) => (s.id === frame.sessionId && s.busy !== busy ? { ...s, busy } : s)),
        );
        return;
      }
      if (frame.kind === "snapshot") {
        const busy = frame.snapshot.state.busy;
        if (!sessionsRef.current.some((s) => s.id === frame.sessionId)) {
          scheduleRefresh();
          return;
        }
        setSessions((prev) =>
          prev.map((s) => (s.id === frame.sessionId && s.busy !== busy ? { ...s, busy } : s)),
        );
      }
    });
    refreshRef.current?.();
    return () => {
      mountedRef.current = false;
      off();
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [ctx.host, scheduleRefresh]);

  // 初始折叠种子：刷新/重启后只保证「选中会话所在组展开、其余组收起」。播一次即完——
  // 此后用户想折叠想展开随他，不落盘也不跨刷新还原（用户裁决 2026-11-18）
  useEffect(() => {
    if (seededRef.current) return;
    const active =
      ctx.sessionId === null ? undefined : sessions.find((s) => s.id === ctx.sessionId);
    if (active === undefined) return; // 等列表 + 选中就位再播
    seededRef.current = true;
    const activeCwd = active.cwd ?? "";
    setCollapsed(
      new Set(
        buildGroups(sessions, dirs, ctx.t)
          .map((group) => group.cwd)
          .filter((cwd) => cwd !== activeCwd),
      ),
    );
  }, [ctx.sessionId, sessions, dirs, ctx.t]);

  // 活跃会话所在组自动展开（选中即见其组）
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
      .then((session) => {
        scheduleRefresh();
        ctx.selectSession(session.id); // 建完即切（「新会话」= 开始在那聊，不切反直觉）
      })
      .catch(() => {});
  }, [ctx.client, ctx.selectSession, scheduleRefresh]);

  const createIn = useCallback(
    (cwd: string): void => {
      void ctx.client
        .createSession({ cwd })
        .then(() => scheduleRefresh())
        .catch(() => {});
    },
    [ctx.client, scheduleRefresh],
  );

  const toggle = useCallback((cwd: string): void => {
    // 纯本地折叠态（不持久化）：想折就折、想展就展，刷新后按「活跃组展开」重来
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }, []);

  const copyPath = useCallback((cwd: string): void => {
    void navigator.clipboard?.writeText(cwd).catch(() => {});
    setMenu(null);
  }, []);

  const groups = buildGroups(sessions, dirs, ctx.t);

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
        width: "100%", // 随宿主列宽走（D-063 拖宽落宿主列内联宽，var 缺省时同值）
      }}
    >
      {/* 「＋新会话」独立一行置任务列表之上（用户裁定 2026-11-18 三栏骨架形状） */}
      <button type="button" className="henira-primary henira-new-session" onClick={createSession}>
        + {ctx.t("sessions.new")}
      </button>
      <div
        className="henira-sidebar-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--henira-space-1)",
          marginBottom: "var(--henira-space-3)",
        }}
      >
        {/* 标题行本体 = 折叠开关（点它收起/展开整个目录列表；纯本地不持久化） */}
        <button
          type="button"
          className="henira-dirs-toggle"
          aria-expanded={!dirsCollapsed}
          onClick={() => {
            setDirsCollapsed((v) => !v);
          }}
        >
          <span
            className="henira-group-caret"
            style={{ transform: dirsCollapsed ? "none" : "rotate(90deg)" }}
          >
            <CaretGlyph size={12} />
          </span>
          <strong style={{ color: "var(--henira-text-strong)" }}>{ctx.t("dirs.title")}</strong>
        </button>
        {hasDirSupport ? (
          <button
            type="button"
            className="henira-hover-reveal"
            aria-label={ctx.t("dirs.add")}
            title={ctx.t("dirs.add")}
            onClick={() => {
              setAddOpen(true);
            }}
          >
            + {ctx.t("dirs.add")}
          </button>
        ) : null}
      </div>
      {!dirsCollapsed &&
        (sessions.length === 0 && groups.length === 0 ? (
          <span style={{ color: "var(--henira-text-muted)" }}>{ctx.t("sessions.empty")}</span>
        ) : (
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {groups.map((group) => {
              const open = !collapsed.has(group.cwd);
              return (
                <section
                  key={group.cwd || "__ungrouped__"}
                  style={{ marginBottom: "var(--henira-space-2)" }}
                >
                  <div className="henira-group-row">
                    <button
                      type="button"
                      className="henira-session-group"
                      aria-expanded={open}
                      title={group.cwd}
                      onContextMenu={(e) => {
                        if (group.dir === undefined || ctx.client.deleteDir === undefined) return; // 未登记组 / 宿主无删除面 → 无目录级操作
                        e.preventDefault();
                        setMenu({ kind: "dir", x: e.clientX, y: e.clientY, dir: group.dir });
                      }}
                      onClick={() => {
                        toggle(group.cwd);
                      }}
                    >
                      <span
                        className="henira-group-caret"
                        style={{ transform: open ? "rotate(90deg)" : "none" }}
                      >
                        <CaretGlyph size={12} />
                      </span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.label}
                      </span>
                      <span className="henira-session-count">{group.sessions.length}</span>
                    </button>
                    {hasDirSupport && group.cwd !== "" ? (
                      <button
                        type="button"
                        className="henira-hover-reveal henira-group-add"
                        aria-label={ctx.t("menu.newSession")}
                        title={ctx.t("menu.newSession")}
                        onClick={() => {
                          createIn(group.cwd);
                        }}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <ul
                      style={{
                        listStyle: "none",
                        margin: 0,
                        padding: "0 0 0 var(--henira-space-4)",
                      }}
                    >
                      {group.sessions.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          selected={ctx.sessionId === s.id}
                          ctx={ctx}
                          canDelete={canDeleteSession}
                          onSelect={ctx.selectSession}
                          onContextMenu={(session, x, y) => {
                            setMenu({ kind: "session", x, y, session });
                          }}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        ))}
      {menu !== null ? (
        <ContextMenu
          menu={menu}
          ctx={ctx}
          onClose={() => {
            setMenu(null);
          }}
          onCreate={(cwd) => {
            setMenu(null);
            createIn(cwd);
          }}
          onCopy={(cwd) => {
            copyPath(cwd);
          }}
          onDelete={(target) => {
            setMenu(null);
            setPending(target);
          }}
        />
      ) : null}
      {pending !== null ? (
        <DeleteConfirm
          ctx={ctx}
          target={pending}
          sessions={sessions}
          onClose={() => {
            setPending(null);
          }}
          onDone={() => {
            setPending(null);
            scheduleRefresh();
          }}
        />
      ) : null}
      {addOpen ? (
        <DirectoryDialog
          ctx={ctx}
          onAdded={() => {
            scheduleRefresh();
          }}
          onClose={() => {
            setAddOpen(false);
          }}
        />
      ) : null}
    </nav>
  );
};

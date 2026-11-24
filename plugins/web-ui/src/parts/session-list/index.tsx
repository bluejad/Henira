// 侧栏目录区主件（R177 拆分）：目录 + 会话两层、刷新、弹窗与菜单接线。
import type { RegisteredDir, SessionSummary } from "@henira/protocol";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../../types.js";
import { DirectoryDialog } from "../directory-dialog.js";
import { CaretGlyph, PlusGlyph } from "../icons.js";
import { ContextMenu } from "./context-menu.js";
import { DeleteConfirm } from "./delete-confirm.js";
import {
  buildGroups,
  type MenuState,
  type PendingDelete,
  pickFallback,
  sameCwd,
} from "./groups.js";
import { SessionRow } from "./row.js";

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [dirs, setDirs] = useState<readonly RegisteredDir[] | null>(null);
  // 首载完成标记（R188）：列表空态在首次请求落定前显示「加载中」，不再闪「还没有会话」
  const [loaded, setLoaded] = useState(false);
  // 相对时间分钟刻度（R188）：列表不重拉也要让「刚刚/分钟前」走字；行 memo 比 now 桶
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  // 当前会话的活跃标题（R188）：store 的 snapshot/delta 已带 title——列表不重拉也能换行名
  const liveTitle = useSyncExternalStore(
    ctx.store.subscribe,
    () => (ctx.sessionId === null ? undefined : ctx.store.getSession(ctx.sessionId)?.title),
    () => undefined,
  );
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
      if (mountedRef.current) setLoaded(true);
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

  // 跨窗口回落（R185 收尾）：列表刷新后校验选中——别的窗口删了本窗正在看的会话时，
  // 本窗只收到 sessions.changed（帧不带载荷），靠这次列表对比补上动作。
  // 守卫：只认「选中会话在上一版列表里、新版没了」——首次装载（上一版空）与拉取失败保旧
  // 列表都不误清；busy 点就地翻新（R176）会让列表对象变但会话仍在，同样不动作。
  const prevSessionsRef = useRef<readonly SessionSummary[]>([]);
  useEffect(() => {
    const prev = prevSessionsRef.current;
    prevSessionsRef.current = sessions;
    if (ctx.sessionId === null || prev === sessions) return;
    const before = prev.find((s) => s.id === ctx.sessionId);
    if (before === undefined) return;
    if (sessions.some((s) => s.id === ctx.sessionId)) return;
    ctx.selectSession(pickFallback(sessions, before.cwd ?? "")?.id ?? null);
  }, [sessions, ctx.sessionId, ctx.selectSession]);

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
        .then((session) => {
          scheduleRefresh();
          // 与顶部「＋新会话」同语义：建完即切（R185 活体：组内 ＋ 只建不切——R150 只修了顶部按钮）
          ctx.selectSession(session.id);
        })
        .catch(() => {});
    },
    [ctx.client, ctx.selectSession, scheduleRefresh],
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
        background: "var(--henira-surface)",
        padding: "var(--henira-space-3)",
        boxSizing: "border-box",
        width: "100%", // 随宿主列宽走（D-063 拖宽落宿主列内联宽，var 缺省时同值）
      }}
    >
      {/* 「＋新会话」独立一行置任务列表之上（用户裁定 2026-11-18 三栏骨架形状；
          R188 改安静行：参照物入口是图标+文字的行，不是通栏实心 CTA） */}
      <button type="button" className="henira-new-session" onClick={createSession}>
        <PlusGlyph size={14} />
        <span>{ctx.t("sessions.new")}</span>
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
        (!loaded ? (
          <span style={{ color: "var(--henira-text-muted)" }}>{ctx.t("dirs.loading")}</span>
        ) : sessions.length === 0 && groups.length === 0 ? (
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
                          now={now}
                          titleOverride={
                            s.id === ctx.sessionId ? liveTitle : ctx.store.getSession(s.id)?.title
                          }
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
            // 删掉的若是当前选中会话（或含它的整个目录）→ 先按本地列表定回落再刷新：
            // 不回落会留下指向已删 id 的空白界面（R185 收尾活体抓）。同目录下一条优先，
            // 其次列表第一个，一个不剩 → 清选中（空态）；列表以服务端刷新为准
            if (pending !== null && ctx.sessionId !== null) {
              const removed =
                pending.kind === "dir"
                  ? new Set(
                      sessions
                        .filter((s) => sameCwd(s.cwd ?? "", pending.dir.cwd))
                        .map((s) => s.id),
                    )
                  : new Set([pending.session.id]);
              if (removed.has(ctx.sessionId)) {
                const remaining = sessions.filter((s) => !removed.has(s.id));
                const cwd = pending.kind === "session" ? (pending.session.cwd ?? "") : null;
                ctx.selectSession(pickFallback(remaining, cwd)?.id ?? null);
              }
            }
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

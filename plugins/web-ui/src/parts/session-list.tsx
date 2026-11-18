// 官方件：侧栏目录区（槽 sidebar）——登记工作目录 + 其下会话两层数据：
// 目录 = 登记表（client.listDirs，可选方法；宿主缺方法退化为纯 cwd 分组）+ 未登记会话 cwd 补组。
// 区头 hover 显「新增目录」（服务端目录树弹窗——BC OpenDirectoryDialog 行为层）；
// 目录行 hover 显 ＋（在该目录新建会话——ZCode ProjectNodeContent 行为层）；
// 右键组头/会话行出菜单（新建会话/复制路径/删除）；删除一律确认弹窗（硬删不可恢复——
// BC 确认弹窗 + busy 守卫语义；busy 会话菜单项 disabled「运行中，请先中断」）。
// 列表项 = 32px 行 + 16px 前置状态槽（busy 转圈 / idle 圆点——ZCode TaskListItem 行为层参照）。

import type { RegisteredDir, SessionSummary } from "@henira/protocol";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { DirectoryDialog } from "./directory-dialog.js";
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

/** cwd 归一比较（busy 会话归组判据；与 plugin-session sameCwd 同式语义）。**浏览器 bundle
 *  无 process**——按路径形状判平台（盘符形/反斜杠 = Windows → 大小写归一），不能用 process.platform
 *  （R127 教训：jsdom 有 process 而 bundle 没有，22 组件绿拦不住真浏览器挂载即崩） */
function sameCwd(a: string, b: string): boolean {
  const isWinPath = /^[A-Za-z]:[/]/.test(a) || a.includes("\\");
  return isWinPath ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 渲染分组：登记目录优先（lastOpenedAt 序），未登记 cwd 补组，cwd 缺失归「其他」 */
interface DirGroup {
  cwd: string;
  label: string;
  sessions: readonly SessionSummary[];
  dir?: RegisteredDir;
}

function buildGroups(
  sessions: readonly SessionSummary[],
  dirs: readonly RegisteredDir[] | null,
  t: (key: string) => string,
): DirGroup[] {
  const byCwd = groupByCwd(sessions);
  if (dirs === null) {
    return [...byCwd.entries()].map(([cwd, list]) => ({
      cwd,
      label: cwd === "" ? t("sessions.ungrouped") : dirBasename(cwd) || cwd,
      sessions: list,
    }));
  }
  const taken = new Set<string>();
  const groups: DirGroup[] = dirs.map((d) => {
    const list = byCwd.get(d.cwd) ?? [];
    for (const s of list) taken.add(s.id);
    return { cwd: d.cwd, label: d.displayName, sessions: list, dir: d };
  });
  for (const [cwd, list] of byCwd) {
    const known = dirs.some((d) => sameCwd(d.cwd, cwd));
    if (!known) {
      for (const s of list) taken.add(s.id);
      groups.push({
        cwd,
        label: cwd === "" ? t("sessions.ungrouped") : dirBasename(cwd) || cwd,
        sessions: list,
      });
    }
  }
  return groups;
}

type PendingDelete =
  | { kind: "dir"; dir: RegisteredDir }
  | { kind: "session"; session: SessionSummary };

type MenuState =
  | { kind: "dir"; x: number; y: number; dir: RegisteredDir }
  | { kind: "session"; x: number; y: number; session: SessionSummary }
  | null;

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [dirs, setDirs] = useState<readonly RegisteredDir[] | null>(null);
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

  const refresh = useCallback((): void => {
    void ctx.client
      .listSessions()
      .then(setSessions)
      .catch(() => {}); // 拉取失败静默保留上次列表（下次帧再来）
    const listDirs = ctx.client.listDirs;
    if (listDirs !== undefined) {
      void listDirs()
        .then(setDirs)
        .catch(() => {});
    }
  }, [ctx.client]);

  useEffect(() => {
    refresh();
    const off = ctx.store.subscribe(refresh); // busy 变化等经帧流触发刷新
    return () => {
      off();
    };
  }, [refresh, ctx.store]);

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

  const createIn = useCallback(
    (cwd: string): void => {
      void ctx.client
        .createSession({ cwd })
        .then(() => refresh())
        .catch(() => {});
    },
    [ctx.client, refresh],
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
        <strong style={{ color: "var(--henira-text-strong)" }}>{ctx.t("dirs.title")}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--henira-space-1)" }}>
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
          <button type="button" className="henira-primary" onClick={createSession}>
            + {ctx.t("sessions.new")}
          </button>
        </div>
      </div>
      {sessions.length === 0 && groups.length === 0 ? (
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
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
      )}
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
            refresh();
          }}
        />
      ) : null}
      {addOpen ? (
        <DirectoryDialog
          ctx={ctx}
          onAdded={() => {
            refresh();
          }}
          onClose={() => {
            setAddOpen(false);
          }}
        />
      ) : null}
    </nav>
  );
};

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

/** 右键菜单（非模态，点外/Escape 关）：目录=新建会话/复制路径/删除目录；会话=删除 */
function ContextMenu(props: {
  menu: Exclude<MenuState, null>;
  ctx: WebPartContext;
  onClose(): void;
  onCreate(cwd: string): void;
  onCopy(cwd: string): void;
  onDelete(target: PendingDelete): void;
}) {
  const { menu, ctx } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [props]);

  const item = (
    label: string,
    action: () => void,
    opts?: { danger?: boolean; disabled?: boolean; title?: string },
  ): ReactNode => (
    <button
      type="button"
      className="henira-menu-item"
      data-danger={opts?.danger === true ? "true" : undefined}
      disabled={opts?.disabled}
      title={opts?.title}
      onClick={action}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="henira-context-menu" style={{ left: menu.x, top: menu.y }}>
      {menu.kind === "dir" ? (
        <>
          {item(ctx.t("menu.newSession"), () => props.onCreate(menu.dir.cwd))}
          {item(ctx.t("menu.copyPath"), () => props.onCopy(menu.dir.cwd))}
          <div className="henira-menu-sep" />
          {item(ctx.t("menu.deleteDir"), () => props.onDelete({ kind: "dir", dir: menu.dir }), {
            danger: true,
          })}
        </>
      ) : (
        item(
          ctx.t("menu.delete"),
          () => props.onDelete({ kind: "session", session: menu.session }),
          {
            danger: true,
            disabled: menu.session.busy,
            title: menu.session.busy ? ctx.t("menu.deleteBusy") : undefined,
          },
        )
      )}
    </div>
  );
}

/** 删除确认弹窗（硬删除不可恢复；目录删除带 busy 前置守卫——BC DeleteProjectModal 行为层） */
function DeleteConfirm(props: {
  ctx: WebPartContext;
  target: PendingDelete;
  sessions: readonly SessionSummary[];
  onClose(): void;
  onDone(): void;
}) {
  const { ctx, target } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = ctx.t;

  const blockedCount =
    target.kind === "dir"
      ? props.sessions.filter((s) => sameCwd(s.cwd, target.dir.cwd) && s.busy).length
      : 0;
  const title = target.kind === "dir" ? t("dirs.deleteTitle") : t("sessions.deleteTitle");
  const message = target.kind === "dir" ? t("dirs.deleteMessage") : t("sessions.deleteMessage");

  const confirm = (): void => {
    setBusy(true);
    setError(null);
    const job =
      target.kind === "dir"
        ? ctx.client.deleteDir?.(target.dir.id)
        : ctx.client.deleteSession?.(target.session.id);
    if (job === undefined) return;
    void job.then(props.onDone).catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="henira-overlay" role="presentation">
      <div className="henira-dialog" role="dialog" aria-label={title}>
        <div className="henira-dialog-head">
          <strong>{title}</strong>
          <button
            type="button"
            aria-label={t("common.cancel")}
            onClick={props.onClose}
            disabled={busy}
          >
            ✕
          </button>
        </div>
        <p className="henira-dialog-message">{message}</p>
        {target.kind === "dir" ? <p className="henira-dialog-path">{target.dir.cwd}</p> : null}
        {blockedCount > 0 ? (
          <p role="alert" className="henira-send-error">
            {t("dirs.deleteBusy").replace("{n}", String(blockedCount))}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="henira-send-error">
            {t("dirs.deleteFailed")}：{error}
          </p>
        ) : null}
        <div className="henira-dialog-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="henira-danger"
            onClick={confirm}
            disabled={busy || blockedCount > 0}
          >
            {busy ? t("dirs.loading") : t("menu.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

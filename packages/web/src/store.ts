// 行 store（web 客户端的唯一数据源——哑渲染器：本 store 应用帧 → 件渲染行）。
// 断档不猜：lastSeq 按会话跟踪；跳号 → 触发重拉快照换发（快照整体替换，消费端永不猜中间态）。
// 行引用契约（虚拟滚动 memo 化的前提，ZCode 同款）：未变化的行保持同一引用，
// 变化的行给新对象（row.delta 不再原地 mutate）；行列表 append-only + 前插仅经 loadOlder。
// getSession 返回缓存对象（版本化）——useSyncExternalStore 要求引用稳定。

import type { Delta, Row, ServerFrame, SessionSnapshot, SessionState } from "@henira/protocol";
import { formatSessionTitle } from "@henira/protocol";

export interface SessionView {
  rows: readonly Row[];
  state: SessionState;
  /** 会话标题（R188：服务端快照派生；缺省 = 尚无用户消息） */
  title?: string;
  /** true = 窗口首行之前还有历史（快照窗口化随帧下发；loadOlder 翻页依据） */
  hasOlder: boolean;
  /** 全序行数（快照下发；滚动条长度估计用） */
  totalRows: number;
}

export class RowStore {
  readonly #sessions = new Map<
    string,
    {
      rows: Row[];
      byId: Map<string, Row>;
      state: SessionState;
      title?: string;
      lastSeq: number;
      totalRows: number;
      version: number;
    }
  >();
  readonly #listeners = new Set<() => void>();
  readonly #views = new Map<string, { view: SessionView; version: number }>();
  #version = 0;
  #refetch: ((sessionId: string) => void) | undefined;

  /** 断档时由宿主接手（client.snapshot → applySnapshot） */
  setRefetch(fn: (sessionId: string) => void): void {
    this.#refetch = fn;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  };

  /** useSyncExternalStore 快照：引用稳定（会话未变化返回同一对象） */
  getSession = (sessionId: string | null): SessionView => {
    if (sessionId === null) return EMPTY;
    const cached = this.#views.get(sessionId);
    if (cached !== undefined) return cached.view;
    return EMPTY;
  };

  /** 会话是否有已投影数据（列表选中态初始渲染 / 选中历史会话补拉快照判据用） */
  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  /** 历史前插（loadOlder）：页行按 rowSeq 过滤只收窗口首行之前、按 rowId 去重后前插——
   *  ZCode mergeOlderRows 同语义（防复活已删行 / 防重复合并）；无新行返回 false 不触发订阅 */
  mergeOlderRows(sessionId: string, page: readonly Row[]): boolean {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || page.length === 0) return false;
    const headSeq = session.rows[0]?.rowSeq ?? Number.POSITIVE_INFINITY;
    const seen = new Set(session.rows.map((r) => r.rowId));
    const older = page.filter((r) => r.rowSeq < headSeq && !seen.has(r.rowId));
    if (older.length === 0) return false;
    session.rows = [...older, ...session.rows];
    for (const row of older) session.byId.set(row.rowId, row);
    this.#touch(sessionId);
    return true;
  }

  #touch(sessionId: string): void {
    this.#version += 1;
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    this.#views.set(sessionId, {
      view: {
        rows: [...session.rows],
        state: { ...session.state },
        ...(session.title !== undefined ? { title: session.title } : {}),
        hasOlder: session.totalRows > session.rows.length,
        totalRows: session.totalRows,
      },
      version: this.#version,
    });
    for (const cb of this.#listeners) cb();
  }

  applySnapshot(frame: Extract<ServerFrame, { kind: "snapshot" }>): void {
    const snapshot: SessionSnapshot = frame.snapshot;
    const session = this.#ensure(frame.sessionId);
    session.rows = [...snapshot.rows];
    session.byId = new Map(snapshot.rows.map((row) => [row.rowId, row]));
    session.state = { ...snapshot.state };
    session.title = snapshot.title;
    session.lastSeq = snapshot.seq;
    // totalRows = 全序行数，此后客户端自持（delta 追加自增、前插不变）——快照帧只在连接时发，
    // 跨过窗口边界时 hasOlder 无帧通知 → hasOlder 改派生（totalRows > rows.length），永不过期
    session.totalRows = snapshot.totalRows ?? snapshot.rows.length; // 兜底：老 client / 测试桩无窗口字段
    this.#touch(frame.sessionId);
  }

  applyFrame(frame: Extract<ServerFrame, { kind: "delta" }>): void {
    const session = this.#ensure(frame.sessionId);
    const expected = session.lastSeq + 1;
    if (frame.seq !== expected) {
      // 断档不猜：跳号 / 重复 → 丢帧重拉快照换发
      this.#refetch?.(frame.sessionId);
      return;
    }
    session.lastSeq = frame.seq;
    this.#applyDelta(frame.sessionId, frame.delta);
    this.#touch(frame.sessionId);
  }

  #applyDelta(sessionId: string, delta: Delta): void {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    switch (delta.op) {
      case "row.appended": {
        const row = delta.row;
        session.rows.push(row);
        session.byId.set(row.rowId, row);
        session.totalRows += 1; // 全序行数客户端自持（新行 = 新账本事实）
        // 首条用户消息即标题：header 不等下一次快照（R188；与 protocol 派生同一规则）
        if (session.title === undefined && row.kind === "user" && row.source !== "breaker") {
          const title = formatSessionTitle(row.text);
          if (title !== undefined) session.title = title;
        }
        break;
      }
      case "row.delta": {
        const row = session.byId.get(delta.rowId);
        if (row === undefined) {
          this.#refetch?.(sessionId); // 行不存在 = 断档的另一种形态：重拉
          return;
        }
        // 不可变替换：变化行给新对象（memo 化的行引用契约——原对象保持冻结）
        const next: Row =
          delta.field === "text"
            ? ({ ...row, text: (row as { text: string }).text + delta.text } as Row)
            : ({
                ...row,
                reasoning: ((row as { reasoning?: string }).reasoning ?? "") + delta.text,
              } as Row);
        const index = session.rows.indexOf(row);
        session.rows[index] = next;
        session.byId.set(next.rowId, next);
        break;
      }
      case "row.upserted": {
        const existing = session.byId.get(delta.row.rowId);
        if (existing === undefined) {
          session.rows.push(delta.row);
        } else {
          const index = session.rows.indexOf(existing);
          session.rows[index] = delta.row;
        }
        session.byId.set(delta.row.rowId, delta.row);
        if (
          session.title === undefined &&
          delta.row.kind === "user" &&
          delta.row.source !== "breaker"
        ) {
          const title = formatSessionTitle(delta.row.text);
          if (title !== undefined) session.title = title;
        }
        break;
      }
      case "state.updated": {
        session.state = { ...delta.state };
        break;
      }
    }
  }

  #ensure(sessionId: string): {
    rows: Row[];
    byId: Map<string, Row>;
    state: SessionState;
    title?: string;
    lastSeq: number;
    totalRows: number;
    version: number;
  } {
    let session = this.#sessions.get(sessionId);
    if (session === undefined) {
      session = {
        rows: [],
        byId: new Map(),
        state: { busy: false },
        lastSeq: 0,
        totalRows: 0,
        version: 0,
      };
      this.#sessions.set(sessionId, session);
    }
    return session;
  }
}

const EMPTY: SessionView = { rows: [], state: { busy: false }, hasOlder: false, totalRows: 0 };

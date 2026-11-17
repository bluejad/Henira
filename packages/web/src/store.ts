// 行 store（web 客户端的唯一数据源——哑渲染器：本 store 应用帧 → 件渲染行）。
// 断档不猜：lastSeq 按会话跟踪；跳号 → 触发重拉快照换发（快照整体替换，消费端永不猜中间态）。
// getSession 返回缓存对象（版本化）——useSyncExternalStore 要求引用稳定。

import type { Delta, Row, ServerFrame, SessionSnapshot, SessionState } from "@henira/protocol";

export interface SessionView {
  rows: readonly Row[];
  state: SessionState;
}

export class RowStore {
  readonly #sessions = new Map<
    string,
    { rows: Row[]; byId: Map<string, Row>; state: SessionState; lastSeq: number; version: number }
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

  /** 会话是否有已投影数据（列表选中态初始渲染用） */
  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  #touch(sessionId: string): void {
    this.#version += 1;
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    this.#views.set(sessionId, {
      view: { rows: [...session.rows], state: { ...session.state } },
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
    session.lastSeq = snapshot.seq;
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
        break;
      }
      case "row.delta": {
        const row = session.byId.get(delta.rowId);
        if (row === undefined) {
          this.#refetch?.(sessionId); // 行不存在 = 断档的另一种形态：重拉
          return;
        }
        if (delta.field === "text") {
          (row as { text: string }).text += delta.text;
        } else {
          const assistant = row as { reasoning?: string };
          assistant.reasoning = (assistant.reasoning ?? "") + delta.text;
        }
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
    lastSeq: number;
    version: number;
  } {
    let session = this.#sessions.get(sessionId);
    if (session === undefined) {
      session = {
        rows: [],
        byId: new Map(),
        state: { busy: false },
        lastSeq: 0,
        version: 0,
      };
      this.#sessions.set(sessionId, session);
    }
    return session;
  }
}

const EMPTY: SessionView = { rows: [], state: { busy: false } };

// SessionService 实现（interfaces.md protocol 段定稿签名）：store + derive + fork 的门面。
// createSession = 开档（存在即装载、缺即新建）；fork 返回同构句柄（含 close——子会话的锁
// 由持有者负责释放）。

import type {
  ModelMessage,
  SessionEvent,
  SessionEventInput,
  SessionService,
} from "@henira/protocol";
import { deriveMessages } from "./derive.js";
import { forkSession } from "./fork.js";
import { type CreateSessionOptions, SessionStore } from "./store.js";

export interface SessionHandle extends SessionService {
  /** 释放文件锁并关闭句柄（会话文件本身只增不删，P2） */
  close(): Promise<void>;
  readonly directory: string;
  /** 协变收窄：fork 返回同构句柄（子会话锁由持有者释放） */
  fork(atSeq?: number): Promise<SessionHandle>;
}

export async function createSession(opts: CreateSessionOptions): Promise<SessionHandle> {
  const { store } = await SessionStore.create(opts);
  return wrapStore(store);
}

function wrapStore(store: SessionStore): SessionHandle {
  return {
    header: () => store.header,
    append: (input: SessionEventInput) => store.append(input),
    events: () => store.events(),
    deriveMessages: (): ModelMessage[] => deriveMessages(store.events()),
    fork: async (atSeq?: number) =>
      wrapStore(
        await forkSession({
          sourceDir: store.directory,
          sourceHeader: store.header,
          sourceEvents: store.events(),
          atSeq,
        }),
      ),
    replay: async (visitor: (e: SessionEvent) => void | Promise<void>) => {
      for (const event of store.events()) await visitor(event);
    },
    close: () => store.close(),
    directory: store.directory,
  };
}

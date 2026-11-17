import "./validators.js"; // 官方 15 变体随本包装载注册进开放注册表（session.md §3）

export { atomicWriteFile } from "./atomic.js";
export { deriveMessages } from "./derive.js";
export { ForkCutOutOfRangeError, type ForkOptions, forkSession } from "./fork.js";
export { acquireSessionLock, type SessionLock, SessionLockedError } from "./lock.js";
export { type SessionPluginOptions, sessionPlugin } from "./plugin.js";
export {
  readSessionFile,
  SessionCorruptError,
  SessionVersionError,
  UnknownEventTypeError,
} from "./reader.js";
export { createSession, type SessionHandle } from "./service.js";
export {
  type CreateSessionOptions,
  type CreateSessionResult,
  EventDataInvalidError,
  NoOpenTurnError,
  SESSION_LOG_FILE,
  SessionStore,
  UnregisteredEventTypeError,
} from "./store.js";
export { overlaps, type ReplaceInterval, readSurfaceOp } from "./surface-op.js";

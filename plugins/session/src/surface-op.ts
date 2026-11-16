// surfaceOp 工具（session.md §4）：写入裁决（store）与派生应用（derive）共用一套判定，
// 禁止两处手抄漂移。

export interface ReplaceInterval {
  op: "replace";
  startSeq: number;
  endSeq: number;
}

export function readSurfaceOp(data: unknown): ReplaceInterval | null {
  if (typeof data !== "object" || data === null) return null;
  const surfaceOp = (data as { surfaceOp?: unknown }).surfaceOp;
  if (typeof surfaceOp !== "object" || surfaceOp === null) return null;
  const candidate = surfaceOp as { op?: unknown; startSeq?: unknown; endSeq?: unknown };
  if (candidate.op !== "replace") return null;
  if (typeof candidate.startSeq !== "number" || typeof candidate.endSeq !== "number") return null;
  return { op: "replace", startSeq: candidate.startSeq, endSeq: candidate.endSeq };
}

/** 区间重叠（闭区间相交）；重叠视为插件 bug——先写入的记录生效 */
export function overlaps(
  accepted: readonly ReplaceInterval[],
  candidate: ReplaceInterval,
): boolean {
  return accepted.some(
    (interval) => candidate.startSeq <= interval.endSeq && interval.startSeq <= candidate.endSeq,
  );
}

// 余量计量器（compaction.md §4.2）：住 loop——谁发请求，谁保证请求装得下（I-14）。
// 公式与估算函数在 protocol（纯函数）；这里只持有会话自校正系数 k、上一请求的估算快照，
// 以及进程内学到的观测上限（静默截断端点 / max_tokens 参数错）。

import {
  type ContextBudget,
  type ContextReading,
  contextBudget,
  type MeasureResult,
  type ModelConfig,
  measureContext,
  nextK,
  type SessionEvent,
  type SurfaceEntry,
  type WireToolSchema,
} from "@henira/protocol";

/** 观测上限住进程内存（按 provider/model，重启重新学）——compaction.md §4.2 */
const observedContextLimits = new Map<string, number>();
const observedOutputLimits = new Map<string, number>();

export function observedContextLimitFor(model: string): number | undefined {
  return observedContextLimits.get(model);
}

export function observedOutputLimitFor(model: string): number | undefined {
  return observedOutputLimits.get(model);
}

function recordLimit(map: Map<string, number>, model: string, limit: number | undefined): void {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return;
  const current = map.get(model);
  if (current === undefined || limit < current) map.set(model, Math.floor(limit));
}

/** 溢出报错自报的上限（取更小值——字典偏保守时不放宽） */
export function recordObservedContextLimit(model: string, limit: number | undefined): void {
  recordLimit(observedContextLimits, model, limit);
}

/** 第③类参数错自报的输出上限（封顶恢复后记录，之后的封顶取三者最小） */
export function recordObservedOutputLimit(model: string, limit: number | undefined): void {
  recordLimit(observedOutputLimits, model, limit);
}

export interface MeterMeasureInput {
  events: readonly SessionEvent[];
  surface: readonly SurfaceEntry[];
  tools: readonly WireToolSchema[];
  modelConfig: ModelConfig;
  /** provider/model（锚点模型比对用） */
  model: string;
}

export interface MeterMeasureResult {
  reading: ContextReading;
  budget: ContextBudget;
  measurement: MeasureResult;
  anchorInput?: number;
  estimateDelta?: number;
}

interface PendingEstimate {
  model: string;
  /** 上次请求前的锚点 input（全量估算时为 undefined） */
  anchorInput?: number;
  /** 上次请求前的估算增量（used − anchor.input；无锚点时 undefined） */
  estimateDelta?: number;
  surfaceGeneration: number;
}

/**
 * 一次运行体内的计量器（loop 每会话一例）。每步请求前 measure()：
 * ① 用当前 k 算读数；② 若上一步的锚点已到手，按「实际增量 ÷ 估算增量」单侧更新 k；
 * ③ 记下本次请求的预估快照，供下一步对比；④ 广播读数。
 */
export class ContextMeter {
  #k = 1;
  #reading: ContextReading | undefined;
  #pending: PendingEstimate | undefined;
  /** 上一次截断嫌疑的读数（连续两次且读数持平才确认观测上限） */
  #suspicion: number | undefined;
  readonly #onReading: (reading: ContextReading) => void;

  constructor(onReading: (reading: ContextReading) => void) {
    this.#onReading = onReading;
  }

  reading(): ContextReading | undefined {
    return this.#reading;
  }

  /** 第③类参数错自报的输出上限（封顶恢复路径调用；进程内共享） */
  recordOutputLimit(model: string, limit: number | undefined): void {
    recordObservedOutputLimit(model, limit);
  }

  /** 溢出报错自报的上限（F-1 回灌；进程内共享） */
  recordContextLimit(model: string, limit: number | undefined): void {
    recordObservedContextLimit(model, limit);
  }

  /** 只读重算（不更新 k / 不写 pending / 不广播）：loop/pre-step 之后按压缩后的表面
   *  重算，输出封顶与下游读数都基于新表面（压缩可能刚把用量降下来） */
  peek(input: MeterMeasureInput): MeterMeasureResult {
    return this.#compute(input);
  }

  /** 广播一次外部重算的读数（压缩后立即刷新余量入口；不参与 k 更新） */
  setReading(reading: ContextReading): void {
    this.#reading = reading;
    this.#onReading(reading);
  }

  measure(input: MeterMeasureInput): MeterMeasureResult {
    const result = this.#compute(input);
    const measurement = result.measurement;

    // k 更新：上一步请求前我们估了 used；这一步的锚点 input 就是实际 prompt。
    // 只在同一模型、表面代次未变、有前后两个锚点时比较增量（估高不下调）。
    const pending = this.#pending;
    if (
      pending !== undefined &&
      measurement.anchor !== undefined &&
      pending.model === input.model &&
      pending.surfaceGeneration === measurement.surfaceGeneration &&
      pending.anchorInput !== undefined &&
      pending.estimateDelta !== undefined
    ) {
      const actual = measurement.anchor.input - pending.anchorInput;
      const expected = pending.estimateDelta;
      // 截断嫌疑（F-13）：读数不涨（新增 ≥200 而增长 ≤64）或增长明显跟不上（预期 ≥2K
      // 而实际不足一半）。单次只提示；连续两次且读数相差 ≤64 才学成观测上限。
      const noGrowth = expected >= 200 && actual <= 64;
      const lag = expected >= 2_000 && actual < expected / 2;
      if (noGrowth || lag) {
        result.reading.suspicion = { expected, actual };
        if (
          this.#suspicion !== undefined &&
          Math.abs(measurement.anchor.input - this.#suspicion) <= 64
        ) {
          recordObservedContextLimit(input.model, measurement.anchor.input);
          this.#suspicion = undefined;
        } else {
          this.#suspicion = measurement.anchor.input;
        }
      } else {
        this.#suspicion = undefined;
        const next = nextK(this.#k, actual, expected);
        if (next !== undefined) this.#k = next;
      }
    } else {
      this.#suspicion = undefined;
    }

    this.#reading = result.reading;
    this.#pending = {
      model: input.model,
      ...(measurement.anchor !== undefined ? { anchorInput: measurement.anchor.input } : {}),
      ...(measurement.estimateDelta !== undefined
        ? { estimateDelta: measurement.estimateDelta }
        : {}),
      surfaceGeneration: measurement.surfaceGeneration,
    };
    this.#onReading(result.reading);
    return result;
  }

  #compute(input: MeterMeasureInput): MeterMeasureResult {
    const budget = contextBudget({
      ...(input.modelConfig.contextWindow !== undefined
        ? { contextWindow: input.modelConfig.contextWindow }
        : {}),
      ...(input.modelConfig.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.modelConfig.maxOutputTokens }
        : {}),
      ...(observedContextLimitFor(input.model) !== undefined
        ? { observedLimit: observedContextLimitFor(input.model) }
        : {}),
      ...(observedOutputLimitFor(input.model) !== undefined
        ? { observedOutputLimit: observedOutputLimitFor(input.model) }
        : {}),
    });
    const measurement: MeasureResult = measureContext({
      events: input.events,
      surface: input.surface,
      tools: input.tools,
      model: input.model,
      budget,
      k: this.#k,
    });
    return {
      reading: measurement.reading,
      budget,
      measurement,
      ...(measurement.anchor !== undefined ? { anchorInput: measurement.anchor.input } : {}),
      ...(measurement.estimateDelta !== undefined
        ? { estimateDelta: measurement.estimateDelta }
        : {}),
    };
  }
}

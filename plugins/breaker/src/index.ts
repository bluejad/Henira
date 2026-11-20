// plugin-breaker：熔断件（D-058 / D-065）——死循环兜底，bail 缝（loop/turn-stopping）的首个生产消费者。
// 无名件（不占槽位）；inject session + config。双机制：
//   ① 回合内提醒：观测 tools/pre-execute（waterfall 透传 next(value)，不否决不截流），
//      连续同形工具调用 ≥ maxRepeatsPerCall → 追加一条 user/message{source:"breaker"} 英文提醒
//      （模型下一步即见、自纠），封顶 maxRemindersPerTurn 条/回合；
//   ② 回合尾否决：计步（bus step/start）+ 记忆本回合重复；loop/turn-stopping（bail）触发且超限 →
//      返回 Veto{by, reason, resume:{prompt}}——loop 注入续跑提示并多跑一步。
// 内核每回合只查一次缝 = 每回合至多一次否决干预。阈值默认必设（D-058），
// settings.plugins.plugin-breaker.options 可配（config.get 读，工厂显式 opts 为嵌入方兜底）。

import type { ServiceDefinition, Veto } from "@henira/kernel";
import { asHeniraContext, type SessionService } from "@henira/protocol";

export interface BreakerOptions {
  /** 单回合步数上限（默认 50；回合尾 veto 的触发线） */
  maxStepsPerTurn?: number;
  /** 同形工具调用重复提醒 / 否决阈值（默认 3） */
  maxRepeatsPerCall?: number;
  /** 每回合提醒行封顶（默认 2） */
  maxRemindersPerTurn?: number;
}

const DEFAULTS: Required<BreakerOptions> = {
  maxStepsPerTurn: 50,
  maxRepeatsPerCall: 3,
  maxRemindersPerTurn: 2,
};

interface TurnStats {
  steps: number;
  currentStep: number;
  lastSig: string | null;
  streak: number;
  maxStreak: number;
  reminders: number;
  vetoed: boolean;
}

/** 稳定序 JSON（键递归排序，总长封顶）——同形调用签名（dsh/ZCode canonical key 同思想） */
function stableKey(value: unknown, depth = 0): string {
  if (depth > 12) return "…";
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableKey(v, depth + 1)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v, depth + 1)}`).join(",")}}`;
}

/** 官方 plugin-breaker 工厂（纯行为件：不占槽位，D-058 形状） */
export function breakerPlugin(options?: BreakerOptions): ServiceDefinition {
  return {
    inject: ["session", "config"],
    async start(ctx) {
      const cx = asHeniraContext(ctx);
      const session = cx.get("session") as SessionService;
      const settings = (await cx.get("config").get<BreakerOptions>("plugin-breaker")) ?? {};
      const limits: Required<BreakerOptions> = {
        ...DEFAULTS,
        ...(options ?? {}),
        ...pickNumbers(settings),
      };

      const turns = new Map<string, TurnStats>();
      let activeTurn: string | null = null;

      const statsFor = (turn: string): TurnStats => {
        let s = turns.get(turn);
        if (s === undefined) {
          // 竞态兜底（step/start 先于 turn/start 观测等）；顺带修剪旧回合
          s = {
            steps: 0,
            currentStep: 0,
            lastSig: null,
            streak: 0,
            maxStreak: 0,
            reminders: 0,
            vetoed: false,
          };
          turns.set(turn, s);
        }
        if (turns.size > 8) {
          for (const key of turns.keys()) {
            if (key !== turn && turns.size > 8) turns.delete(key);
          }
        }
        return s;
      };

      cx.events.on("turn/start", (payload) => {
        const { turn } = payload as { turn: string };
        activeTurn = turn;
        turns.set(turn, {
          steps: 0,
          currentStep: 0,
          lastSig: null,
          streak: 0,
          maxStreak: 0,
          reminders: 0,
          vetoed: false,
        });
        for (const key of turns.keys()) {
          if (key !== turn) turns.delete(key);
        }
      });

      cx.events.on("turn/end", (payload) => {
        const { turn } = payload as { turn: string };
        turns.delete(turn);
        if (activeTurn === turn) activeTurn = null;
      });

      cx.events.on("step/start", (payload) => {
        const { turn, step } = payload as { turn: string; step: number };
        const s = statsFor(turn);
        s.steps += 1;
        s.currentStep = step;
      });

      // 用户插话重置（D-065 决定 6）：连续计数与提醒额清零——用户已介入，给模型重开一次机会；
      // maxStreak（回合尾否决依据）与 steps（回合总预算）保留——插话不洗掉已经跑飞的事实。
      cx.events.on("user/steer", (payload) => {
        const { turn } = payload as { turn: string };
        const s = turns.get(turn);
        if (s === undefined) return;
        s.lastSig = null;
        s.streak = 0;
        s.reminders = 0;
      });

      cx.events.onWaterfall("tools/pre-execute", (value, next) => {
        const v = value as { tool: string; args: unknown; verdict?: string };
        if (activeTurn !== null) {
          const s = turns.get(activeTurn);
          if (s !== undefined) {
            const sig = `${v.tool}::${stableKey(v.args)}`;
            if (sig === s.lastSig) {
              s.streak += 1;
            } else {
              s.lastSig = sig;
              s.streak = 1;
            }
            if (s.streak > s.maxStreak) s.maxStreak = s.streak;
            const fireAt =
              s.streak === limits.maxRepeatsPerCall || s.streak === limits.maxRepeatsPerCall * 2;
            if (fireAt && s.reminders < limits.maxRemindersPerTurn) {
              s.reminders += 1;
              const content =
                `Circuit breaker: the same tool call (${v.tool}) has now been made ${s.streak} times in a row. ` +
                "Break the loop — change the approach, fix the underlying error, or summarize what you have and finish.";
              void session
                .append({
                  type: "user/message",
                  data: { turn: activeTurn, step: s.currentStep, content, source: "breaker" },
                })
                .catch(() => {});
            }
          }
        }
        return next(value); // 透传：观测者不否决不截流（waterfall 不调 next = 短路下游）
      });

      cx.events.onBail("loop/turn-stopping", (payload) => {
        const { turn } = payload as { turn: string };
        const s = turns.get(turn);
        if (s === undefined || s.vetoed) return undefined;
        if (s.steps >= limits.maxStepsPerTurn) {
          s.vetoed = true;
          const veto: Veto = {
            by: "plugin-breaker",
            reason: `step limit: ${s.steps} steps in this turn (limit ${limits.maxStepsPerTurn})`,
            resume: {
              prompt:
                `Circuit breaker: this turn has run ${s.steps} steps (limit ${limits.maxStepsPerTurn}). ` +
                "Wrap up now — summarize the current state and give your final answer instead of continuing.",
            },
          };
          return veto;
        }
        if (s.maxStreak >= limits.maxRepeatsPerCall) {
          s.vetoed = true;
          const veto: Veto = {
            by: "plugin-breaker",
            reason: `the same tool call was repeated ${s.maxStreak} times in this turn (limit ${limits.maxRepeatsPerCall})`,
            resume: {
              prompt:
                `Circuit breaker: the same tool call was repeated ${s.maxStreak} times in this turn. ` +
                "Do not repeat the identical call again — change the approach, fix the underlying error, or summarize and finish.",
            },
          };
          return veto;
        }
        return undefined;
      });
    },
  };
}

function pickNumbers(raw: BreakerOptions): Partial<Record<keyof BreakerOptions, number>> {
  const out: Partial<Record<keyof BreakerOptions, number>> = {};
  for (const key of ["maxStepsPerTurn", "maxRepeatsPerCall", "maxRemindersPerTurn"] as const) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 1) out[key] = Math.floor(v);
  }
  return out;
}

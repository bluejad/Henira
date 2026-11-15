// 装配静态分析：inject 缺失检查（一次报全）+ 依赖环检测 + Kahn 拓扑排序。
// cordis 对缺失依赖静默 PENDING、无环检测（[dsh] vendor/cordis/src/reflect.ts）；
// 我们是静态装配（D-011），start() 一次报全（interfaces.md 四情况表）。

import type { ServiceDefinition } from "./types.js";

export interface DefEntry {
  def: ServiceDefinition;
  owner: string;
}

export interface MissingInject {
  def: string;
  slot: string;
}

/** 插件名：占槽位者用槽位名；匿名件按 use() 顺序编号，报错仍能定位 */
export function ownerNameOf(def: ServiceDefinition, index: number): string {
  return def.name ?? `anonymous#${index + 1}`;
}

/** 缺失 inject 一次报全 + 依赖环路径 */
export function analyze(defs: readonly DefEntry[]): {
  missing: MissingInject[];
  cycles: string[][];
} {
  const bySlot = new Map<string, DefEntry>();
  for (const entry of defs) {
    if (entry.def.name !== undefined) bySlot.set(entry.def.name, entry);
  }
  const missing: MissingInject[] = [];
  for (const entry of defs) {
    for (const slot of entry.def.inject ?? []) {
      if (!bySlot.has(slot)) missing.push({ def: entry.owner, slot });
    }
  }
  return { missing, cycles: findCycles(defs, bySlot) };
}

function findCycles(defs: readonly DefEntry[], bySlot: Map<string, DefEntry>): string[][] {
  // 只看已声明槽位提供者之间的边；DFS 灰节点命中即报一条环路径
  const edges = new Map<string, string[]>();
  for (const entry of defs) {
    if (entry.def.name === undefined) continue;
    const deps = (entry.def.inject ?? [])
      .map((slot) => bySlot.get(slot)?.def.name)
      .filter((name): name is string => name !== undefined);
    edges.set(entry.def.name, deps);
  }
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (name: string): void => {
    const mark = state.get(name);
    if (mark === "done") return;
    if (mark === "visiting") {
      const start = stack.indexOf(name);
      cycles.push([...stack.slice(start), name]);
      return;
    }
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of edges.get(name) ?? []) visit(dep);
    stack.pop();
    state.set(name, "done");
  };
  for (const name of edges.keys()) visit(name);
  return cycles;
}

/** Kahn 拓扑排序：依赖提供者先启；同级按 use() 顺序（先注在前，序稳定） */
export function topoOrder(defs: readonly DefEntry[]): DefEntry[] {
  const bySlot = new Map<string, DefEntry>();
  for (const entry of defs) {
    if (entry.def.name !== undefined) bySlot.set(entry.def.name, entry);
  }
  const indegree = new Map<DefEntry, number>();
  const dependents = new Map<DefEntry, DefEntry[]>();
  for (const entry of defs) {
    const providers = (entry.def.inject ?? [])
      .map((slot) => bySlot.get(slot))
      .filter((p): p is DefEntry => p !== undefined);
    indegree.set(entry, providers.length);
    for (const provider of providers) {
      const list = dependents.get(provider);
      if (list) {
        list.push(entry);
      } else {
        dependents.set(provider, [entry]);
      }
    }
  }
  const queue = defs.filter((entry) => indegree.get(entry) === 0);
  const order: DefEntry[] = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) break;
    order.push(entry);
    for (const dependent of dependents.get(entry) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) queue.push(dependent);
    }
  }
  return order;
}

// plugin-tools 服务件（packages.md：工具定义/注册/五段执行管线，占 'tools' 槽）。
// 两条缝挂在 ctx.events（tools/pre-execute / tools/post-execute，D-027 命名）；
// 判定链经 ToolContext.requestPermission 消费——ToolContext 由 loop 装配（把 approval
// 槽位接进来），本件自身不 inject approval（§1：ToolContext 注入一切依赖）。

import type { ServiceDefinition } from "@henira/kernel";
import type { ToolCall, ToolContext, ToolOutcome, ToolsService } from "@henira/protocol";
import { type PipelineDeps, type PipelineOptions, runBatch, runOne } from "./pipeline.js";
import { ToolRegistry } from "./registry.js";

export interface ToolsPluginOptions extends PipelineOptions {
  /** 工具执行超时（ms）；缺省不设——abort 是唯一取消出口 */
  defaultTimeoutMs?: number;
}

export function toolsPlugin(options: ToolsPluginOptions = {}): ServiceDefinition<ToolsService> {
  return {
    name: "tools",
    start(ctx) {
      const registry = new ToolRegistry();
      const deps: PipelineDeps = {
        registry,
        events: ctx.events,
        limits: options.limits,
        artifactsDir: options.artifactsDir,
        timeoutMs: options.defaultTimeoutMs,
      };
      const service: ToolsService = {
        register: (def) => registry.register(def),
        project: (filter) => registry.project(filter),
        isConcurrencySafe: (name) => registry.resolve(name)?.def.isConcurrencySafe,
        execute: (call: ToolCall, toolCtx: ToolContext): Promise<ToolOutcome> =>
          runOne(call, toolCtx, deps),
        run: (calls, toolCtx) => runBatch(calls, toolCtx, deps),
      };
      return service;
    },
  };
}

// 工具注册表：注册查重 + 装载期 schema 校验（D-044：非法 schema 即抛——装配层捕获后
// 插件跳过 + 告警，D-029）+ 声明式投影。参数运行期校验用同一份编译产物（ajv，draft-07）。

import type { Disposable } from "@henira/kernel";
import type { ToolDefinition, ToolFilter, WireToolSchema } from "@henira/protocol";
import AjvModule from "ajv";

type ValidateArgs = (args: unknown) => boolean;

// NodeNext 下 CJS 模块的 default 显式解出（ajv 的 d.ts 以 export default 声明，运行时 exports.default 在场）
const Ajv = AjvModule.default;

export class DuplicateToolError extends Error {
  constructor(name: string) {
    super(`tool "${name}" is already registered`);
    this.name = "DuplicateToolError";
  }
}

export class InvalidToolSchemaError extends Error {
  constructor(name: string, cause: string) {
    super(`tool "${name}" has an invalid inputSchema: ${cause}`);
    this.name = "InvalidToolSchemaError";
  }
}

interface RegisteredTool {
  def: ToolDefinition;
  validate: ValidateArgs;
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();
  readonly #ajv = new Ajv({ allErrors: true });

  register(def: ToolDefinition): Disposable {
    if (this.#tools.has(def.name)) throw new DuplicateToolError(def.name);
    let validate: ValidateArgs;
    try {
      // 装载期校验 = 编译期校验：schema 非法在这里就炸（调用方是装配层）
      validate = this.#ajv.compile(def.inputSchema) as ValidateArgs;
    } catch (err) {
      throw new InvalidToolSchemaError(def.name, err instanceof Error ? err.message : String(err));
    }
    this.#tools.set(def.name, { def, validate });
    return () => {
      this.#tools.delete(def.name);
    };
  }

  resolve(name: string): RegisteredTool | undefined {
    return this.#tools.get(name);
  }

  project(filter?: ToolFilter): WireToolSchema[] {
    const all = [...this.#tools.values()].map((t) => ({
      name: t.def.name,
      description: t.def.description,
      inputSchema: t.def.inputSchema,
    }));
    if (filter?.include) return all.filter((t) => filter.include?.includes(t.name));
    if (filter?.exclude) return all.filter((t) => !filter.exclude?.includes(t.name));
    return all;
  }
}

export function defineTool(def: ToolDefinition): ToolDefinition {
  return def;
}

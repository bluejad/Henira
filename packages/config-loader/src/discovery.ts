// 插件目录发现与引擎模块装载（plugins.md §2/§3/§5 落码，批 C）：
// 发现 = 纯文件读（scanPlugins，不执行任何插件代码）；装载 = jiti 执行引擎入口
// （loadEngineModule）——宿主传 alias 把 @henira/kernel / @henira/protocol 指到唯一实例
// （§4 硬规矩的 Node 侧等价物，禁插件自带副本）。
// 失败语义一律「跳过 + 告警，不挡启动」（§3 清单坏 / §4 校验表）；本模块不依赖宿主包。

import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

/** 安全段：插件 id / 版本目录名 / 入口路径段（data-directory 实测口径，ASCII 起步） */
const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 清单 ui 段（plugins.md §3：entry 缺省 ui/main.js；title/slots 可选——slots 只做展示校验） */
export interface PluginUiManifest {
  entry: string;
  title?: string;
  slots?: string[];
}

/** 插件清单（plugin.json 解析结果；versionDir 为选中版本目录绝对路径） */
export interface PluginManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  /** 引擎兼容门（§3 顶层 `engines`，2026-11-19 定名——原 `engine` 与段名撞 key） */
  engines?: string;
  ui?: PluginUiManifest;
  engine?: { entry: string };
  versionDir: string;
  warnings: string[];
}

export interface PluginDiscovery {
  /** 每 id 一条 = 选中版本（pin ?? 最高合法版本） */
  plugins: PluginManifest[];
  warnings: string[];
}

/** 版本目录名排序：粗 semver（x.y.z 数字段），解析失败退字典序（版本目录名即版本，D-024） */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] | undefined => {
    const parts = v.split(".");
    const nums: number[] = [];
    for (const part of parts) {
      const m = /^(\d+)/.exec(part);
      if (m === null) return undefined;
      nums.push(Number(m[1]));
    }
    return nums.length > 0 ? nums : undefined;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa === undefined || pb === undefined) return a < b ? -1 : a > b ? 1 : 0;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** 引擎兼容门（§3 `engines` 形如 "^0.1" / "0.1" / "0.1.x" / "*"）：只支持前缀匹配
 * （项目零 semver 依赖；0.1 期的兼容门按 major.minor 前缀判，够用且可解释） */
export function matchesEngineRange(range: string | undefined, version: string): boolean {
  if (range === undefined || range.trim() === "") return true;
  const cleaned = range.trim().replace(/^[\^~=v]+/, "");
  if (cleaned === "*" || cleaned === "x") return true;
  const want = cleaned
    .split(".")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : undefined))
    .filter((n): n is number => n !== undefined);
  if (want.length === 0) return true; // 无法解析 = 不设门
  const have = version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number(/^(\d+)/.exec(part)?.[1] ?? "0"));
  return want.every((n, i) => (have[i] ?? 0) === n);
}

interface RawManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  engines?: unknown;
  ui?: unknown;
  engine?: unknown;
}

/** 单版本目录清单解析：缺省救缺失、写错丢整段（§3）；返回 undefined = 跳过该版本 */
async function readManifest(
  id: string,
  version: string,
  versionDir: string,
  warnings: string[],
): Promise<PluginManifest | undefined> {
  const prefix = `${id}@${version}`;
  let raw: RawManifest;
  try {
    raw = JSON.parse(await fs.readFile(path.join(versionDir, "plugin.json"), "utf8"));
  } catch {
    warnings.push(`${prefix}: plugin.json 缺失或损坏——跳过该版本`);
    return undefined;
  }
  if (raw === null || typeof raw !== "object") {
    warnings.push(`${prefix}: plugin.json 不是对象——跳过该版本`);
    return undefined;
  }
  if (typeof raw.name !== "string" || raw.name === "") {
    warnings.push(`${prefix}: 清单缺少 name（必填）——跳过该版本`);
    return undefined;
  }
  if (raw.name !== id) {
    warnings.push(`${prefix}: name "${raw.name}" 与目录名不一致——跳过该版本`);
    return undefined;
  }
  if (raw.version !== undefined && raw.version !== version) {
    warnings.push(`${prefix}: version "${String(raw.version)}" 与版本目录名不一致——跳过该版本`);
    return undefined;
  }
  const local: string[] = [];
  const manifest: PluginManifest = {
    id,
    version,
    name: raw.name,
    versionDir,
    warnings: [],
  };
  if (typeof raw.description === "string") manifest.description = raw.description;
  if (typeof raw.engines === "string") manifest.engines = raw.engines;
  else if (raw.engines !== undefined) local.push("engines 不是字符串——忽略该字段");
  if (raw.ui !== undefined) {
    const ui = raw.ui as Record<string, unknown>;
    if (ui === null || typeof ui !== "object") {
      local.push("ui 段类型错误——忽略该段");
    } else {
      const entry = typeof ui.entry === "string" && ui.entry !== "" ? ui.entry : "ui/main.js";
      const parsed: PluginUiManifest = { entry };
      if (typeof ui.title === "string") parsed.title = ui.title;
      if (Array.isArray(ui.slots)) {
        const slots = ui.slots.filter((s): s is string => typeof s === "string" && s !== "");
        if (slots.length > 0) parsed.slots = slots;
        if (slots.length !== ui.slots.length) local.push("ui.slots 含非字符串项——已忽略非法项");
      } else if (ui.slots !== undefined) {
        local.push("ui.slots 不是数组——忽略该字段");
      }
      manifest.ui = parsed;
    }
  }
  if (raw.engine !== undefined) {
    const eng = raw.engine as Record<string, unknown>;
    if (eng === null || typeof eng !== "object") {
      local.push("engine 段类型错误——忽略该段");
    } else {
      const entry =
        typeof eng.entry === "string" && eng.entry !== "" ? eng.entry : "engine/main.js";
      manifest.engine = { entry };
    }
  }
  manifest.warnings = local;
  warnings.push(...local.map((w) => `${prefix}: ${w}`));
  return manifest;
}

/**
 * 扫插件根（`~/.henira/plugins`）：每个 id 选一个版本（settings pin ?? 最高合法版本）。
 * 目录不存在 = 没有插件；坏一个不挡其他（§3 :66）。
 */
export async function scanPlugins(
  pluginRoot: string,
  opts?: { pinned?: Readonly<Record<string, string>> },
): Promise<PluginDiscovery> {
  const warnings: string[] = [];
  const plugins: PluginManifest[] = [];
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(pluginRoot)).sort();
  } catch {
    return { plugins, warnings }; // 无插件根 = 空
  }
  for (const id of ids) {
    if (!SAFE_SEG.test(id)) {
      warnings.push(`${id}: 插件 id 非法字符——跳过`);
      continue;
    }
    const idDir = path.join(pluginRoot, id);
    let versions: string[] = [];
    try {
      versions = (await fs.readdir(idDir)).filter((v) => SAFE_SEG.test(v));
    } catch {
      continue; // 不是目录 / 读不了
    }
    if (versions.length === 0) continue;
    // 全版本解析（合法清单才参与选择）：选中版本以外的问题版本也进告警（管理面可见）
    const candidates = new Map<string, PluginManifest>();
    for (const version of versions) {
      const parsed = await readManifest(id, version, path.join(idDir, version), warnings);
      if (parsed !== undefined) candidates.set(version, parsed);
    }
    if (candidates.size === 0) continue;
    const pin = opts?.pinned?.[id];
    let chosen: PluginManifest | undefined;
    if (pin !== undefined) {
      chosen = candidates.get(pin);
      if (chosen === undefined) {
        warnings.push(`${id}: 钉版本 "${pin}" 不存在或清单非法——回落最高版本`);
      }
    }
    if (chosen === undefined) {
      const sorted = [...candidates.keys()].sort(compareVersions);
      chosen = candidates.get(sorted[sorted.length - 1] as string);
    }
    if (chosen !== undefined) plugins.push(chosen);
  }
  return { plugins, warnings };
}

export interface EngineModuleLoad {
  entryPath: string;
  /** 插件定义（ServiceDefinition 形状，宿主转型；形状错 = error） */
  definition?: unknown;
  /** 模块级 `export const inject`（§3 :68——manifest 不复写，单一事实源） */
  inject: string[];
  error?: string;
}

/** 模块缓存：版本目录不可变（D-024）→ 同一入口路径的装载结果可安全复用（跨会话/跨 prepare） */
const moduleCache = new Map<string, EngineModuleLoad>();

/** 违规依赖检查（§4 硬规矩）：engine/ 的标准 Node 包目录里不得出现 @henira/* 依赖 */
async function hasForbiddenDependency(engineDir: string): Promise<string | undefined> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fs.readFile(path.join(engineDir, "package.json"), "utf8"));
  } catch {
    return undefined; // 零依赖单文件 = 合法
  }
  for (const field of ["dependencies", "peerDependencies", "devDependencies"] as const) {
    const deps = raw[field];
    if (deps === null || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      if (name === "@henira/kernel" || name === "@henira/protocol" || name.startsWith("@henira/")) {
        return `${field} 含 ${name}——内核实例禁自带副本（硬规矩）`;
      }
    }
  }
  return undefined;
}

/**
 * 装载引擎入口（§4 engine 行）：jiti 执行 `engine.entry`（缺省 engine/main.js），
 * `alias` 由宿主提供（@henira/kernel / @henira/protocol → 宿主唯一实例路径）。
 * 任何失败 = error（调用方跳过该件 + 告警，不挡启动）。
 */
export async function loadEngineModule(input: {
  versionDir: string;
  entry: string;
  alias: Record<string, string>;
}): Promise<EngineModuleLoad> {
  const { versionDir, entry, alias } = input;
  const entryPath = path.resolve(versionDir, entry);
  const root = path.resolve(versionDir);
  if (!entryPath.startsWith(root + path.sep)) {
    return { entryPath, inject: [], error: "入口路径越出版本目录" };
  }
  const cached = moduleCache.get(entryPath);
  if (cached !== undefined) return cached;
  if (!existsSync(entryPath)) {
    return { entryPath, inject: [], error: `入口不存在：${entry}` };
  }
  const forbidden = await hasForbiddenDependency(path.join(versionDir, "engine"));
  if (forbidden !== undefined) {
    return { entryPath, inject: [], error: forbidden };
  }
  let result: EngineModuleLoad;
  try {
    const jiti = createJiti(import.meta.url, { alias, interopDefault: true });
    const mod = (await jiti.import(entryPath)) as Record<string, unknown>;
    const candidate =
      mod.default !== undefined && typeof mod.default === "object"
        ? (mod.default as Record<string, unknown>)
        : typeof mod.plugin === "object" && mod.plugin !== null
          ? (mod.plugin as Record<string, unknown>)
          : typeof mod.start === "function"
            ? mod
            : undefined;
    if (candidate === undefined || typeof candidate.start !== "function") {
      result = { entryPath, inject: [], error: "模块未导出插件定义（需 start 函数）" };
    } else {
      const declared = Array.isArray(mod.inject)
        ? mod.inject
        : Array.isArray((candidate as { inject?: unknown }).inject)
          ? ((candidate as { inject: unknown[] }).inject as unknown[])
          : [];
      const inject = declared.filter((s): s is string => typeof s === "string" && s !== "");
      result = { entryPath, definition: candidate, inject };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { entryPath, inject: [], error: `装载失败：${message}` };
  }
  if (result.error === undefined) moduleCache.set(entryPath, result); // 成功才缓存（缺依赖重装后可重试）
  return result;
}

/** 内圈槽位（官方五件 + 宿主两件 + mcp 读者，D-064）：注入预检的提供者基座（§4 :96，装配层预检） */
const CORE_SLOTS = [
  "session",
  "tools",
  "llm",
  "approval",
  "loop",
  "interaction",
  "config",
  "mcp",
] as const;

/** settings.plugins.<id> 形状（data-directory §2.3；confirmedVersion = 引擎确认卡记录，批 C；
 *  mcpFingerprint = MCP 变更确认记录，D-030/D-064——指纹不符 = 不 spawn） */
export interface PluginSettingsEntry {
  enabled?: boolean;
  version?: string;
  confirmedVersion?: string;
  mcpFingerprint?: string;
  options?: Record<string, unknown>;
}

/** 管理面可见的单个 MCP server 声明（§6.4 详情；D-030 确认态随指纹） */
export interface McpSlotInfo {
  name: string;
  /** command+args 或 url 的展示串（原始值，未展开模板变量——密钥引用永不展开进读面） */
  target: string;
  confirmed: boolean;
}

/** 单个 MCP server 声明（§4 mcp 槽，D-064）：本模块只读文件——模板变量与 `${credential:}` 展开
 *  由宿主在喂工厂前做（展开值只进内存，永不回读面 / 日志） */
export interface McpServerDecl {
  pluginId: string;
  server: string;
  kind: "stdio" | "remote";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  versionDir: string;
}

/** 管理面 / GET /api/plugins 的每插件状态（plugins.md §5 状态模型） */
export interface PluginState {
  id: string;
  version: string;
  name: string;
  description?: string;
  forms: Array<"engine" | "ui" | "content">;
  enabled: boolean;
  state: "loaded" | "disabled" | "failed" | "awaiting-confirm";
  reason?: string;
  ui?: PluginUiManifest;
  mcp?: McpSlotInfo[];
  /** 当前 mcp 槽指纹（confirm-mcp 端点写回 settings 用；无 mcp 槽 = 缺省） */
  mcpFingerprint?: string;
  inject: string[];
  warnings: string[];
}

export interface PrepareResult {
  /** 每个发现到的插件（含未装载——管理面要显示状态与原因） */
  states: PluginState[];
  /** 可装配的引擎件定义（宿主转型 ServiceDefinition 后 use） */
  definitions: Array<{ id: string; definition: unknown; inject: string[] }>;
  /** 已确认且可连接的 MCP server 声明（宿主喂 plugin-mcp 工厂；D-064） */
  mcpServers: McpServerDecl[];
  warnings: string[];
}

/** 字符串映射（env / headers）：非对象或含非字符串值 = undefined（调用方跳过该 server + 告警） */
function stringMap(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string") return undefined;
    out[k] = v;
  }
  return out;
}

/**
 * mcp 槽扫描（§4 mcp 行 + D-030/D-064）：读 `<versionDir>/mcp/*.json`，坏一个跳过该 server +
 * 告警，不挡其他；指纹 = 目录内全部文件内容 sha1（任何变更即需重新确认）。
 * 声明里保留原始值——模板变量 / `${credential:}` 展开由宿主做。
 */
async function readMcpSlots(input: {
  manifest: PluginManifest;
  fingerprintConfirmed?: string;
  warnings: string[];
}): Promise<{ infos: McpSlotInfo[]; decls: McpServerDecl[]; fingerprint: string }> {
  const { manifest, warnings } = input;
  const mcpDir = path.join(manifest.versionDir, "mcp");
  let files: string[] = [];
  try {
    files = (await fs.readdir(mcpDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { infos: [], decls: [], fingerprint: "" }; // 无 mcp 槽 = 没有该槽位，不告警（§3）
  }
  const prefix0 = `${manifest.id}@${manifest.version}`;
  const entries: Array<{ server: string; raw: string }> = [];
  const hash = createHash("sha1");
  for (const file of files) {
    const server = file.slice(0, -".json".length);
    if (!SAFE_SEG.test(server)) {
      warnings.push(`${prefix0}/${server}: server 名含非法字符——跳过`);
      continue;
    }
    const raw = await fs.readFile(path.join(mcpDir, file), "utf8").catch(() => undefined);
    if (raw === undefined) {
      warnings.push(`${prefix0}/${server}: 声明读取失败——跳过`);
      continue;
    }
    entries.push({ server, raw });
    hash.update(`${server}\u0000${raw}\u0000`);
  }
  const fingerprint = hash.digest("hex");
  const confirmed = input.fingerprintConfirmed === fingerprint;
  const infos: McpSlotInfo[] = [];
  const decls: McpServerDecl[] = [];
  for (const { server, raw } of entries) {
    const prefix = `${prefix0}/${server}`;
    let cfg: unknown;
    try {
      cfg = JSON.parse(raw);
    } catch {
      warnings.push(`${prefix}: JSON 损坏——跳过该 server`);
      continue;
    }
    if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
      warnings.push(`${prefix}: 声明不是对象——跳过该 server`);
      continue;
    }
    const c = cfg as Record<string, unknown>;
    if (c.type === "sse") {
      warnings.push(`${prefix}: type "sse" 暂不支持——跳过该 server（挂账）`);
      continue;
    }
    if (typeof c.command === "string" && c.command !== "") {
      const env = stringMap(c.env);
      if (c.env !== undefined && env === undefined) {
        warnings.push(`${prefix}: env 含非字符串值——跳过该 server`);
        continue;
      }
      const args = Array.isArray(c.args)
        ? c.args.filter((a): a is string => typeof a === "string")
        : [];
      if (Array.isArray(c.args) && args.length !== c.args.length) {
        warnings.push(`${prefix}: args 含非字符串项——已忽略非法项`);
      }
      if (confirmed) {
        // 确认门（D-030 fail-closed）：指纹不符 = 只进读面、不进连接声明
        decls.push({
          pluginId: manifest.id,
          server,
          kind: "stdio",
          command: c.command,
          args,
          env,
          versionDir: manifest.versionDir,
        });
      }
      infos.push({ name: server, target: [c.command, ...args].join(" "), confirmed });
    } else if (typeof c.url === "string" && c.url !== "") {
      const headers = stringMap(c.headers);
      if (c.headers !== undefined && headers === undefined) {
        warnings.push(`${prefix}: headers 含非字符串值——跳过该 server`);
        continue;
      }
      if (confirmed) {
        decls.push({
          pluginId: manifest.id,
          server,
          kind: "remote",
          url: c.url,
          headers,
          versionDir: manifest.versionDir,
        });
      }
      infos.push({ name: server, target: c.url, confirmed });
    } else {
      warnings.push(`${prefix}: command 与 url 至少需要一个——跳过该 server`);
    }
  }
  return { infos, decls, fingerprint };
}

/**
 * 装配前置（§5 装配三步的②+③ + 确认门 + 预检；宿主每次会话装配调用）：
 * 扫描 → settings 过滤（缺省启用）→ engines 兼容门 → 确认门（fail-closed）→
 * 引擎装载 → inject 预检（缺提供者 = 不装载 + 告警）→ mcp 槽扫描（D-064）。
 * 纯配置函数：不依赖任何宿主包；`engineAlias` 由宿主传（@henira/* → 唯一实例路径）。
 */
export async function preparePlugins(opts: {
  pluginRoot: string;
  settings?: { plugins?: Record<string, PluginSettingsEntry> };
  engineAlias: Record<string, string>;
  hostVersion: string;
}): Promise<PrepareResult> {
  const pinned: Record<string, string> = {};
  for (const [id, entry] of Object.entries(opts.settings?.plugins ?? {})) {
    if (entry.version !== undefined) pinned[id] = entry.version;
  }
  const discovery = await scanPlugins(opts.pluginRoot, { pinned });
  const warnings = [...discovery.warnings];
  const states: PluginState[] = [];
  const loaded: Array<{ id: string; definition: unknown; inject: string[]; name?: string }> = [];
  const mcpPending: Array<{ pluginId: string; decls: McpServerDecl[] }> = [];
  for (const manifest of discovery.plugins) {
    const pref = opts.settings?.plugins?.[manifest.id];
    const enabled = pref?.enabled !== false;
    const forms: PluginState["forms"] = [];
    if (manifest.engine !== undefined) forms.push("engine");
    if (manifest.ui !== undefined) forms.push("ui");
    if (forms.length === 0) forms.push("content");
    const state: PluginState = {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      forms,
      enabled,
      state: "loaded",
      inject: [],
      warnings: manifest.warnings,
    };
    if (manifest.description !== undefined) state.description = manifest.description;
    if (manifest.ui !== undefined) state.ui = manifest.ui;
    warnings.push(...manifest.warnings.map((w) => `${manifest.id}@${manifest.version}: ${w}`));
    // mcp 槽（读面与声明；D-064）：声明只在「启用且引擎语义通过」时收集——插件整体
    // disabled / awaiting-confirm / failed 时 MCP 一并不连接（fail-closed）
    const mcp = await readMcpSlots({
      manifest,
      fingerprintConfirmed: pref?.mcpFingerprint,
      warnings,
    });
    if (mcp.infos.length > 0) {
      state.mcp = mcp.infos;
      state.mcpFingerprint = mcp.fingerprint;
    }
    let mcpAllowed = enabled;
    if (!enabled) {
      state.state = "disabled";
      states.push(state);
      continue;
    }
    if (manifest.engine !== undefined) {
      if (!matchesEngineRange(manifest.engines, opts.hostVersion)) {
        state.state = "failed";
        state.reason = `引擎版本不兼容（requires ${String(manifest.engines)}，host ${opts.hostVersion}）`;
        warnings.push(`${manifest.id}: ${state.reason}——跳过`);
        mcpAllowed = false;
      } else if (pref?.confirmedVersion !== manifest.version) {
        state.state = "awaiting-confirm";
        state.reason = "待确认卡放行（引擎代码首次生效 / 版本升级）";
        mcpAllowed = false;
      } else {
        const load = await loadEngineModule({
          versionDir: manifest.versionDir,
          entry: manifest.engine.entry,
          alias: opts.engineAlias,
        });
        if (load.error !== undefined || load.definition === undefined) {
          state.state = "failed";
          state.reason = load.error ?? "装载失败";
          warnings.push(`${manifest.id}: ${state.reason}——跳过`);
          mcpAllowed = false;
        } else {
          state.inject = load.inject;
          loaded.push({
            id: manifest.id,
            definition: load.definition,
            inject: load.inject,
            name: (load.definition as { name?: string }).name,
          });
        }
      }
    }
    if (mcpAllowed && mcp.decls.length > 0)
      mcpPending.push({ pluginId: manifest.id, decls: mcp.decls });
    states.push(state);
  }
  // inject 预检（§4 :96）：提供者 = 内圈槽 + 本批装载件的槽名；缺提供者 = 不装载 + 告警
  const providers = new Set<string>(CORE_SLOTS);
  for (const item of loaded) if (item.name !== undefined) providers.add(item.name);
  const definitions: PrepareResult["definitions"] = [];
  for (const item of loaded) {
    const missing = item.inject.filter((slot) => !providers.has(slot));
    if (missing.length > 0) {
      const state = states.find((s) => s.id === item.id);
      if (state !== undefined) {
        state.state = "failed";
        state.reason = `注入的服务无提供者：${missing.join(", ")}`;
      }
      warnings.push(`${item.id}: ${state?.reason ?? "注入预检失败"}——跳过`);
      continue;
    }
    definitions.push({ id: item.id, definition: item.definition, inject: item.inject });
  }
  // mcp server 名去重（D-032 同层：id 字典序赢 + 告警；discovery.plugins 已按 id 排序）
  const mcpServers: McpServerDecl[] = [];
  const seenServers = new Set<string>();
  for (const { decls } of mcpPending) {
    for (const decl of decls) {
      if (seenServers.has(decl.server)) {
        warnings.push(
          `${decl.pluginId}/${decl.server}: server 名已被其他插件占用——跳过（同名先到先得）`,
        );
        continue;
      }
      seenServers.add(decl.server);
      mcpServers.push(decl);
    }
  }
  return { states, definitions, mcpServers, warnings };
}

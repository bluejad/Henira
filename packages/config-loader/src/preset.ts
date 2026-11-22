// 官方默认预设（出厂清单，D-016）：无 config 文件时的装配来源。
// M2 = 引擎 5 条 id-only（definition 由宿主 / examples 在装配时注入运行参数——会话目录
// 每会话不同，静态清单无法携带）；M3 起清单条目可带 definition（interfaces.md config-loader
// 段定稿形状）——宿主 / cli 经 loadConfig 读出后喂 createHarness（D-016① 加法）。
// 想基于默认改 = import 后 spread（D-022：TS 表达式即补丁）。

import type { ServiceDefinition } from "@henira/kernel";

export interface PluginEntry {
  id: string;
  /** 引擎插件装配物；纯内容包条目省略（不占槽位，由读者扫目录） */
  definition?: ServiceDefinition<unknown>;
  options?: Record<string, unknown>;
}

export const defaultPreset: PluginEntry[] = [
  { id: "plugin-session" },
  { id: "plugin-llm" },
  { id: "plugin-tools" },
  { id: "plugin-approval" },
  { id: "plugin-loop" },
  // fs / shell 能力族（D-065，批 B）：服务件 + 工具件——可停用（停 fs 服务 → 工具件全体
  // 缺席 + 告警，D-049 装配层预检）；官方 npm 包无盘上目录，不可卸载天然成立
  { id: "plugin-fs" },
  { id: "plugin-fs-tools" },
  { id: "plugin-fs-search" },
  { id: "plugin-shell" },
  { id: "plugin-shell-tools" },
  // 熔断件（D-058 / D-065）：无名行为件——死循环兜底，v0.1.0 默认装配
  { id: "plugin-breaker" },
  // 提问件（R184）：ask_user 工具——模型执行中向用户要信息；可停用（settings.plugins），
  // 官方 npm 包无盘上目录不可卸载
  { id: "plugin-ask-user" },
  // MCP 读者（D-064，C5）：外圈官方件——可停用（settings.plugins["plugin-mcp"].enabled:false），
  // 不可卸载（官方 npm 包无盘上目录，卸载端点天然 404）；无 mcp 槽位时零开销
  { id: "plugin-mcp" },
];

/** 官方随包技能目录清单（D-026；官方技能随 M6 plugin-skills 落地，此前为空） */
export const bundledSkillDirs: string[] = [];

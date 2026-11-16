// 官方默认预设（出厂清单，D-016）：无 config 文件时的装配来源。
// M2 = 引擎 5 条 id-only（definition 由宿主 / examples 在装配时注入运行参数——会话目录
// 每会话不同，静态清单无法携带）；M3 cli / server 扩全 21 条并接 definition 工厂。
// 想基于默认改 = import 后 spread（D-022：TS 表达式即补丁）。

export interface PluginEntry {
  id: string;
  options?: Record<string, unknown>;
}

export const defaultPreset: PluginEntry[] = [
  { id: "plugin-session" },
  { id: "plugin-llm" },
  { id: "plugin-tools" },
  { id: "plugin-approval" },
  { id: "plugin-loop" },
];

/** 官方随包技能目录清单（D-026；官方技能随 M6 plugin-skills 落地，此前为空） */
export const bundledSkillDirs: string[] = [];

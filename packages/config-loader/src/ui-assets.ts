// 界面资产扫描（D-059 语言包/主题包读者的唯一数据源实现——server 端点与 sdk runtime 共用，
// P9-5 不两处手抄）：扫用户级已装插件目录（`~/.henira/plugins`）的 locales/*.json + themes/*.css。
// 根参 = 插件根目录本身（data-directory §2:61 口径，批 C 修正——原实参 globalDir 内部拼
// "plugins" 导致默认扫到 config/plugins）；项目级资产包随装配②进扫描面；本版仅用户级。
// 损坏名（路径穿越/非法字符）跳过不抛——资产是内容，坏一个不挡启动。

import { promises as fs } from "node:fs";
import path from "node:path";

export interface UiAssetLocale {
  pluginId: string;
  version: string;
  /** 语言 id = 文件名去 .json（如 ja） */
  lang: string;
  /** 宿主资产路由（server: /api/ui-assets/:id/:version/:kind/:file） */
  url: string;
}

export interface UiAssetTheme {
  pluginId: string;
  version: string;
  /** 主题 id = 文件名去 .css */
  name: string;
  url: string;
}

export interface UiAssets {
  locales: UiAssetLocale[];
  themes: UiAssetTheme[];
}

const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function scanUiAssets(pluginRoot: string): Promise<UiAssets> {
  const out: UiAssets = { locales: [], themes: [] };
  const pluginsDir = pluginRoot;
  let ids: string[];
  try {
    ids = await fs.readdir(pluginsDir);
  } catch {
    return out; // 无已装插件目录 = 空表
  }
  for (const id of ids.sort()) {
    if (!SAFE_SEG.test(id)) continue;
    const idDir = path.join(pluginsDir, id);
    let versions: string[];
    try {
      versions = await fs.readdir(idDir);
    } catch {
      continue;
    }
    for (const version of versions.sort()) {
      if (!SAFE_SEG.test(version)) continue;
      const versionDir = path.join(idDir, version);
      const localesDir = path.join(versionDir, "locales");
      try {
        for (const file of (await fs.readdir(localesDir)).sort()) {
          if (!file.endsWith(".json")) continue;
          const lang = file.slice(0, -5);
          if (!SAFE_SEG.test(lang)) continue;
          out.locales.push({
            pluginId: id,
            version,
            lang,
            url: `/api/ui-assets/${id}/${version}/locales/${file}`,
          });
        }
      } catch {
        // 无 locales 目录 = 没有该槽位
      }
      const themesDir = path.join(versionDir, "themes");
      try {
        for (const file of (await fs.readdir(themesDir)).sort()) {
          if (!file.endsWith(".css")) continue;
          const name = file.slice(0, -4);
          if (!SAFE_SEG.test(name)) continue;
          out.themes.push({
            pluginId: id,
            version,
            name,
            url: `/api/ui-assets/${id}/${version}/themes/${file}`,
          });
        }
      } catch {
        // 无 themes 目录 = 没有该槽位
      }
    }
  }
  return out;
}

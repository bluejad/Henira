// 语言页（R177 拆分）：官方 zh + 已装语言包。
import { type ReactNode, useState } from "react";
import type { UiAssetLocale, WebPartContext } from "../../types.js";
import { HeniraSelect } from "../dropdown.js";

// ── 语言页：官方 zh + 已装语言包（fetch 字典交宿主覆盖，D-059 缺 key 回落官方）──

function LocalePage(props: { ctx: WebPartContext; locales: UiAssetLocale[] }): ReactNode {
  const { ctx } = props;
  // 显示实际生效语言（宿主 ctx.locale——boot 已按磁盘还原过）：包卸载/字典损坏 boot 回落
  // 官方后这里跟手，不再读磁盘旧值漂移显示（改前读 getSettings 与生效脱节，审查 P3-b）；
  // 缺席（旧宿主）= 官方 zh
  const [localeId, setLocaleId] = useState(ctx.locale ?? "zh");

  const changeLocale = (lang: string): void => {
    if (lang === "zh") {
      setLocaleId("zh");
      ctx.onLocale?.(undefined, "zh"); // 官方 zh = 无覆盖字典
      // 持久化（与主题同款两处断头的另一半）：settings.json ui.locale
      void ctx.client.putSettings?.({ ui: { locale: "zh" } }).catch(() => {});
      return;
    }
    const url = props.locales.find((l) => l.lang === lang)?.url;
    if (url === undefined) return; // 选项本就来自资产清单——防御性兜底
    // 字典 fetch 成功才应用+落盘——失败/空字典不应用不落盘，不留下「装不上的语言」
    //（改前先 setLocaleId+落盘再 fetch，失败后显示与磁盘都漂移，审查 P3-b）
    void fetch(url)
      .then((r) => r.json())
      .then((dict: Record<string, string>) => {
        if (Object.keys(dict).length === 0) return;
        setLocaleId(lang);
        ctx.onLocale?.(dict, lang);
        void ctx.client.putSettings?.({ ui: { locale: lang } }).catch(() => {});
      })
      .catch(() => {});
  };

  return (
    <div className="henira-dialog-field">
      <div className="henira-field-label">{ctx.t("settings.locale")}</div>
      <HeniraSelect
        variant="input"
        ariaLabel={ctx.t("settings.locale")}
        value={localeId}
        options={[
          { value: "zh", label: ctx.t("settings.locale.zh") },
          ...props.locales.map((locale) => ({ value: locale.lang, label: locale.lang })),
        ]}
        onChange={(lang) => {
          changeLocale(lang);
        }}
      />
    </div>
  );
}

export { LocalePage };

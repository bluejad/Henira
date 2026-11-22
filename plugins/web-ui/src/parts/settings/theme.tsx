// 主题页（R177 拆分）：官方 light/dark + 已装主题包。
import type { ReactNode } from "react";
import type { UiAssetTheme, WebPartContext } from "../../types.js";
import { HeniraSelect } from "../dropdown.js";

// ── 主题页：官方 light/dark + 已装主题包（选择即宿主切 data-theme + <link> 注入，D-059）──

function ThemePage(props: { ctx: WebPartContext; themes: UiAssetTheme[] }): ReactNode {
  const { ctx } = props;
  // div 非 label：HeniraSelect 是自制弹层（无原生控件可关联，label 会吃 a11y 闸）；
  // 可访问名由触发钮 aria-label 自带
  return (
    <div className="henira-dialog-field">
      <div className="henira-field-label">{ctx.t("settings.theme")}</div>
      <HeniraSelect
        variant="input"
        ariaLabel={ctx.t("settings.theme")}
        value={ctx.theme}
        options={[
          { value: "light", label: ctx.t("settings.theme.light") },
          { value: "dark", label: ctx.t("settings.theme.dark") },
          ...props.themes.map((theme) => ({ value: theme.name, label: theme.name })),
        ]}
        onChange={(id) => {
          ctx.onTheme?.(id, props.themes.find((t) => t.name === id)?.url);
          // 持久化（用户反馈：选深色刷新回落亮色——改前只切内存不落盘）：settings.json
          // ui.theme；旧服务器无 putSettings 静默跳过
          void ctx.client.putSettings?.({ ui: { theme: id } }).catch(() => {});
        }}
      />
    </div>
  );
}

export { ThemePage };

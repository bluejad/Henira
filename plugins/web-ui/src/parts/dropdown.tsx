// 统一下拉弹层基础件（基础件批 2026-11-20）：原生 <select> 系统菜单与界面是两套视觉语言
//（白底蓝高亮直角——用户实拍最丑断点），本件收编全包三处（思考档 / 设置主题 / 设置语言）。
// 受控单选：value/options/onChange；触发钮 ghost 形态（工具排），variant="input" 配表单
// 字段（henira-input 同款）。弹层 = .henira-pop 通用面板；direction 缺省 auto（触发钮
// getBoundingClientRect 判视口上下半定弹向——一次性判断，不引定位库不引 portal，挂账）。
// 键盘：↑↓/Home/End 移动 + Enter 选中 + Esc/外点收（aria-activedescendant + role=listbox）。
// useDismiss 是全包浮层「外点/Esc 收」的统一出口（model-select/right-panel 同行为原各写
// 一份、监听 host 还不一致——本 hook 收敛，后续浮层一律走它）。

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { CaretDownGlyph } from "./icons.js";

export interface HeniraSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * 浮层开关行为：open 期间挂 document mousedown（外点收）+ keydown（Escape 收）。
 * onClose 走 latest-ref——effect 只依赖 [open, ref]，消费方传内联箭头不重挂监听。
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    // capture：Esc 只收最上层浮层——设置弹窗/全屏预览等外层也监听 document，
    // 冒泡阶段会被一并触发（R199 项目选择器实测：Esc 连设置弹窗一起关）。
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref]);
}

export function HeniraSelect(props: {
  value: string;
  options: readonly HeniraSelectOption[];
  onChange(value: string): void;
  ariaLabel: string;
  disabled?: boolean;
  /** 触发钮形态：缺省 ghost（工具排）；"input" 配表单字段 */
  variant?: "ghost" | "input";
  /** 弹向：缺省 auto（视口下半向上弹）；可钉死 up/down */
  direction?: "up" | "down" | "auto";
}): ReactNode {
  const { value, options, onChange, ariaLabel, disabled = false } = props;
  const variant = props.variant ?? "ghost";
  const [open, setOpen] = useState(false);
  const [popDirection, setPopDirection] = useState<"up" | "down">("down");
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useDismiss(open, wrapRef, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  const selected = options.find((o) => o.value === value);
  const selectable = options.filter((o) => o.disabled !== true);

  const openPop = (): void => {
    let dir: "up" | "down" = "down";
    if ((props.direction ?? "auto") === "auto") {
      const rect = triggerRef.current?.getBoundingClientRect();
      dir = rect !== undefined && rect.top > window.innerHeight / 2 ? "up" : "down";
    } else {
      dir = (props.direction ?? "down") as "up" | "down";
    }
    setPopDirection(dir);
    setActiveIndex(
      Math.max(
        options.findIndex((o) => o.value === value),
        0,
      ),
    );
    setOpen(true);
  };

  const move = (next: number): void => {
    if (selectable.length === 0) return;
    const clamped = Math.min(selectable.length - 1, Math.max(0, next));
    const target = selectable[clamped];
    setActiveIndex(options.indexOf(target));
  };

  const commit = (option: HeniraSelectOption | undefined): void => {
    if (option === undefined || option.disabled === true) return;
    setOpen(false);
    onChange(option.value);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        openPop();
      }
      return;
    }
    const current =
      activeIndex >= 0 && options[activeIndex] !== undefined
        ? selectable.indexOf(options[activeIndex])
        : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(current < 0 ? 0 : current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(current < 0 ? selectable.length - 1 : current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(selectable.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(options[activeIndex]);
    }
  };

  // 键盘活动项滚进可视区（listbox 溢出滚动时跟随）
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = popRef.current?.querySelectorAll("[role='option']")[activeIndex];
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  return (
    <span
      className={variant === "input" ? "henira-select henira-select--input" : "henira-select"}
      ref={wrapRef}
    >
      <button
        type="button"
        ref={triggerRef}
        className="henira-select-trigger"
        aria-label={ariaLabel}
        title={selected?.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openPop();
        }}
        onKeyDown={onKeyDown}
      >
        <span className="henira-select-trigger-label">{selected?.label ?? ""}</span>
        <CaretDownGlyph size={10} />
      </button>
      {open ? (
        <span
          className="henira-pop henira-select-pop"
          data-direction={popDirection}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeIndex >= 0 ? `${uid}-opt-${activeIndex}` : undefined}
          tabIndex={-1}
          ref={popRef}
        >
          {options.map((option, i) => (
            <button
              key={option.value}
              type="button"
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled === true}
              className="henira-pop-item"
              title={option.label}
              data-active={option.value === value ? "true" : undefined}
              data-kbd={i === activeIndex ? "true" : undefined}
              onMouseDown={(e) => {
                e.preventDefault(); // 触发钮失焦先于 click——保住焦点链
              }}
              onClick={() => {
                commit(option);
              }}
            >
              {option.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

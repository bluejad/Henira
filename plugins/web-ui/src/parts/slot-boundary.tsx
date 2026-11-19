// 槽件渲染隔离（批 C，dsh 的「abdicate」行为层）：第三方件渲染崩溃只退出该件，
// 不白屏整个界面——每个槽件各自一个 boundary，崩溃件渲染 null，其余件与官方区域照常。
// 官方件同样包在 boundary 里（同一条渲染路径，无特权；官方件崩溃也隔离）。
// 记日志不上报（UI 不是安全边界，host 无网络面）。

import { Component, type ReactNode } from "react";

interface SlotBoundaryProps {
  children: ReactNode;
  /** 崩溃标签（槽名 / 件名）——日志定位用 */
  label?: string;
}

interface SlotBoundaryState {
  crashed: boolean;
}

export class SlotBoundary extends Component<SlotBoundaryProps, SlotBoundaryState> {
  override state: SlotBoundaryState = { crashed: false };

  static getDerivedStateFromError(): SlotBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.warn(`[henira] slot part render crashed (isolated) ${this.props.label ?? ""}:`, error);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

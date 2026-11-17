// 图标收口（interfaces.md web 段视觉语言节：库可换——换集只动本文件）。
// phosphor 子路径导入（包根星号图在 2.1.1 不出 *Icon 主名）；显式六组件——不用动态注册表，
// 组件名避开 phosphor 导出的 Icon 类型名。换图标集 = 重写本文件的六个小函数。

import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";

type Props = { size?: number; color?: string };

export function CheckGlyph(props: Props) {
  return <CheckCircleIcon size={props.size ?? 14} color={props.color} />;
}

export function SpinnerGlyph(props: Props) {
  return <CircleNotchIcon size={props.size ?? 14} color={props.color} />;
}

export function WarnGlyph(props: Props) {
  return <WarningIcon size={props.size ?? 14} color={props.color} />;
}

export function XGlyph(props: Props) {
  return <XIcon size={props.size ?? 14} color={props.color} />;
}

export function SendGlyph(props: Props) {
  return <ArrowUpIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function StopGlyph(props: Props) {
  return <StopIcon size={props.size ?? 14} color={props.color} weight="fill" />;
}

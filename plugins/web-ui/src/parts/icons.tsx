// 图标收口（interfaces.md web 段视觉语言节：库可换——换集只动本文件）。
// phosphor 子路径导入（包根星号图在 2.1.1 不出 *Icon 主名）；显式组件清单——不用动态注册表，
// 组件名避开 phosphor 导出的 Icon 类型名。换图标集 = 重写本文件的小函数。
// 字重规范（基础件批 2026-11-20）：UI chrome 静态图标默认 bold——regular 细笔画在 ≤14px
// 操作钮尺寸下糊成「小点/空方块」（用户实拍根因）；品牌 Horse 用 fill、发送/停止等强调钮
// 沿用 bold/fill、Spinner 保持 regular（运动可读性优先于笔画力度）。

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowLineUpIcon } from "@phosphor-icons/react/dist/csr/ArrowLineUp";
import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { HorseIcon } from "@phosphor-icons/react/dist/csr/Horse";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PencilIcon } from "@phosphor-icons/react/dist/csr/Pencil";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { TerminalIcon } from "@phosphor-icons/react/dist/csr/Terminal";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

type Props = { size?: number; color?: string };

export function ArrowsInGlyph(props: Props) {
  return <ArrowsInIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function ArrowsOutGlyph(props: Props) {
  return <ArrowsOutIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 回底钮（R195）：输入框上方居中悬浮的圆图标钮，无可见文字 */
export function ArrowDownGlyph(props: Props) {
  return <ArrowDownIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

/** 侧栏开合（R194）：左/右各用一份，右侧镜像同一图标 */
export function SidebarGlyph(props: Props & { side?: "left" | "right" }) {
  return (
    <SidebarSimpleIcon
      size={props.size ?? 14}
      color={props.color}
      weight="bold"
      style={props.side === "right" ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

export function CaretDownGlyph(props: Props) {
  return <CaretDownIcon size={props.size ?? 12} color={props.color} weight="bold" />;
}

export function GearGlyph(props: Props) {
  return <GearSixIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

/** 品牌图标（Henira 词源 ἡνία「缰绳」——马具点题） */
export function HorseGlyph(props: Props) {
  return <HorseIcon size={props.size ?? 16} color={props.color} weight="fill" />;
}

export function MagnifierGlyph(props: Props) {
  return <MagnifyingGlassIcon size={props.size ?? 13} color={props.color} weight="bold" />;
}

export function PlusGlyph(props: Props) {
  return <PlusIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function BrainGlyph(props: Props) {
  return <BrainIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 提问工具行图标（R184：ask_user 身份——与状态语义无关） */
export function QuestionGlyph(props: Props) {
  return <QuestionIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function CaretGlyph(props: Props) {
  return <CaretRightIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 左向箭头（多题提问卡「上一题」——右向 CaretGlyph 不得复用） */
export function CaretLeftGlyph(props: Props) {
  return <CaretLeftIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function CheckGlyph(props: Props) {
  return <CheckCircleIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function SpinnerGlyph(props: Props) {
  return <CircleNotchIcon size={props.size ?? 14} color={props.color} />;
}

/** 代码块伪文件名文件图标（E4 头部条——语言串按文件名样式显示的视觉锚） */
export function CodeGlyph(props: Props) {
  return <FileCodeIcon size={props.size ?? 12} color={props.color} weight="bold" />;
}

export function WarnGlyph(props: Props) {
  return <WarningIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function XGlyph(props: Props) {
  return <XIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function SendGlyph(props: Props) {
  return <ArrowUpIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function StopGlyph(props: Props) {
  return <StopIcon size={props.size ?? 14} color={props.color} weight="fill" />;
}

export function SendNowGlyph(props: Props) {
  return <ArrowLineUpIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

export function PencilGlyph(props: Props) {
  return <PencilIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 终端工具行图标（bash/powershell） */
export function TerminalGlyph(props: Props) {
  return <TerminalIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

/** MCP 工具行图标 */
export function PlugGlyph(props: Props) {
  return <PlugIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

/** 兜底工具行图标（第三方/未知工具） */
export function WrenchGlyph(props: Props) {
  return <WrenchIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

/** 目录图标（中列 header 当前工作目录） */
export function FolderGlyph(props: Props) {
  return <FolderIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 图片预览 tab 图标 */
export function ImageGlyph(props: Props) {
  return <ImageIcon size={props.size ?? 14} color={props.color} weight="bold" />;
}

/** 文件 chip 图标（读/编辑/写入的文件名前置） */
export function FileGlyph(props: Props) {
  return <FileTextIcon size={props.size ?? 16} color={props.color} weight="bold" />;
}

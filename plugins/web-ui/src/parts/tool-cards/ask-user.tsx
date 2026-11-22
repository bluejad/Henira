// ask_user 痕迹卡（R184，keyed 缝 tool.call.view.ask_user）：挂起 = 「提问中」单行；答复后展开
// 逐题问答对（question + Answer 同源 QuestionAnswers）；取消 = 「已取消」。数据源 = 工具行
// input（模型原始题面）与 output.meta（工具返回的结构化问答；kind 标记 ask_user——与
// ToolRowOutput.meta 开放词表约定一致）。meta 校验不过/旧账本无 meta → 回落通用工具卡
// （宁缺毋滥：不猜形状，不硬解析模型文本）。

import type { QuestionAnswer, QuestionSpec } from "@henira/protocol";
import { QuestionAnswers } from "../question-card.js";
import { DisclosureRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { ToolView } from "./fallback.js";
import type { CardProps } from "./shell.js";

interface AskUserMeta {
  questions: QuestionSpec[];
  answers?: QuestionAnswer[];
  cancelled?: boolean;
}

function isQuestionSpec(value: unknown): value is QuestionSpec {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Record<string, unknown>;
  return typeof q.id === "string" && typeof q.question === "string";
}

function readQuestions(value: unknown): QuestionSpec[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isQuestionSpec)) return null;
  return value as QuestionSpec[];
}

function readMeta(meta: Record<string, unknown> | undefined): AskUserMeta | null {
  if (meta === undefined || meta.kind !== "ask_user") return null;
  const questions = readQuestions(meta.questions);
  if (questions === null) return null;
  const answers = Array.isArray(meta.answers)
    ? (meta.answers.filter(
        (a): a is QuestionAnswer =>
          typeof a === "object" &&
          a !== null &&
          typeof (a as { id?: unknown }).id === "string" &&
          Array.isArray((a as { selected?: unknown }).selected),
      ) as QuestionAnswer[])
    : undefined;
  return {
    questions,
    ...(answers !== undefined ? { answers } : {}),
    ...(meta.cancelled === true ? { cancelled: true } : {}),
  };
}

/** 挂起态的题面：input 是模型原始 args（JSON 文本）；解析失败返回 null */
function readInputQuestions(input: string): QuestionSpec[] | null {
  try {
    const parsed = JSON.parse(input) as { questions?: unknown };
    return readQuestions(parsed.questions);
  } catch {
    return null;
  }
}

export function AskUserCard({ row, ctx }: CardProps): React.ReactNode {
  const meta = readMeta(row.output?.meta);
  const questions = meta?.questions ?? readInputQuestions(row.input);
  const running = row.status === "running";
  // 形状不认识且已结束 → 通用卡兜底（旧账本 / 顶替件遗留行）
  if (questions === null && !running) return <ToolView row={row} ctx={ctx} />;
  const cancelled = meta?.cancelled === true;
  // 折叠摘要 = 题数（ZCode「{count} questions」同款）——题面正文在展开体里，不在行尾重复
  const summary =
    questions !== null && questions.length > 0
      ? ctx.t("question.askingCount").replace("{count}", String(questions.length))
      : null;
  return (
    <DisclosureRow
      icon={toolGlyph(row.name)}
      title={ctx.t(
        running ? "question.asking" : cancelled ? "question.cancelled" : "question.asked",
      )}
      busy={running}
      summary={summary}
      rowTitle={`${row.name} · ${row.callId}`}
      tone={cancelled ? "var(--henira-warn-text)" : undefined}
      initialOpen={!running}
      expandable={meta?.answers !== undefined}
    >
      {meta?.answers !== undefined ? (
        <QuestionAnswers questions={meta.questions} answers={meta.answers} ctx={ctx} />
      ) : null}
    </DisclosureRow>
  );
}

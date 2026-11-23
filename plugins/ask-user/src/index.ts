// plugin-ask-user（R184）：官方引擎插件——模型执行中向用户提问的专用工具。
// 机制照 dsh 的 ask_user_question 行为层：这是普通工具调用，execute 一直 await 到用户答复；
// 答复就是工具结果（不经审批通道、不折回 modifiedInput）。提问与审批是两个产品概念——
// 权限请求是闭合裁决，澄清表单是自由输入；复用审批会压扁语义且把「提问」变成「先审批再提问」。
// 审计对：question/asked + question/settled 经 session 槽落盘（投影出挂起卡与痕迹行）；
// 挂起与收答经 interaction 槽（kind:"question"），宿主实现（server REST / sdk 嵌入方）。
// 取消语义（dsh ASK_CANCELLED 行为层）：用户取消 / 回合 abort / 交互服务缺席 → 工具收
// Error 结果（回合继续，模型自行判断或重问）；无墙钟自动收口——重启由 session repair 收口。
// isConcurrencySafe：工具无副作用且必须绕过审批默认链——否则提问前先弹审批卡（dsh 同层：
// 提问不走审批）。

import { randomUUID } from "node:crypto";
import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  QUESTION_CUSTOM_MAX,
  type QuestionAnswer,
  type QuestionInteractionAnswer,
  type QuestionSpec,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "@henira/protocol";

export const ASK_USER_TOOL_NAME = "ask_user";

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MAX_HEADER_CHARS = 12;

/** 模型可见工具描述（英文——代码内字符串不进 zh 词表；行为照 ZCode schema 说明） */
const DESCRIPTION = [
  "Ask the user questions during a task and wait for their answers.",
  "Use it when you genuinely need a decision or preference from the user and cannot proceed safely on an assumption.",
  "Each question must be a complete question ending with a question mark; header is a very short chip label (max 12 characters).",
  "Provide 2-4 options with 1-5 word labels and optional one-sentence descriptions.",
  "Do NOT include an Other/custom option: the client always offers a free-text input row automatically.",
  "Set multiSelect: true when more than one option may be chosen.",
  "Users may skip questions or cancel the whole request; continue with your best judgment in that case.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      description: "Questions to ask the user (1-4 questions).",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, description: "Stable id for this question." },
          question: {
            type: "string",
            minLength: 1,
            description: "The complete question to ask the user; end with a question mark.",
          },
          header: {
            type: "string",
            minLength: 1,
            maxLength: MAX_HEADER_CHARS,
            description: "Very short label displayed as a chip/tag (max 12 characters).",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: MAX_OPTIONS,
            description: "2-4 options. Omit for a free-text-only question.",
            items: {
              type: "object",
              properties: {
                label: { type: "string", minLength: 1, description: "1-5 words." },
                description: { type: "string", description: "One sentence explaining the option." },
              },
              required: ["label"],
              additionalProperties: false,
            },
          },
          multiSelect: {
            type: "boolean",
            description: "Allow multiple answers for this question.",
          },
        },
        required: ["id", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

interface ParseOk {
  ok: true;
  questions: QuestionSpec[];
}
interface ParseError {
  ok: false;
  error: string;
}

/** 运行时校验（ajv 已把 JSON Schema 层级；这里补 schema 表达不了的：id / label 唯一性） */
export function parseQuestions(input: unknown): ParseOk | ParseError {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "ask_user: arguments must be an object" };
  }
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUESTIONS) {
    return { ok: false, error: `ask_user: questions must contain 1-${MAX_QUESTIONS} items` };
  }
  const questions: QuestionSpec[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "ask_user: each question must be an object" };
    }
    const q = item as Record<string, unknown>;
    const id = q.id;
    const question = q.question;
    if (typeof id !== "string" || id === "") {
      return { ok: false, error: "ask_user: question id must be a non-empty string" };
    }
    if (ids.has(id)) return { ok: false, error: `ask_user: duplicate question id "${id}"` };
    ids.add(id);
    if (typeof question !== "string" || question === "") {
      return { ok: false, error: `ask_user: question "${id}" is missing its text` };
    }
    const header = q.header;
    if (header !== undefined && (typeof header !== "string" || header === "")) {
      return { ok: false, error: `ask_user: question "${id}" header must be a non-empty string` };
    }
    if (typeof header === "string" && [...header].length > MAX_HEADER_CHARS) {
      return {
        ok: false,
        error: `ask_user: question "${id}" header exceeds ${MAX_HEADER_CHARS} characters`,
      };
    }
    const multiSelect = q.multiSelect;
    if (multiSelect !== undefined && typeof multiSelect !== "boolean") {
      return { ok: false, error: `ask_user: question "${id}" multiSelect must be a boolean` };
    }
    let options: QuestionSpec["options"];
    if (q.options !== undefined) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > MAX_OPTIONS) {
        return {
          ok: false,
          error: `ask_user: question "${id}" options must contain 2-${MAX_OPTIONS} items`,
        };
      }
      const labels = new Set<string>();
      options = [];
      for (const option of q.options) {
        if (typeof option !== "object" || option === null) {
          return { ok: false, error: `ask_user: question "${id}" option must be an object` };
        }
        const o = option as Record<string, unknown>;
        if (typeof o.label !== "string" || o.label === "") {
          return { ok: false, error: `ask_user: question "${id}" option label must be non-empty` };
        }
        if (labels.has(o.label)) {
          return {
            ok: false,
            error: `ask_user: question "${id}" has duplicate option "${o.label}"`,
          };
        }
        labels.add(o.label);
        if (o.description !== undefined && typeof o.description !== "string") {
          return {
            ok: false,
            error: `ask_user: question "${id}" option description must be a string`,
          };
        }
        options.push({
          label: o.label,
          ...(o.description !== undefined ? { description: o.description } : {}),
        });
      }
    }
    questions.push({
      id,
      question,
      ...(typeof header === "string" ? { header } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  return { ok: true, questions };
}

/** 答案归一：按题 id 对齐、过滤畸形项、有 options 的题只认自身 label；缺项 = 跳过 */
export function normalizeAnswers(
  questions: readonly QuestionSpec[],
  input: unknown,
): QuestionAnswer[] {
  const raw = Array.isArray(input) ? input : [];
  const byId = new Map<string, { selected: unknown; custom: unknown }>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id === "string") byId.set(a.id, { selected: a.selected, custom: a.custom });
  }
  return questions.map((q) => {
    const entry = byId.get(q.id);
    const labels = new Set((q.options ?? []).map((o) => o.label));
    const rawSelected = entry === undefined ? undefined : entry.selected;
    const selected = Array.isArray(rawSelected)
      ? rawSelected.filter(
          (label): label is string =>
            typeof label === "string" && (labels.size === 0 || labels.has(label)),
        )
      : [];
    // 自由文本按码点截断到协议上限：REST 已 400 拦一次，这里兜其余宿主/直连路径
    //（截断优于整笔失败——答案仍到达模型，不静默丢整题；R186 收尾）
    const custom =
      typeof entry?.custom === "string" && entry.custom.trim() !== ""
        ? [...entry.custom].slice(0, QUESTION_CUSTOM_MAX).join("")
        : undefined;
    return {
      id: q.id,
      selected,
      ...(custom !== undefined ? { custom } : {}),
    };
  });
}

/** 模型可见答复文本（English——模型上下文；结构与 UI 痕迹行同源，UI 走 __meta 不解析本串） */
export function formatAnswers(
  questions: readonly QuestionSpec[],
  answers: readonly QuestionAnswer[],
): string {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const lines = questions.map((q) => {
    const a = byId.get(q.id);
    const picked = a === undefined ? [] : [...a.selected];
    if (a?.custom !== undefined) picked.push(a.custom);
    return `- ${q.question} -> ${picked.length === 0 ? "(skipped)" : picked.join(", ")}`;
  });
  return ["The user answered your questions:", ...lines].join("\n");
}

export interface AskUserPluginOptions {
  /** 测试 / 嵌入方覆盖工具名（缺省 ask_user） */
  toolName?: string;
}

export function askUserPlugin(options?: AskUserPluginOptions): ServiceDefinition {
  const toolName = options?.toolName ?? ASK_USER_TOOL_NAME;
  return {
    inject: ["session", "tools", "interaction"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      let current: { turn: string; step: number } | undefined;
      ctx.events.on("turn/start", (payload: unknown) => {
        current = { turn: (payload as { turn: string }).turn, step: 0 };
      });
      ctx.events.on("step/start", (payload: unknown) => {
        const p = payload as { turn: string; step: number };
        current = { turn: p.turn, step: p.step };
      });

      const execute = async (
        args: Record<string, unknown>,
        toolCtx: ToolContext,
      ): Promise<ToolResult> => {
        const parsed = parseQuestions(args);
        if (!parsed.ok) return { content: parsed.error, isError: true };
        const { questions } = parsed;
        if (current === undefined) {
          return { content: "ask_user: no open turn accepts a question record", isError: true };
        }
        const { turn, step } = current;
        const session = cx.get("session");
        const requestId = randomUUID();
        await session.append({
          type: "question/asked",
          data: { turn, step, requestId, callId: requestId, questions },
        });

        let answer: QuestionInteractionAnswer | undefined;
        try {
          const interaction = cx.get("interaction");
          const result = await interaction.ask(
            { kind: "question", requestId, toolName, questions },
            toolCtx.signal,
          );
          if (result.kind === "question" && result.requestId === requestId) answer = result;
        } catch {
          // 缺席 / 抛错 → 与取消同收口（fail-closed：没人能答就当用户取消）
        }
        const cancelled = toolCtx.signal.aborted || answer === undefined || "cancelled" in answer;
        if (cancelled) {
          await session.append({
            type: "question/settled",
            data: { turn, step, requestId, outcome: "cancelled" },
          });
          return {
            content:
              "The user cancelled the question request. Continue with your best judgment or ask again later.",
            isError: true,
            __meta: { kind: "ask_user", questions, cancelled: true },
          };
        }
        const answers = normalizeAnswers(questions, (answer as { answers?: unknown }).answers);
        await session.append({
          type: "question/settled",
          data: { turn, step, requestId, outcome: "answered", answers },
        });
        return {
          content: formatAnswers(questions, answers),
          __meta: { kind: "ask_user", questions, answers },
        };
      };

      const tool: ToolDefinition = {
        name: toolName,
        description: DESCRIPTION,
        inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown>,
        // 无副作用 + 必须绕过审批默认链（见文件头）；并行安全
        isConcurrencySafe: true,
        execute,
      };
      cx.get("tools").register(tool);
    },
  };
}

// 轮单位（R177 拆分）：同 turn 行归一个 TurnUnit（虚拟化单位=轮）。
import type { Row } from "@henira/protocol";

/** 虚拟单位 = 轮（turn 相同行不拆散——工具输出与回答同轮同块；key = turnId，无 turn 的
 *  error 行独立成块）。参照实现 ConversationTurnRenderUnit 思想的行模型简版。 */
interface TurnUnit {
  key: string;
  turn?: string;
  rows: Row[];
}

function buildTurnUnits(rows: readonly Row[]): TurnUnit[] {
  const units: TurnUnit[] = [];
  for (const row of rows) {
    const last = units[units.length - 1];
    if (last !== undefined && row.turn !== undefined && last.turn === row.turn) {
      last.rows.push(row);
    } else {
      units.push({ key: row.turn ?? `e:${row.rowId}`, turn: row.turn, rows: [row] });
    }
  }
  return units;
}

export type { TurnUnit };
export { buildTurnUnits };

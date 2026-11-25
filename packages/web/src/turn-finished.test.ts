// onTurnFinished 记账（D-028 / D-085 / D-086）：按会话的发起/收口信用，先记后发，排队当场出账，
// 重连/快照按断线语义对账（信用出清、busy 起点重建）。

import { describe, expect, it } from "vitest";
import { createTurnLedger } from "./turn-finished.js";

describe("createTurnLedger", () => {
  it("直接回合：busy true→false 只投一次；多余的 false 沿不重复投", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    expect(ledger.onBusy("s1", true)).toBe(false);
    expect(ledger.onBusy("s1", false)).toBe(true);
    expect(ledger.onBusy("s1", false)).toBe(false);
    expect(ledger.pending("s1")).toBe(0);
  });

  it("未见 busy 起点（连上时已在回合中 / 断线重连快照）→ 不投也不扣", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    expect(ledger.onBusy("s1", false)).toBe(false);
    expect(ledger.pending("s1")).toBe(1); // 信用还在：等真正的 busy→false
    expect(ledger.onBusy("s1", true)).toBe(false);
    expect(ledger.onBusy("s1", false)).toBe(true);
  });

  it("排队 / 提交失败当场出账：后续 busy 沿不投", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    ledger.settle("s1"); // receipt.id !== null 或 prompt reject
    expect(ledger.pending("s1")).toBe(0);
    expect(ledger.onBusy("s1", true)).toBe(false);
    expect(ledger.onBusy("s1", false)).toBe(false);
  });

  it("跨会话独立：A 的回合结束不会冒领到 B 的发送", () => {
    const ledger = createTurnLedger();
    ledger.sent("a");
    expect(ledger.onBusy("a", true)).toBe(false);
    expect(ledger.onBusy("b", true)).toBe(false);
    expect(ledger.onBusy("b", false)).toBe(false); // b 没有自己的信用
    expect(ledger.onBusy("a", false)).toBe(true); // a 的信用只归 a
  });

  it("连续两次直接发送（串行回合）逐个消耗", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    ledger.sent("s1");
    ledger.onBusy("s1", true);
    expect(ledger.onBusy("s1", false)).toBe(true);
    ledger.onBusy("s1", true);
    expect(ledger.onBusy("s1", false)).toBe(true);
    expect(ledger.pending("s1")).toBe(0);
  });

  it("settle 没有信用时 no-op（不扣成负数）", () => {
    const ledger = createTurnLedger();
    ledger.settle("s1");
    expect(ledger.pending("s1")).toBe(0);
  });

  it("排队回执：登记 → 行流回声命中 → 宿主记信用 → busy 沿投一次（D-086）", () => {
    const ledger = createTurnLedger();
    ledger.queued("s1", "q-1");
    expect(ledger.pending("s1")).toBe(0); // 登记本身不记信用（回合还没开）
    expect(ledger.match("s1", "q-1")).toBe(true); // 账本 user/message 回声命中
    ledger.sent("s1");
    ledger.onBusy("s1", true);
    expect(ledger.onBusy("s1", false)).toBe(true);
    expect(ledger.match("s1", "q-1")).toBe(false); // 已消费，不重复
    expect(ledger.pending("s1")).toBe(0);
  });

  it("排队回执：未登记的回声不冒领（别的窗口排的条目）；按会话隔离", () => {
    const ledger = createTurnLedger();
    ledger.queued("a", "q-1");
    expect(ledger.match("b", "q-1")).toBe(false); // 会话隔离
    expect(ledger.match("a", "q-1")).toBe(true);
    expect(ledger.match("a", "q-other")).toBe(false); // 未登记
    ledger.onBusy("a", true);
    expect(ledger.onBusy("a", false)).toBe(false); // 没有信用 → 不投
  });

  it("重连（connected）清空断线前信用：旧回合与下一轮都不冒领", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    ledger.onBusy("s1", true);
    ledger.reset();
    expect(ledger.pending("s1")).toBe(0);
    expect(ledger.onBusy("s1", false)).toBe(false); // 旧回合的终局不补投
    ledger.onBusy("s1", true);
    expect(ledger.onBusy("s1", false)).toBe(false); // 下一轮也不冒领
  });

  it("重连后仍在途的排队回合：快照补起点，回声记信用并结算一次（D-086）", () => {
    const ledger = createTurnLedger();
    ledger.queued("s1", "q-1");
    ledger.reset(); // 断线重连：旧信用清空，排队登记保留
    ledger.sync("s1", true); // 快照 busy=true：补起点
    expect(ledger.match("s1", "q-1")).toBe(true);
    ledger.sent("s1"); // 宿主 claim：回声命中记信用
    expect(ledger.onBusy("s1", false)).toBe(true);
    expect(ledger.pending("s1")).toBe(0);
  });

  it("快照 busy=false 且本地还挂着起点 = 错过终局：信用出清不冒领", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    ledger.onBusy("s1", true);
    ledger.sync("s1", false);
    expect(ledger.pending("s1")).toBe(0);
    expect(ledger.onBusy("s1", false)).toBe(false);
  });

  it("快照 busy=false 但起点未立（回合尚未开跑/新会话公告）：信用照常保留", () => {
    const ledger = createTurnLedger();
    ledger.sent("s1");
    ledger.sync("s1", false);
    expect(ledger.pending("s1")).toBe(1);
    ledger.onBusy("s1", true);
    expect(ledger.onBusy("s1", false)).toBe(true);
  });
});

import type { LlmRequest, LlmService, StreamEvent } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import {
  type MockLlm,
  mockFinish,
  mockLlm,
  mockReasoning,
  mockText,
  mockToolCall,
  mockUsage,
} from "./mock.js";

const USAGE = { inputTokens: 10, outputTokens: 5 };

function req(content = "hi"): LlmRequest {
  return {
    model: { provider: "mock", model: "mock-1" },
    messages: [{ role: "user", content }],
    tools: [],
  };
}

async function collect(service: LlmService, request: LlmRequest): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of service.stream(request, new AbortController().signal)) out.push(event);
  return out;
}

describe("mockLlm 脚本引擎", () => {
  it("按调用次序消费脚本条目（确定性驱动 loop 的根基）", async () => {
    const { service } = mockLlm([
      [mockText("第一回合"), mockUsage(USAGE), mockFinish("stop")],
      [mockReasoning("思考"), mockText("第二回合"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const first = await collect(service, req("一"));
    const second = await collect(service, req("二"));
    expect(first.map((e) => e.type)).toEqual(["text-delta", "usage", "finish"]);
    expect(second.map((e) => e.type)).toEqual(["reasoning-delta", "text-delta", "usage", "finish"]);
    expect(first).toEqual([mockText("第一回合"), mockUsage(USAGE), mockFinish("stop")]);
  });

  it("请求捕获：requests 记录每次调用的完整请求", async () => {
    const { service, requests } = mockLlm([[mockFinish("stop")], [mockFinish("stop")]]);
    await collect(service, req("甲"));
    await collect(service, req("乙"));
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0]).toEqual({ role: "user", content: "甲" });
    expect(requests[1].messages[0]).toEqual({ role: "user", content: "乙" });
  });

  it("尾部函数条目兼作兜底应答器：耗尽后持续应答且收到请求", async () => {
    let calls = 0;
    const { service, requests } = mockLlm([
      (r) => {
        calls += 1;
        return [
          mockText(`第${calls}次:${r.messages.length}条`),
          mockUsage(USAGE),
          mockFinish("stop"),
        ];
      },
    ]);
    const events1 = await collect(service, req("一"));
    const events2 = await collect(service, req("一"));
    expect(events1[0].type).toBe("text-delta");
    expect(events2[0].type).toBe("text-delta");
    expect(calls).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toBe(requests[0]); // 两次调用各自的真实请求
  });

  it("脚本耗尽且无兜底 → 响亮报错（脚本 bug 不静默）", async () => {
    const { service } = mockLlm([[mockText("a"), mockFinish("stop")]]);
    await collect(service, req());
    await expect(collect(service, req())).rejects.toThrow(/脚本耗尽/);
  });

  it("'hang' 条目挂起，signal abort 后以 ABORTED 拒绝（中断纪律 1 的演练入口）", async () => {
    const ac = new AbortController();
    const { service } = mockLlm(["hang"]);
    const iterator = service.stream(req(), ac.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("Error 条目：流以该错误 rejection 收场（失败路径演练）", async () => {
    const boom = new Error("provider exploded");
    const { service } = mockLlm([boom]);
    await expect(collect(service, req())).rejects.toBe(boom);
  });

  it("不变量①：argsText 原样透传，不改写不重排", async () => {
    const raw = '{"path":  "a.txt",  "n":1}';
    const { service } = mockLlm([
      [mockToolCall("c1", "write", raw), mockUsage(USAGE), mockFinish("tool-calls")],
    ]);
    const events = await collect(service, req());
    expect(events[0]).toEqual({ type: "tool-call", callId: "c1", name: "write", argsText: raw });
  });

  it("构造期自校验：静态脚本条目违反 P3 不变量立即报错", () => {
    // [finish, usage] 同时违反②与"finish 末位"——校验器先报后者（usage 乱序被它覆盖）
    expect(() => mockLlm([[mockFinish("stop"), mockUsage(USAGE)]])).toThrow(
      /finish 之后不得还有事件/,
    );
    expect(() =>
      mockLlm([
        [mockText("a"), mockUsage(USAGE), mockToolCall("c", "t", "{}"), mockFinish("tool-calls")],
      ]),
    ).toThrow(/tool-call 必须集中/);
    expect(() => mockLlm([[mockText("a"), mockFinish("stop"), mockText("迟到的增量")]])).toThrow(
      /finish 之后不得还有事件/,
    );
    expect(() => mockLlm([[mockFinish("stop"), mockFinish("stop")]])).toThrow(/finish 至多一条/);
  });

  it("合法序列（含 tool-call 回合）构造与迭代都通过", async () => {
    const { service } = mockLlm([
      [
        mockText("我看一下"),
        mockToolCall("c1", "read", '{"path":"a.txt"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
    ]);
    const events = await collect(service, req());
    expect(events.map((e) => e.type)).toEqual(["text-delta", "tool-call", "usage", "finish"]);
  });

  it("函数条目的响应期自校验：动态生成的非法序列同样报错", async () => {
    const { service } = mockLlm([() => [mockFinish("stop"), mockText("迟到的增量")]]);
    await expect(collect(service, req())).rejects.toThrow(/finish 之后不得还有事件/);
  });

  it("MockLlm 类型满足 LlmService（槽位级 mock 的契约锚）", () => {
    const mock: MockLlm = mockLlm([]);
    const service: LlmService = mock.service; // 类型收窄赋值即编译期断言
    expect(typeof service.stream).toBe("function");
  });
});

var xm = Object.defineProperty;
var m2 = (s) => {
  throw TypeError(s);
};
var Dm = (s, b, z) =>
  b in s ? xm(s, b, { enumerable: !0, configurable: !0, writable: !0, value: z }) : (s[b] = z);
var D0 = (s, b, z) => Dm(s, typeof b != "symbol" ? b + "" : b, z),
  C0 = (s, b, z) => b.has(s) || m2("Cannot " + z);
var nt = (s, b, z) => (C0(s, b, "read from private field"), z ? z.call(s) : b.get(s)),
  za = (s, b, z) =>
    b.has(s)
      ? m2("Cannot add the same private member more than once")
      : b instanceof WeakSet
        ? b.add(s)
        : b.set(s, z),
  U0 = (s, b, z, o) => (C0(s, b, "write to private field"), o ? o.call(s, z) : b.set(s, z), z),
  hu = (s, b, z) => (C0(s, b, "access private method"), z);
(function () {
  const b = document.createElement("link").relList;
  if (b && b.supports && b.supports("modulepreload")) return;
  for (const N of document.querySelectorAll('link[rel="modulepreload"]')) o(N);
  new MutationObserver((N) => {
    for (const M of N)
      if (M.type === "childList")
        for (const G of M.addedNodes) G.tagName === "LINK" && G.rel === "modulepreload" && o(G);
  }).observe(document, { childList: !0, subtree: !0 });
  function z(N) {
    const M = {};
    return (
      N.integrity && (M.integrity = N.integrity),
      N.referrerPolicy && (M.referrerPolicy = N.referrerPolicy),
      N.crossOrigin === "use-credentials"
        ? (M.credentials = "include")
        : N.crossOrigin === "anonymous"
          ? (M.credentials = "omit")
          : (M.credentials = "same-origin"),
      M
    );
  }
  function o(N) {
    if (N.ep) return;
    N.ep = !0;
    const M = z(N);
    fetch(N.href, M);
  }
})();
function Cm(s = 256) {
  const b = [];
  let z,
    o = !1;
  return {
    push(N) {
      if (!o) {
        if (b.length >= s) {
          (o = !0), z == null || z();
          return;
        }
        b.push(N), z == null || z();
      }
    },
    async *stream() {
      try {
        for (;;) {
          for (; b.length > 0; ) yield b.shift();
          if (o) return;
          await new Promise((N) => {
            z = N;
          });
        }
      } finally {
        o = !0;
      }
    },
  };
}
function Um(s) {
  const b = s.fetch ?? fetch,
    z = s.baseUrl.replace(/\/$/, ""),
    o = () => (s.token === void 0 ? {} : { authorization: `Bearer ${s.token}` }),
    N = (H, q) => `${z}${H}`;
  async function M(H, q) {
    const $ = await b(N(H), {
      ...q,
      headers: {
        "content-type": "application/json",
        ...o(),
        ...((q == null ? void 0 : q.headers) ?? {}),
      },
    });
    if (!$.ok) throw new Error(`${(q == null ? void 0 : q.method) ?? "GET"} ${H} → ${$.status}`);
    return await $.json();
  }
  return {
    async createSession(H) {
      return M("/api/sessions", { method: "POST", body: JSON.stringify(H ?? {}) });
    },
    async listSessions() {
      return M("/api/sessions");
    },
    async prompt(H, q) {
      return M(`/api/sessions/${H}/prompt`, { method: "POST", body: JSON.stringify({ text: q }) });
    },
    async steer(H, q) {
      return (
        await M(`/api/sessions/${H}/steer`, {
          method: "POST",
          body: JSON.stringify({ entryId: q }),
        })
      ).ok;
    },
    async interrupt(H) {
      await M(`/api/sessions/${H}/interrupt`, { method: "POST" });
    },
    async settleApproval(H, q, $) {
      return (
        await M(`/api/sessions/${H}/approvals/${q}`, {
          method: "POST",
          body: JSON.stringify({ decision: $ }),
        })
      ).applied;
    },
    async getSettings() {
      return M("/api/settings");
    },
    async putSettings(H) {
      return M("/api/settings", { method: "PUT", body: JSON.stringify(H) });
    },
    async listModels() {
      return M("/api/models");
    },
    async putCredential(H, q) {
      await M(`/api/credentials/${H}`, { method: "PUT", body: JSON.stringify({ key: q }) });
    },
    async listDir(H, q) {
      const $ = q === void 0 ? "" : `?path=${encodeURIComponent(q)}`;
      return M(`/api/sessions/${H}/files${$}`);
    },
    async snapshot(H) {
      return M(`/api/sessions/${H}/snapshot`);
    },
    async *events() {
      const H = new Map(),
        q = Cm(),
        $ = new AbortController();
      (async () => {
        let T = 500;
        const C = s.maxBackoffMs ?? 5e3;
        for (; !$.signal.aborted; ) {
          try {
            const fl = await b(N("/api/events"), {
              headers: { accept: "text/event-stream", ...o() },
              signal: $.signal,
            });
            if (!fl.ok || fl.body === null) throw new Error(`events → ${fl.status}`);
            T = 500;
            for await (const W of Rm(fl.body))
              if (W.kind === "snapshot") H.set(W.sessionId, W.snapshot.seq), q.push(W);
              else if (W.kind === "delta") {
                const Ul = (H.get(W.sessionId) ?? 0) + 1;
                if (W.seq === Ul) H.set(W.sessionId, W.seq), q.push(W);
                else {
                  const k = await M(`/api/sessions/${W.sessionId}/snapshot`);
                  H.set(W.sessionId, k.seq),
                    q.push({ kind: "snapshot", sessionId: W.sessionId, snapshot: k });
                }
              } else q.push(W);
          } catch {}
          if ($.signal.aborted) break;
          await new Promise((fl) => setTimeout(fl, T)), (T = Math.min(T * 2, C));
        }
      })().catch(() => {});
      try {
        yield* q.stream();
      } finally {
        $.abort();
      }
    },
    async stop() {},
  };
}
async function* Rm(s) {
  const b = s.getReader(),
    z = new TextDecoder();
  let o = "";
  try {
    for (;;) {
      const { done: N, value: M } = await b.read();
      if (N) return;
      o += z.decode(M, { stream: !0 });
      let G = o.indexOf(`

`);
      for (; G !== -1; ) {
        const H = o.slice(0, G);
        o = o.slice(G + 2);
        for (const q of H.split(`
`))
          q.startsWith("data: ") && (yield JSON.parse(q.slice(6)));
        G = o.indexOf(`

`);
      }
    }
  } finally {
    b.releaseLock();
  }
}
var R0 = { exports: {} },
  F = {}; /**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var h2;
function Hm() {
  if (h2) return F;
  h2 = 1;
  var s = Symbol.for("react.transitional.element"),
    b = Symbol.for("react.portal"),
    z = Symbol.for("react.fragment"),
    o = Symbol.for("react.strict_mode"),
    N = Symbol.for("react.profiler"),
    M = Symbol.for("react.consumer"),
    G = Symbol.for("react.context"),
    H = Symbol.for("react.forward_ref"),
    q = Symbol.for("react.suspense"),
    $ = Symbol.for("react.memo"),
    D = Symbol.for("react.lazy"),
    T = Symbol.for("react.activity"),
    C = Symbol.for("react.view_transition"),
    fl = Symbol.iterator;
  function W(d) {
    return d === null || typeof d != "object"
      ? null
      : ((d = (fl && d[fl]) || d["@@iterator"]), typeof d == "function" ? d : null);
  }
  var Ul = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    k = Object.assign,
    Dl = {};
  function Pl(d, _, Z) {
    (this.props = d), (this.context = _), (this.refs = Dl), (this.updater = Z || Ul);
  }
  (Pl.prototype.isReactComponent = {}),
    (Pl.prototype.setState = function (d, _) {
      if (typeof d != "object" && typeof d != "function" && d != null)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, d, _, "setState");
    }),
    (Pl.prototype.forceUpdate = function (d) {
      this.updater.enqueueForceUpdate(this, d, "forceUpdate");
    });
  function lt() {}
  lt.prototype = Pl.prototype;
  function Q(d, _, Z) {
    (this.props = d), (this.context = _), (this.refs = Dl), (this.updater = Z || Ul);
  }
  var ll = (Q.prototype = new lt());
  (ll.constructor = Q), k(ll, Pl.prototype), (ll.isPureReactComponent = !0);
  var il = Array.isArray;
  function V() {}
  var cl = { H: null, A: null, T: null, S: null },
    dt = Object.prototype.hasOwnProperty;
  function Ot(d, _, Z) {
    var L = Z.ref;
    return { $$typeof: s, type: d, key: _, ref: L !== void 0 ? L : null, props: Z };
  }
  function _t(d, _) {
    return Ot(d.type, _, d.props);
  }
  function vt(d) {
    return typeof d == "object" && d !== null && d.$$typeof === s;
  }
  function Ee(d) {
    var _ = { "=": "=0", ":": "=2" };
    return (
      "$" +
      d.replace(/[=:]/g, function (Z) {
        return _[Z];
      })
    );
  }
  var ke = /\/+/g;
  function Yl(d, _) {
    return typeof d == "object" && d !== null && d.key != null ? Ee("" + d.key) : _.toString(36);
  }
  function U(d) {
    switch (d.status) {
      case "fulfilled":
        return d.value;
      case "rejected":
        throw d.reason;
      default:
        switch (
          (typeof d.status == "string"
            ? d.then(V, V)
            : ((d.status = "pending"),
              d.then(
                function (_) {
                  d.status === "pending" && ((d.status = "fulfilled"), (d.value = _));
                },
                function (_) {
                  d.status === "pending" && ((d.status = "rejected"), (d.reason = _));
                },
              )),
          d.status)
        ) {
          case "fulfilled":
            return d.value;
          case "rejected":
            throw d.reason;
        }
    }
    throw d;
  }
  function w(d, _, Z, L, ol) {
    var rl = typeof d;
    (rl === "undefined" || rl === "boolean") && (d = null);
    var vl = !1;
    if (d === null) vl = !0;
    else
      switch (rl) {
        case "bigint":
        case "string":
        case "number":
          vl = !0;
          break;
        case "object":
          switch (d.$$typeof) {
            case s:
            case b:
              vl = !0;
              break;
            case D:
              return ((vl = d._init), w(vl(d._payload), _, Z, L, ol));
          }
      }
    if (vl)
      return (
        (ol = ol(d)),
        (vl = L === "" ? "." + Yl(d, 0) : L),
        il(ol)
          ? ((Z = ""),
            vl != null && (Z = vl.replace(ke, "$&/") + "/"),
            w(ol, _, Z, "", function (ue) {
              return ue;
            }))
          : ol != null &&
            (vt(ol) &&
              (ol = _t(
                ol,
                Z +
                  (ol.key == null || (d && d.key === ol.key)
                    ? ""
                    : ("" + ol.key).replace(ke, "$&/") + "/") +
                  vl,
              )),
            _.push(ol)),
        1
      );
    vl = 0;
    var B = L === "" ? "." : L + ":";
    if (il(d))
      for (var J = 0; J < d.length; J++)
        (L = d[J]), (rl = B + Yl(L, J)), (vl += w(L, _, Z, rl, ol));
    else if (((J = W(d)), typeof J == "function"))
      for (d = J.call(d), J = 0; !(L = d.next()).done; )
        (L = L.value), (rl = B + Yl(L, J++)), (vl += w(L, _, Z, rl, ol));
    else if (rl === "object") {
      if (typeof d.then == "function") return w(U(d), _, Z, L, ol);
      throw (
        (_ = String(d)),
        Error(
          "Objects are not valid as a React child (found: " +
            (_ === "[object Object]" ? "object with keys {" + Object.keys(d).join(", ") + "}" : _) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    }
    return vl;
  }
  function K(d, _, Z) {
    if (d == null) return d;
    var L = [],
      ol = 0;
    return (
      w(d, L, "", "", function (rl) {
        return _.call(Z, rl, ol++);
      }),
      L
    );
  }
  function Tl(d) {
    if (d._status === -1) {
      var _ = d._result,
        Z = _();
      Z.then(
        function (L) {
          (d._status === 0 || d._status === -1) &&
            ((d._status = 1),
            (d._result = L),
            Z.status === void 0 && ((Z.status = "fulfilled"), (Z.value = L)));
        },
        function (L) {
          (d._status === 0 || d._status === -1) &&
            ((d._status = 2),
            (d._result = L),
            Z.status === void 0 && ((Z.status = "rejected"), (Z.reason = L)));
        },
      ),
        d._status === -1 && ((d._status = 0), (d._result = Z));
    }
    if (d._status === 1) return d._result.default;
    throw d._result;
  }
  var hl =
    typeof reportError == "function"
      ? reportError
      : function (d) {
          if (typeof window == "object" && typeof window.ErrorEvent == "function") {
            var _ = new window.ErrorEvent("error", {
              bubbles: !0,
              cancelable: !0,
              message:
                typeof d == "object" && d !== null && typeof d.message == "string"
                  ? String(d.message)
                  : String(d),
              error: d,
            });
            if (!window.dispatchEvent(_)) return;
          } else if (typeof process == "object" && typeof process.emit == "function") {
            process.emit("uncaughtException", d);
            return;
          }
          console.error(d);
        };
  function qt(d) {
    var _ = cl.T,
      Z = {};
    (Z.types = _ !== null ? _.types : null), (cl.T = Z);
    try {
      var L = d(),
        ol = cl.S;
      ol !== null && ol(Z, L),
        typeof L == "object" && L !== null && typeof L.then == "function" && L.then(V, hl);
    } catch (rl) {
      hl(rl);
    } finally {
      _ !== null && Z.types !== null && (_.types = Z.types), (cl.T = _);
    }
  }
  function ae(d) {
    var _ = cl.T;
    if (_ !== null) {
      var Z = _.types;
      Z === null ? (_.types = [d]) : Z.indexOf(d) === -1 && Z.push(d);
    } else qt(ae.bind(null, d));
  }
  var Ie = {
    map: K,
    forEach: function (d, _, Z) {
      K(
        d,
        function () {
          _.apply(this, arguments);
        },
        Z,
      );
    },
    count: function (d) {
      var _ = 0;
      return (
        K(d, function () {
          _++;
        }),
        _
      );
    },
    toArray: function (d) {
      return (
        K(d, function (_) {
          return _;
        }) || []
      );
    },
    only: function (d) {
      if (!vt(d))
        throw Error("React.Children.only expected to receive a single React element child.");
      return d;
    },
  };
  return (
    (F.Activity = T),
    (F.Children = Ie),
    (F.Component = Pl),
    (F.Fragment = z),
    (F.Profiler = N),
    (F.PureComponent = Q),
    (F.StrictMode = o),
    (F.Suspense = q),
    (F.ViewTransition = C),
    (F.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = cl),
    (F.__COMPILER_RUNTIME = {
      __proto__: null,
      c: function (d) {
        return cl.H.useMemoCache(d);
      },
    }),
    (F.addTransitionType = ae),
    (F.cache = function (d) {
      return function () {
        return d.apply(null, arguments);
      };
    }),
    (F.cacheSignal = function () {
      return null;
    }),
    (F.cloneElement = function (d, _, Z) {
      if (d == null) throw Error("The argument must be a React element, but you passed " + d + ".");
      var L = k({}, d.props),
        ol = d.key;
      if (_ != null)
        for (rl in (_.key !== void 0 && (ol = "" + _.key), _))
          !dt.call(_, rl) ||
            rl === "key" ||
            rl === "__self" ||
            rl === "__source" ||
            (rl === "ref" && _.ref === void 0) ||
            (L[rl] = _[rl]);
      var rl = arguments.length - 2;
      if (rl === 1) L.children = Z;
      else if (1 < rl) {
        for (var vl = Array(rl), B = 0; B < rl; B++) vl[B] = arguments[B + 2];
        L.children = vl;
      }
      return Ot(d.type, ol, L);
    }),
    (F.createContext = function (d) {
      return (
        (d = {
          $$typeof: G,
          _currentValue: d,
          _currentValue2: d,
          _threadCount: 0,
          Provider: null,
          Consumer: null,
        }),
        (d.Provider = d),
        (d.Consumer = { $$typeof: M, _context: d }),
        d
      );
    }),
    (F.createElement = function (d, _, Z) {
      var L,
        ol = {},
        rl = null;
      if (_ != null)
        for (L in (_.key !== void 0 && (rl = "" + _.key), _))
          dt.call(_, L) && L !== "key" && L !== "__self" && L !== "__source" && (ol[L] = _[L]);
      var vl = arguments.length - 2;
      if (vl === 1) ol.children = Z;
      else if (1 < vl) {
        for (var B = Array(vl), J = 0; J < vl; J++) B[J] = arguments[J + 2];
        ol.children = B;
      }
      if (d && d.defaultProps)
        for (L in ((vl = d.defaultProps), vl)) ol[L] === void 0 && (ol[L] = vl[L]);
      return Ot(d, rl, ol);
    }),
    (F.createRef = function () {
      return { current: null };
    }),
    (F.forwardRef = function (d) {
      return { $$typeof: H, render: d };
    }),
    (F.isValidElement = vt),
    (F.lazy = function (d) {
      return { $$typeof: D, _payload: { _status: -1, _result: d }, _init: Tl };
    }),
    (F.memo = function (d, _) {
      return { $$typeof: $, type: d, compare: _ === void 0 ? null : _ };
    }),
    (F.startTransition = qt),
    (F.unstable_useCacheRefresh = function () {
      return cl.H.useCacheRefresh();
    }),
    (F.use = function (d) {
      return cl.H.use(d);
    }),
    (F.useActionState = function (d, _, Z) {
      return cl.H.useActionState(d, _, Z);
    }),
    (F.useCallback = function (d, _) {
      return cl.H.useCallback(d, _);
    }),
    (F.useContext = function (d) {
      return cl.H.useContext(d);
    }),
    (F.useDebugValue = function () {}),
    (F.useDeferredValue = function (d, _) {
      return cl.H.useDeferredValue(d, _);
    }),
    (F.useEffect = function (d, _) {
      return cl.H.useEffect(d, _);
    }),
    (F.useEffectEvent = function (d) {
      return cl.H.useEffectEvent(d);
    }),
    (F.useId = function () {
      return cl.H.useId();
    }),
    (F.useImperativeHandle = function (d, _, Z) {
      return cl.H.useImperativeHandle(d, _, Z);
    }),
    (F.useInsertionEffect = function (d, _) {
      return cl.H.useInsertionEffect(d, _);
    }),
    (F.useLayoutEffect = function (d, _) {
      return cl.H.useLayoutEffect(d, _);
    }),
    (F.useMemo = function (d, _) {
      return cl.H.useMemo(d, _);
    }),
    (F.useOptimistic = function (d, _) {
      return cl.H.useOptimistic(d, _);
    }),
    (F.useReducer = function (d, _, Z) {
      return cl.H.useReducer(d, _, Z);
    }),
    (F.useRef = function (d) {
      return cl.H.useRef(d);
    }),
    (F.useState = function (d) {
      return cl.H.useState(d);
    }),
    (F.useSyncExternalStore = function (d, _, Z) {
      return cl.H.useSyncExternalStore(d, _, Z);
    }),
    (F.useTransition = function () {
      return cl.H.useTransition();
    }),
    (F.version = "19.3.1"),
    F
  );
}
var y2;
function V0() {
  return (y2 || ((y2 = 1), (R0.exports = Hm())), R0.exports);
}
var E = V0(),
  H0 = { exports: {} },
  vn = {},
  j0 = { exports: {} },
  q0 = {}; /**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var g2;
function jm() {
  return (
    g2 ||
      ((g2 = 1),
      (function (s) {
        function b(U, w) {
          var K = U.length;
          U.push(w);
          l: for (; 0 < K; ) {
            var Tl = (K - 1) >>> 1,
              hl = U[Tl];
            if (0 < N(hl, w)) (U[Tl] = w), (U[K] = hl), (K = Tl);
            else break l;
          }
        }
        function z(U) {
          return U.length === 0 ? null : U[0];
        }
        function o(U) {
          if (U.length === 0) return null;
          var w = U[0],
            K = U.pop();
          if (K !== w) {
            U[0] = K;
            l: for (var Tl = 0, hl = U.length, qt = hl >>> 1; Tl < qt; ) {
              var ae = 2 * (Tl + 1) - 1,
                Ie = U[ae],
                d = ae + 1,
                _ = U[d];
              if (0 > N(Ie, K))
                d < hl && 0 > N(_, Ie)
                  ? ((U[Tl] = _), (U[d] = K), (Tl = d))
                  : ((U[Tl] = Ie), (U[ae] = K), (Tl = ae));
              else if (d < hl && 0 > N(_, K)) (U[Tl] = _), (U[d] = K), (Tl = d);
              else break l;
            }
          }
          return w;
        }
        function N(U, w) {
          var K = U.sortIndex - w.sortIndex;
          return K !== 0 ? K : U.id - w.id;
        }
        if (
          ((s.unstable_now = void 0),
          typeof performance == "object" && typeof performance.now == "function")
        ) {
          var M = performance;
          s.unstable_now = function () {
            return M.now();
          };
        } else {
          var G = Date,
            H = G.now();
          s.unstable_now = function () {
            return G.now() - H;
          };
        }
        var q = [],
          $ = [],
          D = 1,
          T = null,
          C = 3,
          fl = !1,
          W = !1,
          Ul = !1,
          k = !1,
          Dl = typeof setTimeout == "function" ? setTimeout : null,
          Pl = typeof clearTimeout == "function" ? clearTimeout : null,
          lt = typeof setImmediate < "u" ? setImmediate : null;
        function Q(U) {
          for (var w = z($); w !== null; ) {
            if (w.callback === null) o($);
            else if (w.startTime <= U) o($), (w.sortIndex = w.expirationTime), b(q, w);
            else break;
            w = z($);
          }
        }
        function ll(U) {
          if (((Ul = !1), Q(U), !W))
            if (z(q) !== null) (W = !0), il || ((il = !0), vt());
            else {
              var w = z($);
              w !== null && Yl(ll, w.startTime - U);
            }
        }
        var il = !1,
          V = -1,
          cl = 5,
          dt = -1;
        function Ot() {
          return k ? !0 : !(s.unstable_now() - dt < cl);
        }
        function _t() {
          if (((k = !1), il)) {
            var U = s.unstable_now();
            dt = U;
            var w = !0;
            try {
              l: {
                (W = !1), Ul && ((Ul = !1), Pl(V), (V = -1)), (fl = !0);
                var K = C;
                try {
                  t: {
                    for (Q(U), T = z(q); T !== null && !(T.expirationTime > U && Ot()); ) {
                      var Tl = T.callback;
                      if (typeof Tl == "function") {
                        (T.callback = null), (C = T.priorityLevel);
                        var hl = Tl(T.expirationTime <= U);
                        if (((U = s.unstable_now()), typeof hl == "function")) {
                          (T.callback = hl), Q(U), (w = !0);
                          break t;
                        }
                        T === z(q) && o(q), Q(U);
                      } else o(q);
                      T = z(q);
                    }
                    if (T !== null) w = !0;
                    else {
                      var qt = z($);
                      qt !== null && Yl(ll, qt.startTime - U), (w = !1);
                    }
                  }
                  break l;
                } finally {
                  (T = null), (C = K), (fl = !1);
                }
                w = void 0;
              }
            } finally {
              w ? vt() : (il = !1);
            }
          }
        }
        var vt;
        if (typeof lt == "function")
          vt = function () {
            lt(_t);
          };
        else if (typeof MessageChannel < "u") {
          var Ee = new MessageChannel(),
            ke = Ee.port2;
          (Ee.port1.onmessage = _t),
            (vt = function () {
              ke.postMessage(null);
            });
        } else
          vt = function () {
            Dl(_t, 0);
          };
        function Yl(U, w) {
          V = Dl(function () {
            U(s.unstable_now());
          }, w);
        }
        (s.unstable_IdlePriority = 5),
          (s.unstable_ImmediatePriority = 1),
          (s.unstable_LowPriority = 4),
          (s.unstable_NormalPriority = 3),
          (s.unstable_Profiling = null),
          (s.unstable_UserBlockingPriority = 2),
          (s.unstable_cancelCallback = function (U) {
            U.callback = null;
          }),
          (s.unstable_forceFrameRate = function (U) {
            0 > U || 125 < U
              ? console.error(
                  "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
                )
              : (cl = 0 < U ? Math.floor(1e3 / U) : 5);
          }),
          (s.unstable_getCurrentPriorityLevel = function () {
            return C;
          }),
          (s.unstable_next = function (U) {
            switch (C) {
              case 1:
              case 2:
              case 3:
                var w = 3;
                break;
              default:
                w = C;
            }
            var K = C;
            C = w;
            try {
              return U();
            } finally {
              C = K;
            }
          }),
          (s.unstable_requestPaint = function () {
            k = !0;
          }),
          (s.unstable_runWithPriority = function (U, w) {
            switch (U) {
              case 1:
              case 2:
              case 3:
              case 4:
              case 5:
                break;
              default:
                U = 3;
            }
            var K = C;
            C = U;
            try {
              return w();
            } finally {
              C = K;
            }
          }),
          (s.unstable_scheduleCallback = function (U, w, K) {
            var Tl = s.unstable_now();
            switch (
              (typeof K == "object" && K !== null
                ? ((K = K.delay), (K = typeof K == "number" && 0 < K ? Tl + K : Tl))
                : (K = Tl),
              U)
            ) {
              case 1:
                var hl = -1;
                break;
              case 2:
                hl = 250;
                break;
              case 5:
                hl = 1073741823;
                break;
              case 4:
                hl = 1e4;
                break;
              default:
                hl = 5e3;
            }
            return (
              (hl = K + hl),
              (U = {
                id: D++,
                callback: w,
                priorityLevel: U,
                startTime: K,
                expirationTime: hl,
                sortIndex: -1,
              }),
              K > Tl
                ? ((U.sortIndex = K),
                  b($, U),
                  z(q) === null &&
                    U === z($) &&
                    (Ul ? (Pl(V), (V = -1)) : (Ul = !0), Yl(ll, K - Tl)))
                : ((U.sortIndex = hl), b(q, U), W || fl || ((W = !0), il || ((il = !0), vt()))),
              U
            );
          }),
          (s.unstable_shouldYield = Ot),
          (s.unstable_wrapCallback = function (U) {
            var w = C;
            return function () {
              var K = C;
              C = w;
              try {
                return U.apply(this, arguments);
              } finally {
                C = K;
              }
            };
          });
      })(q0)),
    q0
  );
}
var S2;
function qm() {
  return (S2 || ((S2 = 1), (j0.exports = jm())), j0.exports);
}
var B0 = { exports: {} },
  Wl = {}; /**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var b2;
function Bm() {
  if (b2) return Wl;
  b2 = 1;
  var s = V0();
  function b(D) {
    var T = "https://react.dev/errors/" + D;
    if (1 < arguments.length) {
      T += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var C = 2; C < arguments.length; C++) T += "&args[]=" + encodeURIComponent(arguments[C]);
    }
    return (
      "Minified React error #" +
      D +
      "; visit " +
      T +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function z() {}
  var o = {
      d: {
        f: z,
        r: function () {
          throw Error(b(522));
        },
        D: z,
        C: z,
        L: z,
        m: z,
        X: z,
        S: z,
        M: z,
      },
      p: 0,
      findDOMNode: null,
    },
    N = Symbol.for("react.portal"),
    M = Symbol.for("react.recoverable"),
    G = Symbol.for("react.optimistic_key");
  function H(D, T, C) {
    var fl = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: N,
      key: fl == null ? null : fl === G ? G : "" + fl,
      children: D,
      containerInfo: T,
      implementation: C,
    };
  }
  var q = s.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function $(D, T) {
    if (D === "font") return "";
    if (typeof T == "string") return T === "use-credentials" ? T : "";
  }
  return (
    (Wl.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = o),
    (Wl.browser = function (D) {
      return { $$typeof: M, _reason: D };
    }),
    (Wl.createPortal = function (D, T) {
      var C = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!T || (T.nodeType !== 1 && T.nodeType !== 9 && T.nodeType !== 11)) throw Error(b(299));
      return H(D, T, null, C);
    }),
    (Wl.flushSync = function (D) {
      var T = q.T,
        C = o.p;
      try {
        if (((q.T = null), (o.p = 2), D)) return D();
      } finally {
        (q.T = T), (o.p = C), o.d.f();
      }
    }),
    (Wl.preconnect = function (D, T) {
      typeof D == "string" &&
        (T
          ? ((T = T.crossOrigin),
            (T = typeof T == "string" ? (T === "use-credentials" ? T : "") : void 0))
          : (T = null),
        o.d.C(D, T));
    }),
    (Wl.prefetchDNS = function (D) {
      typeof D == "string" && o.d.D(D);
    }),
    (Wl.preinit = function (D, T) {
      if (typeof D == "string" && T && typeof T.as == "string") {
        var C = T.as,
          fl = $(C, T.crossOrigin),
          W = typeof T.integrity == "string" ? T.integrity : void 0,
          Ul = typeof T.fetchPriority == "string" ? T.fetchPriority : void 0;
        C === "style"
          ? o.d.S(D, typeof T.precedence == "string" ? T.precedence : void 0, {
              crossOrigin: fl,
              integrity: W,
              fetchPriority: Ul,
            })
          : C === "script" &&
            o.d.X(D, {
              crossOrigin: fl,
              integrity: W,
              fetchPriority: Ul,
              nonce: typeof T.nonce == "string" ? T.nonce : void 0,
            });
      }
    }),
    (Wl.preinitModule = function (D, T) {
      if (typeof D == "string")
        if (typeof T == "object" && T !== null) {
          if (T.as == null || T.as === "script") {
            var C = $(T.as, T.crossOrigin);
            o.d.M(D, {
              crossOrigin: C,
              integrity: typeof T.integrity == "string" ? T.integrity : void 0,
              nonce: typeof T.nonce == "string" ? T.nonce : void 0,
              fetchPriority: typeof T.fetchPriority == "string" ? T.fetchPriority : void 0,
            });
          }
        } else T == null && o.d.M(D);
    }),
    (Wl.preload = function (D, T) {
      if (typeof D == "string" && typeof T == "object" && T !== null && typeof T.as == "string") {
        var C = T.as,
          fl = $(C, T.crossOrigin);
        o.d.L(D, C, {
          crossOrigin: fl,
          integrity: typeof T.integrity == "string" ? T.integrity : void 0,
          nonce: typeof T.nonce == "string" ? T.nonce : void 0,
          type: typeof T.type == "string" ? T.type : void 0,
          fetchPriority: typeof T.fetchPriority == "string" ? T.fetchPriority : void 0,
          referrerPolicy: typeof T.referrerPolicy == "string" ? T.referrerPolicy : void 0,
          imageSrcSet: typeof T.imageSrcSet == "string" ? T.imageSrcSet : void 0,
          imageSizes: typeof T.imageSizes == "string" ? T.imageSizes : void 0,
          media: typeof T.media == "string" ? T.media : void 0,
        });
      }
    }),
    (Wl.preloadModule = function (D, T) {
      if (typeof D == "string")
        if (T) {
          var C = $(T.as, T.crossOrigin);
          o.d.m(D, {
            as: typeof T.as == "string" && T.as !== "script" ? T.as : void 0,
            crossOrigin: C,
            integrity: typeof T.integrity == "string" ? T.integrity : void 0,
            nonce: typeof T.nonce == "string" ? T.nonce : void 0,
            fetchPriority: typeof T.fetchPriority == "string" ? T.fetchPriority : void 0,
          });
        } else o.d.m(D);
    }),
    (Wl.requestFormReset = function (D) {
      o.d.r(D);
    }),
    (Wl.unstable_batchedUpdates = function (D, T) {
      return D(T);
    }),
    (Wl.useFormState = function (D, T, C) {
      return q.H.useFormState(D, T, C);
    }),
    (Wl.useFormStatus = function () {
      return q.H.useHostTransitionStatus();
    }),
    (Wl.version = "19.3.1"),
    Wl
  );
}
var E2;
function Ym() {
  if (E2) return B0.exports;
  E2 = 1;
  function s() {
    if (
      !(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      )
    )
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s);
      } catch (b) {
        console.error(b);
      }
  }
  return (s(), (B0.exports = Bm()), B0.exports);
} /**
 * @license React
 * react-dom-client.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var T2;
function Zm() {
  if (T2) return vn;
  T2 = 1;
  var s = qm(),
    b = V0(),
    z = Ym();
  function o(l) {
    var t = "https://react.dev/errors/" + l;
    if (1 < arguments.length) {
      t += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var e = 2; e < arguments.length; e++) t += "&args[]=" + encodeURIComponent(arguments[e]);
    }
    return (
      "Minified React error #" +
      l +
      "; visit " +
      t +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function N(l) {
    return !(!l || (l.nodeType !== 1 && l.nodeType !== 9 && l.nodeType !== 11));
  }
  function M(l) {
    for (var t = l, e = t; e && !e.alternate; )
      (t = e), (t.flags & 4098) !== 0 && (l = t.return), (e = t.return);
    for (; t.return; ) t = t.return;
    return t.tag === 3 ? l : null;
  }
  function G(l) {
    if (l.tag === 13) {
      var t = l.memoizedState;
      if ((t === null && ((l = l.alternate), l !== null && (t = l.memoizedState)), t !== null))
        return t.dehydrated;
    }
    return null;
  }
  function H(l) {
    if (l.tag === 31) {
      var t = l.memoizedState;
      if ((t === null && ((l = l.alternate), l !== null && (t = l.memoizedState)), t !== null))
        return t.dehydrated;
    }
    return null;
  }
  function q(l) {
    if (M(l) !== l) throw Error(o(188));
  }
  function $(l) {
    var t = l.alternate;
    if (!t) {
      if (((t = M(l)), t === null)) throw Error(o(188));
      return t !== l ? null : l;
    }
    for (var e = l, a = t; ; ) {
      var u = e.return;
      if (u === null) break;
      var n = u.alternate;
      if (n === null) {
        if (((a = u.return), a !== null)) {
          e = a;
          continue;
        }
        break;
      }
      if (u.child === n.child) {
        for (n = u.child; n; ) {
          if (n === e) return (q(u), l);
          if (n === a) return (q(u), t);
          n = n.sibling;
        }
        throw Error(o(188));
      }
      if (e.return !== a.return) (e = u), (a = n);
      else {
        for (var i = !1, c = u.child; c; ) {
          if (c === e) {
            (i = !0), (e = u), (a = n);
            break;
          }
          if (c === a) {
            (i = !0), (a = u), (e = n);
            break;
          }
          c = c.sibling;
        }
        if (!i) {
          for (c = n.child; c; ) {
            if (c === e) {
              (i = !0), (e = n), (a = u);
              break;
            }
            if (c === a) {
              (i = !0), (a = n), (e = u);
              break;
            }
            c = c.sibling;
          }
          if (!i) throw Error(o(189));
        }
      }
      if (e.alternate !== a) throw Error(o(190));
    }
    if (e.tag !== 3) throw Error(o(188));
    return e.stateNode.current === e ? l : t;
  }
  function D(l) {
    var t = l.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return l;
    for (l = l.child; l !== null; ) {
      if (((t = D(l)), t !== null)) return t;
      l = l.sibling;
    }
    return null;
  }
  function T(l, t, e, a, u, n) {
    for (; l !== null; ) {
      if (
        ((l.tag === 5 || l.tag === 27 || l.tag === 6) && e(l, a, u, n)) ||
        ((l.tag !== 22 || l.memoizedState === null) &&
          (t || (l.tag !== 5 && l.tag !== 27)) &&
          T(l.child, t, e, a, u, n))
      )
        return !0;
      l = l.sibling;
    }
    return !1;
  }
  function C(l) {
    for (l = l.return; l !== null; ) {
      if (l.tag === 3 || l.tag === 5 || l.tag === 27) return l;
      l = l.return;
    }
    return null;
  }
  function fl(l) {
    var t = !1;
    for (
      l = l.return;
      l !== null && (l.tag === 4 && (t = !0), !(l.tag === 3 || l.tag === 5 || l.tag === 27));
    )
      l = l.return;
    return t;
  }
  function W(l) {
    var t = [null, null],
      e = C(l);
    return (e === null || Ul(t, l, e.child, { foundSelf: !1 }), t);
  }
  function Ul(l, t, e, a) {
    for (; e !== null; ) {
      if (e === t) a.foundSelf = !0;
      else if (e.tag === 5 || e.tag === 27 || e.tag === 6) {
        if (a.foundSelf) return ((l[1] = e), !0);
        l[0] = e;
      } else if ((e.tag !== 22 || e.memoizedState === null) && Ul(l, t, e.child, a)) return !0;
      e = e.sibling;
    }
    return !1;
  }
  function k(l) {
    switch (l.tag) {
      case 5:
      case 27:
      case 6:
        return l.stateNode;
      case 3:
        return l.stateNode.containerInfo;
      default:
        throw Error(o(559));
    }
  }
  var Dl = null,
    Pl = null;
  function lt(l, t, e) {
    return l === e ? !0 : l === t ? ((Dl = l), !0) : !1;
  }
  function Q(l, t, e) {
    return l === e ? ((Pl = l), !1) : l === t ? (Pl !== null && (Dl = l), !0) : !1;
  }
  function ll(l) {
    if (l === null) return null;
    do l = l === null ? null : l.return;
    while (l && l.tag !== 5 && l.tag !== 27 && l.tag !== 3);
    return l || null;
  }
  function il(l, t, e) {
    for (var a = 0, u = l; u; u = e(u)) a++;
    u = 0;
    for (var n = t; n; n = e(n)) u++;
    for (; 0 < a - u; ) (l = e(l)), a--;
    for (; 0 < u - a; ) (t = e(t)), u--;
    for (; a--; ) {
      if (l === t || (t !== null && l === t.alternate)) return l;
      (l = e(l)), (t = e(t));
    }
    return null;
  }
  var V = Object.assign,
    cl = Symbol.for("react.element"),
    dt = Symbol.for("react.transitional.element"),
    Ot = Symbol.for("react.portal"),
    _t = Symbol.for("react.fragment"),
    vt = Symbol.for("react.strict_mode"),
    Ee = Symbol.for("react.profiler"),
    ke = Symbol.for("react.consumer"),
    Yl = Symbol.for("react.context"),
    U = Symbol.for("react.forward_ref"),
    w = Symbol.for("react.suspense"),
    K = Symbol.for("react.suspense_list"),
    Tl = Symbol.for("react.memo"),
    hl = Symbol.for("react.lazy"),
    qt = Symbol.for("react.activity"),
    ae = Symbol.for("react.legacy_hidden"),
    Ie = Symbol.for("react.memo_cache_sentinel"),
    d = Symbol.for("react.view_transition"),
    _ = Symbol.for("react.recoverable"),
    Z = Symbol.iterator;
  function L(l) {
    return l === null || typeof l != "object"
      ? null
      : ((l = (Z && l[Z]) || l["@@iterator"]), typeof l == "function" ? l : null);
  }
  var ol = Symbol.for("react.client.reference");
  function rl(l) {
    if (l == null) return null;
    if (typeof l == "function") return l.$$typeof === ol ? null : l.displayName || l.name || null;
    if (typeof l == "string") return l;
    switch (l) {
      case _t:
        return "Fragment";
      case Ee:
        return "Profiler";
      case vt:
        return "StrictMode";
      case w:
        return "Suspense";
      case K:
        return "SuspenseList";
      case qt:
        return "Activity";
      case d:
        return "ViewTransition";
    }
    if (typeof l == "object")
      switch (l.$$typeof) {
        case Ot:
          return "Portal";
        case Yl:
          return l.displayName || "Context";
        case ke:
          return (l._context.displayName || "Context") + ".Consumer";
        case U:
          var t = l.render;
          return (
            (l = l.displayName),
            l ||
              ((l = t.displayName || t.name || ""),
              (l = l !== "" ? "ForwardRef(" + l + ")" : "ForwardRef")),
            l
          );
        case Tl:
          return ((t = l.displayName || null), t !== null ? t : rl(l.type) || "Memo");
        case hl:
          (t = l._payload), (l = l._init);
          try {
            return rl(l(t));
          } catch {}
      }
    return null;
  }
  var vl = Array.isArray,
    B = b.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    J = z.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    ue = { pending: !1, data: null, method: null, action: null },
    Fi = [],
    pa = -1;
  function Xt(l) {
    return { current: l };
  }
  function Xl(l) {
    0 > pa || ((l.current = Fi[pa]), (Fi[pa] = null), pa--);
  }
  function Al(l, t) {
    pa++, (Fi[pa] = l.current), (l.current = t);
  }
  var Qt = Xt(null),
    Su = Xt(null),
    Te = Xt(null),
    Sn = Xt(null);
  function bn(l, t) {
    switch ((Al(Te, t), Al(Su, l), Al(Qt, null), t.nodeType)) {
      case 9:
      case 11:
        l = (l = t.documentElement) && (l = l.namespaceURI) ? Ar(l) : 0;
        break;
      default:
        if (((l = t.tagName), (t = t.namespaceURI))) (t = Ar(t)), (l = pr(t, l));
        else
          switch (l) {
            case "svg":
              l = 1;
              break;
            case "math":
              l = 2;
              break;
            default:
              l = 0;
          }
    }
    Xl(Qt), Al(Qt, l);
  }
  function Oa() {
    Xl(Qt), Xl(Su), Xl(Te);
  }
  function $i(l) {
    var t = l.memoizedState;
    t !== null && ((du._currentValue = t.memoizedState), Al(Sn, l)), (t = Qt.current);
    var e = pr(t, l.type);
    t !== e && (Al(Su, l), Al(Qt, e));
  }
  function En(l) {
    Su.current === l && (Xl(Qt), Xl(Su)), Sn.current === l && (Xl(Sn), (du._currentValue = ue));
  }
  var Wi, X0;
  function ze(l) {
    if (Wi === void 0)
      try {
        throw Error();
      } catch (e) {
        var t = e.stack.trim().match(/\n( *(at )?)/);
        (Wi = (t && t[1]) || ""),
          (X0 =
            -1 <
            e.stack.indexOf(`
    at`)
              ? " (<anonymous>)"
              : -1 < e.stack.indexOf("@")
                ? "@unknown:0:0"
                : "");
      }
    return (
      `
` +
      Wi +
      l +
      X0
    );
  }
  var ki = !1;
  function Ii(l, t) {
    if (!l || ki) return "";
    ki = !0;
    var e = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var a = {
        DetermineComponentFrameRoot: function () {
          try {
            if (t) {
              var p = function () {
                throw Error();
              };
              if (
                (Object.defineProperty(p.prototype, "props", {
                  set: function () {
                    throw Error();
                  },
                }),
                typeof Reflect == "object" && Reflect.construct)
              ) {
                try {
                  Reflect.construct(p, []);
                } catch (x) {
                  var v = x;
                }
                Reflect.construct(l, [], p);
              } else {
                try {
                  p.call();
                } catch (x) {
                  v = x;
                }
                p = !1;
                try {
                  var g = Object.getOwnPropertyDescriptor(l.prototype, "props");
                  Object.defineProperty(l.prototype, "props", {
                    configurable: !0,
                    set: function () {
                      throw Error();
                    },
                  }),
                    (p = !0),
                    new l();
                } finally {
                  p &&
                    (g !== void 0
                      ? Object.defineProperty(l.prototype, "props", g)
                      : delete l.prototype.props);
                }
              }
            } else {
              try {
                throw Error();
              } catch (x) {
                v = x;
              }
              (p = l()) && typeof p.catch == "function" && p.catch(function () {});
            }
          } catch (x) {
            if (x && v && typeof x.stack == "string") return [x.stack, v.stack];
          }
          return [null, null];
        },
      };
      a.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var u = Object.getOwnPropertyDescriptor(a.DetermineComponentFrameRoot, "name");
      u &&
        u.configurable &&
        Object.defineProperty(a.DetermineComponentFrameRoot, "name", {
          value: "DetermineComponentFrameRoot",
        });
      var n = a.DetermineComponentFrameRoot(),
        i = n[0],
        c = n[1];
      if (i && c) {
        var f = i.split(`
`),
          h = c.split(`
`);
        for (u = a = 0; a < f.length && !f[a].includes("DetermineComponentFrameRoot"); ) a++;
        for (; u < h.length && !h[u].includes("DetermineComponentFrameRoot"); ) u++;
        if (a === f.length || u === h.length)
          for (a = f.length - 1, u = h.length - 1; 1 <= a && 0 <= u && f[a] !== h[u]; ) u--;
        for (; 1 <= a && 0 <= u; a--, u--)
          if (f[a] !== h[u]) {
            if (a !== 1 || u !== 1)
              do
                if ((a--, u--, 0 > u || f[a] !== h[u])) {
                  var S =
                    `
` + f[a].replace(" at new ", " at ");
                  return (
                    l.displayName &&
                      S.includes("<anonymous>") &&
                      (S = S.replace("<anonymous>", l.displayName)),
                    S
                  );
                }
              while (1 <= a && 0 <= u);
            break;
          }
      }
    } finally {
      (ki = !1), (Error.prepareStackTrace = e);
    }
    return (e = l ? l.displayName || l.name : "") ? ze(e) : "";
  }
  function R2(l, t) {
    switch (l.tag) {
      case 26:
      case 27:
      case 5:
        return ze(l.type);
      case 16:
        return ze("Lazy");
      case 13:
        return l.child !== t && t !== null ? ze("Suspense Fallback") : ze("Suspense");
      case 19:
        return ze("SuspenseList");
      case 0:
      case 15:
        return Ii(l.type, !1);
      case 11:
        return Ii(l.type.render, !1);
      case 1:
        return Ii(l.type, !0);
      case 31:
        return ze("Activity");
      case 30:
        return ze("ViewTransition");
      default:
        return "";
    }
  }
  function Q0(l) {
    try {
      var t = "",
        e = null;
      do (t += R2(l, e)), (e = l), (l = l.return);
      while (l);
      return t;
    } catch (a) {
      return (
        `
Error generating stack: ` +
        a.message +
        `
` +
        a.stack
      );
    }
  }
  var Pi = Object.prototype.hasOwnProperty,
    lc = s.unstable_scheduleCallback,
    tc = s.unstable_cancelCallback,
    H2 = s.unstable_shouldYield,
    j2 = s.unstable_requestPaint,
    mt = s.unstable_now,
    q2 = s.unstable_getCurrentPriorityLevel,
    w0 = s.unstable_ImmediatePriority,
    K0 = s.unstable_UserBlockingPriority,
    Tn = s.unstable_NormalPriority,
    B2 = s.unstable_LowPriority,
    J0 = s.unstable_IdlePriority,
    Y2 = s.log,
    Z2 = s.unstable_setDisableYieldValue,
    bu = null,
    ht = null;
  function Ae(l) {
    if ((typeof Y2 == "function" && Z2(l), ht && typeof ht.setStrictMode == "function"))
      try {
        ht.setStrictMode(bu, l);
      } catch {}
  }
  var yt = Math.clz32 ? Math.clz32 : V2,
    L2 = Math.log,
    G2 = Math.LN2;
  function V2(l) {
    return ((l >>>= 0), l === 0 ? 32 : (31 - ((L2(l) / G2) | 0)) | 0);
  }
  var zn = 256,
    An = 262144,
    pn = 4194304;
  function Pe(l) {
    var t = l & 42;
    if (t !== 0) return t;
    switch (l & -l) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return l & -l;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return l & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return l & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return l;
    }
  }
  function On(l, t, e) {
    var a = l.pendingLanes;
    if (a === 0) return 0;
    var u = 0,
      n = l.suspendedLanes,
      i = l.pingedLanes;
    l = l.warmLanes;
    var c = a & 134217727;
    return (
      c !== 0
        ? ((a = c & ~n),
          a !== 0
            ? (u = Pe(a))
            : ((i &= c), i !== 0 ? (u = Pe(i)) : e || ((e = c & ~l), e !== 0 && (u = Pe(e)))))
        : ((c = a & ~n),
          c !== 0
            ? (u = Pe(c))
            : i !== 0
              ? (u = Pe(i))
              : e || ((e = a & ~l), e !== 0 && (u = Pe(e)))),
      u === 0
        ? 0
        : t !== 0 &&
            t !== u &&
            (t & n) === 0 &&
            ((n = u & -u), (e = t & -t), n >= e || (n === 32 && (e & 4194048) !== 0))
          ? t
          : u
    );
  }
  function Eu(l, t) {
    return (l.pendingLanes & ~(l.suspendedLanes & ~l.pingedLanes) & t) === 0;
  }
  function F0(l, t) {
    (t & 8) !== 0 && (t |= t & 32);
    var e = l.entangledLanes;
    if (e !== 0)
      for (l = l.entanglements, e &= t; 0 < e; ) {
        var a = 31 - yt(e),
          u = 1 << a;
        (t |= l[a]), (e &= ~u);
      }
    return t;
  }
  function X2(l, t) {
    switch (l) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return t + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function $0() {
    var l = pn;
    return ((pn <<= 1), (pn & 62914560) === 0 && (pn = 4194304), l);
  }
  function ec(l) {
    for (var t = [], e = 0; 31 > e; e++) t.push(l);
    return t;
  }
  function Tu(l, t) {
    (l.pendingLanes |= t),
      t !== 268435456 && ((l.suspendedLanes = 0), (l.pingedLanes = 0), (l.warmLanes = 0));
  }
  function Q2(l, t, e, a, u, n) {
    var i = l.pendingLanes;
    (l.pendingLanes = e),
      (l.suspendedLanes = 0),
      (l.pingedLanes = 0),
      (l.warmLanes = 0),
      (l.expiredLanes &= e),
      (l.entangledLanes &= e),
      (l.errorRecoveryDisabledLanes &= e),
      (l.shellSuspendCounter = 0);
    var c = l.entanglements,
      f = l.expirationTimes,
      h = l.hiddenUpdates;
    for (e = i & ~e; 0 < e; ) {
      var S = 31 - yt(e),
        p = 1 << S;
      (c[S] = 0), (f[S] = -1);
      var v = h[S];
      if (v !== null)
        for (h[S] = null, S = 0; S < v.length; S++) {
          var g = v[S];
          g !== null && (g.lane &= -536870913);
        }
      e &= ~p;
    }
    a !== 0 && W0(l, a, 0),
      n !== 0 && u === 0 && l.tag !== 0 && (l.suspendedLanes |= n & ~(i & ~t));
  }
  function W0(l, t, e) {
    (l.pendingLanes |= t), (l.suspendedLanes &= ~t);
    var a = 31 - yt(t);
    (l.entangledLanes |= t), (l.entanglements[a] = l.entanglements[a] | 1073741824 | (e & 261930));
  }
  function k0(l, t) {
    var e = (l.entangledLanes |= t);
    for (l = l.entanglements; e; ) {
      var a = 31 - yt(e),
        u = 1 << a;
      (u & t) | (l[a] & t) && (l[a] |= t), (e &= ~u);
    }
  }
  function I0(l, t) {
    var e = t & -t;
    return ((e = (e & 42) !== 0 ? 1 : ac(e)), (e & (l.suspendedLanes | t)) !== 0 ? 0 : e);
  }
  function ac(l) {
    switch (l) {
      case 2:
        l = 1;
        break;
      case 8:
        l = 4;
        break;
      case 32:
        l = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        l = 128;
        break;
      case 268435456:
        l = 134217728;
        break;
      default:
        l = 0;
    }
    return l;
  }
  function uc(l) {
    return ((l &= -l), 2 < l ? (8 < l ? ((l & 134217727) !== 0 ? 32 : 268435456) : 8) : 2);
  }
  function P0() {
    var l = J.p;
    return l !== 0 ? l : ((l = window.event), l === void 0 ? 32 : c2(l.type));
  }
  function l1(l, t) {
    var e = J.p;
    try {
      return ((J.p = l), t());
    } finally {
      J.p = e;
    }
  }
  var ne = Math.random().toString(36).slice(2),
    Ql = "__reactFiber$" + ne,
    it = "__reactProps$" + ne,
    _a = "__reactContainer$" + ne,
    t1 = "__reactEvents$" + ne,
    w2 = "__reactListeners$" + ne,
    K2 = "__reactHandles$" + ne,
    e1 = "__reactResources$" + ne,
    zu = "__reactMarker$" + ne,
    _n = "__reactLoad$" + ne;
  function Nn(l) {
    delete l[Ql], delete l[it], delete l[w2], delete l[K2];
  }
  function la(l) {
    var t;
    if ((t = l[Ql])) return t;
    for (var e = l.parentNode; e; ) {
      if ((t = e[_a] || e[Ql])) {
        if (((e = t.alternate), t.child !== null || (e !== null && e.child !== null)))
          for (l = Gr(l); l !== null; ) {
            if ((e = l[Ql])) return e;
            l = Gr(l);
          }
        return t;
      }
      (l = e), (e = l.parentNode);
    }
    return null;
  }
  function Na(l) {
    if ((l = l[Ql] || l[_a])) {
      var t = l.tag;
      if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return l;
    }
    return null;
  }
  function Au(l) {
    var t = l.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return l.stateNode;
    throw Error(o(33));
  }
  function Ma(l) {
    var t = l[e1];
    return (t || (t = l[e1] = { hoistableStyles: new Map(), hoistableScripts: new Map() }), t);
  }
  function Zl(l) {
    l[zu] = !0;
  }
  function a1(l) {
    l[_n] = void 0;
  }
  var u1 = new Set(),
    n1 = {};
  function ta(l, t) {
    xa(l, t), xa(l + "Capture", t);
  }
  function xa(l, t) {
    for (n1[l] = t, l = 0; l < t.length; l++) u1.add(t[l]);
  }
  var J2 = RegExp(
      "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$",
    ),
    i1 = {},
    c1 = {};
  function F2(l) {
    return Pi.call(c1, l)
      ? !0
      : Pi.call(i1, l)
        ? !1
        : J2.test(l)
          ? (c1[l] = !0)
          : ((i1[l] = !0), !1);
  }
  var dl = !1;
  function f1() {
    var l = dl;
    return ((dl = !1), l);
  }
  function Mn(l, t, e) {
    if (F2(t))
      if (e === null) l.removeAttribute(t);
      else {
        switch (typeof e) {
          case "undefined":
          case "function":
          case "symbol":
            l.removeAttribute(t);
            return;
          case "boolean":
            var a = t.toLowerCase().slice(0, 5);
            if (a !== "data-" && a !== "aria-") {
              l.removeAttribute(t);
              return;
            }
        }
        l.setAttribute(t, e);
      }
  }
  function xn(l, t, e) {
    if (e === null) l.removeAttribute(t);
    else {
      switch (typeof e) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          l.removeAttribute(t);
          return;
      }
      l.setAttribute(t, e);
    }
  }
  function ie(l, t, e, a) {
    if (a === null) l.removeAttribute(e);
    else {
      switch (typeof a) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          l.removeAttribute(e);
          return;
      }
      l.setAttributeNS(t, e, a);
    }
  }
  function gt(l) {
    switch (typeof l) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return l;
      case "object":
        return l;
      default:
        return "";
    }
  }
  function s1(l) {
    var t = l.type;
    return (l = l.nodeName) && l.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
  }
  function $2(l, t, e) {
    var a = Object.getOwnPropertyDescriptor(l.constructor.prototype, t);
    if (
      !l.hasOwnProperty(t) &&
      typeof a < "u" &&
      typeof a.get == "function" &&
      typeof a.set == "function"
    ) {
      var u = a.get,
        n = a.set;
      return (
        Object.defineProperty(l, t, {
          configurable: !0,
          get: function () {
            return u.call(this);
          },
          set: function (i) {
            (e = "" + i), n.call(this, i);
          },
        }),
        Object.defineProperty(l, t, { enumerable: a.enumerable }),
        {
          getValue: function () {
            return e;
          },
          setValue: function (i) {
            e = "" + i;
          },
          stopTracking: function () {
            (l._valueTracker = null), delete l[t];
          },
        }
      );
    }
  }
  function nc(l) {
    if (!l._valueTracker) {
      var t = s1(l) ? "checked" : "value";
      l._valueTracker = $2(l, t, "" + l[t]);
    }
  }
  function o1(l) {
    if (!l) return !1;
    var t = l._valueTracker;
    if (!t) return !0;
    var e = t.getValue(),
      a = "";
    return (
      l && (a = s1(l) ? (l.checked ? "true" : "false") : l.value),
      (l = a),
      l !== e ? (t.setValue(l), !0) : !1
    );
  }
  var W2 = /[\n"\\]/g;
  function Nt(l) {
    return l.replace(W2, function (t) {
      return "\\" + t.charCodeAt(0).toString(16) + " ";
    });
  }
  function ic(l, t, e, a, u, n, i, c) {
    (l.name = ""),
      i != null && typeof i != "function" && typeof i != "symbol" && typeof i != "boolean"
        ? (l.type = i)
        : l.removeAttribute("type"),
      t != null
        ? i === "number"
          ? ((t === 0 && l.value === "") || l.value != t) && (l.value = "" + gt(t))
          : l.value !== "" + gt(t) && (l.value = "" + gt(t))
        : (i !== "submit" && i !== "reset") || l.removeAttribute("value"),
      t != null
        ? i === "number" && l.value == t
          ? cc(l, gt(l.value))
          : cc(l, gt(t))
        : e != null
          ? cc(l, gt(e))
          : a != null && l.removeAttribute("value"),
      u == null && n != null && (l.defaultChecked = !!n),
      u != null && (l.checked = u && typeof u != "function" && typeof u != "symbol"),
      c != null && typeof c != "function" && typeof c != "symbol" && typeof c != "boolean"
        ? (l.name = "" + gt(c))
        : l.removeAttribute("name");
  }
  function r1(l, t, e, a, u, n, i, c) {
    if (
      (n != null &&
        typeof n != "function" &&
        typeof n != "symbol" &&
        typeof n != "boolean" &&
        (l.type = n),
      t != null || e != null)
    ) {
      if (!((n !== "submit" && n !== "reset") || t != null)) {
        nc(l);
        return;
      }
      (e = e != null ? "" + gt(e) : ""),
        (t = t != null ? "" + gt(t) : e),
        c || t === l.value || (l.value = t),
        (l.defaultValue = t);
    }
    (a = a ?? u),
      (a = typeof a != "function" && typeof a != "symbol" && !!a),
      (l.checked = c ? l.checked : !!a),
      (l.defaultChecked = !!a),
      i != null &&
        typeof i != "function" &&
        typeof i != "symbol" &&
        typeof i != "boolean" &&
        (l.name = i),
      nc(l);
  }
  function cc(l, t) {
    l.defaultValue !== "" + t && (l.defaultValue = "" + t);
  }
  function Da(l, t, e, a) {
    if (((l = l.options), t)) {
      t = {};
      for (var u = 0; u < e.length; u++) t["$" + e[u]] = !0;
      for (e = 0; e < l.length; e++)
        (u = t.hasOwnProperty("$" + l[e].value)),
          l[e].selected !== u && (l[e].selected = u),
          u && a && (l[e].defaultSelected = !0);
    } else {
      for (e = "" + gt(e), t = null, u = 0; u < l.length; u++) {
        if (l[u].value === e) {
          (l[u].selected = !0), a && (l[u].defaultSelected = !0);
          return;
        }
        t !== null || l[u].disabled || (t = l[u]);
      }
      t !== null && (t.selected = !0);
    }
  }
  function d1(l, t, e) {
    if (t != null && ((t = "" + gt(t)), t !== l.value && (l.value = t), e == null)) {
      l.defaultValue !== t && (l.defaultValue = t);
      return;
    }
    l.defaultValue = e != null ? "" + gt(e) : "";
  }
  function v1(l, t, e, a) {
    if (t == null) {
      if (a != null) {
        if (e != null) throw Error(o(92));
        if (vl(a)) {
          if (1 < a.length) throw Error(o(93));
          a = a[0];
        }
        e = a;
      }
      e == null && (e = ""), (t = e);
    }
    (e = gt(t)),
      (l.defaultValue = e),
      (a = l.textContent),
      a === e && a !== "" && a !== null && (l.value = a),
      nc(l);
  }
  function Ca(l, t) {
    if (t) {
      var e = l.firstChild;
      if (e && e === l.lastChild && e.nodeType === 3) {
        e.nodeValue = t;
        return;
      }
    }
    l.textContent = t;
  }
  var k2 = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " ",
    ),
  );
  function m1(l, t, e) {
    var a = t.indexOf("--") === 0;
    e == null || typeof e == "boolean" || e === ""
      ? a
        ? l.setProperty(t, "")
        : t === "float"
          ? (l.cssFloat = "")
          : (l[t] = "")
      : a
        ? l.setProperty(t, e)
        : typeof e != "number" || e === 0 || k2.has(t)
          ? t === "float"
            ? (l.cssFloat = e)
            : (l[t] = ("" + e).trim())
          : (l[t] = e + "px");
  }
  function h1(l, t, e) {
    if (t != null && typeof t != "object") throw Error(o(62));
    if (((l = l.style), e != null)) {
      for (var a in e)
        !e.hasOwnProperty(a) ||
          (t != null && t.hasOwnProperty(a)) ||
          (a.indexOf("--") === 0
            ? l.setProperty(a, "")
            : a === "float"
              ? (l.cssFloat = "")
              : (l[a] = ""),
          (dl = !0));
      for (var u in t) (a = t[u]), t.hasOwnProperty(u) && e[u] !== a && (m1(l, u, a), (dl = !0));
    } else for (var n in t) t.hasOwnProperty(n) && m1(l, n, t[n]);
  }
  function fc(l) {
    if (l.indexOf("-") === -1) return !1;
    switch (l) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var I2 = new Map([
      ["acceptCharset", "accept-charset"],
      ["htmlFor", "for"],
      ["httpEquiv", "http-equiv"],
      ["crossOrigin", "crossorigin"],
      ["accentHeight", "accent-height"],
      ["alignmentBaseline", "alignment-baseline"],
      ["arabicForm", "arabic-form"],
      ["baselineShift", "baseline-shift"],
      ["capHeight", "cap-height"],
      ["clipPath", "clip-path"],
      ["clipRule", "clip-rule"],
      ["colorInterpolation", "color-interpolation"],
      ["colorInterpolationFilters", "color-interpolation-filters"],
      ["colorProfile", "color-profile"],
      ["colorRendering", "color-rendering"],
      ["dominantBaseline", "dominant-baseline"],
      ["enableBackground", "enable-background"],
      ["fillOpacity", "fill-opacity"],
      ["fillRule", "fill-rule"],
      ["floodColor", "flood-color"],
      ["floodOpacity", "flood-opacity"],
      ["fontFamily", "font-family"],
      ["fontSize", "font-size"],
      ["fontSizeAdjust", "font-size-adjust"],
      ["fontStretch", "font-stretch"],
      ["fontStyle", "font-style"],
      ["fontVariant", "font-variant"],
      ["fontWeight", "font-weight"],
      ["glyphName", "glyph-name"],
      ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
      ["glyphOrientationVertical", "glyph-orientation-vertical"],
      ["horizAdvX", "horiz-adv-x"],
      ["horizOriginX", "horiz-origin-x"],
      ["imageRendering", "image-rendering"],
      ["letterSpacing", "letter-spacing"],
      ["lightingColor", "lighting-color"],
      ["markerEnd", "marker-end"],
      ["markerMid", "marker-mid"],
      ["markerStart", "marker-start"],
      ["maskType", "mask-type"],
      ["overlinePosition", "overline-position"],
      ["overlineThickness", "overline-thickness"],
      ["paintOrder", "paint-order"],
      ["panose-1", "panose-1"],
      ["pointerEvents", "pointer-events"],
      ["renderingIntent", "rendering-intent"],
      ["shapeRendering", "shape-rendering"],
      ["stopColor", "stop-color"],
      ["stopOpacity", "stop-opacity"],
      ["strikethroughPosition", "strikethrough-position"],
      ["strikethroughThickness", "strikethrough-thickness"],
      ["strokeDasharray", "stroke-dasharray"],
      ["strokeDashoffset", "stroke-dashoffset"],
      ["strokeLinecap", "stroke-linecap"],
      ["strokeLinejoin", "stroke-linejoin"],
      ["strokeMiterlimit", "stroke-miterlimit"],
      ["strokeOpacity", "stroke-opacity"],
      ["strokeWidth", "stroke-width"],
      ["textAnchor", "text-anchor"],
      ["textDecoration", "text-decoration"],
      ["textRendering", "text-rendering"],
      ["transformOrigin", "transform-origin"],
      ["underlinePosition", "underline-position"],
      ["underlineThickness", "underline-thickness"],
      ["unicodeBidi", "unicode-bidi"],
      ["unicodeRange", "unicode-range"],
      ["unitsPerEm", "units-per-em"],
      ["vAlphabetic", "v-alphabetic"],
      ["vHanging", "v-hanging"],
      ["vIdeographic", "v-ideographic"],
      ["vMathematical", "v-mathematical"],
      ["vectorEffect", "vector-effect"],
      ["vertAdvY", "vert-adv-y"],
      ["vertOriginX", "vert-origin-x"],
      ["vertOriginY", "vert-origin-y"],
      ["wordSpacing", "word-spacing"],
      ["writingMode", "writing-mode"],
      ["xmlnsXlink", "xmlns:xlink"],
      ["xHeight", "x-height"],
    ]),
    P2 =
      /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function Dn(l) {
    return P2.test("" + l)
      ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
      : l;
  }
  function wt() {}
  var sc = null;
  function oc(l) {
    return (
      (l = l.target || l.srcElement || window),
      l.correspondingUseElement && (l = l.correspondingUseElement),
      l.nodeType === 3 ? l.parentNode : l
    );
  }
  var Ua = null,
    Ra = null;
  function y1(l) {
    var t = Na(l);
    if (t && (l = t.stateNode)) {
      var e = l[it] || null;
      l: switch (((l = t.stateNode), t.type)) {
        case "input":
          if (
            (ic(
              l,
              e.value,
              e.defaultValue,
              e.defaultValue,
              e.checked,
              e.defaultChecked,
              e.type,
              e.name,
            ),
            (t = e.name),
            e.type === "radio" && t != null)
          ) {
            for (e = l; e.parentNode; ) e = e.parentNode;
            for (
              e = e.querySelectorAll('input[name="' + Nt("" + t) + '"][type="radio"]'), t = 0;
              t < e.length;
              t++
            ) {
              var a = e[t];
              if (a !== l && a.form === l.form) {
                var u = a[it] || null;
                if (!u) throw Error(o(90));
                ic(
                  a,
                  u.value,
                  u.defaultValue,
                  u.defaultValue,
                  u.checked,
                  u.defaultChecked,
                  u.type,
                  u.name,
                );
              }
            }
            for (t = 0; t < e.length; t++) (a = e[t]), a.form === l.form && o1(a);
          }
          break l;
        case "textarea":
          d1(l, e.value, e.defaultValue);
          break l;
        case "select":
          (t = e.value), t != null && Da(l, !!e.multiple, t, !1);
      }
    }
  }
  var rc = !1;
  function g1(l, t, e) {
    if (rc) return l(t, e);
    rc = !0;
    try {
      var a = l(t);
      return a;
    } finally {
      if (
        ((rc = !1),
        (Ua !== null || Ra !== null) &&
          (Di(), Ua && ((t = Ua), (l = Ra), (Ra = Ua = null), y1(t), l)))
      )
        for (t = 0; t < l.length; t++) y1(l[t]);
    }
  }
  function pu(l, t) {
    var e = l.stateNode;
    if (e === null) return null;
    var a = e[it] || null;
    if (a === null) return null;
    e = a[t];
    l: switch (t) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (a = !a.disabled) ||
          ((l = l.type),
          (a = !(l === "button" || l === "input" || l === "select" || l === "textarea"))),
          (l = !a);
        break l;
      default:
        l = !1;
    }
    if (l) return null;
    if (e && typeof e != "function") throw Error(o(231, t, typeof e));
    return e;
  }
  var ce = !(
      typeof window > "u" ||
      typeof window.document > "u" ||
      typeof window.document.createElement > "u"
    ),
    dc = !1;
  if (ce)
    try {
      var Ou = {};
      Object.defineProperty(Ou, "passive", {
        get: function () {
          dc = !0;
        },
      }),
        window.addEventListener("test", Ou, Ou),
        window.removeEventListener("test", Ou, Ou);
    } catch {
      dc = !1;
    }
  var pe = null,
    vc = null,
    Cn = null;
  function S1() {
    if (Cn) return Cn;
    var l,
      t = vc,
      e = t.length,
      a,
      u = "value" in pe ? pe.value : pe.textContent,
      n = u.length;
    for (l = 0; l < e && t[l] === u[l]; l++);
    var i = e - l;
    for (a = 1; a <= i && t[e - a] === u[n - a]; a++);
    return (Cn = u.slice(l, 1 < a ? 1 - a : void 0));
  }
  function Un(l) {
    var t = l.keyCode;
    return (
      "charCode" in l ? ((l = l.charCode), l === 0 && t === 13 && (l = 13)) : (l = t),
      l === 10 && (l = 13),
      32 <= l || l === 13 ? l : 0
    );
  }
  function Rn() {
    return !0;
  }
  function b1() {
    return !1;
  }
  function tt(l) {
    function t(e, a, u, n, i) {
      (this._reactName = e),
        (this._targetInst = u),
        (this.type = a),
        (this.nativeEvent = n),
        (this.target = i),
        (this.currentTarget = null);
      for (var c in l) l.hasOwnProperty(c) && ((e = l[c]), (this[c] = e ? e(n) : n[c]));
      return (
        (this.isDefaultPrevented = (
          n.defaultPrevented != null
            ? n.defaultPrevented
            : n.returnValue === !1
        )
          ? Rn
          : b1),
        (this.isPropagationStopped = b1),
        this
      );
    }
    return (
      V(t.prototype, {
        preventDefault: function () {
          this.defaultPrevented = !0;
          var e = this.nativeEvent;
          e &&
            (e.preventDefault
              ? e.preventDefault()
              : typeof e.returnValue != "unknown" && (e.returnValue = !1),
            (this.isDefaultPrevented = Rn));
        },
        stopPropagation: function () {
          var e = this.nativeEvent;
          e &&
            (e.stopPropagation
              ? e.stopPropagation()
              : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0),
            (this.isPropagationStopped = Rn));
        },
        persist: function () {},
        isPersistent: Rn,
      }),
      t
    );
  }
  var Oe = {
      eventPhase: 0,
      bubbles: 0,
      cancelable: 0,
      timeStamp: function (l) {
        return l.timeStamp || Date.now();
      },
      defaultPrevented: 0,
      isTrusted: 0,
    },
    Hn = tt(Oe),
    _u = V({}, Oe, { view: 0, detail: 0 }),
    ld = tt(_u),
    mc,
    hc,
    Nu,
    jn = V({}, _u, {
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      getModifierState: gc,
      button: 0,
      buttons: 0,
      relatedTarget: function (l) {
        return l.relatedTarget === void 0
          ? l.fromElement === l.srcElement
            ? l.toElement
            : l.fromElement
          : l.relatedTarget;
      },
      movementX: function (l) {
        return "movementX" in l
          ? l.movementX
          : (l !== Nu &&
              (Nu && l.type === "mousemove"
                ? ((mc = l.screenX - Nu.screenX), (hc = l.screenY - Nu.screenY))
                : (hc = mc = 0),
              (Nu = l)),
            mc);
      },
      movementY: function (l) {
        return "movementY" in l ? l.movementY : hc;
      },
    }),
    E1 = tt(jn),
    td = V({}, jn, { dataTransfer: 0 }),
    ed = tt(td),
    ad = V({}, _u, { relatedTarget: 0 }),
    yc = tt(ad),
    ud = V({}, Oe, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
    nd = tt(ud),
    id = V({}, Oe, {
      clipboardData: function (l) {
        return "clipboardData" in l ? l.clipboardData : window.clipboardData;
      },
    }),
    cd = tt(id),
    fd = V({}, Oe, { data: 0 }),
    T1 = tt(fd),
    sd = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified",
    },
    od = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta",
    },
    rd = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
  function dd(l) {
    var t = this.nativeEvent;
    return t.getModifierState ? t.getModifierState(l) : (l = rd[l]) ? !!t[l] : !1;
  }
  function gc() {
    return dd;
  }
  var vd = V({}, _u, {
      key: function (l) {
        if (l.key) {
          var t = sd[l.key] || l.key;
          if (t !== "Unidentified") return t;
        }
        return l.type === "keypress"
          ? ((l = Un(l)), l === 13 ? "Enter" : String.fromCharCode(l))
          : l.type === "keydown" || l.type === "keyup"
            ? od[l.keyCode] || "Unidentified"
            : "";
      },
      code: 0,
      location: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      repeat: 0,
      locale: 0,
      getModifierState: gc,
      charCode: function (l) {
        return l.type === "keypress" ? Un(l) : 0;
      },
      keyCode: function (l) {
        return l.type === "keydown" || l.type === "keyup" ? l.keyCode : 0;
      },
      which: function (l) {
        return l.type === "keypress"
          ? Un(l)
          : l.type === "keydown" || l.type === "keyup"
            ? l.keyCode
            : 0;
      },
    }),
    md = tt(vd),
    hd = V({}, jn, {
      pointerId: 0,
      width: 0,
      height: 0,
      pressure: 0,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: 0,
      isPrimary: 0,
    }),
    z1 = tt(hd),
    yd = V({}, Oe, { submitter: 0 }),
    gd = tt(yd),
    Sd = V({}, _u, {
      touches: 0,
      targetTouches: 0,
      changedTouches: 0,
      altKey: 0,
      metaKey: 0,
      ctrlKey: 0,
      shiftKey: 0,
      getModifierState: gc,
    }),
    bd = tt(Sd),
    Ed = V({}, Oe, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
    Td = tt(Ed),
    zd = V({}, jn, {
      deltaX: function (l) {
        return "deltaX" in l ? l.deltaX : "wheelDeltaX" in l ? -l.wheelDeltaX : 0;
      },
      deltaY: function (l) {
        return "deltaY" in l
          ? l.deltaY
          : "wheelDeltaY" in l
            ? -l.wheelDeltaY
            : "wheelDelta" in l
              ? -l.wheelDelta
              : 0;
      },
      deltaZ: 0,
      deltaMode: 0,
    }),
    Ad = tt(zd),
    pd = V({}, Oe, { newState: 0, oldState: 0, source: 0 }),
    Od = tt(pd),
    _d = [9, 13, 27, 32],
    Sc = ce && "CompositionEvent" in window,
    Mu = null;
  ce && "documentMode" in document && (Mu = document.documentMode);
  var Nd = ce && "TextEvent" in window && !Mu,
    A1 = ce && (!Sc || (Mu && 8 < Mu && 11 >= Mu)),
    p1 = " ",
    O1 = !1;
  function _1(l, t) {
    switch (l) {
      case "keyup":
        return _d.indexOf(t.keyCode) !== -1;
      case "keydown":
        return t.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function N1(l) {
    return ((l = l.detail), typeof l == "object" && "data" in l ? l.data : null);
  }
  var Ha = !1;
  function Md(l, t) {
    switch (l) {
      case "compositionend":
        return N1(t);
      case "keypress":
        return t.which !== 32 ? null : ((O1 = !0), p1);
      case "textInput":
        return ((l = t.data), l === p1 && O1 ? null : l);
      default:
        return null;
    }
  }
  function xd(l, t) {
    if (Ha)
      return l === "compositionend" || (!Sc && _1(l, t))
        ? ((l = S1()), (Cn = vc = pe = null), (Ha = !1), l)
        : null;
    switch (l) {
      case "paste":
        return null;
      case "keypress":
        if (!(t.ctrlKey || t.altKey || t.metaKey) || (t.ctrlKey && t.altKey)) {
          if (t.char && 1 < t.char.length) return t.char;
          if (t.which) return String.fromCharCode(t.which);
        }
        return null;
      case "compositionend":
        return A1 && t.locale !== "ko" ? null : t.data;
      default:
        return null;
    }
  }
  var Dd = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0,
  };
  function M1(l) {
    var t = l && l.nodeName && l.nodeName.toLowerCase();
    return t === "input" ? !!Dd[l.type] : t === "textarea";
  }
  function x1(l, t, e, a) {
    Ua ? (Ra ? Ra.push(a) : (Ra = [a])) : (Ua = a),
      (t = qi(t, "onChange")),
      0 < t.length &&
        ((e = new Hn("onChange", "change", null, e, a)), l.push({ event: e, listeners: t }));
  }
  var xu = null,
    Du = null;
  function Cd(l) {
    gr(l, 0);
  }
  function qn(l) {
    var t = Au(l);
    if (o1(t)) return l;
  }
  function D1(l, t) {
    if (l === "change") return t;
  }
  var C1 = !1;
  if (ce) {
    var bc;
    if (ce) {
      var Ec = "oninput" in document;
      if (!Ec) {
        var U1 = document.createElement("div");
        U1.setAttribute("oninput", "return;"), (Ec = typeof U1.oninput == "function");
      }
      bc = Ec;
    } else bc = !1;
    C1 = bc && (!document.documentMode || 9 < document.documentMode);
  }
  function R1() {
    xu && (xu.detachEvent("onpropertychange", H1), (Du = xu = null));
  }
  function H1(l) {
    if (l.propertyName === "value" && qn(Du)) {
      var t = [];
      x1(t, Du, l, oc(l)), g1(Cd, t);
    }
  }
  function Ud(l, t, e) {
    l === "focusin"
      ? (R1(), (xu = t), (Du = e), xu.attachEvent("onpropertychange", H1))
      : l === "focusout" && R1();
  }
  function Rd(l) {
    if (l === "selectionchange" || l === "keyup" || l === "keydown") return qn(Du);
  }
  function Hd(l, t) {
    if (l === "click") return qn(t);
  }
  function jd(l, t) {
    if (l === "input" || l === "change") return qn(t);
  }
  function qd(l, t) {
    return (l === t && (l !== 0 || 1 / l === 1 / t)) || (l !== l && t !== t);
  }
  var St = typeof Object.is == "function" ? Object.is : qd;
  function Cu(l, t) {
    if (St(l, t)) return !0;
    if (typeof l != "object" || l === null || typeof t != "object" || t === null) return !1;
    var e = Object.keys(l),
      a = Object.keys(t);
    if (e.length !== a.length) return !1;
    for (a = 0; a < e.length; a++) {
      var u = e[a];
      if (!Pi.call(t, u) || !St(l[u], t[u])) return !1;
    }
    return !0;
  }
  function Tc(l) {
    if (((l = l || (typeof document < "u" ? document : void 0)), typeof l > "u")) return null;
    try {
      return l.activeElement || l.body;
    } catch {
      return l.body;
    }
  }
  function j1(l) {
    for (; l && l.firstChild; ) l = l.firstChild;
    return l;
  }
  function q1(l, t) {
    var e = j1(l);
    l = 0;
    for (var a; e; ) {
      if (e.nodeType === 3) {
        if (((a = l + e.textContent.length), l <= t && a >= t)) return { node: e, offset: t - l };
        l = a;
      }
      l: {
        for (; e; ) {
          if (e.nextSibling) {
            e = e.nextSibling;
            break l;
          }
          e = e.parentNode;
        }
        e = void 0;
      }
      e = j1(e);
    }
  }
  function B1(l, t) {
    return l && t
      ? l === t
        ? !0
        : l && l.nodeType === 3
          ? !1
          : t && t.nodeType === 3
            ? B1(l, t.parentNode)
            : "contains" in l
              ? l.contains(t)
              : l.compareDocumentPosition
                ? !!(l.compareDocumentPosition(t) & 16)
                : !1
      : !1;
  }
  function Y1(l) {
    l =
      l != null && l.ownerDocument != null && l.ownerDocument.defaultView != null
        ? l.ownerDocument.defaultView
        : window;
    for (var t = Tc(l.document); t instanceof l.HTMLIFrameElement; ) {
      try {
        var e = typeof t.contentWindow.location.href == "string";
      } catch {
        e = !1;
      }
      if (e) l = t.contentWindow;
      else break;
      t = Tc(l.document);
    }
    return t;
  }
  function zc(l) {
    var t = l && l.nodeName && l.nodeName.toLowerCase();
    return (
      t &&
      ((t === "input" &&
        (l.type === "text" ||
          l.type === "search" ||
          l.type === "tel" ||
          l.type === "url" ||
          l.type === "password")) ||
        t === "textarea" ||
        l.contentEditable === "true")
    );
  }
  var Bd = ce && "documentMode" in document && 11 >= document.documentMode,
    ja = null,
    Ac = null,
    Uu = null,
    pc = !1;
  function Z1(l, t, e) {
    var a = e.window === e ? e.document : e.nodeType === 9 ? e : e.ownerDocument;
    pc ||
      ja == null ||
      ja !== Tc(a) ||
      ((a = ja),
      "selectionStart" in a && zc(a)
        ? (a = { start: a.selectionStart, end: a.selectionEnd })
        : ((a = ((a.ownerDocument && a.ownerDocument.defaultView) || window).getSelection()),
          (a = {
            anchorNode: a.anchorNode,
            anchorOffset: a.anchorOffset,
            focusNode: a.focusNode,
            focusOffset: a.focusOffset,
          })),
      (Uu && Cu(Uu, a)) ||
        ((Uu = a),
        (a = qi(Ac, "onSelect")),
        0 < a.length &&
          ((t = new Hn("onSelect", "select", null, t, e)),
          l.push({ event: t, listeners: a }),
          (t.target = ja))));
  }
  function ea(l, t) {
    var e = {};
    return (
      (e[l.toLowerCase()] = t.toLowerCase()),
      (e["Webkit" + l] = "webkit" + t),
      (e["Moz" + l] = "moz" + t),
      e
    );
  }
  var qa = {
      animationend: ea("Animation", "AnimationEnd"),
      animationiteration: ea("Animation", "AnimationIteration"),
      animationstart: ea("Animation", "AnimationStart"),
      transitionrun: ea("Transition", "TransitionRun"),
      transitionstart: ea("Transition", "TransitionStart"),
      transitioncancel: ea("Transition", "TransitionCancel"),
      transitionend: ea("Transition", "TransitionEnd"),
    },
    Oc = {},
    L1 = {};
  ce &&
    ((L1 = document.createElement("div").style),
    "AnimationEvent" in window ||
      (delete qa.animationend.animation,
      delete qa.animationiteration.animation,
      delete qa.animationstart.animation),
    "TransitionEvent" in window || delete qa.transitionend.transition);
  function aa(l) {
    if (Oc[l]) return Oc[l];
    if (!qa[l]) return l;
    var t = qa[l],
      e;
    for (e in t) if (t.hasOwnProperty(e) && e in L1) return (Oc[l] = t[e]);
    return l;
  }
  var G1 = aa("animationend"),
    V1 = aa("animationiteration"),
    X1 = aa("animationstart"),
    Yd = aa("transitionrun"),
    Zd = aa("transitionstart"),
    Ld = aa("transitioncancel"),
    Q1 = aa("transitionend"),
    w1 = new Map(),
    _c =
      "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
        " ",
      );
  _c.push("scrollEnd");
  function Bt(l, t) {
    w1.set(l, t), ta(t, [l]);
  }
  var Gd = 0;
  function fe(l, t) {
    if (l.name != null && l.name !== "auto") return l.name;
    if (t.autoName !== null) return t.autoName;
    l = Gt.identifierPrefix;
    var e = Gd++;
    return ((l = "_" + l + "t_" + e.toString(32) + "_"), (t.autoName = l));
  }
  function K1(l) {
    if (l == null || typeof l == "string") return l;
    var t = null,
      e = eu;
    if (e !== null)
      for (var a = 0; a < e.length; a++) {
        var u = l[e[a]];
        if (u != null) {
          if (u === "none") return "none";
          t = t == null ? u : t + (" " + u);
        }
      }
    return t ?? l.default;
  }
  function se(l, t) {
    return (
      (l = K1(l)), (t = K1(t)), t == null ? (l === "auto" ? null : l) : t === "auto" ? null : t
    );
  }
  var Bn =
      typeof reportError == "function"
        ? reportError
        : function (l) {
            if (typeof window == "object" && typeof window.ErrorEvent == "function") {
              var t = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  typeof l == "object" && l !== null && typeof l.message == "string"
                    ? String(l.message)
                    : String(l),
                error: l,
              });
              if (!window.dispatchEvent(t)) return;
            } else if (typeof process == "object" && typeof process.emit == "function") {
              process.emit("uncaughtException", l);
              return;
            }
            console.error(l);
          },
    Mt = [],
    Ba = 0,
    Nc = 0;
  function Yn() {
    for (var l = Ba, t = (Nc = Ba = 0); t < l; ) {
      var e = Mt[t];
      Mt[t++] = null;
      var a = Mt[t];
      Mt[t++] = null;
      var u = Mt[t];
      Mt[t++] = null;
      var n = Mt[t];
      if (((Mt[t++] = null), a !== null && u !== null)) {
        var i = a.pending;
        i === null ? (u.next = u) : ((u.next = i.next), (i.next = u)), (a.pending = u);
      }
      n !== 0 && J1(e, u, n);
    }
  }
  function Zn(l, t, e, a) {
    (Mt[Ba++] = l),
      (Mt[Ba++] = t),
      (Mt[Ba++] = e),
      (Mt[Ba++] = a),
      (Nc |= a),
      (l.lanes |= a),
      (l = l.alternate),
      l !== null && (l.lanes |= a);
  }
  function Mc(l, t, e, a) {
    return (Zn(l, t, e, a), Ln(l));
  }
  function ua(l, t) {
    return (Zn(l, null, null, t), Ln(l));
  }
  function J1(l, t, e) {
    l.lanes |= e;
    var a = l.alternate;
    a !== null && (a.lanes |= e);
    for (var u = !1, n = l.return; n !== null; )
      (n.childLanes |= e),
        (a = n.alternate),
        a !== null && (a.childLanes |= e),
        n.tag === 22 && ((l = n.stateNode), l === null || l._visibility & 1 || (u = !0)),
        (l = n),
        (n = n.return);
    return l.tag === 3
      ? ((n = l.stateNode),
        u &&
          t !== null &&
          ((u = 31 - yt(e)),
          (l = n.hiddenUpdates),
          (a = l[u]),
          a === null ? (l[u] = [t]) : a.push(t),
          (t.lane = e | 536870912)),
        n)
      : null;
  }
  function Ln(l) {
    if (50 < ln) throw ((ln = 0), (xi = null), Error(o(185)));
    for (var t = l.return; t !== null; ) (l = t), (t = l.return);
    return l.tag === 3 ? l.stateNode : null;
  }
  var Ya = {};
  function Vd(l, t, e, a) {
    (this.tag = l),
      (this.key = e),
      (this.sibling =
        this.child =
        this.return =
        this.stateNode =
        this.type =
        this.elementType =
          null),
      (this.index = 0),
      (this.refCleanup = this.ref = null),
      (this.pendingProps = t),
      (this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null),
      (this.mode = a),
      (this.subtreeFlags = this.flags = 0),
      (this.deletions = null),
      (this.childLanes = this.lanes = 0),
      (this.alternate = null);
  }
  function ct(l, t, e, a) {
    return new Vd(l, t, e, a);
  }
  function xc(l) {
    return ((l = l.prototype), !(!l || !l.isReactComponent));
  }
  function oe(l, t) {
    var e = l.alternate;
    return (
      e === null
        ? ((e = ct(l.tag, t, l.key, l.mode)),
          (e.elementType = l.elementType),
          (e.type = l.type),
          (e.stateNode = l.stateNode),
          (e.alternate = l),
          (l.alternate = e))
        : ((e.pendingProps = t),
          (e.type = l.type),
          (e.flags = 0),
          (e.subtreeFlags = 0),
          (e.deletions = null)),
      (e.flags = l.flags & 1206910976),
      (e.childLanes = l.childLanes),
      (e.lanes = l.lanes),
      (e.child = l.child),
      (e.memoizedProps = l.memoizedProps),
      (e.memoizedState = l.memoizedState),
      (e.updateQueue = l.updateQueue),
      (t = l.dependencies),
      (e.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }),
      (e.sibling = l.sibling),
      (e.index = l.index),
      (e.ref = l.ref),
      (e.refCleanup = l.refCleanup),
      e
    );
  }
  function F1(l, t) {
    l.flags &= 1206910978;
    var e = l.alternate;
    return (
      e === null
        ? ((l.childLanes = 0),
          (l.lanes = t),
          (l.child = null),
          (l.subtreeFlags = 0),
          (l.memoizedProps = null),
          (l.memoizedState = null),
          (l.updateQueue = null),
          (l.dependencies = null),
          (l.stateNode = null))
        : ((l.childLanes = e.childLanes),
          (l.lanes = e.lanes),
          (l.child = e.child),
          (l.subtreeFlags = 0),
          (l.deletions = null),
          (l.memoizedProps = e.memoizedProps),
          (l.memoizedState = e.memoizedState),
          (l.updateQueue = e.updateQueue),
          (l.type = e.type),
          (t = e.dependencies),
          (l.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext })),
      l
    );
  }
  function Gn(l, t, e, a, u, n) {
    var i = 0;
    if (((a = l), typeof a == "function")) xc(a) && (i = 1);
    else if (typeof a == "string")
      i = ym(l, e, Qt.current) ? 26 : l === "html" || l === "head" || l === "body" ? 27 : 5;
    else
      l: switch (a) {
        case qt:
          return ((l = ct(31, e, t, u)), (l.elementType = qt), (l.lanes = n), l);
        case _t:
          return na(e.children, u, n, t);
        case vt:
          (i = 8), (u |= 24);
          break;
        case Ee:
          return ((l = ct(12, e, t, u | 2)), (l.elementType = Ee), (l.lanes = n), l);
        case w:
          return ((l = ct(13, e, t, u)), (l.elementType = w), (l.lanes = n), l);
        case K:
          return ((l = ct(19, e, t, u)), (l.elementType = K), (l.lanes = n), l);
        case ae:
        case d:
          return (
            (l = u | 32),
            (l = ct(30, e, t, l)),
            (l.elementType = d),
            (l.lanes = n),
            (l.stateNode = { autoName: null, paired: null, clones: null, ref: null }),
            l
          );
        default:
          if (typeof a == "object" && a !== null)
            switch (a.$$typeof) {
              case Yl:
                i = 10;
                break l;
              case ke:
                i = 9;
                break l;
              case U:
                i = 11;
                break l;
              case Tl:
                i = 14;
                break l;
              case hl:
                (i = 16), (a = null);
                break l;
            }
          (i = 29), (e = Error(o(130, l === null ? "null" : typeof l, ""))), (a = null);
      }
    return ((t = ct(i, e, t, u)), (t.elementType = l), (t.type = a), (t.lanes = n), t);
  }
  function na(l, t, e, a) {
    return ((l = ct(7, l, a, t)), (l.lanes = e), l);
  }
  function Dc(l, t, e) {
    return ((l = ct(6, l, null, t)), (l.lanes = e), l);
  }
  function $1(l) {
    var t = ct(18, null, null, 0);
    return ((t.stateNode = l), t);
  }
  function Cc(l, t, e) {
    return (
      (t = ct(4, l.children !== null ? l.children : [], l.key, t)),
      (t.lanes = e),
      (t.stateNode = {
        containerInfo: l.containerInfo,
        pendingChildren: null,
        implementation: l.implementation,
      }),
      t
    );
  }
  var W1 = new WeakMap();
  function xt(l, t) {
    if (typeof l == "object" && l !== null) {
      var e = W1.get(l);
      return e !== void 0 ? e : ((t = { value: l, source: t, stack: Q0(t) }), W1.set(l, t), t);
    }
    return { value: l, source: t, stack: Q0(t) };
  }
  var Za = [],
    La = 0,
    Vn = null,
    Ru = 0,
    Dt = [],
    Ct = 0,
    _e = null,
    Kt = 1,
    Jt = "";
  function re(l, t) {
    (Za[La++] = Ru), (Za[La++] = Vn), (Vn = l), (Ru = t);
  }
  function k1(l, t, e) {
    (Dt[Ct++] = Kt), (Dt[Ct++] = Jt), (Dt[Ct++] = _e), (_e = l);
    var a = Kt;
    l = Jt;
    var u = 32 - yt(a) - 1;
    (a &= ~(1 << u)), (e += 1);
    var n = 32 - yt(t) + u;
    if (30 < n) {
      var i = u - (u % 5);
      (n = (a & ((1 << i) - 1)).toString(32)),
        (a >>= i),
        (u -= i),
        (Kt = (1 << (32 - yt(t) + u)) | (e << u) | a),
        (Jt = n + l);
    } else (Kt = (1 << n) | (e << u) | a), (Jt = l);
  }
  function Xn(l) {
    l.return !== null && (re(l, 1), k1(l, 1, 0));
  }
  function Uc(l) {
    for (; l === Vn; ) (Vn = Za[--La]), (Za[La] = null), (Ru = Za[--La]), (Za[La] = null);
    for (; l === _e; )
      (_e = Dt[--Ct]),
        (Dt[Ct] = null),
        (Jt = Dt[--Ct]),
        (Dt[Ct] = null),
        (Kt = Dt[--Ct]),
        (Dt[Ct] = null);
  }
  function I1(l, t) {
    (Dt[Ct++] = Kt), (Dt[Ct++] = Jt), (Dt[Ct++] = _e), (Kt = t.id), (Jt = t.overflow), (_e = l);
  }
  var Ll = null,
    pl = null,
    tl = !1,
    Ne = null,
    Ut = !1,
    Rc = Error(o(519));
  function Me(l) {
    var t = Error(
      o(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", ""),
    );
    throw (Hu(xt(t, l)), Rc);
  }
  function P1(l) {
    var t = l.stateNode,
      e = l.type,
      a = l.memoizedProps;
    switch (((t[Ql] = l), (t[it] = a), e)) {
      case "dialog":
        al("cancel", t), al("close", t);
        break;
      case "iframe":
      case "object":
      case "embed":
        al("load", t);
        break;
      case "video":
      case "audio":
        for (e = 0; e < en.length; e++) al(en[e], t);
        break;
      case "source":
        al("error", t);
        break;
      case "img":
      case "image":
      case "link":
        al("error", t), al("load", t);
        break;
      case "details":
        al("toggle", t);
        break;
      case "input":
        al("invalid", t),
          r1(t, a.value, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name, !0);
        break;
      case "select":
        al("invalid", t);
        break;
      case "textarea":
        al("invalid", t), v1(t, a.value, a.defaultValue, a.children);
    }
    (e = a.children),
      (typeof e != "string" && typeof e != "number" && typeof e != "bigint") ||
      t.textContent === "" + e ||
      a.suppressHydrationWarning === !0 ||
      Tr(t.textContent, e)
        ? (a.popover != null && (al("beforetoggle", t), al("toggle", t)),
          a.onScroll != null && al("scroll", t),
          a.onScrollEnd != null && al("scrollend", t),
          a.onClick != null && (t.onclick = wt),
          (t = !0))
        : (t = !1),
      t || Me(l, !0);
  }
  function Qn(l) {
    for (Ll = l.return; Ll; )
      switch (Ll.tag) {
        case 5:
        case 31:
        case 13:
          Ut = !1;
          return;
        case 27:
        case 3:
          Ut = !0;
          return;
        default:
          Ll = Ll.return;
      }
  }
  function Ga(l) {
    if (l !== Ll) return !1;
    if (!tl) return (Qn(l), (tl = !0), !1);
    var t = l.tag,
      e;
    if (
      ((e = t !== 3 && t !== 27) &&
        ((e = t === 5) &&
          ((e = l.type), (e = !(e !== "form" && e !== "button") || o0(l.type, l.memoizedProps))),
        (e = !e)),
      e && pl && Me(l),
      Qn(l),
      t === 13)
    ) {
      if (((l = l.memoizedState), (l = l !== null ? l.dehydrated : null), !l)) throw Error(o(317));
      pl = Lr(l);
    } else if (t === 31) {
      if (((l = l.memoizedState), (l = l !== null ? l.dehydrated : null), !l)) throw Error(o(317));
      pl = Lr(l);
    } else
      t === 27
        ? ((t = pl), Qe(l.type) ? ((l = b0), (b0 = null), (pl = l)) : (pl = t))
        : (pl = Ll ? Ht(l.stateNode.nextSibling) : null);
    return !0;
  }
  function ia() {
    (pl = Ll = null), (tl = !1);
  }
  function Hc() {
    var l = Ne;
    return (l !== null && (ot === null ? (ot = l) : ot.push.apply(ot, l), (Ne = null)), l);
  }
  function Hu(l) {
    Ne === null ? (Ne = [l]) : Ne.push(l);
  }
  var jc = Xt(null),
    ca = null,
    de = null;
  function xe(l, t, e) {
    Al(jc, t._currentValue), (t._currentValue = e);
  }
  function ve(l) {
    (l._currentValue = jc.current), Xl(jc);
  }
  function wn(l, t, e) {
    for (; l !== null; ) {
      var a = l.alternate;
      if (
        ((l.childLanes & t) !== t
          ? ((l.childLanes |= t), a !== null && (a.childLanes |= t))
          : a !== null && (a.childLanes & t) !== t && (a.childLanes |= t),
        l === e)
      )
        break;
      l = l.return;
    }
  }
  function qc(l, t, e, a) {
    var u = l.child;
    for (u !== null && (u.return = l); u !== null; ) {
      var n = u.dependencies;
      if (n !== null) {
        var i = u.child;
        n = n.firstContext;
        l: for (; n !== null; ) {
          var c = n;
          n = u;
          for (var f = 0; f < t.length; f++)
            if (c.context === t[f]) {
              (n.lanes |= e),
                (c = n.alternate),
                c !== null && (c.lanes |= e),
                wn(n.return, e, l),
                a || (i = null);
              break l;
            }
          n = c.next;
        }
      } else if (u.tag === 18) {
        if (((i = u.return), i === null)) throw Error(o(341));
        (i.lanes |= e), (n = i.alternate), n !== null && (n.lanes |= e), wn(i, e, l), (i = null);
      } else
        u.tag === 13 && u.memoizedState !== null && u.memoizedState.dehydrated === null
          ? ((u.lanes |= e),
            (i = u.alternate),
            i !== null && (i.lanes |= e),
            wn(u.return, e, l),
            (i = u.child),
            (i = i !== null ? i.sibling : null))
          : (i = u.child);
      if (i !== null) i.return = u;
      else
        for (i = u; i !== null; ) {
          if (i === l) {
            i = null;
            break;
          }
          if (((u = i.sibling), u !== null)) {
            (u.return = i.return), (i = u);
            break;
          }
          i = i.return;
        }
      u = i;
    }
  }
  function fa(l, t, e, a) {
    l = null;
    for (var u = t, n = !1; u !== null; ) {
      if (!n) {
        if ((u.flags & 524288) !== 0) n = !0;
        else if ((u.flags & 262144) !== 0) break;
      }
      if (u.tag === 10) {
        var i = u.alternate;
        if (i === null) throw Error(o(387));
        if (((i = i.memoizedProps), i !== null)) {
          var c = u.type;
          St(u.pendingProps.value, i.value) || (l !== null ? l.push(c) : (l = [c]));
        }
      } else if (u === Sn.current) {
        if (((i = u.alternate), i === null)) throw Error(o(387));
        i.memoizedState.memoizedState !== u.memoizedState.memoizedState &&
          (l !== null ? l.push(du) : (l = [du]));
      }
      u = u.return;
    }
    return (l !== null && qc(t, l, e, a), (t.flags |= 262144), l !== null);
  }
  function Kn(l) {
    for (l = l.firstContext; l !== null; ) {
      if (!St(l.context._currentValue, l.memoizedValue)) return !0;
      l = l.next;
    }
    return !1;
  }
  function sa(l) {
    (ca = l), (de = null), (l = l.dependencies), l !== null && (l.firstContext = null);
  }
  function wl(l) {
    return ls(ca, l);
  }
  function Jn(l, t) {
    return (ca === null && sa(l), ls(l, t));
  }
  function ls(l, t) {
    var e = t._currentValue;
    if (((t = { context: t, memoizedValue: e, next: null }), de === null)) {
      if (l === null) throw Error(o(308));
      (de = t), (l.dependencies = { lanes: 0, firstContext: t }), (l.flags |= 524288);
    } else de = de.next = t;
    return e;
  }
  var Xd =
      typeof AbortController < "u"
        ? AbortController
        : function () {
            var l = [],
              t = (this.signal = {
                aborted: !1,
                addEventListener: function (e, a) {
                  l.push(a);
                },
              });
            this.abort = function () {
              (t.aborted = !0),
                l.forEach(function (e) {
                  return e();
                });
            };
          },
    Qd = s.unstable_scheduleCallback,
    wd = s.unstable_NormalPriority,
    Rl = {
      $$typeof: Yl,
      Consumer: null,
      Provider: null,
      _currentValue: null,
      _currentValue2: null,
      _threadCount: 0,
    };
  function Bc() {
    return { controller: new Xd(), data: new Map(), refCount: 0 };
  }
  function ju(l) {
    l.refCount--,
      l.refCount === 0 &&
        Qd(wd, function () {
          l.controller.abort();
        });
  }
  function ts(l, t) {
    if ((l.pendingLanes & 4194048) !== 0) {
      var e = l.transitionTypes;
      for (e === null && (e = l.transitionTypes = []), l = 0; l < t.length; l++) {
        var a = t[l];
        e.indexOf(a) === -1 && e.push(a);
      }
    }
  }
  var qu = null;
  function Kd(l) {
    var t = l.transitionTypes;
    return ((l.transitionTypes = null), t);
  }
  var Bu = null,
    Yc = 0,
    oa = 0,
    Va = null;
  function Jd(l, t) {
    if (Bu === null) {
      var e = (Bu = []);
      (Yc = 0),
        (oa = t0()),
        (Va = {
          status: "pending",
          value: void 0,
          then: function (a) {
            e.push(a);
          },
        });
    }
    return (Yc++, t.then(es, es), t);
  }
  function es() {
    if (--Yc === 0 && ((qu = null), Bu !== null)) {
      Va !== null && (Va.status = "fulfilled");
      var l = Bu;
      (Bu = null), (oa = 0), (Va = null);
      for (var t = 0; t < l.length; t++) (0, l[t])();
    }
  }
  function Fd(l, t) {
    var e = [],
      a = {
        status: "pending",
        value: null,
        reason: null,
        then: function (u) {
          e.push(u);
        },
      };
    return (
      l.then(
        function () {
          (a.status = "fulfilled"), (a.value = t);
          for (var u = 0; u < e.length; u++) (0, e[u])(t);
        },
        function (u) {
          for (a.status = "rejected", a.reason = u, u = 0; u < e.length; u++) (0, e[u])(void 0);
        },
      ),
      a
    );
  }
  var as = B.S;
  B.S = function (l, t) {
    if (
      ((Wo = mt()),
      typeof t == "object" && t !== null && typeof t.then == "function" && Jd(l, t),
      qu !== null)
    )
      for (var e = iu; e !== null; ) ts(e, qu), (e = e.next);
    if (((e = l.types), e !== null)) {
      for (var a = iu; a !== null; ) ts(a, e), (a = a.next);
      if (oa !== 0) {
        (a = qu), a === null && (a = qu = []);
        for (var u = 0; u < e.length; u++) {
          var n = e[u];
          a.indexOf(n) === -1 && a.push(n);
        }
      }
    }
    as !== null && as(l, t);
  };
  var ra = Xt(null);
  function Zc() {
    var l = ra.current;
    return l !== null ? l : zl.pooledCache;
  }
  function Fn(l, t) {
    t === null ? Al(ra, ra.current) : Al(ra, t.pool);
  }
  function us() {
    var l = Zc();
    return l === null ? null : { parent: Rl._currentValue, pool: l };
  }
  var Xa = Error(o(460)),
    Lc = Error(o(474)),
    $n = Error(o(542)),
    Wn = { then: function () {} };
  function ns(l) {
    return ((l = l.status), l === "fulfilled" || l === "rejected");
  }
  function is(l, t, e) {
    switch (
      ((e = l[e]), e === void 0 ? l.push(t) : e !== t && (t.then(wt, wt), (t = e)), t.status)
    ) {
      case "fulfilled":
        return t.value;
      case "rejected":
        throw ((l = t.reason), fs(l), l === void 0 && !("reason" in t) ? Error(o(600)) : l);
      default:
        if (typeof t.status == "string") t.then(wt, wt);
        else {
          if (((l = zl), l !== null && 100 < l.shellSuspendCounter)) throw Error(o(482));
          (l = t),
            (l.status = "pending"),
            l.then(
              function (a) {
                if (t.status === "pending") {
                  var u = t;
                  (u.status = "fulfilled"), (u.value = a);
                }
              },
              function (a) {
                if (t.status === "pending") {
                  var u = t;
                  (u.status = "rejected"), (u.reason = a);
                }
              },
            );
        }
        switch (t.status) {
          case "fulfilled":
            return t.value;
          case "rejected":
            throw ((l = t.reason), fs(l), l);
        }
        throw ((va = t), Xa);
    }
  }
  function da(l) {
    try {
      var t = l._init;
      return t(l._payload);
    } catch (e) {
      throw e !== null && typeof e == "object" && typeof e.then == "function" ? ((va = e), Xa) : e;
    }
  }
  var va = null;
  function cs() {
    if (va === null) throw Error(o(459));
    var l = va;
    return ((va = null), l);
  }
  function fs(l) {
    if (l === Xa || l === $n) throw Error(o(483));
  }
  var Qa = null,
    Yu = 0;
  function kn(l) {
    var t = Yu;
    return ((Yu += 1), Qa === null && (Qa = []), is(Qa, l, t));
  }
  function De(l, t) {
    (t = t.props.ref), (l.ref = t !== void 0 ? t : null);
  }
  function In(l, t) {
    throw t.$$typeof === cl
      ? Error(o(525))
      : ((l = Object.prototype.toString.call(t)),
        Error(
          o(
            31,
            l === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : l,
          ),
        ));
  }
  function ss(l) {
    function t(m, r) {
      if (l) {
        var y = m.deletions;
        y === null ? ((m.deletions = [r]), (m.flags |= 16)) : y.push(r);
      }
    }
    function e(m, r) {
      if (!l) return null;
      for (; r !== null; ) t(m, r), (r = r.sibling);
      return null;
    }
    function a(m) {
      for (var r = new Map(); m !== null; )
        m.key === null ? r.set(m.index, m) : r.set(m.key, m), (m = m.sibling);
      return r;
    }
    function u(m, r) {
      return ((m = oe(m, r)), (m.index = 0), (m.sibling = null), m);
    }
    function n(m, r, y) {
      return (
        (m.index = y),
        l
          ? ((y = m.alternate),
            y !== null
              ? ((y = y.index), y < r ? ((m.flags |= 2), r) : y)
              : ((m.flags |= 134217730), r))
          : ((m.flags |= 1048576), r)
      );
    }
    function i(m) {
      return (l && m.alternate === null && (m.flags |= 134217730), m);
    }
    function c(m, r, y, A) {
      return r === null || r.tag !== 6
        ? ((r = Dc(y, m.mode, A)), (r.return = m), r)
        : ((r = u(r, y)), (r.return = m), r);
    }
    function f(m, r, y, A) {
      var R = y.type;
      return R === _t
        ? ((m = S(m, r, y.props.children, A, y.key)), De(m, y), m)
        : r !== null &&
            (r.elementType === R ||
              (typeof R == "object" && R !== null && R.$$typeof === hl && da(R) === r.type))
          ? ((r = u(r, y.props)), De(r, y), (r.return = m), r)
          : ((r = Gn(y.type, y.key, y.props, null, m.mode, A)), De(r, y), (r.return = m), r);
    }
    function h(m, r, y, A) {
      return r === null ||
        r.tag !== 4 ||
        r.stateNode.containerInfo !== y.containerInfo ||
        r.stateNode.implementation !== y.implementation
        ? ((r = Cc(y, m.mode, A)), (r.return = m), r)
        : ((r = u(r, y.children || [])), (r.return = m), r);
    }
    function S(m, r, y, A, R) {
      return r === null || r.tag !== 7
        ? ((r = na(y, m.mode, A, R)), (r.return = m), r)
        : ((r = u(r, y)), (r.return = m), r);
    }
    function p(m, r, y) {
      if ((typeof r == "string" && r !== "") || typeof r == "number" || typeof r == "bigint")
        return ((r = Dc("" + r, m.mode, y)), (r.return = m), r);
      if (typeof r == "object" && r !== null) {
        switch (r.$$typeof) {
          case dt:
            return ((y = Gn(r.type, r.key, r.props, null, m.mode, y)), De(y, r), (y.return = m), y);
          case Ot:
            return ((r = Cc(r, m.mode, y)), (r.return = m), r);
          case hl:
            return ((r = da(r)), p(m, r, y));
        }
        if (vl(r) || L(r)) return ((r = na(r, m.mode, y, null)), (r.return = m), r);
        if (typeof r.then == "function") return p(m, kn(r), y);
        if (r.$$typeof === Yl) return p(m, Jn(m, r), y);
        In(m, r);
      }
      return null;
    }
    function v(m, r, y, A) {
      var R = r !== null ? r.key : null;
      if ((typeof y == "string" && y !== "") || typeof y == "number" || typeof y == "bigint")
        return R !== null ? null : c(m, r, "" + y, A);
      if (typeof y == "object" && y !== null) {
        switch (y.$$typeof) {
          case dt:
            return y.key === R ? f(m, r, y, A) : null;
          case Ot:
            return y.key === R ? h(m, r, y, A) : null;
          case hl:
            return ((y = da(y)), v(m, r, y, A));
        }
        if (vl(y) || L(y)) return R !== null ? null : S(m, r, y, A, null);
        if (typeof y.then == "function") return v(m, r, kn(y), A);
        if (y.$$typeof === Yl) return v(m, r, Jn(m, y), A);
        In(m, y);
      }
      return null;
    }
    function g(m, r, y, A, R) {
      if ((typeof A == "string" && A !== "") || typeof A == "number" || typeof A == "bigint")
        return ((m = m.get(y) || null), c(r, m, "" + A, R));
      if (typeof A == "object" && A !== null) {
        switch (A.$$typeof) {
          case dt:
            return ((m = m.get(A.key === null ? y : A.key) || null), f(r, m, A, R));
          case Ot:
            return ((m = m.get(A.key === null ? y : A.key) || null), h(r, m, A, R));
          case hl:
            return ((A = da(A)), g(m, r, y, A, R));
        }
        if (vl(A) || L(A)) return ((m = m.get(y) || null), S(r, m, A, R, null));
        if (typeof A.then == "function") return g(m, r, y, kn(A), R);
        if (A.$$typeof === Yl) return g(m, r, y, Jn(r, A), R);
        In(r, A);
      }
      return null;
    }
    function x(m, r, y, A) {
      for (
        var R = null, nl = null, Y = r, X = (r = 0), ql = null;
        Y !== null && X < y.length;
        X++
      ) {
        Y.index > X ? ((ql = Y), (Y = null)) : (ql = Y.sibling);
        var sl = v(m, Y, y[X], A);
        if (sl === null) {
          Y === null && (Y = ql);
          break;
        }
        l && Y && sl.alternate === null && t(m, Y),
          (r = n(sl, r, X)),
          nl === null ? (R = sl) : (nl.sibling = sl),
          (nl = sl),
          (Y = ql);
      }
      if (X === y.length) return (e(m, Y), tl && re(m, X), R);
      if (Y === null) {
        for (; X < y.length; X++)
          (Y = p(m, y[X], A)),
            Y !== null && ((r = n(Y, r, X)), nl === null ? (R = Y) : (nl.sibling = Y), (nl = Y));
        return (tl && re(m, X), R);
      }
      for (Y = a(Y); X < y.length; X++)
        (ql = g(Y, m, X, y[X], A)),
          ql !== null &&
            (l && ((sl = ql.alternate), sl !== null && Y.delete(sl.key === null ? X : sl.key)),
            (r = n(ql, r, X)),
            nl === null ? (R = ql) : (nl.sibling = ql),
            (nl = ql));
      return (
        l &&
          Y.forEach(function ($e) {
            return t(m, $e);
          }),
        tl && re(m, X),
        R
      );
    }
    function j(m, r, y, A) {
      if (y == null) throw Error(o(151));
      for (
        var R = null, nl = null, Y = r, X = (r = 0), ql = null, sl = y.next();
        Y !== null && !sl.done;
        X++, sl = y.next()
      ) {
        Y.index > X ? ((ql = Y), (Y = null)) : (ql = Y.sibling);
        var $e = v(m, Y, sl.value, A);
        if ($e === null) {
          Y === null && (Y = ql);
          break;
        }
        l && Y && $e.alternate === null && t(m, Y),
          (r = n($e, r, X)),
          nl === null ? (R = $e) : (nl.sibling = $e),
          (nl = $e),
          (Y = ql);
      }
      if (sl.done) return (e(m, Y), tl && re(m, X), R);
      if (Y === null) {
        for (; !sl.done; X++, sl = y.next())
          (sl = p(m, sl.value, A)),
            sl !== null &&
              ((r = n(sl, r, X)), nl === null ? (R = sl) : (nl.sibling = sl), (nl = sl));
        return (tl && re(m, X), R);
      }
      for (Y = a(Y); !sl.done; X++, sl = y.next())
        (sl = g(Y, m, X, sl.value, A)),
          sl !== null &&
            (l && ((ql = sl.alternate), ql !== null && Y.delete(ql.key === null ? X : ql.key)),
            (r = n(sl, r, X)),
            nl === null ? (R = sl) : (nl.sibling = sl),
            (nl = sl));
      return (
        l &&
          Y.forEach(function (Mm) {
            return t(m, Mm);
          }),
        tl && re(m, X),
        R
      );
    }
    function P(m, r, y, A) {
      if (
        (typeof y == "object" &&
          y !== null &&
          y.type === _t &&
          y.key === null &&
          y.props.ref === void 0 &&
          (y = y.props.children),
        typeof y == "object" && y !== null)
      ) {
        switch (y.$$typeof) {
          case dt:
            l: {
              for (var R = y.key; r !== null; ) {
                if (r.key === R) {
                  if (((R = y.type), R === _t)) {
                    if (r.tag === 7) {
                      e(m, r.sibling),
                        (A = u(r, y.props.children)),
                        De(A, y),
                        (A.return = m),
                        (m = A);
                      break l;
                    }
                  } else if (
                    r.elementType === R ||
                    (typeof R == "object" && R !== null && R.$$typeof === hl && da(R) === r.type)
                  ) {
                    e(m, r.sibling), (A = u(r, y.props)), De(A, y), (A.return = m), (m = A);
                    break l;
                  }
                  e(m, r);
                  break;
                } else t(m, r);
                r = r.sibling;
              }
              y.type === _t
                ? ((A = na(y.props.children, m.mode, A, y.key)), De(A, y), (A.return = m), (m = A))
                : ((A = Gn(y.type, y.key, y.props, null, m.mode, A)),
                  De(A, y),
                  (A.return = m),
                  (m = A));
            }
            return i(m);
          case Ot:
            l: {
              for (R = y.key; r !== null; ) {
                if (r.key === R)
                  if (
                    r.tag === 4 &&
                    r.stateNode.containerInfo === y.containerInfo &&
                    r.stateNode.implementation === y.implementation
                  ) {
                    e(m, r.sibling), (A = u(r, y.children || [])), (A.return = m), (m = A);
                    break l;
                  } else {
                    e(m, r);
                    break;
                  }
                else t(m, r);
                r = r.sibling;
              }
              (A = Cc(y, m.mode, A)), (A.return = m), (m = A);
            }
            return i(m);
          case hl:
            return ((y = da(y)), P(m, r, y, A));
        }
        if (vl(y)) return x(m, r, y, A);
        if (L(y)) {
          if (((R = L(y)), typeof R != "function")) throw Error(o(150));
          return ((y = R.call(y)), j(m, r, y, A));
        }
        if (typeof y.then == "function") return P(m, r, kn(y), A);
        if (y.$$typeof === Yl) return P(m, r, Jn(m, y), A);
        In(m, y);
      }
      return (typeof y == "string" && y !== "") || typeof y == "number" || typeof y == "bigint"
        ? ((y = "" + y),
          r !== null && r.tag === 6
            ? (e(m, r.sibling), (A = u(r, y)), (A.return = m), (m = A))
            : (e(m, r), (A = Dc(y, m.mode, A)), (A.return = m), (m = A)),
          i(m))
        : e(m, r);
    }
    return function (m, r, y, A) {
      try {
        Yu = 0;
        var R = P(m, r, y, A);
        return ((Qa = null), R);
      } catch (Y) {
        if (Y === Xa || Y === $n) throw Y;
        var nl = ct(29, Y, null, m.mode);
        return ((nl.lanes = A), (nl.return = m), nl);
      } finally {
      }
    };
  }
  var ma = ss(!0),
    os = ss(!1),
    Ce = !1;
  function Gc(l) {
    l.updateQueue = {
      baseState: l.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null,
    };
  }
  function Vc(l, t) {
    (l = l.updateQueue),
      t.updateQueue === l &&
        (t.updateQueue = {
          baseState: l.baseState,
          firstBaseUpdate: l.firstBaseUpdate,
          lastBaseUpdate: l.lastBaseUpdate,
          shared: l.shared,
          callbacks: null,
        });
  }
  function Ue(l) {
    return { lane: l, tag: 0, payload: null, callback: null, next: null };
  }
  function Re(l, t, e) {
    var a = l.updateQueue;
    if (a === null) return null;
    if (((a = a.shared), (ml & 2) !== 0)) {
      var u = a.pending;
      return (
        u === null ? (t.next = t) : ((t.next = u.next), (u.next = t)),
        (a.pending = t),
        (t = Ln(l)),
        J1(l, null, e),
        t
      );
    }
    return (Zn(l, a, t, e), Ln(l));
  }
  function Zu(l, t, e) {
    if (((t = t.updateQueue), t !== null && ((t = t.shared), (e & 4194048) !== 0))) {
      var a = t.lanes;
      (a &= l.pendingLanes), (e |= a), (t.lanes = e), k0(l, e);
    }
  }
  function Xc(l, t) {
    var e = l.updateQueue,
      a = l.alternate;
    if (a !== null && ((a = a.updateQueue), e === a)) {
      var u = null,
        n = null;
      if (((e = e.firstBaseUpdate), e !== null)) {
        do {
          var i = { lane: e.lane, tag: e.tag, payload: e.payload, callback: null, next: null };
          n === null ? (u = n = i) : (n = n.next = i), (e = e.next);
        } while (e !== null);
        n === null ? (u = n = t) : (n = n.next = t);
      } else u = n = t;
      (e = {
        baseState: a.baseState,
        firstBaseUpdate: u,
        lastBaseUpdate: n,
        shared: a.shared,
        callbacks: a.callbacks,
      }),
        (l.updateQueue = e);
      return;
    }
    (l = e.lastBaseUpdate),
      l === null ? (e.firstBaseUpdate = t) : (l.next = t),
      (e.lastBaseUpdate = t);
  }
  var Qc = !1;
  function Lu() {
    if (Qc) {
      var l = Va;
      if (l !== null) throw l;
    }
  }
  function Gu(l, t, e, a) {
    Qc = !1;
    var u = l.updateQueue;
    Ce = !1;
    var n = u.firstBaseUpdate,
      i = u.lastBaseUpdate,
      c = u.shared.pending;
    if (c !== null) {
      u.shared.pending = null;
      var f = c,
        h = f.next;
      (f.next = null), i === null ? (n = h) : (i.next = h), (i = f);
      var S = l.alternate;
      S !== null &&
        ((S = S.updateQueue),
        (c = S.lastBaseUpdate),
        c !== i && (c === null ? (S.firstBaseUpdate = h) : (c.next = h), (S.lastBaseUpdate = f)));
    }
    if (n !== null) {
      var p = u.baseState;
      (i = 0), (S = h = f = null), (c = n);
      do {
        var v = c.lane & -536870913,
          g = v !== c.lane;
        if (g ? (ul & v) === v : (a & v) === v) {
          v !== 0 && v === oa && (Qc = !0),
            S !== null &&
              (S = S.next =
                { lane: 0, tag: c.tag, payload: c.payload, callback: null, next: null });
          l: {
            var x = l,
              j = c;
            v = t;
            var P = e;
            switch (j.tag) {
              case 1:
                if (((x = j.payload), typeof x == "function")) {
                  p = x.call(P, p, v);
                  break l;
                }
                p = x;
                break l;
              case 3:
                x.flags = (x.flags & -65537) | 128;
              case 0:
                if (
                  ((x = j.payload), (v = typeof x == "function" ? x.call(P, p, v) : x), v == null)
                )
                  break l;
                p = V({}, p, v);
                break l;
              case 2:
                Ce = !0;
            }
          }
          (v = c.callback),
            v !== null &&
              ((l.flags |= 64),
              g && (l.flags |= 8192),
              (g = u.callbacks),
              g === null ? (u.callbacks = [v]) : g.push(v));
        } else
          (g = { lane: v, tag: c.tag, payload: c.payload, callback: c.callback, next: null }),
            S === null ? ((h = S = g), (f = p)) : (S = S.next = g),
            (i |= v);
        if (((c = c.next), c === null)) {
          if (((c = u.shared.pending), c === null)) break;
          (g = c), (c = g.next), (g.next = null), (u.lastBaseUpdate = g), (u.shared.pending = null);
        }
      } while (!0);
      S === null && (f = p),
        (u.baseState = f),
        (u.firstBaseUpdate = h),
        (u.lastBaseUpdate = S),
        n === null && (u.shared.lanes = 0),
        (Le |= i),
        (l.lanes = i),
        (l.memoizedState = p);
    }
  }
  function rs(l, t) {
    if (typeof l != "function") throw Error(o(191, l));
    l.call(t);
  }
  function ds(l, t) {
    var e = l.callbacks;
    if (e !== null) for (l.callbacks = null, l = 0; l < e.length; l++) rs(e[l], t);
  }
  var He = Xt(null),
    Pn = Xt(0);
  function vs(l, t) {
    (l = Se), Al(Pn, l), Al(He, t), (Se = l | t.baseLanes);
  }
  function wc() {
    Al(Pn, Se), Al(He, He.current);
  }
  function Kc() {
    (Se = Pn.current), Xl(He), Xl(Pn);
  }
  var Kl = Xt(null),
    Il = null;
  function je(l) {
    var t = l.alternate;
    Al(Jl, Jl.current & 1),
      Al(Kl, l),
      Il === null && (t === null || He.current !== null || t.memoizedState !== null) && (Il = l);
  }
  function Jc(l) {
    Al(Jl, Jl.current), Al(Kl, l), Il === null && (Il = l);
  }
  function ms(l) {
    l.tag === 22 ? (Al(Jl, Jl.current), Al(Kl, l), Il === null && (Il = l)) : qe();
  }
  function qe() {
    Al(Jl, Jl.current), Al(Kl, Kl.current);
  }
  function bt(l) {
    Xl(Kl), Il === l && (Il = null), Xl(Jl);
  }
  var Jl = Xt(0);
  function Vu(l, t) {
    Al(Kl, Kl.current), Al(Jl, t);
  }
  function Fc(l) {
    Xl(Jl), Xl(Kl), Il === l && (Il = null);
  }
  function li(l) {
    for (var t = l; t !== null; ) {
      if (t.tag === 13) {
        var e = t.memoizedState;
        if (e !== null && ((e = e.dehydrated), e === null || g0(e) || S0(e))) return t;
      } else if (t.tag === 19 && t.memoizedProps.revealOrder !== "independent") {
        if ((t.flags & 128) !== 0) return t;
      } else if (t.child !== null) {
        (t.child.return = t), (t = t.child);
        continue;
      }
      if (t === l) break;
      for (; t.sibling === null; ) {
        if (t.return === null || t.return === l) return null;
        t = t.return;
      }
      (t.sibling.return = t.return), (t = t.sibling);
    }
    return null;
  }
  var me = 0,
    I = null,
    El = null,
    Hl = null,
    ti = !1,
    wa = !1,
    ha = !1,
    ei = 0,
    Xu = 0,
    Ka = null,
    $d = 0;
  function Ml() {
    throw Error(o(321));
  }
  function $c(l, t) {
    if (t === null) return !1;
    for (var e = 0; e < t.length && e < l.length; e++) if (!St(l[e], t[e])) return !1;
    return !0;
  }
  function Wc(l, t, e, a, u, n) {
    return (
      (me = n),
      (I = t),
      (t.memoizedState = null),
      (t.updateQueue = null),
      (t.lanes = 0),
      (B.H = l === null || l.memoizedState === null ? ks : Is),
      (ha = !1),
      (n = e(a, u)),
      (ha = !1),
      wa && (n = ys(t, e, a, u)),
      hs(l),
      n
    );
  }
  function hs(l) {
    B.H = si;
    var t = El !== null && El.next !== null;
    if (((me = 0), (Hl = El = I = null), (ti = !1), (Xu = 0), (Ka = null), t)) throw Error(o(300));
    l === null || jl || ((l = l.dependencies), l !== null && Kn(l) && (jl = !0));
  }
  function ys(l, t, e, a) {
    I = l;
    var u = 0;
    do {
      if ((wa && (Ka = null), (Xu = 0), (wa = !1), 25 <= u)) throw Error(o(301));
      if (((u += 1), (Hl = El = null), l.updateQueue != null)) {
        var n = l.updateQueue;
        (n.lastEffect = null),
          (n.events = null),
          (n.stores = null),
          n.memoCache != null && (n.memoCache.index = 0);
      }
      (B.H = av), (n = t(e, a));
    } while (wa);
    return n;
  }
  function Wd() {
    var l = B.H,
      t = l.useState()[0];
    return (
      (t = typeof t.then == "function" ? Qu(t) : t),
      (l = l.useState()[0]),
      (El !== null ? El.memoizedState : null) !== l && (I.flags |= 1024),
      t
    );
  }
  function kc() {
    var l = ei !== 0;
    return ((ei = 0), l);
  }
  function Ic(l, t, e) {
    (t.updateQueue = l.updateQueue), (t.flags &= -2053), (l.lanes &= ~e);
  }
  function Pc(l) {
    if (ti) {
      for (l = l.memoizedState; l !== null; ) {
        var t = l.queue;
        t !== null && (t.pending = null), (l = l.next);
      }
      ti = !1;
    }
    (me = 0), (Hl = El = I = null), (wa = !1), (Xu = ei = 0), (Ka = null);
  }
  function et() {
    var l = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
    return (Hl === null ? (I.memoizedState = Hl = l) : (Hl = Hl.next = l), Hl);
  }
  function Cl() {
    if (El === null) {
      var l = I.alternate;
      l = l !== null ? l.memoizedState : null;
    } else l = El.next;
    var t = Hl === null ? I.memoizedState : Hl.next;
    if (t !== null) (Hl = t), (El = l);
    else {
      if (l === null) throw I.alternate === null ? Error(o(467)) : Error(o(310));
      (El = l),
        (l = {
          memoizedState: El.memoizedState,
          baseState: El.baseState,
          baseQueue: El.baseQueue,
          queue: El.queue,
          next: null,
        }),
        Hl === null ? (I.memoizedState = Hl = l) : (Hl = Hl.next = l);
    }
    return Hl;
  }
  function ai() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function Qu(l) {
    var t = Xu;
    return (
      (Xu += 1),
      Ka === null && (Ka = []),
      (l = is(Ka, l, t)),
      (t = I),
      (Hl === null ? t.memoizedState : Hl.next) === null &&
        ((t = t.alternate), (B.H = t === null || t.memoizedState === null ? ks : Is)),
      l
    );
  }
  function ui(l) {
    if (l !== null && typeof l == "object") {
      if (typeof l.then == "function") return Qu(l);
      if (l.$$typeof === _) return;
      if (l.$$typeof === Yl) return wl(l);
    }
    throw Error(o(438, String(l)));
  }
  function lf(l) {
    var t = null,
      e = I.updateQueue;
    if ((e !== null && (t = e.memoCache), t == null)) {
      var a = I.alternate;
      a !== null &&
        ((a = a.updateQueue),
        a !== null &&
          ((a = a.memoCache),
          a != null &&
            (t = {
              data: a.data.map(function (u) {
                return u.slice();
              }),
              index: 0,
            })));
    }
    if (
      (t == null && (t = { data: [], index: 0 }),
      e === null && ((e = ai()), (I.updateQueue = e)),
      (e.memoCache = t),
      (e = t.data[t.index]),
      e === void 0)
    )
      for (e = t.data[t.index] = Array(l), a = 0; a < l; a++) e[a] = Ie;
    return (t.index++, e);
  }
  function he(l, t) {
    return typeof t == "function" ? t(l) : t;
  }
  function ni(l) {
    var t = Cl();
    return tf(t, El, l);
  }
  function tf(l, t, e) {
    var a = l.queue;
    if (a === null) throw Error(o(311));
    a.lastRenderedReducer = e;
    var u = l.baseQueue,
      n = a.pending;
    if (n !== null) {
      if (u !== null) {
        var i = u.next;
        (u.next = n.next), (n.next = i);
      }
      (t.baseQueue = u = n), (a.pending = null);
    }
    if (((n = l.baseState), u === null)) l.memoizedState = n;
    else {
      t = u.next;
      var c = (i = null),
        f = null,
        h = t,
        S = !1;
      do {
        var p = h.lane & -536870913;
        if (p !== h.lane ? (ul & p) === p : (me & p) === p) {
          var v = h.revertLane;
          if (v === 0)
            f !== null &&
              (f = f.next =
                {
                  lane: 0,
                  revertLane: 0,
                  gesture: null,
                  action: h.action,
                  hasEagerState: h.hasEagerState,
                  eagerState: h.eagerState,
                  next: null,
                }),
              p === oa && (S = !0);
          else if ((me & v) === v) {
            (h = h.next), v === oa && (S = !0);
            continue;
          } else
            (p = {
              lane: 0,
              revertLane: h.revertLane,
              gesture: null,
              action: h.action,
              hasEagerState: h.hasEagerState,
              eagerState: h.eagerState,
              next: null,
            }),
              f === null ? ((c = f = p), (i = n)) : (f = f.next = p),
              (I.lanes |= v),
              (Le |= v);
          (p = h.action), ha && e(n, p), (n = h.hasEagerState ? h.eagerState : e(n, p));
        } else
          (v = {
            lane: p,
            revertLane: h.revertLane,
            gesture: h.gesture,
            action: h.action,
            hasEagerState: h.hasEagerState,
            eagerState: h.eagerState,
            next: null,
          }),
            f === null ? ((c = f = v), (i = n)) : (f = f.next = v),
            (I.lanes |= p),
            (Le |= p);
        h = h.next;
      } while (h !== null && h !== t);
      if (
        (f === null ? (i = n) : (f.next = c),
        !St(n, l.memoizedState) && ((jl = !0), S && ((e = Va), e !== null)))
      )
        throw e;
      (l.memoizedState = n), (l.baseState = i), (l.baseQueue = f), (a.lastRenderedState = n);
    }
    return (u === null && (a.lanes = 0), [l.memoizedState, a.dispatch]);
  }
  function ef(l) {
    var t = Cl(),
      e = t.queue;
    if (e === null) throw Error(o(311));
    e.lastRenderedReducer = l;
    var a = e.dispatch,
      u = e.pending,
      n = t.memoizedState;
    if (u !== null) {
      e.pending = null;
      var i = (u = u.next);
      do (n = l(n, i.action)), (i = i.next);
      while (i !== u);
      St(n, t.memoizedState) || (jl = !0),
        (t.memoizedState = n),
        t.baseQueue === null && (t.baseState = n),
        (e.lastRenderedState = n);
    }
    return [n, a];
  }
  function gs(l, t, e) {
    var a = I,
      u = Cl(),
      n = tl;
    if (n) {
      if (e === void 0) throw Error(o(407));
      e = e();
    } else e = t();
    var i = !St((El || u).memoizedState, e);
    if (
      (i && ((u.memoizedState = e), (jl = !0)),
      (u = u.queue),
      nf(Es.bind(null, a, u, l), [l]),
      (l = u.getSnapshot !== t || i || (Hl !== null && (Hl.memoizedState.tag & 1) !== 0)),
      Ja(l ? 9 : 8, { destroy: void 0 }, bs.bind(null, a, u, e, t), null),
      l)
    ) {
      if (((a.flags |= 2048), zl === null)) throw Error(o(349));
      n || (me & 127) !== 0 || Ss(a, t, e);
    }
    return e;
  }
  function Ss(l, t, e) {
    (l.flags |= 16384),
      (l = { getSnapshot: t, value: e }),
      (t = I.updateQueue),
      t === null
        ? ((t = ai()), (I.updateQueue = t), (t.stores = [l]))
        : ((e = t.stores), e === null ? (t.stores = [l]) : e.push(l));
  }
  function bs(l, t, e, a) {
    (t.value = e), (t.getSnapshot = a), Ts(t) && zs(l);
  }
  function Es(l, t, e) {
    return e(function () {
      Ts(t) && zs(l);
    });
  }
  function Ts(l) {
    var t = l.getSnapshot;
    l = l.value;
    try {
      var e = t();
      return !St(l, e);
    } catch {
      return !0;
    }
  }
  function zs(l) {
    var t = ua(l, 2);
    t !== null && rt(t, l, 2);
  }
  function af(l) {
    var t = et();
    if (typeof l == "function") {
      var e = l;
      if (((l = e()), ha)) {
        Ae(!0);
        try {
          e();
        } finally {
          Ae(!1);
        }
      }
    }
    return (
      (t.memoizedState = t.baseState = l),
      (t.queue = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: he,
        lastRenderedState: l,
      }),
      t
    );
  }
  function As(l, t, e, a) {
    return ((l.baseState = e), tf(l, El, typeof a == "function" ? a : he));
  }
  function kd(l, t, e, a, u) {
    if (fi(l)) throw Error(o(485));
    if (((l = t.action), l !== null)) {
      var n = {
        payload: u,
        action: l,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function (i) {
          n.listeners.push(i);
        },
      };
      B.T !== null ? e(!0) : (n.isTransition = !1),
        a(n),
        (e = t.pending),
        e === null
          ? ((n.next = t.pending = n), ps(t, n))
          : ((n.next = e.next), (t.pending = e.next = n));
    }
  }
  function ps(l, t) {
    var e = t.action,
      a = t.payload,
      u = l.state;
    if (t.isTransition) {
      var n = B.T,
        i = {};
      (i.types = n !== null ? n.types : null), (B.T = i);
      try {
        var c = e(u, a),
          f = B.S;
        f !== null && f(i, c), Os(l, t, c);
      } catch (h) {
        uf(l, t, h);
      } finally {
        n !== null && i.types !== null && (n.types = i.types), (B.T = n);
      }
    } else
      try {
        (n = e(u, a)), Os(l, t, n);
      } catch (h) {
        uf(l, t, h);
      }
  }
  function Os(l, t, e) {
    e !== null && typeof e == "object" && typeof e.then == "function"
      ? e.then(
          function (a) {
            _s(l, t, a);
          },
          function (a) {
            return uf(l, t, a);
          },
        )
      : _s(l, t, e);
  }
  function _s(l, t, e) {
    (t.status = "fulfilled"),
      (t.value = e),
      Ns(t),
      (l.state = e),
      (t = l.pending),
      t !== null &&
        ((e = t.next), e === t ? (l.pending = null) : ((e = e.next), (t.next = e), ps(l, e)));
  }
  function uf(l, t, e) {
    var a = l.pending;
    if (((l.pending = null), a !== null)) {
      a = a.next;
      do (t.status = "rejected"), (t.reason = e), Ns(t), (t = t.next);
      while (t !== a);
    }
    l.action = null;
  }
  function Ns(l) {
    l = l.listeners;
    for (var t = 0; t < l.length; t++) (0, l[t])();
  }
  function Ms(l, t) {
    return t;
  }
  function xs(l, t) {
    if (tl) {
      var e = zl.formState;
      if (e !== null) {
        l: {
          var a = I;
          if (tl) {
            if (pl) {
              t: {
                for (var u = pl, n = Ut; u.nodeType !== 8; ) {
                  if (!n) {
                    u = null;
                    break t;
                  }
                  if (((u = Ht(u.nextSibling)), u === null)) {
                    u = null;
                    break t;
                  }
                }
                (n = u.data), (u = n === "F!" || n === "F" ? u : null);
              }
              if (u) {
                (pl = Ht(u.nextSibling)), (a = u.data === "F!");
                break l;
              }
            }
            Me(a);
          }
          a = !1;
        }
        a && (t = e[0]);
      }
    }
    return (
      (e = et()),
      (e.memoizedState = e.baseState = t),
      (a = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Ms,
        lastRenderedState: t,
      }),
      (e.queue = a),
      (e = Fs.bind(null, I, a)),
      (a.dispatch = e),
      (a = af(!1)),
      (n = rf.bind(null, I, !1, a.queue)),
      (a = et()),
      (u = { state: t, dispatch: null, action: l, pending: null }),
      (a.queue = u),
      (e = kd.bind(null, I, u, n, e)),
      (u.dispatch = e),
      (a.memoizedState = l),
      [t, e, !1]
    );
  }
  function Ds(l) {
    var t = Cl();
    return Cs(t, El, l);
  }
  function Cs(l, t, e) {
    if (
      ((t = tf(l, t, Ms)[0]),
      (l = ni(he)[0]),
      typeof t == "object" && t !== null && typeof t.then == "function")
    )
      try {
        var a = Qu(t);
      } catch (i) {
        throw i === Xa ? $n : i;
      }
    else a = t;
    t = Cl();
    var u = t.queue,
      n = u.dispatch;
    return (
      e !== t.memoizedState &&
        ((I.flags |= 2048), Ja(9, { destroy: void 0 }, Id.bind(null, u, e), null)),
      [a, n, l]
    );
  }
  function Id(l, t) {
    l.action = t;
  }
  function Us(l) {
    var t = Cl(),
      e = El;
    if (e !== null) return Cs(t, e, l);
    Cl(), (t = t.memoizedState), (e = Cl());
    var a = e.queue.dispatch;
    return ((e.memoizedState = l), [t, a, !1]);
  }
  function Ja(l, t, e, a) {
    return (
      (l = { tag: l, create: e, deps: a, inst: t, next: null }),
      (t = I.updateQueue),
      t === null && ((t = ai()), (I.updateQueue = t)),
      (e = t.lastEffect),
      e === null
        ? (t.lastEffect = l.next = l)
        : ((a = e.next), (e.next = l), (l.next = a), (t.lastEffect = l)),
      l
    );
  }
  function Rs() {
    return Cl().memoizedState;
  }
  function ii(l, t, e, a) {
    var u = et();
    (I.flags |= l), (u.memoizedState = Ja(1 | t, { destroy: void 0 }, e, a === void 0 ? null : a));
  }
  function ci(l, t, e, a) {
    var u = Cl();
    a = a === void 0 ? null : a;
    var n = u.memoizedState.inst;
    El !== null && a !== null && $c(a, El.memoizedState.deps)
      ? (u.memoizedState = Ja(t, n, e, a))
      : ((I.flags |= l), (u.memoizedState = Ja(1 | t, n, e, a)));
  }
  function Hs(l, t) {
    ii(8390656, 8, l, t);
  }
  function nf(l, t) {
    ci(2048, 8, l, t);
  }
  function Pd(l) {
    I.flags |= 4;
    var t = I.updateQueue;
    if (t === null) (t = ai()), (I.updateQueue = t), (t.events = [l]);
    else {
      var e = t.events;
      e === null ? (t.events = [l]) : e.push(l);
    }
  }
  function js(l) {
    var t = Cl().memoizedState;
    return (
      Pd({ ref: t, nextImpl: l }),
      function () {
        if ((ml & 2) !== 0) throw Error(o(440));
        return t.impl.apply(void 0, arguments);
      }
    );
  }
  function qs(l, t) {
    return ci(4, 2, l, t);
  }
  function Bs(l, t) {
    return ci(4, 4, l, t);
  }
  function Ys(l, t) {
    if (typeof t == "function") {
      l = l();
      var e = t(l);
      return function () {
        typeof e == "function" ? e() : t(null);
      };
    }
    if (t != null)
      return (
        (l = l()),
        (t.current = l),
        function () {
          t.current = null;
        }
      );
  }
  function Zs(l, t, e) {
    (e = e != null ? e.concat([l]) : null), ci(4, 4, Ys.bind(null, t, l), e);
  }
  function cf() {}
  function Ls(l, t) {
    var e = Cl();
    t = t === void 0 ? null : t;
    var a = e.memoizedState;
    return t !== null && $c(t, a[1]) ? a[0] : ((e.memoizedState = [l, t]), l);
  }
  function Gs(l, t) {
    var e = Cl();
    t = t === void 0 ? null : t;
    var a = e.memoizedState;
    if (t !== null && $c(t, a[1])) return a[0];
    if (((a = l()), ha)) {
      Ae(!0);
      try {
        l();
      } finally {
        Ae(!1);
      }
    }
    return ((e.memoizedState = [a, t]), a);
  }
  function ff(l, t, e) {
    return e === void 0 || ((me & 1073741824) !== 0 && (ul & 261930) === 0)
      ? (l.memoizedState = t)
      : ((l.memoizedState = e), (l = Io()), (I.lanes |= l), (Le |= l), e);
  }
  function Vs(l, t, e, a) {
    return St(e, t)
      ? e
      : He.current !== null
        ? ((l = ff(l, e, a)), St(l, t) || (jl = !0), l)
        : (me & 106) === 0 || ((me & 1073741824) !== 0 && (ul & 261930) === 0)
          ? ((jl = !0), (l.memoizedState = e))
          : ((l = Io()), (I.lanes |= l), (Le |= l), t);
  }
  function Xs(l, t, e, a, u) {
    var n = J.p;
    J.p = n !== 0 && 8 > n ? n : 8;
    var i = B.T,
      c = {};
    (c.types = i !== null ? i.types : null), (B.T = c), rf(l, !1, t, e);
    try {
      var f = u(),
        h = B.S;
      if (
        (h !== null && h(c, f), f !== null && typeof f == "object" && typeof f.then == "function")
      ) {
        var S = Fd(f, a);
        wu(l, t, S, At(l));
      } else wu(l, t, a, At(l));
    } catch (p) {
      wu(l, t, { then: function () {}, status: "rejected", reason: p }, At());
    } finally {
      (J.p = n), i !== null && c.types !== null && (i.types = c.types), (B.T = i);
    }
  }
  function lv() {}
  function sf(l, t, e, a) {
    if (l.tag !== 5) throw Error(o(476));
    var u = Qs(l).queue;
    Xs(
      l,
      u,
      t,
      ue,
      e === null
        ? lv
        : function () {
            return (ws(l), e(a));
          },
    );
  }
  function Qs(l) {
    var t = l.memoizedState;
    if (t !== null) return t;
    t = {
      memoizedState: ue,
      baseState: ue,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: he,
        lastRenderedState: ue,
      },
      next: null,
    };
    var e = {};
    return (
      (t.next = {
        memoizedState: e,
        baseState: e,
        baseQueue: null,
        queue: {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: he,
          lastRenderedState: e,
        },
        next: null,
      }),
      (l.memoizedState = t),
      (l = l.alternate),
      l !== null && (l.memoizedState = t),
      t
    );
  }
  function ws(l) {
    var t = Qs(l);
    t.next === null && (t = l.alternate.memoizedState), wu(l, t.next.queue, {}, At());
  }
  function of() {
    return wl(du);
  }
  function Ks() {
    return Cl().memoizedState;
  }
  function Js() {
    return Cl().memoizedState;
  }
  function tv(l) {
    for (var t = l.return; t !== null; ) {
      switch (t.tag) {
        case 24:
        case 3:
          var e = At();
          l = Ue(e);
          var a = Re(t, l, e);
          a !== null && (rt(a, t, e), Zu(a, t, e)), (t = { cache: Bc() }), (l.payload = t);
          return;
      }
      t = t.return;
    }
  }
  function ev(l, t, e) {
    var a = At();
    (e = {
      lane: a,
      revertLane: 0,
      gesture: null,
      action: e,
      hasEagerState: !1,
      eagerState: null,
      next: null,
    }),
      fi(l) ? $s(t, e) : ((e = Mc(l, t, e, a)), e !== null && (rt(e, l, a), Ws(e, t, a)));
  }
  function Fs(l, t, e) {
    var a = At();
    wu(l, t, e, a);
  }
  function wu(l, t, e, a) {
    var u = {
      lane: a,
      revertLane: 0,
      gesture: null,
      action: e,
      hasEagerState: !1,
      eagerState: null,
      next: null,
    };
    if (fi(l)) $s(t, u);
    else {
      var n = l.alternate;
      if (
        l.lanes === 0 &&
        (n === null || n.lanes === 0) &&
        ((n = t.lastRenderedReducer), n !== null)
      )
        try {
          var i = t.lastRenderedState,
            c = n(i, e);
          if (((u.hasEagerState = !0), (u.eagerState = c), St(c, i)))
            return (Zn(l, t, u, 0), zl === null && Yn(), !1);
        } catch {
        } finally {
        }
      if (((e = Mc(l, t, u, a)), e !== null)) return (rt(e, l, a), Ws(e, t, a), !0);
    }
    return !1;
  }
  function rf(l, t, e, a) {
    if (
      ((a = {
        lane: 2,
        revertLane: t0(),
        gesture: null,
        action: a,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      }),
      fi(l))
    ) {
      if (t) throw Error(o(479));
    } else (t = Mc(l, e, a, 2)), t !== null && rt(t, l, 2);
  }
  function fi(l) {
    var t = l.alternate;
    return l === I || (t !== null && t === I);
  }
  function $s(l, t) {
    wa = ti = !0;
    var e = l.pending;
    e === null ? (t.next = t) : ((t.next = e.next), (e.next = t)), (l.pending = t);
  }
  function Ws(l, t, e) {
    if ((e & 4194048) !== 0) {
      var a = t.lanes;
      (a &= l.pendingLanes), (e |= a), (t.lanes = e), k0(l, e);
    }
  }
  var si = {
      readContext: wl,
      use: ui,
      useCallback: Ml,
      useContext: Ml,
      useEffect: Ml,
      useImperativeHandle: Ml,
      useLayoutEffect: Ml,
      useInsertionEffect: Ml,
      useMemo: Ml,
      useReducer: Ml,
      useRef: Ml,
      useState: Ml,
      useDebugValue: Ml,
      useDeferredValue: Ml,
      useTransition: Ml,
      useSyncExternalStore: Ml,
      useId: Ml,
      useHostTransitionStatus: Ml,
      useFormState: Ml,
      useActionState: Ml,
      useOptimistic: Ml,
      useMemoCache: Ml,
      useCacheRefresh: Ml,
      useEffectEvent: Ml,
    },
    ks = {
      readContext: wl,
      use: ui,
      useCallback: function (l, t) {
        return ((et().memoizedState = [l, t === void 0 ? null : t]), l);
      },
      useContext: wl,
      useEffect: Hs,
      useImperativeHandle: function (l, t, e) {
        (e = e != null ? e.concat([l]) : null), ii(4194308, 4, Ys.bind(null, t, l), e);
      },
      useLayoutEffect: function (l, t) {
        return ii(4194308, 4, l, t);
      },
      useInsertionEffect: function (l, t) {
        ii(4, 2, l, t);
      },
      useMemo: function (l, t) {
        var e = et();
        t = t === void 0 ? null : t;
        var a = l();
        if (ha) {
          Ae(!0);
          try {
            l();
          } finally {
            Ae(!1);
          }
        }
        return ((e.memoizedState = [a, t]), a);
      },
      useReducer: function (l, t, e) {
        var a = et();
        if (e !== void 0) {
          var u = e(t);
          if (ha) {
            Ae(!0);
            try {
              e(t);
            } finally {
              Ae(!1);
            }
          }
        } else u = t;
        return (
          (a.memoizedState = a.baseState = u),
          (l = {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: l,
            lastRenderedState: u,
          }),
          (a.queue = l),
          (l = l.dispatch = ev.bind(null, I, l)),
          [a.memoizedState, l]
        );
      },
      useRef: function (l) {
        var t = et();
        return ((l = { current: l }), (t.memoizedState = l));
      },
      useState: function (l) {
        l = af(l);
        var t = l.queue,
          e = Fs.bind(null, I, t);
        return ((t.dispatch = e), [l.memoizedState, e]);
      },
      useDebugValue: cf,
      useDeferredValue: function (l, t) {
        var e = et();
        return ff(e, l, t);
      },
      useTransition: function () {
        var l = af(!1);
        return ((l = Xs.bind(null, I, l.queue, !0, !1)), (et().memoizedState = l), [!1, l]);
      },
      useSyncExternalStore: function (l, t, e) {
        var a = I,
          u = et();
        if (tl) {
          if (e === void 0) throw Error(o(407));
          e = e();
        } else {
          if (((e = t()), zl === null)) throw Error(o(349));
          (ul & 127) !== 0 || Ss(a, t, e);
        }
        u.memoizedState = e;
        var n = { value: e, getSnapshot: t };
        return (
          (u.queue = n),
          Hs(Es.bind(null, a, n, l), [l]),
          (a.flags |= 2048),
          Ja(9, { destroy: void 0 }, bs.bind(null, a, n, e, t), null),
          e
        );
      },
      useId: function () {
        var l = et(),
          t = zl.identifierPrefix;
        if (tl) {
          var e = Jt,
            a = Kt;
          (e = (a & ~(1 << (32 - yt(a) - 1))).toString(32) + e),
            (t = "_" + t + "R_" + e),
            (e = ei++),
            0 < e && (t += "H" + e.toString(32)),
            (t += "_");
        } else (e = $d++), (t = "_" + t + "r_" + e.toString(32) + "_");
        return (l.memoizedState = t);
      },
      useHostTransitionStatus: of,
      useFormState: xs,
      useActionState: xs,
      useOptimistic: function (l) {
        var t = et();
        t.memoizedState = t.baseState = l;
        var e = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: null,
          lastRenderedState: null,
        };
        return ((t.queue = e), (t = rf.bind(null, I, !0, e)), (e.dispatch = t), [l, t]);
      },
      useMemoCache: lf,
      useCacheRefresh: function () {
        return (et().memoizedState = tv.bind(null, I));
      },
      useEffectEvent: function (l) {
        var t = et(),
          e = { impl: l };
        return (
          (t.memoizedState = e),
          function () {
            if ((ml & 2) !== 0) throw Error(o(440));
            return e.impl.apply(void 0, arguments);
          }
        );
      },
    },
    Is = {
      readContext: wl,
      use: ui,
      useCallback: Ls,
      useContext: wl,
      useEffect: nf,
      useImperativeHandle: Zs,
      useInsertionEffect: qs,
      useLayoutEffect: Bs,
      useMemo: Gs,
      useReducer: ni,
      useRef: Rs,
      useState: function () {
        return ni(he);
      },
      useDebugValue: cf,
      useDeferredValue: function (l, t) {
        var e = Cl();
        return Vs(e, El.memoizedState, l, t);
      },
      useTransition: function () {
        var l = ni(he)[0],
          t = Cl().memoizedState;
        return [typeof l == "boolean" ? l : Qu(l), t];
      },
      useSyncExternalStore: gs,
      useId: Ks,
      useHostTransitionStatus: of,
      useFormState: Ds,
      useActionState: Ds,
      useOptimistic: function (l, t) {
        var e = Cl();
        return As(e, El, l, t);
      },
      useMemoCache: lf,
      useCacheRefresh: Js,
      useEffectEvent: js,
    },
    av = {
      readContext: wl,
      use: ui,
      useCallback: Ls,
      useContext: wl,
      useEffect: nf,
      useImperativeHandle: Zs,
      useInsertionEffect: qs,
      useLayoutEffect: Bs,
      useMemo: Gs,
      useReducer: ef,
      useRef: Rs,
      useState: function () {
        return ef(he);
      },
      useDebugValue: cf,
      useDeferredValue: function (l, t) {
        var e = Cl();
        return El === null ? ff(e, l, t) : Vs(e, El.memoizedState, l, t);
      },
      useTransition: function () {
        var l = ef(he)[0],
          t = Cl().memoizedState;
        return [typeof l == "boolean" ? l : Qu(l), t];
      },
      useSyncExternalStore: gs,
      useId: Ks,
      useHostTransitionStatus: of,
      useFormState: Us,
      useActionState: Us,
      useOptimistic: function (l, t) {
        var e = Cl();
        return El !== null ? As(e, El, l, t) : ((e.baseState = l), [l, e.queue.dispatch]);
      },
      useMemoCache: lf,
      useCacheRefresh: Js,
      useEffectEvent: js,
    };
  function df(l, t, e, a) {
    (t = l.memoizedState),
      (e = e(a, t)),
      (e = e == null ? t : V({}, t, e)),
      (l.memoizedState = e),
      l.lanes === 0 && (l.updateQueue.baseState = e);
  }
  var vf = {
    enqueueSetState: function (l, t, e) {
      l = l._reactInternals;
      var a = At(),
        u = Ue(a);
      (u.payload = t),
        e != null && (u.callback = e),
        (t = Re(l, u, a)),
        t !== null && (rt(t, l, a), Zu(t, l, a));
    },
    enqueueReplaceState: function (l, t, e) {
      l = l._reactInternals;
      var a = At(),
        u = Ue(a);
      (u.tag = 1),
        (u.payload = t),
        e != null && (u.callback = e),
        (t = Re(l, u, a)),
        t !== null && (rt(t, l, a), Zu(t, l, a));
    },
    enqueueForceUpdate: function (l, t) {
      l = l._reactInternals;
      var e = At(),
        a = Ue(e);
      (a.tag = 2),
        t != null && (a.callback = t),
        (t = Re(l, a, e)),
        t !== null && (rt(t, l, e), Zu(t, l, e));
    },
  };
  function Ps(l, t, e, a, u, n, i) {
    return (
      (l = l.stateNode),
      typeof l.shouldComponentUpdate == "function"
        ? l.shouldComponentUpdate(a, n, i)
        : t.prototype && t.prototype.isPureReactComponent
          ? !Cu(e, a) || !Cu(u, n)
          : !0
    );
  }
  function lo(l, t, e, a) {
    (l = t.state),
      typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(e, a),
      typeof t.UNSAFE_componentWillReceiveProps == "function" &&
        t.UNSAFE_componentWillReceiveProps(e, a),
      t.state !== l && vf.enqueueReplaceState(t, t.state, null);
  }
  function ya(l, t) {
    var e = t;
    if ("ref" in t) {
      e = {};
      for (var a in t) a !== "ref" && (e[a] = t[a]);
    }
    if ((l = l.defaultProps)) {
      e === t && (e = V({}, e));
      for (var u in l) e[u] === void 0 && (e[u] = l[u]);
    }
    return e;
  }
  function to(l) {
    Bn(l);
  }
  function eo(l) {
    console.error(l);
  }
  function ao(l) {
    Bn(l);
  }
  function oi(l, t) {
    try {
      var e = l.onUncaughtError;
      e(t.value, { componentStack: t.stack });
    } catch (a) {
      setTimeout(function () {
        throw a;
      });
    }
  }
  function uo(l, t, e) {
    try {
      var a = l.onCaughtError;
      a(e.value, { componentStack: e.stack, errorBoundary: t.tag === 1 ? t.stateNode : null });
    } catch (u) {
      setTimeout(function () {
        throw u;
      });
    }
  }
  function mf(l, t, e) {
    return (
      (e = Ue(e)),
      (e.tag = 3),
      (e.payload = { element: null }),
      (e.callback = function () {
        oi(l, t);
      }),
      e
    );
  }
  function no(l) {
    return ((l = Ue(l)), (l.tag = 3), l);
  }
  function io(l, t, e, a) {
    var u = e.type.getDerivedStateFromError;
    if (typeof u == "function") {
      var n = a.value;
      (l.payload = function () {
        return u(n);
      }),
        (l.callback = function () {
          uo(t, e, a);
        });
    }
    var i = e.stateNode;
    i !== null &&
      typeof i.componentDidCatch == "function" &&
      (l.callback = function () {
        uo(t, e, a),
          typeof u != "function" && (Ge === null ? (Ge = new Set([this])) : Ge.add(this));
        var c = a.stack;
        this.componentDidCatch(a.value, { componentStack: c !== null ? c : "" });
      });
  }
  function uv(l, t, e, a, u) {
    if (((e.flags |= 32768), a !== null && typeof a == "object" && typeof a.then == "function")) {
      if (((t = e.alternate), t !== null && fa(t, e, u, !0), (e = Kl.current), e !== null)) {
        switch (e.tag) {
          case 31:
          case 13:
          case 19:
            return (
              Il === null ? Ci() : e.alternate === null && xl === 0 && (xl = 3),
              (e.flags &= -257),
              (e.flags |= 65536),
              (e.lanes = u),
              a === Wn
                ? (e.flags |= 16384)
                : ((t = e.updateQueue),
                  t === null ? (e.updateQueue = new Set([a])) : t.add(a),
                  If(l, a, u)),
              !1
            );
          case 22:
            return (
              (e.flags |= 65536),
              a === Wn
                ? (e.flags |= 16384)
                : ((t = e.updateQueue),
                  t === null
                    ? ((t = { transitions: null, markerInstances: null, retryQueue: new Set([a]) }),
                      (e.updateQueue = t))
                    : ((e = t.retryQueue), e === null ? (t.retryQueue = new Set([a])) : e.add(a)),
                  If(l, a, u)),
              !1
            );
        }
        throw Error(o(435, e.tag));
      }
      return (If(l, a, u), Ci(), !1);
    }
    if (tl)
      return (
        (t = Kl.current),
        t !== null
          ? ((t.flags & 65536) === 0 && (t.flags |= 256),
            (t.flags |= 65536),
            (t.lanes = u),
            a !== Rc && ((l = Error(o(422), { cause: a })), Hu(xt(l, e))))
          : (a !== Rc && ((t = Error(o(423), { cause: a })), Hu(xt(t, e))),
            (l = l.current.alternate),
            (l.flags |= 65536),
            (u &= -u),
            (l.lanes |= u),
            (a = xt(a, e)),
            (u = mf(l.stateNode, a, u)),
            Xc(l, u),
            xl !== 4 && (xl = 2)),
        !1
      );
    var n = Error(o(520), { cause: a });
    if (((n = xt(n, e)), Pu === null ? (Pu = [n]) : Pu.push(n), xl !== 4 && (xl = 2), t === null))
      return !0;
    (a = xt(a, e)), (e = t);
    do {
      switch (e.tag) {
        case 3:
          return (
            (e.flags |= 65536),
            (l = u & -u),
            (e.lanes |= l),
            (l = mf(e.stateNode, a, l)),
            Xc(e, l),
            !1
          );
        case 1:
          if (
            ((t = e.type),
            (n = e.stateNode),
            (e.flags & 128) === 0 &&
              (typeof t.getDerivedStateFromError == "function" ||
                (n !== null &&
                  typeof n.componentDidCatch == "function" &&
                  (Ge === null || !Ge.has(n)))))
          )
            return (
              (e.flags |= 65536),
              (u &= -u),
              (e.lanes |= u),
              (u = no(u)),
              io(u, l, e, a),
              Xc(e, u),
              !1
            );
          break;
        case 22:
          if (e.memoizedState !== null) return ((e.flags |= 65536), !1);
      }
      e = e.return;
    } while (e !== null);
    return !1;
  }
  var hf = Error(o(461)),
    jl = !1;
  function Bl(l, t, e, a) {
    t.child = l === null ? os(t, null, e, a) : ma(t, l.child, e, a);
  }
  function co(l, t, e, a, u) {
    e = e.render;
    var n = t.ref;
    if ("ref" in a) {
      var i = {};
      for (var c in a) c !== "ref" && (i[c] = a[c]);
    } else i = a;
    return (
      sa(t),
      (a = Wc(l, t, e, i, n, u)),
      (c = kc()),
      l !== null && !jl
        ? (Ic(l, t, u), ye(l, t, u))
        : (tl && c && Xn(t), (t.flags |= 1), Bl(l, t, a, u), t.child)
    );
  }
  function fo(l, t, e, a, u) {
    if (l === null) {
      var n = e.type;
      return typeof n == "function" && !xc(n) && n.defaultProps === void 0 && e.compare === null
        ? ((t.tag = 15), (t.type = n), so(l, t, n, a, u))
        : ((l = Gn(e.type, null, a, t, t.mode, u)), (l.ref = t.ref), (l.return = t), (t.child = l));
    }
    if (((n = l.child), !Af(l, u))) {
      var i = n.memoizedProps;
      if (((e = e.compare), (e = e !== null ? e : Cu), e(i, a) && l.ref === t.ref))
        return ye(l, t, u);
    }
    return ((t.flags |= 1), (l = oe(n, a)), (l.ref = t.ref), (l.return = t), (t.child = l));
  }
  function so(l, t, e, a, u) {
    if (l !== null) {
      var n = l.memoizedProps;
      if (Cu(n, a) && l.ref === t.ref)
        if (((jl = !1), (t.pendingProps = a = n), Af(l, u))) (l.flags & 131072) !== 0 && (jl = !0);
        else return ((t.lanes = l.lanes), ye(l, t, u));
    }
    return yf(l, t, e, a, u);
  }
  function oo(l, t, e, a) {
    var u = a.children,
      n = l !== null ? l.memoizedState : null;
    if (
      (l === null &&
        t.stateNode === null &&
        (t.stateNode = {
          _visibility: 1,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null,
        }),
      a.mode === "hidden")
    ) {
      if ((t.flags & 128) !== 0) {
        if (((n = n !== null ? n.baseLanes | e : e), l !== null)) {
          for (a = t.child = l.child, u = 0; a !== null; )
            (u = u | a.lanes | a.childLanes), (a = a.sibling);
          a = u & ~n;
        } else (a = 0), (t.child = null);
        return ro(l, t, n, e, a);
      }
      if ((e & 536870912) !== 0)
        (t.memoizedState = { baseLanes: 0, cachePool: null }),
          l !== null && Fn(t, n !== null ? n.cachePool : null),
          n !== null ? vs(t, n) : wc(),
          ms(t);
      else return ((a = t.lanes = 536870912), ro(l, t, n !== null ? n.baseLanes | e : e, e, a));
    } else
      n !== null
        ? (Fn(t, n.cachePool), vs(t, n), qe(), (t.memoizedState = null))
        : (l !== null && Fn(t, null), wc(), qe());
    return (Bl(l, t, u, e), t.child);
  }
  function Ku(l, t) {
    return (
      (l !== null && l.tag === 22) ||
        t.stateNode !== null ||
        (t.stateNode = {
          _visibility: 1,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null,
        }),
      t.sibling
    );
  }
  function ro(l, t, e, a, u) {
    var n = Zc();
    return (
      (n = n === null ? null : { parent: Rl._currentValue, pool: n }),
      (t.memoizedState = { baseLanes: e, cachePool: n }),
      l !== null && Fn(t, null),
      wc(),
      ms(t),
      l !== null && fa(l, t, a, !0),
      (t.childLanes = u),
      null
    );
  }
  function ri(l, t) {
    return (
      (t = di({ mode: t.mode, children: t.children }, l.mode)),
      (t.ref = l.ref),
      (l.child = t),
      (t.return = l),
      t
    );
  }
  function vo(l, t, e) {
    return (
      ma(t, l.child, null, e),
      (l = ri(t, t.pendingProps)),
      (l.flags |= 2),
      bt(t),
      (t.memoizedState = null),
      l
    );
  }
  function nv(l, t, e) {
    var a = t.pendingProps,
      u = (t.flags & 128) !== 0;
    if (((t.flags &= -129), l === null)) {
      if (tl) {
        if (a.mode === "hidden")
          return (
            (l = ri(t, a)),
            (t.lanes = 536870912),
            (l.memoizedState = { baseLanes: 0, cachePool: null }),
            Ku(null, l)
          );
        if (
          (Jc(t),
          (l = pl)
            ? ((l = Zr(l, Ut)),
              (l = l !== null && l.data === "&" ? l : null),
              l !== null &&
                ((t.memoizedState = {
                  dehydrated: l,
                  treeContext: _e !== null ? { id: Kt, overflow: Jt } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $1(l)),
                (e.return = t),
                (t.child = e),
                (Ll = t),
                (pl = null)))
            : (l = null),
          l === null)
        )
          throw Me(t);
        return ((t.lanes = 536870912), null);
      }
      return ri(t, a);
    }
    var n = l.memoizedState;
    if (n !== null) {
      var i = n.dehydrated;
      if ((Jc(t), u))
        if (t.flags & 256) (t.flags &= -257), (t = vo(l, t, e));
        else if (t.memoizedState !== null) (t.child = l.child), (t.flags |= 128), (t = null);
        else throw Error(o(558));
      else if ((jl || fa(l, t, e, !1), (u = (e & l.childLanes) !== 0), jl || u)) {
        if (He.current === null) {
          if (((a = zl), a !== null && ((i = I0(a, e)), i !== 0 && i !== n.retryLane)))
            throw ((n.retryLane = i), ua(l, i), rt(a, l, i), hf);
          Ci();
        }
        t = vo(l, t, e);
      } else
        (l = n.treeContext),
          (pl = Ht(i.nextSibling)),
          (Ll = t),
          (tl = !0),
          (Ne = null),
          (Ut = !1),
          l !== null && I1(t, l),
          (t = ri(t, a)),
          (t.flags |= 134221824);
      return t;
    }
    return (
      (l = oe(l.child, { mode: a.mode, children: a.children })),
      (l.ref = t.ref),
      (t.child = l),
      (l.return = t),
      l
    );
  }
  function Fa(l, t) {
    var e = t.ref;
    if (e === null) l !== null && l.ref !== null && (t.flags |= 4194816);
    else {
      if (typeof e != "function" && typeof e != "object") throw Error(o(284));
      (l === null || l.ref !== e) && (t.flags |= 4194816);
    }
  }
  function yf(l, t, e, a, u) {
    return (
      sa(t),
      (e = Wc(l, t, e, a, void 0, u)),
      (a = kc()),
      l !== null && !jl
        ? (Ic(l, t, u), ye(l, t, u))
        : (tl && a && Xn(t), (t.flags |= 1), Bl(l, t, e, u), t.child)
    );
  }
  function mo(l, t, e, a, u, n) {
    return (
      sa(t),
      (t.updateQueue = null),
      (e = ys(t, a, e, u)),
      hs(l),
      (a = kc()),
      l !== null && !jl
        ? (Ic(l, t, n), ye(l, t, n))
        : (tl && a && Xn(t), (t.flags |= 1), Bl(l, t, e, n), t.child)
    );
  }
  function ho(l, t, e, a, u) {
    if ((sa(t), t.stateNode === null)) {
      var n = Ya,
        i = e.contextType;
      typeof i == "object" && i !== null && (n = wl(i)),
        (n = new e(a, n)),
        (t.memoizedState = n.state !== null && n.state !== void 0 ? n.state : null),
        (n.updater = vf),
        (t.stateNode = n),
        (n._reactInternals = t),
        (n = t.stateNode),
        (n.props = a),
        (n.state = t.memoizedState),
        (n.refs = {}),
        Gc(t),
        (i = e.contextType),
        (n.context = typeof i == "object" && i !== null ? wl(i) : Ya),
        (n.state = t.memoizedState),
        (i = e.getDerivedStateFromProps),
        typeof i == "function" && (df(t, e, i, a), (n.state = t.memoizedState)),
        typeof e.getDerivedStateFromProps == "function" ||
          typeof n.getSnapshotBeforeUpdate == "function" ||
          (typeof n.UNSAFE_componentWillMount != "function" &&
            typeof n.componentWillMount != "function") ||
          ((i = n.state),
          typeof n.componentWillMount == "function" && n.componentWillMount(),
          typeof n.UNSAFE_componentWillMount == "function" && n.UNSAFE_componentWillMount(),
          i !== n.state && vf.enqueueReplaceState(n, n.state, null),
          Gu(t, a, n, u),
          Lu(),
          (n.state = t.memoizedState)),
        typeof n.componentDidMount == "function" && (t.flags |= 4194308),
        (a = !0);
    } else if (l === null) {
      n = t.stateNode;
      var c = t.memoizedProps,
        f = ya(e, c);
      n.props = f;
      var h = n.context,
        S = e.contextType;
      (i = Ya), typeof S == "object" && S !== null && (i = wl(S));
      var p = e.getDerivedStateFromProps;
      (S = typeof p == "function" || typeof n.getSnapshotBeforeUpdate == "function"),
        (c = t.pendingProps !== c),
        S ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((c || h !== i) && lo(t, n, a, i)),
        (Ce = !1);
      var v = t.memoizedState;
      (n.state = v),
        Gu(t, a, n, u),
        Lu(),
        (h = t.memoizedState),
        c || v !== h || Ce
          ? (typeof p == "function" && (df(t, e, p, a), (h = t.memoizedState)),
            (f = Ce || Ps(t, e, f, a, v, h, i))
              ? (S ||
                  (typeof n.UNSAFE_componentWillMount != "function" &&
                    typeof n.componentWillMount != "function") ||
                  (typeof n.componentWillMount == "function" && n.componentWillMount(),
                  typeof n.UNSAFE_componentWillMount == "function" &&
                    n.UNSAFE_componentWillMount()),
                typeof n.componentDidMount == "function" && (t.flags |= 4194308))
              : (typeof n.componentDidMount == "function" && (t.flags |= 4194308),
                (t.memoizedProps = a),
                (t.memoizedState = h)),
            (n.props = a),
            (n.state = h),
            (n.context = i),
            (a = f))
          : (typeof n.componentDidMount == "function" && (t.flags |= 4194308), (a = !1));
    } else {
      (n = t.stateNode),
        Vc(l, t),
        (i = t.memoizedProps),
        (S = ya(e, i)),
        (n.props = S),
        (p = t.pendingProps),
        (v = n.context),
        (h = e.contextType),
        (f = Ya),
        typeof h == "object" && h !== null && (f = wl(h)),
        (c = e.getDerivedStateFromProps),
        (h = typeof c == "function" || typeof n.getSnapshotBeforeUpdate == "function") ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((i !== p || v !== f) && lo(t, n, a, f)),
        (Ce = !1),
        (v = t.memoizedState),
        (n.state = v),
        Gu(t, a, n, u),
        Lu();
      var g = t.memoizedState;
      i !== p || v !== g || Ce || (l !== null && l.dependencies !== null && Kn(l.dependencies))
        ? (typeof c == "function" && (df(t, e, c, a), (g = t.memoizedState)),
          (S =
            Ce ||
            Ps(t, e, S, a, v, g, f) ||
            (l !== null && l.dependencies !== null && Kn(l.dependencies)))
            ? (h ||
                (typeof n.UNSAFE_componentWillUpdate != "function" &&
                  typeof n.componentWillUpdate != "function") ||
                (typeof n.componentWillUpdate == "function" && n.componentWillUpdate(a, g, f),
                typeof n.UNSAFE_componentWillUpdate == "function" &&
                  n.UNSAFE_componentWillUpdate(a, g, f)),
              typeof n.componentDidUpdate == "function" && (t.flags |= 4),
              typeof n.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024))
            : (typeof n.componentDidUpdate != "function" ||
                (i === l.memoizedProps && v === l.memoizedState) ||
                (t.flags |= 4),
              typeof n.getSnapshotBeforeUpdate != "function" ||
                (i === l.memoizedProps && v === l.memoizedState) ||
                (t.flags |= 1024),
              (t.memoizedProps = a),
              (t.memoizedState = g)),
          (n.props = a),
          (n.state = g),
          (n.context = f),
          (a = S))
        : (typeof n.componentDidUpdate != "function" ||
            (i === l.memoizedProps && v === l.memoizedState) ||
            (t.flags |= 4),
          typeof n.getSnapshotBeforeUpdate != "function" ||
            (i === l.memoizedProps && v === l.memoizedState) ||
            (t.flags |= 1024),
          (a = !1));
    }
    return (
      (n = a),
      Fa(l, t),
      (a = (t.flags & 128) !== 0),
      n || a
        ? ((n = t.stateNode),
          (e = a && typeof e.getDerivedStateFromError != "function" ? null : n.render()),
          (t.flags |= 1),
          l !== null && a
            ? ((t.child = ma(t, l.child, null, u)), (t.child = ma(t, null, e, u)))
            : Bl(l, t, e, u),
          (t.memoizedState = n.state),
          (l = t.child))
        : (l = ye(l, t, u)),
      l
    );
  }
  function yo(l, t, e, a) {
    return (ia(), (t.flags |= 256), Bl(l, t, e, a), t.child);
  }
  var gf = { dehydrated: null, treeContext: null, retryLane: 0, hydrationErrors: null };
  function Sf(l) {
    return { baseLanes: l, cachePool: us() };
  }
  function bf(l, t, e) {
    return ((l = l !== null ? l.childLanes & ~e : 0), t && (l |= zt), l);
  }
  function go(l, t, e) {
    var a = t.pendingProps,
      u = !1,
      n = (t.flags & 128) !== 0,
      i;
    if (
      ((i = n) || (i = l !== null && l.memoizedState === null ? !1 : (Jl.current & 2) !== 0),
      i && ((u = !0), (t.flags &= -129)),
      (i = (t.flags & 32) !== 0),
      (t.flags &= -33),
      l === null)
    ) {
      if (tl) {
        if (
          (u ? je(t) : qe(),
          (l = pl)
            ? ((l = Zr(l, Ut)),
              (l = l !== null && l.data !== "&" ? l : null),
              l !== null &&
                ((t.memoizedState = {
                  dehydrated: l,
                  treeContext: _e !== null ? { id: Kt, overflow: Jt } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $1(l)),
                (e.return = t),
                (t.child = e),
                (Ll = t),
                (pl = null)))
            : (l = null),
          l === null)
        )
          throw Me(t);
        return (S0(l) ? (t.lanes = 32) : (t.lanes = 536870912), null);
      }
      return (
        (n = a.children),
        (a = a.fallback),
        u
          ? (qe(),
            (u = t.mode),
            (n = di({ mode: "hidden", children: n }, u)),
            (a = na(a, u, e, null)),
            (n.return = t),
            (a.return = t),
            (n.sibling = a),
            (t.child = n),
            (a = t.child),
            (a.memoizedState = Sf(e)),
            (a.childLanes = bf(l, i, e)),
            (t.memoizedState = gf),
            Ku(null, a))
          : (je(t), Ef(t, n))
      );
    }
    var c = l.memoizedState;
    if (c !== null) {
      var f = c.dehydrated;
      if (f !== null) return iv(l, t, n, i, a, f, c, e);
    }
    return u
      ? (qe(),
        (u = a.fallback),
        (n = t.mode),
        (c = l.child),
        (f = c.sibling),
        (a = oe(c, { mode: "hidden", children: a.children })),
        (a.subtreeFlags = c.subtreeFlags & 1206910976),
        f !== null ? (u = oe(f, u)) : ((u = na(u, n, e, null)), (u.flags |= 2)),
        (u.return = t),
        (a.return = t),
        (a.sibling = u),
        (t.child = a),
        Ku(null, a),
        (a = t.child),
        (u = l.child.memoizedState),
        u === null
          ? (u = Sf(e))
          : ((n = u.cachePool),
            n !== null
              ? ((c = Rl._currentValue), (n = n.parent !== c ? { parent: c, pool: c } : n))
              : (n = us()),
            (u = { baseLanes: u.baseLanes | e, cachePool: n })),
        (a.memoizedState = u),
        (a.childLanes = bf(l, i, e)),
        (t.memoizedState = gf),
        Ku(l.child, a))
      : (je(t),
        (e = l.child),
        (l = e.sibling),
        (e = oe(e, { mode: "visible", children: a.children })),
        (e.return = t),
        (e.sibling = null),
        l !== null &&
          ((i = t.deletions), i === null ? ((t.deletions = [l]), (t.flags |= 16)) : i.push(l)),
        (t.child = e),
        (t.memoizedState = null),
        e);
  }
  function Ef(l, t) {
    return ((t = di({ mode: "visible", children: t }, l.mode)), (t.return = l), (l.child = t));
  }
  function di(l, t) {
    return ((l = ct(22, l, null, t)), (l.lanes = 0), l);
  }
  function vi(l, t, e) {
    return (
      ma(t, l.child, null, e),
      (l = Ef(t, t.pendingProps.children)),
      (l.flags |= 2),
      (t.memoizedState = null),
      l
    );
  }
  function iv(l, t, e, a, u, n, i, c) {
    if (e)
      return t.flags & 256
        ? (je(t), (t.flags &= -257), vi(l, t, c))
        : t.memoizedState !== null
          ? (qe(), (t.child = l.child), (t.flags |= 128), null)
          : (qe(),
            (n = u.fallback),
            (i = t.mode),
            (u = di({ mode: "visible", children: u.children }, i)),
            (n = na(n, i, c, null)),
            (n.flags |= 2),
            (u.return = t),
            (n.return = t),
            (u.sibling = n),
            (t.child = u),
            ma(t, l.child, null, c),
            (u = t.child),
            (u.memoizedState = Sf(c)),
            (u.childLanes = bf(l, a, c)),
            (t.memoizedState = gf),
            Ku(null, u));
    if ((je(t), S0(n))) {
      if (((a = n.nextSibling && n.nextSibling.dataset), a)) var f = a.dgst;
      return (
        (a = f),
        a !== "" &&
          ((u = Error(o(419))),
          (u.stack = ""),
          (u.digest = a),
          Hu({ value: u, source: null, stack: null })),
        vi(l, t, c)
      );
    }
    if ((jl || fa(l, t, c, !1), (a = (c & l.childLanes) !== 0), jl || a)) {
      if (He.current !== null) return vi(l, t, c);
      if (((a = zl), a !== null && ((u = I0(a, c)), u !== 0 && u !== i.retryLane)))
        throw ((i.retryLane = u), ua(l, u), rt(a, l, u), hf);
      return (g0(n) || Ci(), vi(l, t, c));
    }
    return g0(n)
      ? ((t.flags |= 192), (t.child = l.child), null)
      : ((l = i.treeContext),
        (pl = Ht(n.nextSibling)),
        (Ll = t),
        (tl = !0),
        (Ne = null),
        (Ut = !1),
        l !== null && I1(t, l),
        (t = Ef(t, u.children)),
        (t.flags |= 134221824),
        t);
  }
  function So(l, t, e) {
    l.lanes |= t;
    var a = l.alternate;
    a !== null && (a.lanes |= t), wn(l.return, t, e);
  }
  function bo(l) {
    for (var t = null; l !== null; ) {
      var e = l.alternate;
      e !== null && li(e) === null && (t = l), (l = l.sibling);
    }
    return t;
  }
  function mi(l, t, e, a, u, n) {
    var i = l.memoizedState;
    i === null
      ? (l.memoizedState = {
          isBackwards: t,
          rendering: null,
          renderingStartTime: 0,
          last: a,
          tail: e,
          tailMode: u,
          treeForkCount: n,
        })
      : ((i.isBackwards = t),
        (i.rendering = null),
        (i.renderingStartTime = 0),
        (i.last = a),
        (i.tail = e),
        (i.tailMode = u),
        (i.treeForkCount = n));
  }
  function Tf(l) {
    var t = l.child;
    for (l.child = null; t !== null; ) {
      var e = t.sibling;
      (t.sibling = l.child), (l.child = t), (t = e);
    }
  }
  function zf(l, t, e) {
    var a = t.pendingProps,
      u = a.revealOrder,
      n = a.tail;
    a = a.children;
    var i = Jl.current;
    if (t.flags & 128) return (Vu(t, i), null);
    var c = (i & 2) !== 0;
    if (
      (c ? ((i = (i & 1) | 2), (t.flags |= 128)) : (i &= 1),
      Vu(t, i),
      u === "backwards" && l !== null ? (Tf(l), Bl(l, t, a, e), Tf(l)) : Bl(l, t, a, e),
      (a = tl ? Ru : 0),
      !c && l !== null && (l.flags & 128) !== 0)
    )
      l: for (l = t.child; l !== null; ) {
        if (l.tag === 13) l.memoizedState !== null && So(l, e, t);
        else if (l.tag === 19) So(l, e, t);
        else if (l.child !== null) {
          (l.child.return = l), (l = l.child);
          continue;
        }
        if (l === t) break l;
        for (; l.sibling === null; ) {
          if (l.return === null || l.return === t) break l;
          l = l.return;
        }
        (l.sibling.return = l.return), (l = l.sibling);
      }
    switch (u) {
      case "backwards":
        (e = bo(t.child)),
          e === null
            ? ((u = t.child), (t.child = null))
            : ((u = e.sibling), (e.sibling = null), Tf(t)),
          mi(t, !0, u, null, n, a);
        break;
      case "unstable_legacy-backwards":
        for (e = null, u = t.child, t.child = null; u !== null; ) {
          if (((l = u.alternate), l !== null && li(l) === null)) {
            t.child = u;
            break;
          }
          (l = u.sibling), (u.sibling = e), (e = u), (u = l);
        }
        mi(t, !0, e, null, n, a);
        break;
      case "together":
        mi(t, !1, null, null, void 0, a);
        break;
      case "independent":
        t.memoizedState = null;
        break;
      default:
        (e = bo(t.child)),
          e === null ? ((u = t.child), (t.child = null)) : ((u = e.sibling), (e.sibling = null)),
          mi(t, !1, u, e, n, a);
    }
    return t.child;
  }
  function Eo(l, t, e) {
    var a = t.pendingProps;
    return (xe(t, t.type, a.value), Bl(l, t, a.children, e), t.child);
  }
  function ye(l, t, e) {
    if (
      (l !== null && (t.dependencies = l.dependencies), (Le |= t.lanes), (e & t.childLanes) === 0)
    )
      if (l !== null) {
        if ((fa(l, t, e, !1), (e & t.childLanes) === 0)) return null;
      } else return null;
    if (l !== null && t.child !== l.child) throw Error(o(153));
    if (t.child !== null) {
      for (l = t.child, e = oe(l, l.pendingProps), t.child = e, e.return = t; l.sibling !== null; )
        (l = l.sibling), (e = e.sibling = oe(l, l.pendingProps)), (e.return = t);
      e.sibling = null;
    }
    return t.child;
  }
  function Af(l, t) {
    return (l.lanes & t) !== 0 ? !0 : ((l = l.dependencies), !!(l !== null && Kn(l)));
  }
  function cv(l, t, e) {
    switch (t.tag) {
      case 3:
        bn(t, t.stateNode.containerInfo), xe(t, Rl, l.memoizedState.cache), ia();
        break;
      case 27:
      case 5:
        $i(t);
        break;
      case 4:
        bn(t, t.stateNode.containerInfo);
        break;
      case 10:
        xe(t, t.type, t.memoizedProps.value);
        break;
      case 31:
        if (t.memoizedState !== null) return ((t.flags |= 128), Jc(t), null);
        break;
      case 13:
        var a = t.memoizedState;
        if (a !== null) {
          if (a.dehydrated !== null) return (je(t), (t.flags |= 128), null);
          a = fa(l, t, e, !1);
          var u = t.child.childLanes;
          return a || (e & u) !== 0
            ? go(l, t, e)
            : (je(t), (l = ye(l, t, e)), l !== null ? l.sibling : null);
        }
        je(t);
        break;
      case 19:
        if (t.flags & 128) return zf(l, t, e);
        if (
          ((u = (l.flags & 128) !== 0),
          (a = (e & t.childLanes) !== 0),
          a || (fa(l, t, e, !1), (a = (e & t.childLanes) !== 0)),
          u)
        ) {
          if (a) return zf(l, t, e);
          t.flags |= 128;
        }
        if (
          ((u = t.memoizedState),
          u !== null && ((u.rendering = null), (u.tail = null), (u.lastEffect = null)),
          Vu(t, Jl.current),
          a)
        )
          break;
        return null;
      case 22:
        return ((t.lanes = 0), oo(l, t, e, t.pendingProps));
      case 24:
        xe(t, Rl, l.memoizedState.cache);
    }
    return ye(l, t, e);
  }
  function To(l, t, e) {
    if (l !== null)
      if (l.memoizedProps !== t.pendingProps) jl = !0;
      else {
        if (!Af(l, e) && (t.flags & 128) === 0) return ((jl = !1), cv(l, t, e));
        jl = (l.flags & 131072) !== 0;
      }
    else (jl = !1), tl && (t.flags & 1048576) !== 0 && k1(t, Ru, t.index);
    switch (((t.lanes = 0), t.tag)) {
      case 16:
        l: {
          var a = t.pendingProps;
          if (((l = da(t.elementType)), (t.type = l), typeof l == "function"))
            xc(l)
              ? ((a = ya(l, a)), (t.tag = 1), (t = ho(null, t, l, a, e)))
              : ((t.tag = 0), (t = yf(null, t, l, a, e)));
          else {
            if (l != null) {
              var u = l.$$typeof;
              if (u === U) {
                (t.tag = 11), (t = co(null, t, l, a, e));
                break l;
              } else if (u === Tl) {
                (t.tag = 14), (t = fo(null, t, l, a, e));
                break l;
              } else if (u === Yl) {
                (t.tag = 10), (t.type = l), (t = Eo(null, t, e));
                break l;
              }
            }
            throw ((t = rl(l) || l), Error(o(306, t, "")));
          }
        }
        return t;
      case 0:
        return yf(l, t, t.type, t.pendingProps, e);
      case 1:
        return ((a = t.type), (u = ya(a, t.pendingProps)), ho(l, t, a, u, e));
      case 3:
        l: {
          if ((bn(t, t.stateNode.containerInfo), l === null)) throw Error(o(387));
          a = t.pendingProps;
          var n = t.memoizedState;
          (u = n.element), Vc(l, t), Gu(t, a, null, e);
          var i = t.memoizedState;
          if (
            ((a = i.cache),
            xe(t, Rl, a),
            a !== n.cache && qc(t, [Rl], e, !0),
            Lu(),
            (a = i.element),
            n.isDehydrated)
          )
            if (
              ((n = { element: a, isDehydrated: !1, cache: i.cache }),
              (t.updateQueue.baseState = n),
              (t.memoizedState = n),
              t.flags & 256)
            ) {
              t = yo(l, t, a, e);
              break l;
            } else if (a !== u) {
              (u = xt(Error(o(424)), t)), Hu(u), (t = yo(l, t, a, e));
              break l;
            } else {
              switch (((l = t.stateNode.containerInfo), l.nodeType)) {
                case 9:
                  l = l.body;
                  break;
                default:
                  l = l.nodeName === "HTML" ? l.ownerDocument.body : l;
              }
              for (
                pl = Ht(l.firstChild),
                  Ll = t,
                  tl = !0,
                  Ne = null,
                  Ut = !0,
                  e = os(t, null, a, e),
                  t.child = e;
                e;
              )
                (e.flags = (e.flags & -3) | 134221824), (e = e.sibling);
            }
          else {
            if ((ia(), a === u)) {
              t = ye(l, t, e);
              break l;
            }
            Bl(l, t, a, e);
          }
          t = t.child;
        }
        return t;
      case 26:
        return (
          Fa(l, t),
          l === null
            ? (e = Kr(t.type, null, t.pendingProps, null))
              ? (t.memoizedState = e)
              : tl || (t.stateNode = Or(t.type, t.pendingProps, Te.current, t))
            : (t.memoizedState = Kr(t.type, l.memoizedProps, t.pendingProps, l.memoizedState)),
          null
        );
      case 27:
        return (
          $i(t),
          l === null &&
            tl &&
            ((a = t.stateNode = Vr(t.type, t.pendingProps, Te.current)),
            (Ll = t),
            (Ut = !0),
            (u = pl),
            Qe(t.type) ? ((b0 = u), (pl = Ht(a.firstChild))) : (pl = u)),
          Bl(l, t, t.pendingProps.children, e),
          Fa(l, t),
          l === null && (t.flags |= 4194304),
          t.child
        );
      case 5:
        return (
          l === null &&
            tl &&
            ((u = a = pl) &&
              ((a = tm(a, t.type, t.pendingProps, Ut)),
              a !== null
                ? ((t.stateNode = a), (Ll = t), (pl = Ht(a.firstChild)), (Ut = !1), (u = !0))
                : (u = !1)),
            u || Me(t)),
          $i(t),
          (u = t.type),
          (n = t.pendingProps),
          (i = l !== null ? l.memoizedProps : null),
          (a = n.children),
          o0(u, n) ? (a = null) : i !== null && o0(u, i) && (t.flags |= 32),
          t.memoizedState !== null && ((u = Wc(l, t, Wd, null, null, e)), (du._currentValue = u)),
          Fa(l, t),
          Bl(l, t, a, e),
          t.child
        );
      case 6:
        return (
          l === null &&
            tl &&
            ((l = e = pl) &&
              ((e = em(e, t.pendingProps, Ut)),
              e !== null ? ((t.stateNode = e), (Ll = t), (pl = null), (l = !0)) : (l = !1)),
            l || Me(t)),
          null
        );
      case 13:
        return go(l, t, e);
      case 4:
        return (
          bn(t, t.stateNode.containerInfo),
          (a = t.pendingProps),
          l === null ? (t.child = ma(t, null, a, e)) : Bl(l, t, a, e),
          t.child
        );
      case 11:
        return co(l, t, t.type, t.pendingProps, e);
      case 7:
        return ((a = t.pendingProps), Fa(l, t), Bl(l, t, a, e), t.child);
      case 8:
        return (Bl(l, t, t.pendingProps.children, e), t.child);
      case 12:
        return (Bl(l, t, t.pendingProps.children, e), t.child);
      case 10:
        return Eo(l, t, e);
      case 9:
        return (
          (u = t.type._context),
          (a = t.pendingProps.children),
          sa(t),
          (u = wl(u)),
          (a = a(u)),
          (t.flags |= 1),
          Bl(l, t, a, e),
          t.child
        );
      case 14:
        return fo(l, t, t.type, t.pendingProps, e);
      case 15:
        return so(l, t, t.type, t.pendingProps, e);
      case 19:
        return zf(l, t, e);
      case 31:
        return nv(l, t, e);
      case 22:
        return oo(l, t, e, t.pendingProps);
      case 24:
        return (
          sa(t),
          (a = wl(Rl)),
          l === null
            ? ((u = Zc()),
              u === null &&
                ((u = zl),
                (n = Bc()),
                (u.pooledCache = n),
                n.refCount++,
                n !== null && (u.pooledCacheLanes |= e),
                (u = n)),
              (t.memoizedState = { parent: a, cache: u }),
              Gc(t),
              xe(t, Rl, u))
            : ((l.lanes & e) !== 0 && (Vc(l, t), Gu(t, null, null, e), Lu()),
              (u = l.memoizedState),
              (n = t.memoizedState),
              u.parent !== a
                ? ((u = { parent: a, cache: a }),
                  (t.memoizedState = u),
                  t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = u),
                  xe(t, Rl, a))
                : ((a = n.cache), xe(t, Rl, a), a !== u.cache && qc(t, [Rl], e, !0))),
          Bl(l, t, t.pendingProps.children, e),
          t.child
        );
      case 30:
        return (
          t.stateNode === null &&
            (t.stateNode = { autoName: null, paired: null, clones: null, ref: null }),
          (a = t.pendingProps),
          a.name != null && a.name !== "auto"
            ? (t.flags |= l === null ? 18882560 : 18874368)
            : tl && Xn(t),
          l !== null && l.memoizedProps.name !== a.name ? (t.flags |= 4194816) : Fa(l, t),
          Bl(l, t, a.children, e),
          t.child
        );
      case 29:
        throw t.pendingProps;
    }
    throw Error(o(156, t.tag));
  }
  function ge(l) {
    l.flags |= 4;
  }
  function pf(l, t, e, a, u) {
    var n;
    if (
      ((n = (l.mode & 32) !== 0) &&
        (n = e === null ? Wr(t, a) : Wr(t, a) && (a.src !== e.src || a.srcSet !== e.srcSet)),
      n)
    ) {
      if (((l.flags |= 16777216), (u & 335544128) === u))
        if (l.stateNode.complete) l.flags |= 8192;
        else if (er()) l.flags |= 8192;
        else throw ((va = Wn), Lc);
    } else l.flags &= -16777217;
  }
  function zo(l, t) {
    if (t.type !== "stylesheet" || (t.state.loading & 4) !== 0) l.flags &= -16777217;
    else if (((l.flags |= 16777216), !kr(t)))
      if (er()) l.flags |= 8192;
      else throw ((va = Wn), Lc);
  }
  function hi(l, t) {
    t !== null && (l.flags |= 4),
      l.flags & 16384 && ((t = l.tag !== 22 ? $0() : 536870912), (l.lanes |= t), (Pa |= t));
  }
  function Ju(l, t) {
    if (!tl)
      switch (l.tailMode) {
        case "visible":
          break;
        case "collapsed":
          for (var e = l.tail, a = null; e !== null; )
            e.alternate !== null && (a = e), (e = e.sibling);
          a === null
            ? t || l.tail === null
              ? (l.tail = null)
              : (l.tail.sibling = null)
            : (a.sibling = null);
          break;
        default:
          for (t = l.tail, e = null; t !== null; ) t.alternate !== null && (e = t), (t = t.sibling);
          e === null ? (l.tail = null) : (e.sibling = null);
      }
  }
  function Ol(l) {
    var t = l.alternate !== null && l.alternate.child === l.child,
      e = 0,
      a = 0;
    if (t)
      for (var u = l.child; u !== null; )
        (e |= u.lanes | u.childLanes),
          (a |= u.subtreeFlags & 1206910976),
          (a |= u.flags & 1206910976),
          (u.return = l),
          (u = u.sibling);
    else
      for (u = l.child; u !== null; )
        (e |= u.lanes | u.childLanes),
          (a |= u.subtreeFlags),
          (a |= u.flags),
          (u.return = l),
          (u = u.sibling);
    return ((l.subtreeFlags |= a), (l.childLanes = e), t);
  }
  function fv(l, t, e) {
    var a = t.pendingProps;
    switch ((Uc(t), t.tag)) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return (Ol(t), null);
      case 1:
        return (Ol(t), null);
      case 3:
        return (
          (e = t.stateNode),
          (a = null),
          l !== null && (a = l.memoizedState.cache),
          t.memoizedState.cache !== a && (t.flags |= 2048),
          ve(Rl),
          Oa(),
          e.pendingContext && ((e.context = e.pendingContext), (e.pendingContext = null)),
          (l === null || l.child === null) &&
            (Ga(t)
              ? ge(t)
              : l === null ||
                (l.memoizedState.isDehydrated && (t.flags & 256) === 0) ||
                ((t.flags |= 1024), Hc())),
          Ol(t),
          null
        );
      case 26:
        var u = t.type,
          n = t.memoizedState;
        return (
          l === null
            ? (ge(t), n !== null ? (Ol(t), zo(t, n)) : (Ol(t), pf(t, u, null, a, e)))
            : n
              ? n !== l.memoizedState
                ? (ge(t), Ol(t), zo(t, n))
                : (Ol(t), (t.flags &= -16777217))
              : ((l = l.memoizedProps), l !== a && ge(t), Ol(t), pf(t, u, l, a, e)),
          null
        );
      case 27:
        if ((En(t), (e = Te.current), (u = t.type), l !== null && t.stateNode != null))
          l.memoizedProps !== a && ge(t);
        else {
          if (!a) {
            if (t.stateNode === null) throw Error(o(166));
            return (Ol(t), (t.subtreeFlags &= -33554433), null);
          }
          (l = Qt.current), Ga(t) ? P1(t) : ((l = Vr(u, a, e)), (t.stateNode = l), ge(t));
        }
        return (Ol(t), (t.subtreeFlags &= -33554433), null);
      case 5:
        if ((En(t), (u = t.type), l !== null && t.stateNode != null))
          l.memoizedProps !== a && ge(t);
        else {
          if (!a) {
            if (t.stateNode === null) throw Error(o(166));
            return (Ol(t), (t.subtreeFlags &= -33554433), null);
          }
          if (((n = Qt.current), Ga(t))) P1(t);
          else {
            var i = un(Te.current);
            switch (n) {
              case 1:
                n = i.createElementNS("http://www.w3.org/2000/svg", u);
                break;
              case 2:
                n = i.createElementNS("http://www.w3.org/1998/Math/MathML", u);
                break;
              default:
                switch (u) {
                  case "svg":
                    n = i.createElementNS("http://www.w3.org/2000/svg", u);
                    break;
                  case "math":
                    n = i.createElementNS("http://www.w3.org/1998/Math/MathML", u);
                    break;
                  case "script":
                    (n = i.createElement("div")),
                      (n.innerHTML = "<script><\/script>"),
                      (n = n.removeChild(n.firstChild));
                    break;
                  case "select":
                    (n =
                      typeof a.is == "string"
                        ? i.createElement("select", { is: a.is })
                        : i.createElement("select")),
                      a.multiple ? (n.multiple = !0) : a.size && (n.size = a.size);
                    break;
                  default:
                    n =
                      typeof a.is == "string"
                        ? i.createElement(u, { is: a.is })
                        : i.createElement(u);
                }
            }
            (n[Ql] = t), (n[it] = a);
            l: for (i = t.child; i !== null; ) {
              if (i.tag === 5 || i.tag === 6) n.appendChild(i.stateNode);
              else if (i.tag !== 4 && i.tag !== 27 && i.child !== null) {
                (i.child.return = i), (i = i.child);
                continue;
              }
              if (i === t) break l;
              for (; i.sibling === null; ) {
                if (i.return === null || i.return === t) break l;
                i = i.return;
              }
              (i.sibling.return = i.return), (i = i.sibling);
            }
            t.stateNode = n;
            l: switch (($l(n, u, a), u)) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                a = !!a.autoFocus;
                break l;
              case "img":
                a = !0;
                break l;
              default:
                a = !1;
            }
            a && ge(t);
          }
        }
        return (
          Ol(t),
          (t.subtreeFlags &= -33554433),
          pf(t, t.type, l === null ? null : l.memoizedProps, t.pendingProps, e),
          null
        );
      case 6:
        if (l && t.stateNode != null) l.memoizedProps !== a && ge(t);
        else {
          if (typeof a != "string" && t.stateNode === null) throw Error(o(166));
          if (((l = Te.current), Ga(t))) {
            if (((l = t.stateNode), (e = t.memoizedProps), (a = null), (u = Ll), u !== null))
              switch (u.tag) {
                case 27:
                case 5:
                  a = u.memoizedProps;
              }
            (l[Ql] = t),
              (l = !!(
                l.nodeValue === e ||
                (a !== null && a.suppressHydrationWarning === !0) ||
                Tr(l.nodeValue, e)
              )),
              l || Me(t, !0);
          } else (l = un(l).createTextNode(a)), (l[Ql] = t), (t.stateNode = l);
        }
        return (Ol(t), null);
      case 31:
        if (((e = t.memoizedState), l === null || l.memoizedState !== null)) {
          if (((a = Ga(t)), e !== null)) {
            if (l === null) {
              if (!a) throw Error(o(318));
              if (((l = t.memoizedState), (l = l !== null ? l.dehydrated : null), !l))
                throw Error(o(557));
              l[Ql] = t;
            } else ia(), (t.flags & 128) === 0 && (t.memoizedState = null), (t.flags |= 4);
            Ol(t), (l = !1);
          } else
            (e = Hc()),
              l !== null && l.memoizedState !== null && (l.memoizedState.hydrationErrors = e),
              (l = !0);
          if (!l) return t.flags & 256 ? (bt(t), t) : (bt(t), null);
          if ((t.flags & 128) !== 0) throw Error(o(558));
        }
        return (Ol(t), null);
      case 13:
        if (
          ((a = t.memoizedState),
          l === null || (l.memoizedState !== null && l.memoizedState.dehydrated !== null))
        ) {
          if (((u = Ga(t)), a !== null && a.dehydrated !== null)) {
            if (l === null) {
              if (!u) throw Error(o(318));
              if (((u = t.memoizedState), (u = u !== null ? u.dehydrated : null), !u))
                throw Error(o(317));
              u[Ql] = t;
            } else ia(), (t.flags & 128) === 0 && (t.memoizedState = null), (t.flags |= 4);
            Ol(t), (u = !1);
          } else
            (u = Hc()),
              l !== null && l.memoizedState !== null && (l.memoizedState.hydrationErrors = u),
              (u = !0);
          if (!u) return t.flags & 256 ? (bt(t), t) : (bt(t), null);
        }
        return (
          bt(t),
          (t.flags & 128) !== 0
            ? ((t.lanes = e), t)
            : ((e = a !== null),
              (l = l !== null && l.memoizedState !== null),
              e &&
                ((a = t.child),
                (u = null),
                a.alternate !== null &&
                  a.alternate.memoizedState !== null &&
                  a.alternate.memoizedState.cachePool !== null &&
                  (u = a.alternate.memoizedState.cachePool.pool),
                (n = null),
                a.memoizedState !== null &&
                  a.memoizedState.cachePool !== null &&
                  (n = a.memoizedState.cachePool.pool),
                n !== u && (a.flags |= 2048)),
              e !== l && e && (t.child.flags |= 8192),
              hi(t, t.updateQueue),
              Ol(t),
              null)
        );
      case 4:
        return (
          Oa(), l === null && n0(t.stateNode.containerInfo), (t.flags |= 67108864), Ol(t), null
        );
      case 10:
        return (ve(t.type), Ol(t), null);
      case 19:
        if ((Fc(t), (a = t.memoizedState), a === null)) return (Ol(t), null);
        if (((u = (t.flags & 128) !== 0), (n = a.rendering), n === null))
          if (u) Ju(a, !1);
          else {
            if (xl !== 0 || (l !== null && (l.flags & 128) !== 0))
              for (l = t.child; l !== null; ) {
                if (((n = li(l)), n !== null)) {
                  for (
                    t.flags |= 128,
                      Ju(a, !1),
                      l = n.updateQueue,
                      t.updateQueue = l,
                      hi(t, l),
                      t.subtreeFlags = 0,
                      l = e,
                      e = t.child;
                    e !== null;
                  )
                    F1(e, l), (e = e.sibling);
                  return (Vu(t, (Jl.current & 1) | 2), tl && re(t, a.treeForkCount), t.child);
                }
                l = l.sibling;
              }
            a.tail !== null &&
              mt() > Ni &&
              ((t.flags |= 128), (u = !0), Ju(a, !1), (t.lanes = 4194304));
          }
        else {
          if (!u)
            if (((l = li(n)), l !== null)) {
              if (
                ((t.flags |= 128),
                (u = !0),
                (l = l.updateQueue),
                (t.updateQueue = l),
                hi(t, l),
                Ju(a, !0),
                a.tail === null &&
                  a.tailMode !== "collapsed" &&
                  a.tailMode !== "visible" &&
                  !n.alternate &&
                  !tl)
              )
                return (Ol(t), null);
            } else
              2 * mt() - a.renderingStartTime > Ni &&
                e !== 536870912 &&
                ((t.flags |= 128), (u = !0), Ju(a, !1), (t.lanes = 4194304));
          a.isBackwards
            ? ((n.sibling = t.child), (t.child = n))
            : ((l = a.last), l !== null ? (l.sibling = n) : (t.child = n), (a.last = n));
        }
        if (a.tail !== null) {
          l = a.tail;
          l: {
            for (e = l; e !== null; ) {
              if (e.alternate !== null) {
                e = !1;
                break l;
              }
              e = e.sibling;
            }
            e = !0;
          }
          return (
            (a.rendering = l),
            (a.tail = l.sibling),
            (a.renderingStartTime = mt()),
            (l.sibling = null),
            (n = Jl.current),
            (n = u ? (n & 1) | 2 : n & 1),
            a.tailMode === "visible" || a.tailMode === "collapsed" || !e || tl
              ? Vu(t, n)
              : ((e = n), Al(Kl, t), Al(Jl, e), Il === null && (Il = t)),
            tl && re(t, a.treeForkCount),
            l
          );
        }
        return (Ol(t), null);
      case 22:
      case 23:
        return (
          bt(t),
          Kc(),
          (a = t.memoizedState !== null),
          l !== null
            ? (l.memoizedState !== null) !== a && (t.flags |= 8192)
            : a && (t.flags |= 8192),
          a
            ? (e & 536870912) !== 0 &&
              (t.flags & 128) === 0 &&
              (Ol(t), t.subtreeFlags & 6 && (t.flags |= 8192))
            : Ol(t),
          (e = t.updateQueue),
          e !== null && hi(t, e.retryQueue),
          (e = null),
          l !== null &&
            l.memoizedState !== null &&
            l.memoizedState.cachePool !== null &&
            (e = l.memoizedState.cachePool.pool),
          (a = null),
          t.memoizedState !== null &&
            t.memoizedState.cachePool !== null &&
            (a = t.memoizedState.cachePool.pool),
          a !== e && (t.flags |= 2048),
          l !== null && Xl(ra),
          null
        );
      case 24:
        return (
          (e = null),
          l !== null && (e = l.memoizedState.cache),
          t.memoizedState.cache !== e && (t.flags |= 2048),
          ve(Rl),
          Ol(t),
          null
        );
      case 25:
        return null;
      case 30:
        return ((t.flags |= 33554432), Ol(t), null);
    }
    throw Error(o(156, t.tag));
  }
  function sv(l, t) {
    switch ((Uc(t), t.tag)) {
      case 1:
        return ((l = t.flags), l & 65536 ? ((t.flags = (l & -65537) | 128), t) : null);
      case 3:
        return (
          ve(Rl),
          Oa(),
          (l = t.flags),
          (l & 65536) !== 0 && (l & 128) === 0 ? ((t.flags = (l & -65537) | 128), t) : null
        );
      case 26:
      case 27:
      case 5:
        return (En(t), null);
      case 31:
        if (t.memoizedState !== null) {
          if ((bt(t), t.alternate === null)) throw Error(o(340));
          ia();
        }
        return ((l = t.flags), l & 65536 ? ((t.flags = (l & -65537) | 128), t) : null);
      case 13:
        if ((bt(t), (l = t.memoizedState), l !== null && l.dehydrated !== null)) {
          if (t.alternate === null) throw Error(o(340));
          ia();
        }
        return ((l = t.flags), l & 65536 ? ((t.flags = (l & -65537) | 128), t) : null);
      case 19:
        return (
          Fc(t),
          (l = t.flags),
          l & 65536
            ? ((t.flags = (l & -65537) | 128),
              (l = t.memoizedState),
              l !== null && ((l.rendering = null), (l.tail = null)),
              (t.flags |= 4),
              t)
            : null
        );
      case 4:
        return (Oa(), null);
      case 10:
        return (ve(t.type), null);
      case 22:
      case 23:
        return (
          bt(t),
          Kc(),
          l !== null && Xl(ra),
          (l = t.flags),
          l & 65536 ? ((t.flags = (l & -65537) | 128), t) : null
        );
      case 24:
        return (ve(Rl), null);
      case 25:
        return null;
      default:
        return null;
    }
  }
  function Ao(l, t) {
    switch ((Uc(t), t.tag)) {
      case 3:
        ve(Rl), Oa();
        break;
      case 26:
      case 27:
      case 5:
        En(t);
        break;
      case 4:
        Oa();
        break;
      case 31:
        t.memoizedState !== null && bt(t);
        break;
      case 13:
        bt(t);
        break;
      case 19:
        Fc(t);
        break;
      case 10:
        ve(t.type);
        break;
      case 22:
      case 23:
        bt(t), Kc(), l !== null && Xl(ra);
        break;
      case 24:
        ve(Rl);
    }
  }
  function Fu(l, t) {
    try {
      var e = t.updateQueue,
        a = e !== null ? e.lastEffect : null;
      if (a !== null) {
        var u = a.next;
        e = u;
        do {
          if ((e.tag & l) === l) {
            a = void 0;
            var n = e.create,
              i = e.inst;
            (a = n()), (i.destroy = a);
          }
          e = e.next;
        } while (e !== u);
      }
    } catch (c) {
      Sl(t, t.return, c);
    }
  }
  function Be(l, t, e) {
    try {
      var a = t.updateQueue,
        u = a !== null ? a.lastEffect : null;
      if (u !== null) {
        var n = u.next;
        a = n;
        do {
          if ((a.tag & l) === l) {
            var i = a.inst,
              c = i.destroy;
            if (c !== void 0) {
              (i.destroy = void 0), (u = t);
              var f = e,
                h = c;
              try {
                h();
              } catch (S) {
                Sl(u, f, S);
              }
            }
          }
          a = a.next;
        } while (a !== n);
      }
    } catch (S) {
      Sl(t, t.return, S);
    }
  }
  function po(l) {
    var t = l.updateQueue;
    if (t !== null) {
      var e = l.stateNode;
      try {
        ds(t, e);
      } catch (a) {
        Sl(l, l.return, a);
      }
    }
  }
  function Oo(l, t, e) {
    (e.props = ya(l.type, l.memoizedProps)), (e.state = l.memoizedState);
    try {
      e.componentWillUnmount();
    } catch (a) {
      Sl(l, t, a);
    }
  }
  function Ft(l, t) {
    try {
      var e = l.ref;
      if (e !== null) {
        switch (l.tag) {
          case 26:
          case 27:
          case 5:
            var a = l.stateNode;
            break;
          case 30:
            var u = l.stateNode,
              n = fe(l.memoizedProps, u);
            (u.ref === null || u.ref.name !== n) && (u.ref = Ur(n)), (a = u.ref);
            break;
          case 7:
            if (l.stateNode === null) {
              var i = new pt(l);
              T(l.child, !1, Pv, i, void 0, void 0), (l.stateNode = i);
            }
            a = l.stateNode;
            break;
          default:
            a = l.stateNode;
        }
        typeof e == "function" ? (l.refCleanup = e(a)) : (e.current = a);
      }
    } catch (c) {
      Sl(l, t, c);
    }
  }
  function Fl(l, t) {
    var e = l.ref,
      a = l.refCleanup;
    if (e !== null)
      if (typeof a == "function")
        try {
          a();
        } catch (u) {
          Sl(l, t, u);
        } finally {
          (l.refCleanup = null), (l = l.alternate), l != null && (l.refCleanup = null);
        }
      else if (typeof e == "function")
        try {
          e(null);
        } catch (u) {
          Sl(l, t, u);
        }
      else e.current = null;
  }
  function yi(l, t) {
    if ((l.tag === 5 || l.tag === 27 || l.tag === 6) && l.alternate === null && t !== null)
      for (var e = 0; e < t.length; e++) Yr(l.stateNode, t[e]);
  }
  function _o(l) {
    for (var t = l.return; t !== null && (_f(t) && Yr(l.stateNode, t.stateNode), !Of(t)); )
      t = t.return;
  }
  function $u(l) {
    for (var t = l.return; t !== null && (_f(t) && lm(l.stateNode, t.stateNode), !Of(t)); )
      t = t.return;
  }
  function Of(l) {
    return l.tag === 5 || l.tag === 3 || l.tag === 27;
  }
  function _f(l) {
    return l && l.tag === 7 && l.stateNode !== null;
  }
  function Nf(l) {
    var t = l.type,
      e = l.memoizedProps,
      a = l.stateNode;
    try {
      l: switch (t) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          e.autoFocus && a.focus();
          break l;
        case "img":
          e.src ? (a.src = e.src) : e.srcSet && (a.srcset = e.srcSet);
      }
    } catch (u) {
      Sl(l, l.return, u);
    }
  }
  function Mf(l, t, e) {
    try {
      var a = l.stateNode;
      jv(a, l.type, e, t), (a[it] = t);
    } catch (u) {
      Sl(l, l.return, u);
    }
  }
  function No(l) {
    return (
      l.tag === 5 || l.tag === 3 || l.tag === 26 || (l.tag === 27 && Qe(l.type)) || l.tag === 4
    );
  }
  function xf(l) {
    l: for (;;) {
      for (; l.sibling === null; ) {
        if (l.return === null || No(l.return)) return null;
        l = l.return;
      }
      for (
        l.sibling.return = l.return, l = l.sibling;
        l.tag !== 5 && l.tag !== 6 && l.tag !== 18;
      ) {
        if ((l.tag === 27 && Qe(l.type)) || l.flags & 2 || l.child === null || l.tag === 4)
          continue l;
        (l.child.return = l), (l = l.child);
      }
      if (!(l.flags & 2)) return l.stateNode;
    }
  }
  function Df(l, t, e, a) {
    var u = l.tag;
    if (u === 5 || u === 6)
      (u = l.stateNode),
        t
          ? (e.nodeType === 9
              ? e.body
              : e.nodeName === "HTML"
                ? e.ownerDocument.body
                : e
            ).insertBefore(u, t)
          : ((t = e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e),
            t.appendChild(u),
            (e = e._reactRootContainer),
            e != null || t.onclick !== null || (t.onclick = wt)),
        yi(l, a),
        (dl = !0);
    else if (
      u !== 4 &&
      (u === 27 && (yi(l, a), (a = null), Qe(l.type) && ((e = l.stateNode), (t = null))),
      (l = l.child),
      l !== null)
    )
      for (Df(l, t, e, a), l = l.sibling; l !== null; ) Df(l, t, e, a), (l = l.sibling);
  }
  function gi(l, t, e, a) {
    var u = l.tag;
    if (u === 5 || u === 6)
      (u = l.stateNode), t ? e.insertBefore(u, t) : e.appendChild(u), yi(l, a), (dl = !0);
    else if (
      u !== 4 &&
      (u === 27 && (yi(l, a), (a = null), Qe(l.type) && (e = l.stateNode)),
      (l = l.child),
      l !== null)
    )
      for (gi(l, t, e, a), l = l.sibling; l !== null; ) gi(l, t, e, a), (l = l.sibling);
  }
  function Mo(l) {
    var t = l.stateNode,
      e = l.memoizedProps;
    try {
      for (var a = l.type, u = t.attributes; u.length; ) t.removeAttributeNode(u[0]);
      $l(t, a, e), (t[Ql] = l), (t[it] = e);
    } catch (n) {
      Sl(l, l.return, n);
    }
  }
  var Si = !1,
    Et = null;
  function xo(l) {
    (l.tag === 30 || (l.subtreeFlags & 33554432) !== 0) && (Si = !0);
  }
  var $t = null;
  function Do() {
    var l = $t;
    return (($t = null), l);
  }
  var ft = 0;
  function $a(l, t, e, a, u) {
    return ((ft = 0), Co(l.child, t, e, a, u));
  }
  function Co(l, t, e, a, u) {
    for (var n = !1; l !== null; ) {
      if (l.tag === 5) {
        var i = l.stateNode;
        if (a !== null) {
          var c = v0(i);
          a.push(c), c.view && (n = !0);
        } else n || (v0(i).view && (n = !0));
        (Si = !0), Dr(i, ft === 0 ? t : t + "_" + ft, e), ft++;
      } else
        (l.tag !== 22 || l.memoizedState === null) &&
          ((l.tag === 30 && u) || (Co(l.child, t, e, a, u) && (n = !0)));
      l = l.sibling;
    }
    return n;
  }
  function Wt(l, t) {
    for (; l !== null; )
      l.tag === 5
        ? Cr(l.stateNode, l.memoizedProps)
        : (l.tag !== 22 || l.memoizedState === null) && ((l.tag === 30 && t) || Wt(l.child, t)),
        (l = l.sibling);
  }
  function bi(l) {
    if ((l.subtreeFlags & 18874368) !== 0)
      for (l = l.child; l !== null; ) {
        if (
          (l.tag !== 22 || l.memoizedState === null) &&
          (bi(l), l.tag === 30 && (l.flags & 18874368) !== 0 && l.stateNode.paired)
        ) {
          var t = l.memoizedProps;
          if (t.name == null || t.name === "auto") throw Error(o(544));
          var e = t.name;
          (t = se(t.default, t.share)), t !== "none" && ($a(l, e, t, null, !1) || Wt(l.child, !1));
        }
        l = l.sibling;
      }
  }
  function Cf(l, t) {
    if (l.tag === 30) {
      var e = l.stateNode,
        a = l.memoizedProps,
        u = fe(a, e),
        n = se(a.default, e.paired ? a.share : a.enter);
      n !== "none"
        ? $a(l, u, n, null, !1)
          ? (bi(l), e.paired || t || au(l, a.onEnter))
          : Wt(l.child, !1)
        : bi(l);
    } else if ((l.subtreeFlags & 33554432) !== 0)
      for (l = l.child; l !== null; ) Cf(l, t), (l = l.sibling);
    else bi(l);
  }
  function Uf(l) {
    if (Et !== null && Et.size !== 0) {
      var t = Et;
      if ((l.subtreeFlags & 18874368) !== 0)
        for (l = l.child; l !== null; ) {
          if (l.tag !== 22 || l.memoizedState === null) {
            if (l.tag === 30 && (l.flags & 18874368) !== 0) {
              var e = l.memoizedProps,
                a = e.name;
              if (a != null && a !== "auto") {
                var u = t.get(a);
                if (u !== void 0) {
                  var n = se(e.default, e.share);
                  if (
                    (n !== "none" &&
                      ($a(l, a, n, null, !1)
                        ? ((n = l.stateNode), (u.paired = n), (n.paired = u), au(l, e.onShare))
                        : Wt(l.child, !1)),
                    t.delete(a),
                    t.size === 0)
                  )
                    break;
                }
              }
            }
            Uf(l);
          }
          l = l.sibling;
        }
    }
  }
  function Rf(l) {
    if (l.tag === 30) {
      var t = l.memoizedProps,
        e = fe(t, l.stateNode),
        a = Et !== null ? Et.get(e) : void 0,
        u = se(t.default, a !== void 0 ? t.share : t.exit);
      u !== "none" &&
        ($a(l, e, u, null, !1)
          ? a !== void 0
            ? ((u = l.stateNode), (a.paired = u), (u.paired = a), Et.delete(e), au(l, t.onShare))
            : au(l, t.onExit)
          : Wt(l.child, !1)),
        Et !== null && Uf(l);
    } else if ((l.subtreeFlags & 33554432) !== 0)
      for (l = l.child; l !== null; ) Rf(l), (l = l.sibling);
    else Et !== null && Uf(l);
  }
  function Uo(l) {
    for (l = l.child; l !== null; ) {
      if (l.tag === 30) {
        var t = l.memoizedProps,
          e = fe(t, l.stateNode);
        (t = se(t.default, t.update)),
          (l.flags &= -5),
          t !== "none" && $a(l, e, t, (l.memoizedState = []), !1);
      } else (l.subtreeFlags & 33554432) !== 0 && Uo(l);
      l = l.sibling;
    }
  }
  function Hf(l) {
    if ((l.subtreeFlags & 18874368) !== 0)
      for (l = l.child; l !== null; ) {
        if (l.tag !== 22 || l.memoizedState === null) {
          if (l.tag === 30 && (l.flags & 18874368) !== 0) {
            var t = l.stateNode;
            t.paired !== null && ((t.paired = null), Wt(l.child, !1));
          }
          Hf(l);
        }
        l = l.sibling;
      }
  }
  function Ei(l) {
    if (l.tag === 30) (l.stateNode.paired = null), Wt(l.child, !1), Hf(l);
    else if ((l.subtreeFlags & 33554432) !== 0)
      for (l = l.child; l !== null; ) Ei(l), (l = l.sibling);
    else Hf(l);
  }
  function Ro(l) {
    for (l = l.child; l !== null; )
      l.tag === 30 ? Wt(l.child, !1) : (l.subtreeFlags & 33554432) !== 0 && Ro(l), (l = l.sibling);
  }
  function jf(l, t, e, a, u, n, i) {
    for (var c = !1; t !== null; ) {
      if (t.tag === 5) {
        var f = t.stateNode;
        if (n !== null && ft < n.length) {
          var h = n[ft],
            S = v0(f);
          (h.view || S.view) && (c = !0);
          var p;
          if ((p = (l.flags & 4) === 0))
            if (S.clip) p = !0;
            else {
              p = h.rect;
              var v = S.rect;
              p = p.y !== v.y || p.x !== v.x || p.height !== v.height || p.width !== v.width;
            }
          p && (l.flags |= 4),
            S.abs
              ? (S = !h.abs)
              : ((h = h.rect), (S = S.rect), (S = h.height !== S.height || h.width !== S.width)),
            S && (l.flags |= 32);
        } else l.flags |= 32;
        (l.flags & 4) !== 0 && Dr(f, ft === 0 ? e : e + "_" + ft, u),
          (c && (l.flags & 4) !== 0) ||
            ($t === null && ($t = []), $t.push(f, ft === 0 ? a : a + "_" + ft, t.memoizedProps)),
          ft++;
      } else
        (t.tag !== 22 || t.memoizedState === null) &&
          (t.tag === 30 && i
            ? (l.flags |= t.flags & 32)
            : jf(l, t.child, e, a, u, n, i) && (c = !0));
      t = t.sibling;
    }
    return c;
  }
  function Ho(l, t) {
    for (l = l.child; l !== null; ) {
      if (l.tag === 30) {
        var e = l.memoizedProps,
          a = l.stateNode,
          u = fe(e, a),
          n = se(e.default, e.update),
          i;
        (i = l.memoizedState), (l.memoizedState = null), (a = l);
        var c = l.child;
        (ft = 0), (u = jf(a, c, u, u, n, i, !1)), (l.flags & 4) !== 0 && u && au(l, e.onUpdate);
      } else (l.subtreeFlags & 33554432) !== 0 && Ho(l);
      l = l.sibling;
    }
  }
  var Gl = !1,
    yl = !1,
    kt = !1,
    qf = !1,
    jo = typeof WeakSet == "function" ? WeakSet : Set,
    Vl = null,
    It = !1,
    Wu = !1,
    Ti = !1,
    Bf = !1;
  function ov(l, t, e) {
    if (((l = l.containerInfo), (f0 = vu), (l = Y1(l)), zc(l))) {
      if ("selectionStart" in l) var a = { start: l.selectionStart, end: l.selectionEnd };
      else
        l: {
          a = ((a = l.ownerDocument) && a.defaultView) || window;
          var u = a.getSelection && a.getSelection();
          if (u && u.rangeCount !== 0) {
            a = u.anchorNode;
            var n = u.anchorOffset,
              i = u.focusNode;
            u = u.focusOffset;
            try {
              a.nodeType, i.nodeType;
            } catch {
              a = null;
              break l;
            }
            var c = 0,
              f = -1,
              h = -1,
              S = 0,
              p = 0,
              v = l,
              g = null;
            t: for (;;) {
              for (
                var x;
                v !== a || (n !== 0 && v.nodeType !== 3) || (f = c + n),
                  v !== i || (u !== 0 && v.nodeType !== 3) || (h = c + u),
                  v.nodeType === 3 && (c += v.nodeValue.length),
                  (x = v.firstChild) !== null;
              )
                (g = v), (v = x);
              for (;;) {
                if (v === l) break t;
                if (
                  (g === a && ++S === n && (f = c),
                  g === i && ++p === u && (h = c),
                  (x = v.nextSibling) !== null)
                )
                  break;
                (v = g), (g = v.parentNode);
              }
              v = x;
            }
            a = f === -1 || h === -1 ? null : { start: f, end: h };
          } else a = null;
        }
      a = a || { start: 0, end: 0 };
    } else a = null;
    for (
      s0 = { focusedElem: l, selectionRange: a },
        vu = !1,
        e = (e & 335544064) === e,
        Vl = t,
        t = e ? 9270 : 1024;
      Vl !== null;
    ) {
      if (((l = Vl), e && ((a = l.deletions), a !== null)))
        for (n = 0; n < a.length; n++) e && Rf(a[n]);
      if (l.alternate === null && (l.flags & 2) !== 0) e && xo(l), zi(e);
      else {
        if (l.tag === 22) {
          if (((a = l.alternate), l.memoizedState !== null)) {
            a !== null && a.memoizedState === null && e && Rf(a), zi(e);
            continue;
          } else if (a !== null && a.memoizedState !== null) {
            e && xo(l), zi(e);
            continue;
          }
        }
        (a = l.child),
          (l.subtreeFlags & t) !== 0 && a !== null
            ? ((a.return = l), (Vl = a))
            : (e && Uo(l), zi(e));
      }
    }
    Et = null;
  }
  function zi(l) {
    for (; Vl !== null; ) {
      var t = Vl,
        e = l,
        a = t.alternate,
        u = t.flags;
      switch (t.tag) {
        case 0:
        case 11:
        case 15:
          break;
        case 1:
          if ((u & 1024) !== 0 && a !== null) {
            (e = void 0), (u = a.memoizedProps), (a = a.memoizedState);
            var n = t.stateNode;
            try {
              var i = ya(t.type, u);
              (e = n.getSnapshotBeforeUpdate(i, a)), (n.__reactInternalSnapshotBeforeUpdate = e);
            } catch (c) {
              Sl(t, t.return, c);
            }
          }
          break;
        case 3:
          if ((u & 1024) !== 0) {
            if (((a = t.stateNode.containerInfo), (e = a.nodeType), e === 9)) y0(a);
            else if (e === 1)
              switch (a.nodeName) {
                case "HEAD":
                case "HTML":
                case "BODY":
                  y0(a);
                  break;
                default:
                  a.textContent = "";
              }
          }
          break;
        case 5:
        case 26:
        case 27:
        case 6:
        case 4:
        case 17:
          break;
        case 30:
          e &&
            a !== null &&
            ((e = fe(a.memoizedProps, a.stateNode)),
            (u = t.memoizedProps),
            (u = se(u.default, u.update)),
            u !== "none" && $a(a, e, u, (a.memoizedState = []), !0));
          break;
        default:
          if ((u & 1024) !== 0) throw Error(o(163));
      }
      if (((a = t.sibling), a !== null)) {
        (a.return = t.return), (Vl = a);
        break;
      }
      Vl = t.return;
    }
  }
  function qo(l, t, e) {
    var a = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        Pt(l, e), a & 4 && Fu(5, e);
        break;
      case 1:
        if ((Pt(l, e), a & 4))
          if (((l = e.stateNode), t === null))
            try {
              l.componentDidMount();
            } catch (i) {
              Sl(e, e.return, i);
            }
          else {
            var u = ya(e.type, t.memoizedProps);
            t = t.memoizedState;
            try {
              l.componentDidUpdate(u, t, l.__reactInternalSnapshotBeforeUpdate);
            } catch (i) {
              Sl(e, e.return, i);
            }
          }
        a & 64 && po(e), a & 512 && Ft(e, e.return);
        break;
      case 3:
        if ((Pt(l, e), a & 64 && ((l = e.updateQueue), l !== null))) {
          if (((t = null), e.child !== null))
            switch (e.child.tag) {
              case 27:
              case 5:
                t = e.child.stateNode;
                break;
              case 1:
                t = e.child.stateNode;
            }
          try {
            ds(l, t);
          } catch (i) {
            Sl(e, e.return, i);
          }
        }
        break;
      case 27:
        t === null && a & 4 && Mo(e);
      case 26:
      case 5:
        Pt(l, e), t === null && a & 4 && Nf(e), a & 512 && Ft(e, e.return);
        break;
      case 12:
        Pt(l, e);
        break;
      case 31:
        Pt(l, e), a & 4 && Lo(l, e);
        break;
      case 13:
        Pt(l, e),
          a & 4 && Go(l, e),
          a & 64 &&
            ((l = e.memoizedState),
            l !== null && ((l = l.dehydrated), l !== null && ((e = zv.bind(null, e)), am(l, e))));
        break;
      case 22:
        if (((a = e.memoizedState !== null || Gl), !a)) {
          var n = (t !== null && t.memoizedState !== null) || yl;
          (t = Gl),
            (u = yl),
            (Gl = a),
            (yl = n) && !u
              ? ((a = 2), (e.subtreeFlags & 8772) !== 0 && (a |= 1), Lt(l, e, a))
              : Pt(l, e),
            (Gl = t),
            (yl = u);
        }
        break;
      case 30:
        Pt(l, e), a & 512 && Ft(e, e.return);
        break;
      case 7:
        a & 512 && Ft(e, e.return);
      default:
        Pt(l, e);
    }
  }
  function Yf(l, t) {
    for (l = l.child; l !== null; ) Bo(l, t), (l = l.sibling);
  }
  function Bo(l, t) {
    switch (l.tag) {
      case 5:
      case 26:
        try {
          var e = l.stateNode;
          if (t) {
            var a = e.style;
            typeof a.setProperty == "function"
              ? a.setProperty("display", "none", "important")
              : (a.display = "none");
          } else {
            var u = l.stateNode,
              n = l.memoizedProps.style,
              i = n != null && n.hasOwnProperty("display") ? n.display : null;
            u.style.display = i == null || typeof i == "boolean" ? "" : ("" + i).trim();
          }
        } catch (f) {
          Sl(l, l.return, f);
        }
        Zf(l, t);
        break;
      case 6:
        try {
          (l.stateNode.nodeValue = t ? "" : l.memoizedProps), (dl = !0);
        } catch (f) {
          Sl(l, l.return, f);
        }
        break;
      case 18:
        try {
          var c = l.stateNode;
          t ? xr(c, !0) : xr(l.stateNode, !1);
        } catch (f) {
          Sl(l, l.return, f);
        }
        break;
      case 22:
      case 23:
        l.memoizedState === null && Yf(l, t);
        break;
      default:
        Yf(l, t);
    }
  }
  function Zf(l, t) {
    if (l.subtreeFlags & 67108864)
      for (l = l.child; l !== null; ) {
        l: {
          var e = l,
            a = t;
          switch (e.tag) {
            case 4:
              Bo(e, a);
              break l;
            case 22:
              e.memoizedState === null && Zf(e, a);
              break l;
            default:
              Zf(e, a);
          }
        }
        l = l.sibling;
      }
  }
  function Yo(l) {
    var t = l.alternate;
    t !== null && ((l.alternate = null), Yo(t)),
      (l.child = null),
      (l.deletions = null),
      (l.sibling = null),
      l.tag === 5 && ((t = l.stateNode), t !== null && Nn(t)),
      (l.stateNode = null),
      (l.return = null),
      (l.dependencies = null),
      (l.memoizedProps = null),
      (l.memoizedState = null),
      (l.pendingProps = null),
      (l.stateNode = null),
      (l.updateQueue = null);
  }
  var _l = null,
    st = !1;
  function Yt(l, t, e) {
    for (e = e.child; e !== null; ) Zo(l, t, e), (e = e.sibling);
  }
  function Zo(l, t, e) {
    if (ht && typeof ht.onCommitFiberUnmount == "function")
      try {
        ht.onCommitFiberUnmount(bu, e);
      } catch {}
    switch (e.tag) {
      case 26:
        yl || Fl(e, t),
          Yt(l, t, e),
          e.memoizedState
            ? e.memoizedState.count--
            : e.stateNode && !yl && ((e = e.stateNode), e.parentNode.removeChild(e));
        break;
      case 27:
        yl || Fl(e, t), $u(e);
        var a = _l,
          u = st;
        Qe(e.type) && ((_l = e.stateNode), (st = !1)),
          Yt(l, t, e),
          Xr(e.stateNode, e.type, e.memoizedProps),
          (_l = a),
          (st = u);
        break;
      case 5:
        yl || Fl(e, t), $u(e);
      case 6:
        if (
          (e.tag === 6 && $u(e),
          (a = _l),
          (u = st),
          (_l = null),
          Yt(l, t, e),
          (_l = a),
          (st = u),
          _l !== null)
        )
          if (st)
            try {
              (_l.nodeType === 9
                ? _l.body
                : _l.nodeName === "HTML"
                  ? _l.ownerDocument.body
                  : _l
              ).removeChild(e.stateNode),
                (dl = !0);
            } catch (n) {
              Sl(e, t, n);
            }
          else
            try {
              _l.removeChild(e.stateNode), (dl = !0);
            } catch (n) {
              Sl(e, t, n);
            }
        break;
      case 18:
        _l !== null &&
          (st
            ? ((l = _l),
              Mr(
                l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l,
                e.stateNode,
              ),
              mu(l))
            : Mr(_l, e.stateNode));
        break;
      case 4:
        (a = _l),
          (u = st),
          (_l = e.stateNode.containerInfo),
          (st = !0),
          Yt(l, t, e),
          (_l = a),
          (st = u);
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        Be(2, e, t), yl || Be(4, e, t), Yt(l, t, e);
        break;
      case 1:
        yl ||
          (Fl(e, t), (a = e.stateNode), typeof a.componentWillUnmount == "function" && Oo(e, t, a)),
          Yt(l, t, e);
        break;
      case 21:
        Yt(l, t, e);
        break;
      case 22:
        (yl = (a = yl) || e.memoizedState !== null), Yt(l, t, e), (yl = a);
        break;
      case 30:
        Fl(e, t), Yt(l, t, e);
        break;
      case 7:
        yl || Fl(e, t), Yt(l, t, e);
        break;
      default:
        Yt(l, t, e);
    }
  }
  function Lo(l, t) {
    if (
      t.memoizedState === null &&
      ((l = t.alternate), l !== null && ((l = l.memoizedState), l !== null))
    ) {
      l = l.dehydrated;
      try {
        mu(l);
      } catch (e) {
        Sl(t, t.return, e);
      }
    }
  }
  function Go(l, t) {
    if (
      t.memoizedState === null &&
      ((l = t.alternate),
      l !== null && ((l = l.memoizedState), l !== null && ((l = l.dehydrated), l !== null)))
    )
      try {
        mu(l);
      } catch (e) {
        Sl(t, t.return, e);
      }
  }
  function rv(l) {
    switch (l.tag) {
      case 31:
      case 13:
      case 19:
        var t = l.stateNode;
        return (t === null && (t = l.stateNode = new jo()), t);
      case 22:
        return (
          (l = l.stateNode), (t = l._retryCache), t === null && (t = l._retryCache = new jo()), t
        );
      default:
        throw Error(o(435, l.tag));
    }
  }
  function Ai(l, t) {
    var e = rv(l);
    t.forEach(function (a) {
      if (!e.has(a)) {
        e.add(a);
        var u = Av.bind(null, l, a);
        a.then(u, u);
      }
    });
  }
  function at(l, t, e) {
    var a = t.deletions;
    if (a !== null)
      for (var u = 0; u < a.length; u++) {
        var n = a[u],
          i = l,
          c = t,
          f = c;
        l: for (; f !== null; ) {
          switch (f.tag) {
            case 27:
              if (Qe(f.type)) {
                (_l = f.stateNode), (st = !1);
                break l;
              }
              break;
            case 5:
              (_l = f.stateNode), (st = !1);
              break l;
            case 3:
            case 4:
              (_l = f.stateNode.containerInfo), (st = !0);
              break l;
          }
          f = f.return;
        }
        if (_l === null) throw Error(o(160));
        Zo(i, c, n),
          (_l = null),
          (st = !1),
          (i = n.alternate),
          i !== null && (i.return = null),
          (n.return = null);
      }
    if (t.subtreeFlags & 13886) for (t = t.child; t !== null; ) Vo(t, l, e), (t = t.sibling);
  }
  var Zt = null;
  function Vo(l, t, e) {
    var a = l.alternate,
      u = l.flags;
    switch (l.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        if (u & 4 && ((a = l.updateQueue), (a = a !== null ? a.events : null), a !== null))
          for (var n = 0; n < a.length; n++) {
            var i = a[n];
            i.ref.impl = i.nextImpl;
          }
        at(t, l, e), ut(l), u & 4 && (Be(3, l, l.return), Fu(3, l), Be(5, l, l.return));
        break;
      case 1:
        at(t, l, e),
          ut(l),
          u & 512 && (yl || a === null || Fl(a, a.return)),
          u & 64 &&
            Gl &&
            ((l = l.updateQueue),
            l !== null &&
              ((t = l.callbacks),
              t !== null &&
                ((e = l.shared.hiddenCallbacks),
                (l.shared.hiddenCallbacks = e === null ? t : e.concat(t)))));
        break;
      case 26:
        if (((n = Zt), at(t, l, e), ut(l), u & 512 && (yl || a === null || Fl(a, a.return)), u & 4))
          if (((u = a !== null ? a.memoizedState : null), (e = l.memoizedState), a === null))
            if (e === null)
              if (l.stateNode === null)
                if (Gl) l.stateNode = Or(l.type, l.memoizedProps, t.containerInfo, l);
                else {
                  l: {
                    (t = l.type), (e = l.memoizedProps), (u = n.ownerDocument || n);
                    t: switch (t) {
                      case "title":
                        (a = u.getElementsByTagName("title")[0]),
                          (!a ||
                            a[zu] ||
                            a[Ql] ||
                            a.namespaceURI === "http://www.w3.org/2000/svg" ||
                            a.hasAttribute("itemprop")) &&
                            ((a = u.createElement(t)),
                            u.head.insertBefore(a, u.querySelector("head > title"))),
                          $l(a, t, e),
                          (a[Ql] = l),
                          Zl(a),
                          (t = a);
                        break l;
                      case "link":
                        if ((n = $r("link", "href", u).get(t + (e.href || "")))) {
                          for (i = 0; i < n.length; i++)
                            if (
                              ((a = n[i]),
                              a.getAttribute("href") ===
                                (e.href == null || e.href === "" ? null : e.href) &&
                                a.getAttribute("rel") === (e.rel == null ? null : e.rel) &&
                                a.getAttribute("title") === (e.title == null ? null : e.title) &&
                                a.getAttribute("crossorigin") ===
                                  (e.crossOrigin == null ? null : e.crossOrigin))
                            ) {
                              n.splice(i, 1);
                              break t;
                            }
                        }
                        (a = u.createElement(t)), $l(a, t, e), u.head.appendChild(a);
                        break;
                      case "meta":
                        if ((n = $r("meta", "content", u).get(t + (e.content || "")))) {
                          for (i = 0; i < n.length; i++)
                            if (
                              ((a = n[i]),
                              a.getAttribute("content") ===
                                (e.content == null ? null : "" + e.content) &&
                                a.getAttribute("name") === (e.name == null ? null : e.name) &&
                                a.getAttribute("property") ===
                                  (e.property == null ? null : e.property) &&
                                a.getAttribute("http-equiv") ===
                                  (e.httpEquiv == null ? null : e.httpEquiv) &&
                                a.getAttribute("charset") ===
                                  (e.charSet == null ? null : e.charSet))
                            ) {
                              n.splice(i, 1);
                              break t;
                            }
                        }
                        (a = u.createElement(t)), $l(a, t, e), u.head.appendChild(a);
                        break;
                      default:
                        throw Error(o(468, t));
                    }
                    (a[Ql] = l), Zl(a), (t = a);
                  }
                  l.stateNode = t;
                }
              else Gl || A0(n, l.type, l.stateNode);
            else l.stateNode = Fr(n, e, l.memoizedProps);
          else
            u !== e
              ? (u === null
                  ? ((t = a.stateNode), t === null || yl || t.parentNode.removeChild(t))
                  : u.count--,
                e === null ? Gl || A0(n, l.type, l.stateNode) : Fr(n, e, l.memoizedProps))
              : e === null && l.stateNode !== null && Mf(l, l.memoizedProps, a.memoizedProps);
        break;
      case 27:
        at(t, l, e),
          ut(l),
          u & 512 && (yl || a === null || Fl(a, a.return)),
          a !== null && u & 4 && Mf(l, l.memoizedProps, a.memoizedProps);
        break;
      case 5:
        if (
          ((n = kt),
          (kt = !1),
          at(t, l, e),
          (kt = n),
          ut(l),
          u & 512 && (yl || a === null || Fl(a, a.return)),
          l.flags & 32)
        ) {
          t = l.stateNode;
          try {
            Ca(t, ""), (dl = !0);
          } catch (S) {
            Sl(l, l.return, S);
          }
        }
        u & 4 &&
          l.stateNode != null &&
          ((t = l.memoizedProps), Mf(l, t, a !== null ? a.memoizedProps : t)),
          u & 1024 && (qf = !0);
        break;
      case 6:
        if ((at(t, l, e), ut(l), u & 4)) {
          if (l.stateNode === null) throw Error(o(162));
          (t = l.memoizedProps), (e = l.stateNode);
          try {
            (e.nodeValue = t), (dl = !0);
          } catch (S) {
            Sl(l, l.return, S);
          }
        }
        break;
      case 3:
        if (
          ((dl = !1),
          (Yi = null),
          (n = Zt),
          (Zt = nn(t.containerInfo)),
          at(t, l, e),
          (Zt = n),
          ut(l),
          u & 4 && a !== null && a.memoizedState.isDehydrated)
        )
          try {
            mu(t.containerInfo);
          } catch (S) {
            Sl(l, l.return, S);
          }
        qf && ((qf = !1), Xo(l)), (dl = !1);
        break;
      case 4:
        (u = kt),
          (kt = Gl),
          (a = f1()),
          (n = Zt),
          (Zt = nn(l.stateNode.containerInfo)),
          at(t, l, e),
          ut(l),
          (Zt = n),
          dl && Wu && (Ti = !0),
          (dl = a),
          (kt = u);
        break;
      case 12:
        at(t, l, e), ut(l);
        break;
      case 31:
        at(t, l, e),
          ut(l),
          u & 4 && ((t = l.updateQueue), t !== null && ((l.updateQueue = null), Ai(l, t)));
        break;
      case 13:
        at(t, l, e),
          ut(l),
          l.child.flags & 8192 &&
            (l.memoizedState !== null) != (a !== null && a.memoizedState !== null) &&
            (_i = mt()),
          u & 4 && ((t = l.updateQueue), t !== null && ((l.updateQueue = null), Ai(l, t)));
        break;
      case 22:
        (n = l.memoizedState !== null), (i = a !== null && a.memoizedState !== null);
        var c = Gl,
          f = yl,
          h = kt;
        (Gl = c || n),
          (kt = h || n),
          (yl = f || i),
          at(t, l, e),
          (yl = f),
          (kt = h),
          (Gl = c),
          ut(l),
          u & 8192 &&
            ((t = l.stateNode),
            (t._visibility = n ? t._visibility & -2 : t._visibility | 1),
            !n ||
              a === null ||
              i ||
              Gl ||
              yl ||
              ((t = i || yl),
              (e = Gl),
              (a = yl),
              (Gl = n || Gl),
              (yl = t),
              Ye(l, 2),
              (Gl = e),
              (yl = a)),
            (!n && kt) || Yf(l, n)),
          u & 4 &&
            ((t = l.updateQueue),
            t !== null && ((e = t.retryQueue), e !== null && ((t.retryQueue = null), Ai(l, e))));
        break;
      case 19:
        at(t, l, e),
          ut(l),
          u & 4 && ((t = l.updateQueue), t !== null && ((l.updateQueue = null), Ai(l, t)));
        break;
      case 30:
        u & 512 && (yl || a === null || Fl(a, a.return)),
          (u = f1()),
          (n = Wu),
          (i = (e & 335544064) === e),
          (c = l.memoizedProps),
          (Wu = i && se(c.default, c.update) !== "none"),
          at(t, l, e),
          ut(l),
          i && a !== null && dl && (l.flags |= 4),
          (Wu = n),
          (dl = u);
        break;
      case 21:
        break;
      case 7:
        u & 512 && (yl || a === null || Fl(a, a.return)),
          a && a.stateNode !== null && (a.stateNode._fragmentFiber = l);
      default:
        at(t, l, e), ut(l);
    }
  }
  function ut(l) {
    var t = l.flags;
    if (t & 2) {
      try {
        for (var e, a = l.return; a !== null; ) {
          if (No(a)) {
            e = a;
            break;
          }
          a = a.return;
        }
        a = null;
        for (var u = l.return; u !== null; ) {
          if (_f(u)) {
            var n = u.stateNode;
            a === null ? (a = [n]) : a.push(n);
          }
          if (Of(u)) break;
          u = u.return;
        }
        var i = a;
        if (e == null) throw Error(o(160));
        switch (e.tag) {
          case 27:
            var c = e.stateNode,
              f = xf(l);
            gi(l, f, c, i);
            break;
          case 5:
            var h = e.stateNode;
            e.flags & 32 && (Ca(h, ""), (e.flags &= -33));
            var S = xf(l);
            gi(l, S, h, i);
            break;
          case 3:
          case 4:
            var p = e.stateNode.containerInfo,
              v = xf(l);
            Df(l, v, p, i);
            break;
          default:
            throw Error(o(161));
        }
      } catch (g) {
        Sl(l, l.return, g);
      }
      l.flags &= -3;
    }
    t & 4096 && (l.flags &= -4097);
  }
  function Xo(l) {
    if (l.subtreeFlags & 1024)
      for (l = l.child; l !== null; ) {
        var t = l;
        Xo(t),
          t.tag === 5 && t.flags & 1024 && ((t = t.stateNode), (vu = !0), t.reset(), (vu = !1)),
          (l = l.sibling);
      }
  }
  function Wa(l, t) {
    if (t.subtreeFlags & 9270) for (t = t.child; t !== null; ) Qo(t, l), (t = t.sibling);
    else Ho(t);
  }
  function Qo(l, t) {
    var e = l.alternate;
    if (e === null) Cf(l, !1);
    else
      switch (l.tag) {
        case 3:
          if (((Bf = It = !1), Do(), Wa(t, l), !It && !Ti)) {
            if (((l = $t), l !== null))
              for (var a = 0; a < l.length; a += 3) {
                e = l[a];
                var u = l[a + 1];
                Cr(e, l[a + 2]),
                  (e = e.ownerDocument.documentElement),
                  e !== null &&
                    e.animate(
                      { opacity: [0, 0], pointerEvents: ["none", "none"] },
                      {
                        duration: 0,
                        fill: "forwards",
                        pseudoElement: "::view-transition-group(" + u + ")",
                      },
                    );
              }
            (l = t.containerInfo),
              (l = l.nodeType === 9 ? l.documentElement : l.ownerDocument.documentElement),
              l !== null &&
                l.style.viewTransitionName === "" &&
                ((l.style.viewTransitionName = "none"),
                l.animate(
                  { opacity: [0, 0], pointerEvents: ["none", "none"] },
                  { duration: 0, fill: "forwards", pseudoElement: "::view-transition-group(root)" },
                ),
                l.animate(
                  { width: [0, 0], height: [0, 0] },
                  { duration: 0, fill: "forwards", pseudoElement: "::view-transition" },
                )),
              (Bf = !0);
          }
          $t = null;
          break;
        case 5:
          Wa(t, l);
          break;
        case 4:
          (a = It), (It = !1), Wa(t, l), It && (Ti = !0), (It = a);
          break;
        case 22:
          l.memoizedState === null && (e.memoizedState !== null ? Cf(l, !1) : Wa(t, l));
          break;
        case 30:
          (a = It), (u = Do()), (It = !1), Wa(t, l), It && (l.flags |= 4);
          var n = l.memoizedProps,
            i = l.stateNode;
          (t = fe(n, i)), (i = fe(e.memoizedProps, i));
          var c = se(n.default, n.update);
          c === "none"
            ? (t = !1)
            : ((n = e.memoizedState),
              (e.memoizedState = null),
              (e = l.child),
              (ft = 0),
              (t = jf(l, e, t, i, c, n, !0)),
              ft !== (n === null ? 0 : n.length) && (l.flags |= 32)),
            (l.flags & 4) !== 0 && t
              ? (au(l, l.memoizedProps.onUpdate), ($t = u))
              : u !== null && (u.push.apply(u, $t), ($t = u)),
            (It = (l.flags & 32) !== 0 ? !0 : a);
          break;
        default:
          Wa(t, l);
      }
  }
  function Pt(l, t) {
    if (t.subtreeFlags & 8772)
      for (t = t.child; t !== null; ) qo(l, t.alternate, t), (t = t.sibling);
  }
  function Ye(l, t) {
    for (l = l.child; l !== null; ) {
      var e = l,
        a = t;
      switch (e.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          Be(4, e, e.return), Ye(e, a);
          break;
        case 1:
          Fl(e, e.return);
          var u = e.stateNode;
          typeof u.componentWillUnmount == "function" && Oo(e, e.return, u), Ye(e, a);
          break;
        case 27:
          (a & 2) !== 0 && Xr(e.stateNode, e.type, e.memoizedProps);
        case 5:
          Fl(e, e.return), (e.tag !== 5 && e.tag !== 27) || $u(e), Ye(e, a);
          break;
        case 6:
          $u(e);
          break;
        case 26:
          Fl(e, e.return),
            (u = e.stateNode),
            e.memoizedState !== null || u === null || yl || u.parentNode.removeChild(u),
            Ye(e, a);
          break;
        case 22:
          e.memoizedState === null && Ye(e, a);
          break;
        case 30:
          Fl(e, e.return), Ye(e, a);
          break;
        case 7:
          Fl(e, e.return);
        default:
          Ye(e, a);
      }
      l = l.sibling;
    }
  }
  function Lt(l, t, e) {
    for (e = (t.subtreeFlags & 8772) !== 0 ? e : e & -2, t = t.child; t !== null; ) {
      var a = t.alternate,
        u = l,
        n = t,
        i = n.flags,
        c = (e & 1) !== 0;
      switch (n.tag) {
        case 0:
        case 11:
        case 15:
          Lt(u, n, e), Fu(4, n);
          break;
        case 1:
          if ((Lt(u, n, e), (a = n), (u = a.stateNode), typeof u.componentDidMount == "function"))
            try {
              u.componentDidMount();
            } catch (S) {
              Sl(a, a.return, S);
            }
          if (((a = n), (u = a.updateQueue), u !== null)) {
            var f = a.stateNode;
            try {
              var h = u.shared.hiddenCallbacks;
              if (h !== null)
                for (u.shared.hiddenCallbacks = null, u = 0; u < h.length; u++) rs(h[u], f);
            } catch (S) {
              Sl(a, a.return, S);
            }
          }
          c && i & 64 && po(n), Ft(n, n.return);
          break;
        case 27:
          (e & 2) !== 0 && Mo(n);
        case 5:
          (n.tag !== 5 && n.tag !== 27) || _o(n),
            Lt(u, n, e),
            c && a === null && i & 4 && Nf(n),
            Ft(n, n.return);
          break;
        case 6:
          _o(n);
          break;
        case 26:
          (f = n.stateNode),
            n.memoizedState !== null || f === null || Gl || A0(nn(f.ownerDocument), n.type, f),
            Lt(u, n, e),
            c && a === null && i & 4 && Nf(n),
            Ft(n, n.return);
          break;
        case 12:
          Lt(u, n, e);
          break;
        case 31:
          Lt(u, n, e), c && i & 4 && Lo(u, n);
          break;
        case 13:
          Lt(u, n, e), c && i & 4 && Go(u, n);
          break;
        case 22:
          n.memoizedState === null && Lt(u, n, e), Ft(n, n.return);
          break;
        case 30:
          Lt(u, n, e), Ft(n, n.return);
          break;
        case 7:
          Ft(n, n.return);
        default:
          Lt(u, n, e);
      }
      t = t.sibling;
    }
  }
  function Lf(l, t) {
    var e = null;
    l !== null &&
      l.memoizedState !== null &&
      l.memoizedState.cachePool !== null &&
      (e = l.memoizedState.cachePool.pool),
      (l = null),
      t.memoizedState !== null &&
        t.memoizedState.cachePool !== null &&
        (l = t.memoizedState.cachePool.pool),
      l !== e && (l != null && l.refCount++, e != null && ju(e));
  }
  function Gf(l, t) {
    (l = null),
      t.alternate !== null && (l = t.alternate.memoizedState.cache),
      (t = t.memoizedState.cache),
      t !== l && (t.refCount++, l != null && ju(l));
  }
  function Rt(l, t, e, a) {
    var u = (e & 335544064) === e;
    if (t.subtreeFlags & (u ? 10262 : 10256))
      for (t = t.child; t !== null; ) wo(l, t, e, a), (t = t.sibling);
    else u && Ro(t);
  }
  function wo(l, t, e, a) {
    var u = (e & 335544064) === e;
    u && t.alternate === null && t.return !== null && t.return.alternate !== null && Ei(t);
    var n = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        Rt(l, t, e, a), n & 2048 && Fu(9, t);
        break;
      case 1:
        Rt(l, t, e, a);
        break;
      case 3:
        Rt(l, t, e, a),
          u &&
            Bf &&
            ((l = l.containerInfo),
            (l = l.nodeType === 9 ? l.body : l.nodeName === "HTML" ? l.ownerDocument.body : l),
            l.style.viewTransitionName === "root" && (l.style.viewTransitionName = ""),
            (l = l.ownerDocument.documentElement),
            l !== null &&
              l.style.viewTransitionName === "none" &&
              (l.style.viewTransitionName = "")),
          n & 2048 &&
            ((n = null),
            t.alternate !== null && (n = t.alternate.memoizedState.cache),
            (t = t.memoizedState.cache),
            t !== n && (t.refCount++, n != null && ju(n)));
        break;
      case 12:
        if (n & 2048) {
          Rt(l, t, e, a), (n = t.stateNode);
          try {
            var i = t.memoizedProps,
              c = i.id,
              f = i.onPostCommit;
            typeof f == "function" &&
              f(c, t.alternate === null ? "mount" : "update", n.passiveEffectDuration, -0);
          } catch (h) {
            Sl(t, t.return, h);
          }
        } else Rt(l, t, e, a);
        break;
      case 31:
        Rt(l, t, e, a);
        break;
      case 13:
        Rt(l, t, e, a);
        break;
      case 23:
        break;
      case 22:
        (i = t.stateNode),
          (c = t.alternate),
          t.memoizedState !== null
            ? (u && c !== null && c.memoizedState === null && Ei(c),
              i._visibility & 2 ? Rt(l, t, e, a) : ku(l, t))
            : (u && c !== null && c.memoizedState !== null && Ei(t),
              i._visibility & 2
                ? Rt(l, t, e, a)
                : ((i._visibility |= 2), ka(l, t, e, a, (t.subtreeFlags & 10256) !== 0 || !1))),
          n & 2048 && Lf(c, t);
        break;
      case 24:
        Rt(l, t, e, a), n & 2048 && Gf(t.alternate, t);
        break;
      case 30:
        u && ((n = t.alternate), n !== null && (Wt(n.child, !0), Wt(t.child, !0))), Rt(l, t, e, a);
        break;
      default:
        Rt(l, t, e, a);
    }
  }
  function ka(l, t, e, a, u) {
    for (u = u && ((t.subtreeFlags & 10256) !== 0 || !1), t = t.child; t !== null; ) {
      var n = l,
        i = t,
        c = e,
        f = a,
        h = i.flags;
      switch (i.tag) {
        case 0:
        case 11:
        case 15:
          ka(n, i, c, f, u), Fu(8, i);
          break;
        case 23:
          break;
        case 22:
          var S = i.stateNode;
          i.memoizedState !== null
            ? S._visibility & 2
              ? ka(n, i, c, f, u)
              : ku(n, i)
            : ((S._visibility |= 2), ka(n, i, c, f, u)),
            u && h & 2048 && Lf(i.alternate, i);
          break;
        case 24:
          ka(n, i, c, f, u), u && h & 2048 && Gf(i.alternate, i);
          break;
        default:
          ka(n, i, c, f, u);
      }
      t = t.sibling;
    }
  }
  function ku(l, t) {
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; ) {
        var e = l,
          a = t,
          u = a.flags;
        switch (a.tag) {
          case 22:
            ku(e, a), u & 2048 && Lf(a.alternate, a);
            break;
          case 24:
            ku(e, a), u & 2048 && Gf(a.alternate, a);
            break;
          default:
            ku(e, a);
        }
        t = t.sibling;
      }
  }
  var ga = 8192;
  function Sa(l, t, e) {
    if (l.subtreeFlags & ga) for (l = l.child; l !== null; ) Ko(l, t, e), (l = l.sibling);
  }
  function Ko(l, t, e) {
    switch (l.tag) {
      case 26:
        Sa(l, t, e),
          l.flags & ga &&
            (l.memoizedState !== null
              ? gm(e, Zt, l.memoizedState, l.memoizedProps)
              : ((l = l.stateNode), (t & 335544128) === t && Pr(e, l)));
        break;
      case 5:
        Sa(l, t, e), l.flags & ga && ((l = l.stateNode), (t & 335544128) === t && Pr(e, l));
        break;
      case 3:
      case 4:
        var a = Zt;
        (Zt = nn(l.stateNode.containerInfo)), Sa(l, t, e), (Zt = a);
        break;
      case 22:
        l.memoizedState === null &&
          ((a = l.alternate),
          a !== null && a.memoizedState !== null
            ? ((a = ga), (ga = 16777216), Sa(l, t, e), (ga = a))
            : Sa(l, t, e));
        break;
      case 30:
        if ((l.flags & ga) !== 0 && ((a = l.memoizedProps.name), a != null && a !== "auto")) {
          var u = l.stateNode;
          (u.paired = null), Et === null && (Et = new Map()), Et.set(a, u);
        }
        Sa(l, t, e);
        break;
      default:
        Sa(l, t, e);
    }
  }
  function Jo(l) {
    var t = l.alternate;
    if (t !== null && ((l = t.child), l !== null)) {
      t.child = null;
      do (t = l.sibling), (l.sibling = null), (l = t);
      while (l !== null);
    }
  }
  function Iu(l) {
    var t = l.deletions;
    if ((l.flags & 16) !== 0) {
      if (t !== null)
        for (var e = 0; e < t.length; e++) {
          var a = t[e];
          (Vl = a), $o(a, l);
        }
      Jo(l);
    }
    if (l.subtreeFlags & 10256) for (l = l.child; l !== null; ) Fo(l), (l = l.sibling);
  }
  function Fo(l) {
    switch (l.tag) {
      case 0:
      case 11:
      case 15:
        Iu(l), l.flags & 2048 && Be(9, l, l.return);
        break;
      case 3:
        Iu(l);
        break;
      case 12:
        Iu(l);
        break;
      case 22:
        var t = l.stateNode;
        l.memoizedState !== null && t._visibility & 2 && (l.return === null || l.return.tag !== 13)
          ? ((t._visibility &= -3), pi(l))
          : Iu(l);
        break;
      default:
        Iu(l);
    }
  }
  function pi(l) {
    var t = l.deletions;
    if ((l.flags & 16) !== 0) {
      if (t !== null)
        for (var e = 0; e < t.length; e++) {
          var a = t[e];
          (Vl = a), $o(a, l);
        }
      Jo(l);
    }
    for (l = l.child; l !== null; ) {
      switch (((t = l), t.tag)) {
        case 0:
        case 11:
        case 15:
          Be(8, t, t.return), pi(t);
          break;
        case 22:
          (e = t.stateNode), e._visibility & 2 && ((e._visibility &= -3), pi(t));
          break;
        default:
          pi(t);
      }
      l = l.sibling;
    }
  }
  function $o(l, t) {
    for (; Vl !== null; ) {
      var e = Vl;
      switch (e.tag) {
        case 0:
        case 11:
        case 15:
          Be(8, e, t);
          break;
        case 23:
        case 22:
          if (e.memoizedState !== null && e.memoizedState.cachePool !== null) {
            var a = e.memoizedState.cachePool.pool;
            a != null && a.refCount++;
          }
          break;
        case 24:
          ju(e.memoizedState.cache);
      }
      if (((a = e.child), a !== null)) (a.return = e), (Vl = a);
      else
        l: for (e = l; Vl !== null; ) {
          a = Vl;
          var u = a.sibling,
            n = a.return;
          if ((Yo(a), a === e)) {
            Vl = null;
            break l;
          }
          if (u !== null) {
            (u.return = n), (Vl = u);
            break l;
          }
          Vl = n;
        }
    }
  }
  var dv = {
      getCacheForType: function (l) {
        var t = wl(Rl),
          e = t.data.get(l);
        return (e === void 0 && ((e = l()), t.data.set(l, e)), e);
      },
      cacheSignal: function () {
        return wl(Rl).controller.signal;
      },
    },
    vv = typeof WeakMap == "function" ? WeakMap : Map,
    ml = 0,
    zl = null,
    el = null,
    ul = 0,
    gl = 0,
    Tt = null,
    Ze = !1,
    Ia = !1,
    Vf = !1,
    Se = 0,
    xl = 0,
    Le = 0,
    ba = 0,
    Oi = 0,
    zt = 0,
    Pa = 0,
    Pu = null,
    ot = null,
    Xf = !1,
    _i = 0,
    Wo = 0,
    Ni = 1 / 0,
    Mi = null,
    Ge = null,
    Nl = 0,
    Gt = null,
    Ea = null,
    le = 0,
    Qf = 0,
    wf = null,
    ko = null,
    lu = null,
    tu = null,
    eu = null,
    ln = 0,
    xi = null;
  function At() {
    return (ml & 2) !== 0 && ul !== 0 ? ul & -ul : B.T !== null ? t0() : P0();
  }
  function Io() {
    if (zt === 0)
      if ((ul & 536870912) === 0 || tl) {
        var l = An;
        (An <<= 1), (An & 3932160) === 0 && (An = 262144), (zt = l);
      } else zt = 536870912;
    return ((l = Kl.current), l !== null && (l.flags |= 32), zt);
  }
  function au(l, t) {
    if (t != null) {
      var e = l.stateNode,
        a = e.ref;
      a === null && (a = e.ref = Ur(fe(l.memoizedProps, e))),
        tu === null && (tu = []),
        tu.push(t.bind(null, a));
    }
  }
  function rt(l, t, e) {
    ((l === zl && (gl === 2 || gl === 9)) || l.cancelPendingCommit !== null) &&
      (uu(l, 0), Ve(l, ul, zt, !1)),
      Tu(l, e),
      ((ml & 2) === 0 || l !== zl) &&
        (l === zl && ((ml & 2) === 0 && (ba |= e), xl === 4 && Ve(l, ul, zt, !1)), te(l));
  }
  function Po(l, t, e) {
    if ((ml & 6) !== 0) throw Error(o(327));
    var a = (!e && (t & 127) === 0 && (t & l.expiredLanes) === 0) || Eu(l, t),
      u = a ? yv(l, t) : Jf(l, t, !0),
      n = a;
    do {
      if (u === 0) {
        Ia && !a && Ve(l, t, 0, !1);
        break;
      } else {
        if (((e = l.current.alternate), n && !mv(e))) {
          (u = Jf(l, t, !1)), (n = !1);
          continue;
        }
        if (u === 2) {
          if (((n = t), l.errorRecoveryDisabledLanes & n)) var i = 0;
          else (i = l.pendingLanes & -536870913), (i = i !== 0 ? i : i & 536870912 ? 536870912 : 0);
          if (i !== 0) {
            t = i;
            l: {
              var c = l;
              u = Pu;
              var f = c.current.memoizedState.isDehydrated;
              if ((f && (uu(c, i).flags |= 256), (i = Jf(c, i, !1)), i !== 2 && i !== 6)) {
                if (Vf && !f) {
                  (c.errorRecoveryDisabledLanes |= n), (ba |= n), (u = 4);
                  break l;
                }
                (n = ot), (ot = u), n !== null && (ot === null ? (ot = n) : ot.push.apply(ot, n));
              }
              u = i;
            }
            if (((n = !1), u !== 2)) continue;
          }
        }
        if (u === 1) {
          uu(l, 0), Ve(l, t, 0, !0);
          break;
        }
        l: {
          switch (((a = l), (n = u), n)) {
            case 0:
            case 1:
              throw Error(o(345));
            case 4:
              if ((t & 4194048) !== t && (t & 62914560) !== t) break;
            case 6:
              Ve(a, t, zt, !Ze);
              break l;
            case 2:
              ot = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(o(329));
          }
          if ((t & 62914560) === t && ((u = _i + 300 - mt()), 10 < u)) {
            if ((Ve(a, t, zt, !Ze), On(a, 0, !0) !== 0)) break l;
            (le = t),
              (a.timeoutHandle = d0(
                lr.bind(null, a, e, ot, Mi, Xf, t, zt, ba, Pa, Ze, n, "Throttled", -0, 0),
                u,
              ));
            break l;
          }
          lr(a, e, ot, Mi, Xf, t, zt, ba, Pa, Ze, n, null, -0, 0);
        }
      }
      break;
    } while (!0);
    te(l);
  }
  function lr(l, t, e, a, u, n, i, c, f, h, S, p, v, g) {
    l.timeoutHandle = -1;
    var x = t.subtreeFlags,
      j = (n & 335544064) === n;
    if (
      ((p = null),
      (j || x & 8192 || (x & 16785408) === 16785408) &&
        ((p = {
          stylesheets: null,
          count: 0,
          imgCount: 0,
          imgBytes: 0,
          suspenseyImages: [],
          waitingForImages: !0,
          waitingForViewTransition: !1,
          unsuspend: wt,
        }),
        (Et = null),
        Ko(t, n, p),
        j &&
          ((x = p),
          (j = l.containerInfo),
          (j = (j.nodeType === 9 ? j : j.ownerDocument).__reactViewTransition),
          j != null &&
            (x.count++,
            (x.waitingForViewTransition = !0),
            (x = sn.bind(x)),
            j.finished.then(x, x))),
        (x = (n & 62914560) === n ? _i - mt() : (n & 4194048) === n ? Wo - mt() : 0),
        (x = Sm(p, x)),
        x !== null))
    ) {
      (le = n),
        (l.cancelPendingCommit = x(fr.bind(null, l, t, n, e, a, u, i, c, f, h, S, p, null, v, g))),
        Ve(l, n, i, !h);
      return;
    }
    fr(l, t, n, e, a, u, i, c, f, h, S, p);
  }
  function mv(l) {
    for (var t = l; ; ) {
      var e = t.tag;
      if (
        (e === 0 || e === 11 || e === 15) &&
        t.flags & 16384 &&
        ((e = t.updateQueue), e !== null && ((e = e.stores), e !== null))
      )
        for (var a = 0; a < e.length; a++) {
          var u = e[a],
            n = u.getSnapshot;
          u = u.value;
          try {
            if (!St(n(), u)) return !1;
          } catch {
            return !1;
          }
        }
      if (((e = t.child), t.subtreeFlags & 16384 && e !== null)) (e.return = t), (t = e);
      else {
        if (t === l) break;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === l) return !0;
          t = t.return;
        }
        (t.sibling.return = t.return), (t = t.sibling);
      }
    }
    return !0;
  }
  function Ve(l, t, e, a) {
    (t = F0(l, t)),
      (t &= ~Oi),
      (t &= ~ba),
      (l.suspendedLanes |= t),
      (l.pingedLanes &= ~t),
      a && (l.warmLanes |= t),
      (a = l.expirationTimes);
    for (var u = t; 0 < u; ) {
      var n = 31 - yt(u),
        i = 1 << n;
      (a[n] = -1), (u &= ~i);
    }
    e !== 0 && W0(l, e, t);
  }
  function Di() {
    return (ml & 6) === 0 ? (tn(0), !1) : !0;
  }
  function Kf() {
    if (el !== null) {
      if (gl === 0) var l = el.return;
      else (l = el), (de = ca = null), Pc(l), (Qa = null), (Yu = 0), (l = el);
      for (; l !== null; ) Ao(l.alternate, l), (l = l.return);
      el = null;
    }
  }
  function uu(l, t) {
    var e = l.timeoutHandle;
    return (
      e !== -1 && ((l.timeoutHandle = -1), Yv(e)),
      (e = l.cancelPendingCommit),
      e !== null && ((l.cancelPendingCommit = null), e()),
      (le = 0),
      Kf(),
      (zl = l),
      (el = e = oe(l.current, null)),
      (ul = t),
      (gl = 0),
      (Tt = null),
      (Ze = !1),
      (Ia = Eu(l, t)),
      (Vf = !1),
      (Pa = zt = Oi = ba = Le = xl = 0),
      (ot = Pu = null),
      (Xf = !1),
      (Se = F0(l, t)),
      Yn(),
      e
    );
  }
  function tr(l, t) {
    (I = null),
      (B.H = si),
      t === Xa || t === $n
        ? ((t = cs()), (gl = 3))
        : t === Lc
          ? ((t = cs()), (gl = 4))
          : (gl =
              t === hf
                ? 8
                : t !== null && typeof t == "object" && typeof t.then == "function"
                  ? 6
                  : 1),
      (Tt = t),
      el === null && ((xl = 1), oi(l, xt(t, l.current)));
  }
  function er() {
    var l = Kl.current;
    return l === null
      ? !0
      : (ul & 4194048) === ul
        ? Il === null
        : (ul & 62914560) === ul || (ul & 536870912) !== 0
          ? l === Il
          : !1;
  }
  function ar() {
    var l = B.H;
    return ((B.H = si), l === null ? si : l);
  }
  function ur() {
    var l = B.A;
    return ((B.A = dv), l);
  }
  function Ci() {
    (xl = 4),
      Ze || ((ul & 4194048) !== ul && Kl.current !== null) || (Ia = !0),
      ((Le & 134217727) === 0 && (ba & 134217727) === 0) || zl === null || Ve(zl, ul, zt, !1);
  }
  function Jf(l, t, e) {
    var a = ml;
    ml |= 2;
    var u = ar(),
      n = ur();
    (zl !== l || ul !== t) && ((Mi = null), uu(l, t)), (t = !1);
    var i = xl;
    l: do
      try {
        if (gl !== 0 && el !== null) {
          var c = el,
            f = Tt;
          switch (gl) {
            case 8:
              Kf(), (i = 6);
              break l;
            case 3:
            case 2:
            case 9:
            case 6:
              Kl.current === null && (t = !0);
              var h = gl;
              if (((gl = 0), (Tt = null), nu(l, c, f, h), e && Ia)) {
                i = 0;
                break l;
              }
              break;
            default:
              (h = gl), (gl = 0), (Tt = null), nu(l, c, f, h);
          }
        }
        hv(), (i = xl);
        break;
      } catch (S) {
        tr(l, S);
      }
    while (!0);
    return (
      t && l.shellSuspendCounter++,
      (de = ca = null),
      (ml = a),
      (B.H = u),
      (B.A = n),
      el === null && ((zl = null), (ul = 0), Yn()),
      i
    );
  }
  function hv() {
    for (; el !== null; ) nr(el);
  }
  function yv(l, t) {
    var e = ml;
    ml |= 2;
    var a = ar(),
      u = ur();
    zl !== l || ul !== t ? ((Mi = null), (Ni = mt() + 500), uu(l, t)) : (Ia = Eu(l, t));
    l: do
      try {
        if (gl !== 0 && el !== null) {
          t = el;
          var n = Tt;
          t: switch (gl) {
            case 1:
              (gl = 0), (Tt = null), nu(l, t, n, 1);
              break;
            case 2:
            case 9:
              if (ns(n)) {
                (gl = 0), (Tt = null), ir(t);
                break;
              }
              (t = function () {
                (gl !== 2 && gl !== 9) || zl !== l || (gl = 7), te(l);
              }),
                n.then(t, t);
              break l;
            case 3:
              gl = 7;
              break l;
            case 4:
              gl = 5;
              break l;
            case 7:
              ns(n) ? ((gl = 0), (Tt = null), ir(t)) : ((gl = 0), (Tt = null), nu(l, t, n, 7));
              break;
            case 5:
              var i = null;
              switch (el.tag) {
                case 26:
                  i = el.memoizedState;
                case 5:
                case 27:
                  var c = el;
                  if (i ? kr(i) : c.stateNode.complete) {
                    (gl = 0), (Tt = null);
                    var f = c.sibling;
                    if (f !== null) el = f;
                    else {
                      var h = c.return;
                      h !== null ? ((el = h), Ui(h)) : (el = null);
                    }
                    break t;
                  }
              }
              (gl = 0), (Tt = null), nu(l, t, n, 5);
              break;
            case 6:
              (gl = 0), (Tt = null), nu(l, t, n, 6);
              break;
            case 8:
              Kf(), (xl = 6);
              break l;
            default:
              throw Error(o(462));
          }
        }
        gv();
        break;
      } catch (S) {
        tr(l, S);
      }
    while (!0);
    return (
      (de = ca = null),
      (B.H = a),
      (B.A = u),
      (ml = e),
      el !== null ? 0 : ((zl = null), (ul = 0), Yn(), xl)
    );
  }
  function gv() {
    for (; el !== null && !H2(); ) nr(el);
  }
  function nr(l) {
    var t = To(l.alternate, l, Se);
    (l.memoizedProps = l.pendingProps), t === null ? Ui(l) : (el = t);
  }
  function ir(l) {
    var t = l,
      e = t.alternate;
    switch (t.tag) {
      case 15:
      case 0:
        t = mo(e, t, t.pendingProps, t.type, void 0, ul);
        break;
      case 11:
        t = mo(e, t, t.pendingProps, t.type.render, t.ref, ul);
        break;
      case 5:
        Pc(t);
        var a = t;
        a === Ll &&
          (tl
            ? (Qn(a), a.tag === 5 && a.stateNode != null && (pl = a.stateNode))
            : (Qn(a), (tl = !0)));
      default:
        Ao(e, t), (t = el = F1(t, Se)), (t = To(e, t, Se));
    }
    (l.memoizedProps = l.pendingProps), t === null ? Ui(l) : (el = t);
  }
  function nu(l, t, e, a) {
    (de = ca = null), Pc(t), (Qa = null), (Yu = 0);
    var u = t.return;
    try {
      if (uv(l, u, t, e, ul)) {
        (xl = 1), oi(l, xt(e, l.current)), (el = null);
        return;
      }
    } catch (n) {
      if (u !== null) throw ((el = u), n);
      (xl = 1), oi(l, xt(e, l.current)), (el = null);
      return;
    }
    t.flags & 32768
      ? (tl || a === 1
          ? (l = !0)
          : Ia || (ul & 536870912) !== 0
            ? (l = !1)
            : ((Ze = l = !0),
              (a === 2 || a === 9 || a === 3 || a === 6) &&
                ((a = Kl.current), a !== null && a.tag === 13 && (a.flags |= 16384))),
        cr(t, l))
      : Ui(t);
  }
  function Ui(l) {
    var t = l;
    do {
      if ((t.flags & 32768) !== 0) {
        cr(t, Ze);
        return;
      }
      l = t.return;
      var e = fv(t.alternate, t, Se);
      if (e !== null) {
        el = e;
        return;
      }
      if (((t = t.sibling), t !== null)) {
        el = t;
        return;
      }
      el = t = l;
    } while (t !== null);
    xl === 0 && (xl = 5);
  }
  function cr(l, t) {
    do {
      var e = sv(l.alternate, l);
      if (e !== null) {
        (e.flags &= 32767), (el = e);
        return;
      }
      if (
        ((e = l.return),
        e !== null && ((e.flags |= 32768), (e.subtreeFlags = 0), (e.deletions = null)),
        !t && ((l = l.sibling), l !== null))
      ) {
        el = l;
        return;
      }
      el = l = e;
    } while (l !== null);
    (xl = 6), (el = null);
  }
  function fr(l, t, e, a, u, n, i, c, f, h, S, p) {
    l.cancelPendingCommit = null;
    do Ri();
    while (Nl !== 0);
    if ((ml & 6) !== 0) throw Error(o(327));
    if (t !== null) {
      if (t === l.current) throw Error(o(177));
      l === zl && ((el = zl = null), (ul = 0)),
        (Ea = t),
        (Gt = l),
        (le = e),
        (wf = u),
        (ko = a),
        Sv(l, t, e, i, c, f, p);
    }
  }
  function Sv(l, t, e, a, u, n, i) {
    var c = t.lanes | t.childLanes;
    if (
      ((Qf = c),
      (c |= Nc),
      Q2(l, e, c, a, u, n),
      (tu = null),
      (e & 335544064) === e ? ((eu = Kd(l)), (a = 10262)) : ((eu = null), (a = 10256)),
      (t.subtreeFlags & a) !== 0 || (t.flags & a) !== 0
        ? ((l.callbackNode = null),
          (l.callbackPriority = 0),
          pv(Tn, function () {
            return (kf(), null);
          }))
        : ((l.callbackNode = null), (l.callbackPriority = 0)),
      (Si = !1),
      (a = (t.flags & 13878) !== 0),
      (t.subtreeFlags & 13878) !== 0 || a)
    ) {
      (a = B.T), (B.T = null), (u = J.p), (J.p = 2), (n = ml), (ml |= 4);
      try {
        ov(l, t, e);
      } finally {
        (ml = n), (J.p = u), (B.T = a);
      }
    }
    (Nl = 1), Si ? (lu = Qv(i, l.containerInfo, eu, Ff, $f, Ev, Wf, kf, bv)) : (Ff(), $f(), Wf());
  }
  function bv(l) {
    if (Nl !== 0) {
      var t = Gt.onRecoverableError;
      t(l, { componentStack: null });
    }
  }
  function Ev() {
    Nl === 3 && ((Nl = 0), Qo(Ea, Gt), (Nl = 4));
  }
  function Ff() {
    if (Nl === 1) {
      Nl = 0;
      var l = Gt,
        t = Ea,
        e = le,
        a = (t.flags & 13878) !== 0;
      if ((t.subtreeFlags & 13878) !== 0 || a) {
        (a = B.T), (B.T = null);
        var u = J.p;
        J.p = 2;
        var n = ml;
        ml |= 4;
        try {
          (Wu = Ti = !1), Vo(t, l, e), (e = s0);
          var i = Y1(l.containerInfo),
            c = e.focusedElem,
            f = e.selectionRange;
          if (i !== c && c && c.ownerDocument && B1(c.ownerDocument.documentElement, c)) {
            if (f !== null && zc(c)) {
              var h = f.start,
                S = f.end;
              if ((S === void 0 && (S = h), "selectionStart" in c))
                (c.selectionStart = h), (c.selectionEnd = Math.min(S, c.value.length));
              else {
                var p = c.ownerDocument || document,
                  v = (p && p.defaultView) || window;
                if (v.getSelection) {
                  var g = v.getSelection(),
                    x = c.textContent.length,
                    j = Math.min(f.start, x),
                    P = f.end === void 0 ? j : Math.min(f.end, x);
                  !g.extend && j > P && ((i = P), (P = j), (j = i));
                  var m = q1(c, j),
                    r = q1(c, P);
                  if (
                    m &&
                    r &&
                    (g.rangeCount !== 1 ||
                      g.anchorNode !== m.node ||
                      g.anchorOffset !== m.offset ||
                      g.focusNode !== r.node ||
                      g.focusOffset !== r.offset)
                  ) {
                    var y = p.createRange();
                    y.setStart(m.node, m.offset),
                      g.removeAllRanges(),
                      j > P
                        ? (g.addRange(y), g.extend(r.node, r.offset))
                        : (y.setEnd(r.node, r.offset), g.addRange(y));
                  }
                }
              }
            }
            for (p = [], g = c; (g = g.parentNode); )
              g.nodeType === 1 && p.push({ element: g, left: g.scrollLeft, top: g.scrollTop });
            for (typeof c.focus == "function" && c.focus(), c = 0; c < p.length; c++) {
              var A = p[c];
              (A.element.scrollLeft = A.left), (A.element.scrollTop = A.top);
            }
          }
          (vu = !!f0), (s0 = f0 = null);
        } finally {
          (ml = n), (J.p = u), (B.T = a);
        }
      }
      (l.current = t), (Nl = 2);
    }
  }
  function $f() {
    if (Nl === 2) {
      Nl = 0;
      var l = Gt,
        t = Ea,
        e = (t.flags & 8772) !== 0;
      if ((t.subtreeFlags & 8772) !== 0 || e) {
        (e = B.T), (B.T = null);
        var a = J.p;
        J.p = 2;
        var u = ml;
        ml |= 4;
        try {
          qo(l, t.alternate, t);
        } finally {
          (ml = u), (J.p = a), (B.T = e);
        }
      }
      Nl = 3;
    }
  }
  function Wf() {
    if (Nl === 4 || Nl === 3) {
      Nl = 0;
      var l = lu;
      (lu = null), j2();
      var t = Gt,
        e = Ea,
        a = le,
        u = ko,
        n = (a & 335544064) === a ? 10262 : 10256;
      if (
        ((e.subtreeFlags & n) !== 0 || (e.flags & n) !== 0
          ? (Nl = 5)
          : ((Nl = 0), (Ea = Gt = null), sr(t, t.pendingLanes)),
        (n = t.pendingLanes),
        n === 0 && (Ge = null),
        uc(a),
        (e = e.stateNode),
        ht && typeof ht.onCommitFiberRoot == "function")
      )
        try {
          ht.onCommitFiberRoot(bu, e, void 0, (e.current.flags & 128) === 128);
        } catch {}
      if (u !== null) {
        (e = B.T), (n = J.p), (J.p = 2), (B.T = null);
        try {
          for (var i = t.onRecoverableError, c = 0; c < u.length; c++) {
            var f = u[c];
            i(f.value, { componentStack: f.stack });
          }
        } finally {
          (B.T = e), (J.p = n);
        }
      }
      if (
        ((u = tu),
        (i = eu),
        (eu = null),
        u !== null && ((tu = null), i === null && (i = []), l !== null))
      )
        for (f = 0; f < u.length; f++) (e = (0, u[f])(i)), e !== void 0 && l.finished.finally(e);
      (le & 3) !== 0 && Ri(),
        te(t),
        (n = t.pendingLanes),
        (a & 261930) !== 0 && (n & 42) !== 0
          ? t === xi
            ? ln++
            : ((ln = 0), (xi = t))
          : ((ln = 0), (xi = null)),
        tn(0);
    }
  }
  function sr(l, t) {
    (l.pooledCacheLanes &= t) === 0 &&
      ((t = l.pooledCache), t != null && ((l.pooledCache = null), ju(t)));
  }
  function Ri() {
    return (lu !== null && (lu.skipTransition(), (lu = null)), Ff(), $f(), Wf(), kf());
  }
  function kf() {
    if (Nl !== 5) return !1;
    var l = Gt,
      t = Qf;
    Qf = 0;
    var e = uc(le),
      a = B.T,
      u = J.p;
    try {
      (J.p = 32 > e ? 32 : e), (B.T = null), (e = wf), (wf = null);
      var n = Gt,
        i = le;
      if (((Nl = 0), (Ea = Gt = null), (le = 0), (ml & 6) !== 0)) throw Error(o(331));
      var c = ml;
      if (
        ((ml |= 4),
        Fo(n.current),
        wo(n, n.current, i, e),
        (ml = c),
        tn(0, !1),
        ht && typeof ht.onPostCommitFiberRoot == "function")
      )
        try {
          ht.onPostCommitFiberRoot(bu, n);
        } catch {}
      return !0;
    } finally {
      (J.p = u), (B.T = a), sr(l, t);
    }
  }
  function or(l, t, e) {
    (t = xt(e, t)), (t = mf(l.stateNode, t, 2)), (l = Re(l, t, 2)), l !== null && (Tu(l, 2), te(l));
  }
  function Sl(l, t, e) {
    if (l.tag === 3) or(l, l, e);
    else
      for (; t !== null; ) {
        if (t.tag === 3) {
          or(t, l, e);
          break;
        } else if (t.tag === 1) {
          var a = t.stateNode;
          if (
            typeof t.type.getDerivedStateFromError == "function" ||
            (typeof a.componentDidCatch == "function" && (Ge === null || !Ge.has(a)))
          ) {
            (l = xt(e, l)),
              (e = no(2)),
              (a = Re(t, e, 2)),
              a !== null && (io(e, a, t, l), Tu(a, 2), te(a));
            break;
          }
        }
        t = t.return;
      }
  }
  function If(l, t, e) {
    var a = l.pingCache;
    if (a === null) {
      a = l.pingCache = new vv();
      var u = new Set();
      a.set(t, u);
    } else (u = a.get(t)), u === void 0 && ((u = new Set()), a.set(t, u));
    u.has(e) || ((Vf = !0), u.add(e), (l = Tv.bind(null, l, t, e)), t.then(l, l));
  }
  function Tv(l, t, e) {
    var a = l.pingCache;
    a !== null && a.delete(t),
      (l.pingedLanes |= l.suspendedLanes & e),
      (l.warmLanes &= ~e),
      zl === l &&
        (ul & e) === e &&
        ((xl === 4 || (xl === 3 && (ul & 62914560) === ul && 300 > mt() - _i)) && (ml & 2) === 0
          ? uu(l, 0)
          : (Oi |= e),
        Pa === ul && (Pa = 0)),
      te(l);
  }
  function rr(l, t) {
    t === 0 && (t = $0()), (l = ua(l, t)), l !== null && (Tu(l, t), te(l));
  }
  function zv(l) {
    var t = l.memoizedState,
      e = 0;
    t !== null && (e = t.retryLane), rr(l, e);
  }
  function Av(l, t) {
    var e = 0;
    switch (l.tag) {
      case 31:
      case 13:
        var a = l.stateNode,
          u = l.memoizedState;
        u !== null && (e = u.retryLane);
        break;
      case 19:
        a = l.stateNode;
        break;
      case 22:
        a = l.stateNode._retryCache;
        break;
      default:
        throw Error(o(314));
    }
    a !== null && a.delete(t), rr(l, e);
  }
  function pv(l, t) {
    return lc(l, t);
  }
  var iu = null,
    cu = null,
    Pf = !1,
    Hi = !1,
    l0 = !1,
    Xe = 0;
  function te(l) {
    l !== cu && l.next === null && (cu === null ? (iu = cu = l) : (cu = cu.next = l)),
      (Hi = !0),
      Pf || ((Pf = !0), _v());
  }
  function tn(l, t) {
    if (!l0 && Hi) {
      l0 = !0;
      do
        for (var e = !1, a = iu; a !== null; ) {
          if (l !== 0) {
            var u = a.pendingLanes;
            if (u === 0) var n = 0;
            else {
              var i = a.suspendedLanes,
                c = a.pingedLanes;
              (n = (1 << (31 - yt(42 | l) + 1)) - 1),
                (n &= u & ~(i & ~c)),
                (n = n & 201326741 ? (n & 201326741) | 1 : n ? n | 2 : 0);
            }
            n !== 0 && ((e = !0), hr(a, n));
          } else
            (n = ul),
              (n = On(
                a,
                a === zl ? n : 0,
                a.cancelPendingCommit !== null || a.timeoutHandle !== -1,
              )),
              (n & 3) === 0 || Eu(a, n) || ((e = !0), hr(a, n));
          a = a.next;
        }
      while (e);
      l0 = !1;
    }
  }
  function Ov() {
    dr();
  }
  function dr() {
    Hi = Pf = !1;
    var l = 0;
    Xe !== 0 && Bv() && (l = Xe);
    for (var t = mt(), e = null, a = iu; a !== null; ) {
      var u = a.next,
        n = vr(a, t);
      n === 0
        ? ((a.next = null), e === null ? (iu = u) : (e.next = u), u === null && (cu = e))
        : ((e = a), (l !== 0 || (n & 3) !== 0) && (Hi = !0)),
        (a = u);
    }
    (Nl !== 0 && Nl !== 5) || tn(l), Xe !== 0 && (Xe = 0);
  }
  function vr(l, t) {
    for (
      var e = l.suspendedLanes,
        a = l.pingedLanes,
        u = l.expirationTimes,
        n = l.pendingLanes & -62914561;
      0 < n;
    ) {
      var i = 31 - yt(n),
        c = 1 << i,
        f = u[i];
      f === -1
        ? ((c & e) === 0 || (c & a) !== 0) && (u[i] = X2(c, t))
        : f <= t && (l.expiredLanes |= c),
        (n &= ~c);
    }
    if (
      ((t = zl),
      (e = ul),
      (e = On(l, l === t ? e : 0, l.cancelPendingCommit !== null || l.timeoutHandle !== -1)),
      (a = l.callbackNode),
      e === 0 || (l === t && (gl === 2 || gl === 9)) || l.cancelPendingCommit !== null)
    )
      return (a !== null && a !== null && tc(a), (l.callbackNode = null), (l.callbackPriority = 0));
    if ((e & 3) === 0 || Eu(l, e)) {
      if (((t = e & -e), t === l.callbackPriority)) return t;
      switch ((a !== null && tc(a), uc(e))) {
        case 2:
        case 8:
          e = K0;
          break;
        case 32:
          e = Tn;
          break;
        case 268435456:
          e = J0;
          break;
        default:
          e = Tn;
      }
      return (
        (a = mr.bind(null, l)), (e = lc(e, a)), (l.callbackPriority = t), (l.callbackNode = e), t
      );
    }
    return (
      a !== null && a !== null && tc(a), (l.callbackPriority = 2), (l.callbackNode = null), 2
    );
  }
  function mr(l, t) {
    if (Nl !== 0 && Nl !== 5) return ((l.callbackNode = null), (l.callbackPriority = 0), null);
    var e = l.callbackNode;
    if (Ri() && l.callbackNode !== e) return null;
    var a = ul;
    return (
      (a = On(l, l === zl ? a : 0, l.cancelPendingCommit !== null || l.timeoutHandle !== -1)),
      a === 0
        ? null
        : (Po(l, a, t),
          vr(l, mt()),
          l.callbackNode != null && l.callbackNode === e ? mr.bind(null, l) : null)
    );
  }
  function hr(l, t) {
    if (Ri()) return null;
    Po(l, t, !0);
  }
  function _v() {
    Zv(function () {
      (ml & 6) !== 0 ? lc(w0, Ov) : dr();
    });
  }
  function t0() {
    if (Xe === 0) {
      var l = oa;
      l === 0 && ((l = zn), (zn <<= 1), (zn & 261888) === 0 && (zn = 256)), (Xe = l);
    }
    return Xe;
  }
  function yr(l) {
    return l == null || typeof l == "symbol" || typeof l == "boolean"
      ? null
      : typeof l == "function"
        ? l
        : Dn(l);
  }
  function Nv(l, t, e, a, u) {
    if (t === "submit" && e && e.stateNode === u) {
      var n = yr((u[it] || null).action),
        i = a.submitter;
      i &&
        ((t = (t = i[it] || null) ? yr(t.formAction) : i.getAttribute("formAction")),
        t !== null && ((n = t), (i = null)));
      var c = new Hn("action", "action", null, a, u);
      l.push({
        event: c,
        listeners: [
          {
            instance: null,
            listener: function () {
              if (a.defaultPrevented) {
                if (Xe !== 0) {
                  var f = new FormData(u, i);
                  sf(e, { pending: !0, data: f, method: u.method, action: n }, null, f);
                }
              } else
                typeof n == "function" &&
                  (c.preventDefault(),
                  (f = new FormData(u, i)),
                  sf(e, { pending: !0, data: f, method: u.method, action: n }, n, f));
            },
            currentTarget: u,
          },
        ],
      });
    }
  }
  for (var e0 = 0; e0 < _c.length; e0++) {
    var a0 = _c[e0],
      Mv = a0.toLowerCase(),
      xv = a0[0].toUpperCase() + a0.slice(1);
    Bt(Mv, "on" + xv);
  }
  Bt(G1, "onAnimationEnd"),
    Bt(V1, "onAnimationIteration"),
    Bt(X1, "onAnimationStart"),
    Bt("dblclick", "onDoubleClick"),
    Bt("focusin", "onFocus"),
    Bt("focusout", "onBlur"),
    Bt(Yd, "onTransitionRun"),
    Bt(Zd, "onTransitionStart"),
    Bt(Ld, "onTransitionCancel"),
    Bt(Q1, "onTransitionEnd"),
    xa("onMouseEnter", ["mouseout", "mouseover"]),
    xa("onMouseLeave", ["mouseout", "mouseover"]),
    xa("onPointerEnter", ["pointerout", "pointerover"]),
    xa("onPointerLeave", ["pointerout", "pointerover"]),
    ta("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")),
    ta(
      "onSelect",
      "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
        " ",
      ),
    ),
    ta("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]),
    ta("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")),
    ta(
      "onCompositionStart",
      "compositionstart focusout keydown keypress keyup mousedown".split(" "),
    ),
    ta(
      "onCompositionUpdate",
      "compositionupdate focusout keydown keypress keyup mousedown".split(" "),
    );
  var en =
      "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
        " ",
      ),
    Dv = new Set(
      "beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(en),
    );
  function gr(l, t) {
    t = (t & 4) !== 0;
    for (var e = 0; e < l.length; e++) {
      var a = l[e],
        u = a.event;
      a = a.listeners;
      l: {
        var n = void 0;
        if (t)
          for (var i = a.length - 1; 0 <= i; i--) {
            var c = a[i],
              f = c.instance,
              h = c.currentTarget;
            if (((c = c.listener), f !== n && u.isPropagationStopped())) break l;
            (n = c), (u.currentTarget = h);
            try {
              n(u);
            } catch (S) {
              Bn(S);
            }
            (u.currentTarget = null), (n = f);
          }
        else
          for (i = 0; i < a.length; i++) {
            if (
              ((c = a[i]),
              (f = c.instance),
              (h = c.currentTarget),
              (c = c.listener),
              f !== n && u.isPropagationStopped())
            )
              break l;
            (n = c), (u.currentTarget = h);
            try {
              n(u);
            } catch (S) {
              Bn(S);
            }
            (u.currentTarget = null), (n = f);
          }
      }
    }
  }
  function al(l, t) {
    var e = t[t1];
    e === void 0 && (e = t[t1] = new Set());
    var a = l + "__bubble";
    e.has(a) || (Sr(t, l, 2, !1), e.add(a));
  }
  function u0(l, t, e) {
    var a = 0;
    t && (a |= 4), Sr(e, l, a, t);
  }
  var ji = "_reactListening" + Math.random().toString(36).slice(2);
  function n0(l) {
    if (!l[ji]) {
      (l[ji] = !0),
        u1.forEach(function (e) {
          e !== "selectionchange" && (Dv.has(e) || u0(e, !1, l), u0(e, !0, l));
        });
      var t = l.nodeType === 9 ? l : l.ownerDocument;
      t === null || t[ji] || ((t[ji] = !0), u0("selectionchange", !1, t));
    }
  }
  function Sr(l, t, e, a) {
    switch (c2(t)) {
      case 2:
        var u = zm;
        break;
      case 8:
        u = Am;
        break;
      default:
        u = O0;
    }
    (e = u.bind(null, t, e, l)),
      (u = void 0),
      !dc || (t !== "touchstart" && t !== "touchmove" && t !== "wheel") || (u = !0),
      a
        ? u !== void 0
          ? l.addEventListener(t, e, { capture: !0, passive: u })
          : l.addEventListener(t, e, !0)
        : u !== void 0
          ? l.addEventListener(t, e, { passive: u })
          : l.addEventListener(t, e, !1);
  }
  function i0(l, t, e, a, u) {
    var n = a;
    if ((t & 1) === 0 && (t & 2) === 0 && a !== null)
      l: for (;;) {
        if (a === null) return;
        var i = a.tag;
        if (i === 3 || i === 4) {
          var c = a.stateNode.containerInfo;
          if (c === u) break;
          if (i === 4)
            for (i = a.return; i !== null; ) {
              var f = i.tag;
              if ((f === 3 || f === 4) && i.stateNode.containerInfo === u) return;
              i = i.return;
            }
          for (; c !== null; ) {
            if (((i = la(c)), i === null)) return;
            if (((f = i.tag), f === 5 || f === 6 || f === 26 || f === 27)) {
              a = n = i;
              continue l;
            }
            c = c.parentNode;
          }
        }
        a = a.return;
      }
    g1(function () {
      var h = n,
        S = oc(e),
        p = [];
      l: {
        var v = w1.get(l);
        if (v !== void 0) {
          var g = Hn,
            x = l;
          switch (l) {
            case "keypress":
              if (Un(e) === 0) break l;
            case "keydown":
            case "keyup":
              g = md;
              break;
            case "focusin":
              (x = "focus"), (g = yc);
              break;
            case "focusout":
              (x = "blur"), (g = yc);
              break;
            case "beforeblur":
            case "afterblur":
              g = yc;
              break;
            case "click":
              if (e.button === 2) break l;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              g = E1;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              g = ed;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              g = bd;
              break;
            case G1:
            case V1:
            case X1:
              g = nd;
              break;
            case Q1:
              g = Td;
              break;
            case "scroll":
            case "scrollend":
              g = ld;
              break;
            case "wheel":
              g = Ad;
              break;
            case "copy":
            case "cut":
            case "paste":
              g = cd;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              g = z1;
              break;
            case "submit":
              g = gd;
              break;
            case "toggle":
            case "beforetoggle":
              g = Od;
          }
          var j = (t & 4) !== 0,
            P = !j && (l === "scroll" || l === "scrollend"),
            m = j ? (v !== null ? v + "Capture" : null) : v;
          j = [];
          for (var r = h, y; r !== null; ) {
            var A = r;
            if (
              ((y = A.stateNode),
              (A = A.tag),
              (A !== 5 && A !== 26 && A !== 27) ||
                y === null ||
                m === null ||
                ((A = pu(r, m)), A != null && j.push(an(r, A, y))),
              P)
            )
              break;
            r = r.return;
          }
          0 < j.length && ((v = new g(v, x, null, e, S)), p.push({ event: v, listeners: j }));
        }
      }
      if ((t & 7) === 0) {
        l: {
          if (
            ((g = l === "mouseover" || l === "pointerover"),
            (v = l === "mouseout" || l === "pointerout"),
            g && e !== sc && (x = e.relatedTarget || e.fromElement) && (la(x) || x[_a]))
          )
            break l;
          (v || g) &&
            ((x =
              S.window === S
                ? S
                : (g = S.ownerDocument)
                  ? g.defaultView || g.parentWindow
                  : window),
            v
              ? ((g = e.relatedTarget || e.toElement),
                (v = h),
                (g = g ? la(g) : null),
                g !== null &&
                  ((P = M(g)), (j = g.tag), g !== P || (j !== 5 && j !== 27 && j !== 6)) &&
                  (g = null))
              : ((v = null), (g = h)),
            v !== g &&
              ((j = E1),
              (A = "onMouseLeave"),
              (m = "onMouseEnter"),
              (r = "mouse"),
              (l === "pointerout" || l === "pointerover") &&
                ((j = z1), (A = "onPointerLeave"), (m = "onPointerEnter"), (r = "pointer")),
              (P = v == null ? x : Au(v)),
              (y = g == null ? x : Au(g)),
              (x = new j(A, r + "leave", v, e, S)),
              (x.target = P),
              (x.relatedTarget = y),
              (A = null),
              la(S) === h &&
                ((j = new j(m, r + "enter", g, e, S)),
                (j.target = y),
                (j.relatedTarget = P),
                (A = j)),
              (P = A),
              (j = v && g ? il(v, g, Cv) : null),
              v !== null && br(p, x, v, j, !1),
              g !== null && P !== null && br(p, P, g, j, !0)));
        }
        l: {
          if (
            ((v = h ? Au(h) : window),
            (g = v.nodeName && v.nodeName.toLowerCase()),
            g === "select" || (g === "input" && v.type === "file"))
          )
            var R = D1;
          else if (M1(v))
            if (C1) R = jd;
            else {
              R = Rd;
              var nl = Ud;
            }
          else
            (g = v.nodeName),
              !g || g.toLowerCase() !== "input" || (v.type !== "checkbox" && v.type !== "radio")
                ? h && fc(h.elementType) && (R = D1)
                : (R = Hd);
          if (R && (R = R(l, h))) {
            x1(p, R, e, S);
            break l;
          }
          nl && nl(l, v, h);
        }
        switch (((nl = h ? Au(h) : window), l)) {
          case "focusin":
            (M1(nl) || nl.contentEditable === "true") && ((ja = nl), (Ac = h), (Uu = null));
            break;
          case "focusout":
            Uu = Ac = ja = null;
            break;
          case "mousedown":
            pc = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            (pc = !1), Z1(p, e, S);
            break;
          case "selectionchange":
            if (Bd) break;
          case "keydown":
          case "keyup":
            Z1(p, e, S);
        }
        var Y;
        if (Sc)
          l: {
            switch (l) {
              case "compositionstart":
                var X = "onCompositionStart";
                break l;
              case "compositionend":
                X = "onCompositionEnd";
                break l;
              case "compositionupdate":
                X = "onCompositionUpdate";
                break l;
            }
            X = void 0;
          }
        else
          Ha
            ? _1(l, e) && (X = "onCompositionEnd")
            : l === "keydown" && e.keyCode === 229 && (X = "onCompositionStart");
        X &&
          (A1 &&
            e.locale !== "ko" &&
            (Ha || X !== "onCompositionStart"
              ? X === "onCompositionEnd" && Ha && (Y = S1())
              : ((pe = S), (vc = "value" in pe ? pe.value : pe.textContent), (Ha = !0))),
          (nl = qi(h, X)),
          0 < nl.length &&
            ((X = new T1(X, l, null, e, S)),
            p.push({ event: X, listeners: nl }),
            Y ? (X.data = Y) : ((Y = N1(e)), Y !== null && (X.data = Y)))),
          (Y = Nd ? Md(l, e) : xd(l, e)) &&
            ((X = qi(h, "onBeforeInput")),
            0 < X.length &&
              ((nl = new T1("onBeforeInput", "beforeinput", null, e, S)),
              p.push({ event: nl, listeners: X }),
              (nl.data = Y))),
          Nv(p, l, h, e, S);
      }
      gr(p, t);
    });
  }
  function an(l, t, e) {
    return { instance: l, listener: t, currentTarget: e };
  }
  function qi(l, t) {
    for (var e = t + "Capture", a = []; l !== null; ) {
      var u = l,
        n = u.stateNode;
      if (
        ((u = u.tag),
        (u !== 5 && u !== 26 && u !== 27) ||
          n === null ||
          ((u = pu(l, e)),
          u != null && a.unshift(an(l, u, n)),
          (u = pu(l, t)),
          u != null && a.push(an(l, u, n))),
        l.tag === 3)
      )
        return a;
      l = l.return;
    }
    return [];
  }
  function Cv(l) {
    if (l === null) return null;
    do l = l.return;
    while (l && l.tag !== 5 && l.tag !== 27);
    return l || null;
  }
  function br(l, t, e, a, u) {
    for (var n = t._reactName, i = []; e !== null && e !== a; ) {
      var c = e,
        f = c.alternate,
        h = c.stateNode;
      if (((c = c.tag), f !== null && f === a)) break;
      (c !== 5 && c !== 26 && c !== 27) ||
        h === null ||
        ((f = h),
        u
          ? ((h = pu(e, n)), h != null && i.unshift(an(e, h, f)))
          : u || ((h = pu(e, n)), h != null && i.push(an(e, h, f)))),
        (e = e.return);
    }
    i.length !== 0 && l.push({ event: t, listeners: i });
  }
  var Uv = /\r\n?/g,
    Rv = /\u0000|\uFFFD/g;
  function Er(l) {
    return (typeof l == "string" ? l : "" + l)
      .replace(
        Uv,
        `
`,
      )
      .replace(Rv, "");
  }
  function Tr(l, t) {
    return ((t = Er(t)), Er(l) === t);
  }
  function bl(l, t, e, a, u, n) {
    switch (e) {
      case "children":
        if (typeof a == "string") t === "body" || (t === "textarea" && a === "") || Ca(l, a);
        else if (typeof a == "number" || typeof a == "bigint") t !== "body" && Ca(l, "" + a);
        else return;
        break;
      case "className":
        xn(l, "class", a);
        break;
      case "tabIndex":
        xn(l, "tabindex", a);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        xn(l, e, a);
        break;
      case "style":
        h1(l, a, n);
        return;
      case "data":
        if (t !== "object") {
          xn(l, "data", a);
          break;
        }
      case "src":
      case "href":
        if (a === "" && (t !== "a" || e !== "href")) {
          l.removeAttribute(e);
          break;
        }
        if (a == null || typeof a == "function" || typeof a == "symbol" || typeof a == "boolean") {
          l.removeAttribute(e);
          break;
        }
        (a = Dn(a)), l.setAttribute(e, a);
        break;
      case "action":
      case "formAction":
        if (typeof a == "function") {
          l.setAttribute(
            e,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')",
          );
          break;
        } else
          typeof n == "function" &&
            (e === "formAction"
              ? (t !== "input" && bl(l, t, "name", u.name, u, null),
                bl(l, t, "formEncType", u.formEncType, u, null),
                bl(l, t, "formMethod", u.formMethod, u, null),
                bl(l, t, "formTarget", u.formTarget, u, null))
              : (bl(l, t, "encType", u.encType, u, null),
                bl(l, t, "method", u.method, u, null),
                bl(l, t, "target", u.target, u, null)));
        if (a == null || typeof a == "symbol" || typeof a == "boolean") {
          l.removeAttribute(e);
          break;
        }
        (a = Dn(a)), l.setAttribute(e, a);
        break;
      case "onClick":
        a != null && (l.onclick = wt);
        return;
      case "onScroll":
        a != null && al("scroll", l);
        return;
      case "onScrollEnd":
        a != null && al("scrollend", l);
        return;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a)) throw Error(o(61));
          if (((e = a.__html), e != null)) {
            if (u.children != null) throw Error(o(60));
            (n != null ? n.__html : void 0) !== e && (l.innerHTML = e);
          }
        }
        break;
      case "multiple":
        l.multiple = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "muted":
        l.muted = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (a == null || typeof a == "function" || typeof a == "boolean" || typeof a == "symbol") {
          l.removeAttribute("xlink:href");
          break;
        }
        (e = Dn(a)), l.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", e);
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        a != null && typeof a != "function" && typeof a != "symbol"
          ? l.setAttribute(e, a)
          : l.removeAttribute(e);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "credentialless":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        a && typeof a != "function" && typeof a != "symbol"
          ? l.setAttribute(e, "")
          : l.removeAttribute(e);
        break;
      case "capture":
      case "download":
        a === !0
          ? l.setAttribute(e, "")
          : a !== !1 && a != null && typeof a != "function" && typeof a != "symbol"
            ? l.setAttribute(e, a)
            : l.removeAttribute(e);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        a != null && typeof a != "function" && typeof a != "symbol" && !isNaN(a) && 1 <= a
          ? l.setAttribute(e, a)
          : l.removeAttribute(e);
        break;
      case "rowSpan":
      case "start":
        a == null || typeof a == "function" || typeof a == "symbol" || isNaN(a)
          ? l.removeAttribute(e)
          : l.setAttribute(e, a);
        break;
      case "popover":
        al("beforetoggle", l), al("toggle", l), Mn(l, "popover", a);
        break;
      case "xlinkActuate":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:actuate", a);
        break;
      case "xlinkArcrole":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:arcrole", a);
        break;
      case "xlinkRole":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:role", a);
        break;
      case "xlinkShow":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:show", a);
        break;
      case "xlinkTitle":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:title", a);
        break;
      case "xlinkType":
        ie(l, "http://www.w3.org/1999/xlink", "xlink:type", a);
        break;
      case "xmlBase":
        ie(l, "http://www.w3.org/XML/1998/namespace", "xml:base", a);
        break;
      case "xmlLang":
        ie(l, "http://www.w3.org/XML/1998/namespace", "xml:lang", a);
        break;
      case "xmlSpace":
        ie(l, "http://www.w3.org/XML/1998/namespace", "xml:space", a);
        break;
      case "is":
        Mn(l, "is", a);
        break;
      case "innerText":
      case "textContent":
        return;
      default:
        if (!(2 < e.length) || (e[0] !== "o" && e[0] !== "O") || (e[1] !== "n" && e[1] !== "N"))
          (e = I2.get(e) || e), Mn(l, e, a);
        else return;
    }
    dl = !0;
  }
  function c0(l, t, e, a, u, n) {
    switch (e) {
      case "style":
        h1(l, a, n);
        return;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a)) throw Error(o(61));
          if (((e = a.__html), e != null)) {
            if (u.children != null) throw Error(o(60));
            (n != null ? n.__html : void 0) !== e && (l.innerHTML = e);
          }
        }
        break;
      case "children":
        if (typeof a == "string") Ca(l, a);
        else if (typeof a == "number" || typeof a == "bigint") Ca(l, "" + a);
        else return;
        break;
      case "onScroll":
        a != null && al("scroll", l);
        return;
      case "onScrollEnd":
        a != null && al("scrollend", l);
        return;
      case "onClick":
        a != null && (l.onclick = wt);
        return;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        return;
      case "innerText":
      case "textContent":
        return;
      default:
        if (!n1.hasOwnProperty(e))
          l: {
            if (
              e[0] === "o" &&
              e[1] === "n" &&
              ((u = e.endsWith("Capture")),
              (n = e.slice(2, u ? e.length - 7 : void 0)),
              (t = l[it] || null),
              (t = t != null ? t[e] : null),
              typeof t == "function" && l.removeEventListener(n, t, u),
              typeof a == "function")
            ) {
              typeof t != "function" &&
                t !== null &&
                (e in l ? (l[e] = null) : l.hasAttribute(e) && l.removeAttribute(e)),
                l.addEventListener(n, a, u);
              break l;
            }
            (dl = !0), e in l ? (l[e] = a) : a === !0 ? l.setAttribute(e, "") : Mn(l, e, a);
          }
        return;
    }
    dl = !0;
  }
  function $l(l, t, e) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        al("error", l), al("load", l);
        var a = !1,
          u = !1,
          n;
        for (n in e)
          if (e.hasOwnProperty(n)) {
            var i = e[n];
            if (i != null)
              switch (n) {
                case "src":
                  a = !0;
                  break;
                case "srcSet":
                  u = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(o(137, t));
                default:
                  bl(l, t, n, i, e, null);
              }
          }
        u && bl(l, t, "srcSet", e.srcSet, e, null), a && bl(l, t, "src", e.src, e, null);
        return;
      case "input":
        al("invalid", l);
        var c = (n = i = u = null),
          f = null,
          h = null;
        for (a in e)
          if (e.hasOwnProperty(a)) {
            var S = e[a];
            if (S != null)
              switch (a) {
                case "name":
                  u = S;
                  break;
                case "type":
                  i = S;
                  break;
                case "checked":
                  f = S;
                  break;
                case "defaultChecked":
                  h = S;
                  break;
                case "value":
                  n = S;
                  break;
                case "defaultValue":
                  c = S;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (S != null) throw Error(o(137, t));
                  break;
                default:
                  bl(l, t, a, S, e, null);
              }
          }
        r1(l, n, c, f, h, i, u, !1);
        return;
      case "select":
        al("invalid", l), (a = i = n = null);
        for (u in e)
          if (e.hasOwnProperty(u) && ((c = e[u]), c != null))
            switch (u) {
              case "value":
                n = c;
                break;
              case "defaultValue":
                i = c;
                break;
              case "multiple":
                a = c;
              default:
                bl(l, t, u, c, e, null);
            }
        (t = n),
          (e = i),
          (l.multiple = !!a),
          t != null ? Da(l, !!a, t, !1) : e != null && Da(l, !!a, e, !0);
        return;
      case "textarea":
        al("invalid", l), (n = u = a = null);
        for (i in e)
          if (e.hasOwnProperty(i) && ((c = e[i]), c != null))
            switch (i) {
              case "value":
                a = c;
                break;
              case "defaultValue":
                u = c;
                break;
              case "children":
                n = c;
                break;
              case "dangerouslySetInnerHTML":
                if (c != null) throw Error(o(91));
                break;
              default:
                bl(l, t, i, c, e, null);
            }
        v1(l, a, u, n);
        return;
      case "option":
        for (f in e)
          if (e.hasOwnProperty(f) && ((a = e[f]), a != null))
            switch (f) {
              case "selected":
                l.selected = a && typeof a != "function" && typeof a != "symbol";
                break;
              default:
                bl(l, t, f, a, e, null);
            }
        return;
      case "dialog":
        al("beforetoggle", l), al("toggle", l), al("cancel", l), al("close", l);
        break;
      case "iframe":
      case "object":
        al("load", l);
        break;
      case "video":
      case "audio":
        for (a = 0; a < en.length; a++) al(en[a], l);
        break;
      case "image":
        al("error", l), al("load", l);
        break;
      case "details":
        al("toggle", l);
        break;
      case "embed":
      case "source":
      case "link":
        al("error", l), al("load", l);
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (h in e)
          if (e.hasOwnProperty(h) && ((a = e[h]), a != null))
            switch (h) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(o(137, t));
              default:
                bl(l, t, h, a, e, null);
            }
        return;
      default:
        if (fc(t)) {
          for (S in e)
            e.hasOwnProperty(S) && ((a = e[S]), a !== void 0 && c0(l, t, S, a, e, void 0));
          return;
        }
    }
    for (c in e) e.hasOwnProperty(c) && ((a = e[c]), a != null && bl(l, t, c, a, e, null));
  }
  var Hv = {};
  function jv(l, t, e, a) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var u = null,
          n = null,
          i = null,
          c = null,
          f = null,
          h = null,
          S = null;
        for (g in e) {
          var p = e[g];
          if (e.hasOwnProperty(g) && p != null)
            switch (g) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                f = p;
              default:
                a.hasOwnProperty(g) || bl(l, t, g, null, a, p);
            }
        }
        for (var v in a) {
          var g = a[v];
          if (((p = e[v]), a.hasOwnProperty(v) && (g != null || p != null)))
            switch (v) {
              case "type":
                g !== p && (dl = !0), (n = g);
                break;
              case "name":
                g !== p && (dl = !0), (u = g);
                break;
              case "checked":
                g !== p && (dl = !0), (h = g);
                break;
              case "defaultChecked":
                g !== p && (dl = !0), (S = g);
                break;
              case "value":
                g !== p && (dl = !0), (i = g);
                break;
              case "defaultValue":
                g !== p && (dl = !0), (c = g);
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (g != null) throw Error(o(137, t));
                break;
              default:
                g !== p && bl(l, t, v, g, a, p);
            }
        }
        ic(l, i, c, f, h, S, n, u);
        return;
      case "select":
        g = i = c = v = null;
        for (n in e)
          if (((f = e[n]), e.hasOwnProperty(n) && f != null))
            switch (n) {
              case "value":
                break;
              case "multiple":
                g = f;
              default:
                a.hasOwnProperty(n) || bl(l, t, n, null, a, f);
            }
        for (u in a)
          if (((n = a[u]), (f = e[u]), a.hasOwnProperty(u) && (n != null || f != null)))
            switch (u) {
              case "value":
                n !== f && (dl = !0), (v = n);
                break;
              case "defaultValue":
                n !== f && (dl = !0), (c = n);
                break;
              case "multiple":
                n !== f && (dl = !0), (i = n);
              default:
                n !== f && bl(l, t, u, n, a, f);
            }
        (t = c),
          (e = i),
          (a = g),
          v != null
            ? Da(l, !!e, v, !1)
            : !!a != !!e && (t != null ? Da(l, !!e, t, !0) : Da(l, !!e, e ? [] : "", !1));
        return;
      case "textarea":
        g = v = null;
        for (c in e)
          if (((u = e[c]), e.hasOwnProperty(c) && u != null && !a.hasOwnProperty(c)))
            switch (c) {
              case "value":
                break;
              case "children":
                break;
              default:
                bl(l, t, c, null, a, u);
            }
        for (i in a)
          if (((u = a[i]), (n = e[i]), a.hasOwnProperty(i) && (u != null || n != null)))
            switch (i) {
              case "value":
                u !== n && (dl = !0), (v = u);
                break;
              case "defaultValue":
                u !== n && (dl = !0), (g = u);
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (u != null) throw Error(o(91));
                break;
              default:
                u !== n && bl(l, t, i, u, a, n);
            }
        d1(l, v, g);
        return;
      case "option":
        for (var x in e)
          if (((v = e[x]), e.hasOwnProperty(x) && v != null && !a.hasOwnProperty(x)))
            switch (x) {
              case "selected":
                l.selected = !1;
                break;
              default:
                bl(l, t, x, null, a, v);
            }
        for (f in a)
          if (((v = a[f]), (g = e[f]), a.hasOwnProperty(f) && v !== g && (v != null || g != null)))
            switch (f) {
              case "selected":
                v !== g && (dl = !0),
                  (l.selected = v && typeof v != "function" && typeof v != "symbol");
                break;
              default:
                bl(l, t, f, v, a, g);
            }
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var j in e)
          (v = e[j]),
            e.hasOwnProperty(j) && v != null && !a.hasOwnProperty(j) && bl(l, t, j, null, a, v);
        for (h in a)
          if (((v = a[h]), (g = e[h]), a.hasOwnProperty(h) && v !== g && (v != null || g != null)))
            switch (h) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (v != null) throw Error(o(137, t));
                break;
              default:
                bl(l, t, h, v, a, g);
            }
        return;
      default:
        if (fc(t)) {
          for (var P in e)
            (v = e[P]),
              e.hasOwnProperty(P) &&
                v !== void 0 &&
                !a.hasOwnProperty(P) &&
                c0(l, t, P, void 0, a, v);
          for (S in a)
            (v = a[S]),
              (g = e[S]),
              !a.hasOwnProperty(S) ||
                v === g ||
                (v === void 0 && g === void 0) ||
                c0(l, t, S, v, a, g);
          return;
        }
    }
    for (var m in e)
      (v = e[m]),
        e.hasOwnProperty(m) && v != null && !a.hasOwnProperty(m) && bl(l, t, m, null, a, v);
    for (p in a)
      (v = a[p]),
        (g = e[p]),
        !a.hasOwnProperty(p) || v === g || (v == null && g == null) || bl(l, t, p, v, a, g);
  }
  function zr(l) {
    switch (l) {
      case "css":
      case "script":
      case "font":
      case "img":
      case "image":
      case "input":
      case "link":
        return !0;
      default:
        return !1;
    }
  }
  function qv() {
    if (typeof performance.getEntriesByType == "function") {
      for (
        var l = 0, t = 0, e = performance.getEntriesByType("resource"), a = 0;
        a < e.length;
        a++
      ) {
        var u = e[a],
          n = u.transferSize,
          i = u.initiatorType,
          c = u.duration;
        if (n && c && zr(i)) {
          for (i = 0, c = u.responseEnd, a += 1; a < e.length; a++) {
            var f = e[a],
              h = f.startTime;
            if (h > c) break;
            var S = f.transferSize,
              p = f.initiatorType;
            S && zr(p) && ((f = f.responseEnd), (i += S * (f < c ? 1 : (c - h) / (f - h))));
          }
          if ((--a, (t += (8 * (n + i)) / (u.duration / 1e3)), l++, 10 < l)) break;
        }
      }
      if (0 < l) return t / l / 1e6;
    }
    return navigator.connection && ((l = navigator.connection.downlink), typeof l == "number")
      ? l
      : 5;
  }
  var f0 = null,
    s0 = null;
  function un(l) {
    return l.nodeType === 9 ? l : l.ownerDocument;
  }
  function Ar(l) {
    switch (l) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function pr(l, t) {
    if (l === 0)
      switch (t) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return l === 1 && t === "foreignObject" ? 0 : l;
  }
  function Or(l, t, e, a) {
    return ((e = un(e).createElement(l)), (e[Ql] = a), (e[it] = t), $l(e, l, t), Zl(e), e);
  }
  function o0(l, t) {
    return (
      l === "textarea" ||
      l === "noscript" ||
      typeof t.children == "string" ||
      typeof t.children == "number" ||
      typeof t.children == "bigint" ||
      (typeof t.dangerouslySetInnerHTML == "object" &&
        t.dangerouslySetInnerHTML !== null &&
        t.dangerouslySetInnerHTML.__html != null)
    );
  }
  var r0 = null;
  function Bv() {
    var l = window.event;
    return l && l.type === "popstate" ? (l === r0 ? !1 : ((r0 = l), !0)) : ((r0 = null), !1);
  }
  var d0 = typeof setTimeout == "function" ? setTimeout : void 0,
    Yv = typeof clearTimeout == "function" ? clearTimeout : void 0,
    _r = typeof Promise == "function" ? Promise : void 0,
    Nr = typeof requestAnimationFrame == "function" ? requestAnimationFrame : d0,
    Zv =
      typeof queueMicrotask == "function"
        ? queueMicrotask
        : typeof _r < "u"
          ? function (l) {
              return _r.resolve(null).then(l).catch(Lv);
            }
          : d0;
  function Lv(l) {
    setTimeout(function () {
      throw l;
    });
  }
  function Qe(l) {
    return l === "head";
  }
  function Mr(l, t) {
    var e = t,
      a = 0;
    do {
      var u = e.nextSibling;
      if ((l.removeChild(e), u && u.nodeType === 8))
        if (((e = u.data), e === "/$" || e === "/&")) {
          if (a === 0) {
            l.removeChild(u), mu(t);
            return;
          }
          a--;
        } else if (e === "$" || e === "$?" || e === "$~" || e === "$!" || e === "&") a++;
        else if (e === "html") E0(l.ownerDocument.documentElement);
        else if (e === "head") {
          (e = l.ownerDocument.head), E0(e);
          for (var n = e.firstChild; n; ) {
            var i = n.nextSibling,
              c = n.nodeName;
            n[zu] ||
              c === "SCRIPT" ||
              c === "STYLE" ||
              (c === "LINK" && n.rel.toLowerCase() === "stylesheet") ||
              e.removeChild(n),
              (n = i);
          }
        } else e === "body" && E0(l.ownerDocument.body);
      e = u;
    } while (e);
    mu(t);
  }
  function xr(l, t) {
    var e = l;
    l = 0;
    do {
      var a = e.nextSibling;
      if (
        (e.nodeType === 1
          ? t
            ? ((e._stashedDisplay = e.style.display), (e.style.display = "none"))
            : ((e.style.display = e._stashedDisplay || ""),
              e.getAttribute("style") === "" && e.removeAttribute("style"))
          : e.nodeType === 3 &&
            (t
              ? ((e._stashedText = e.nodeValue), (e.nodeValue = ""))
              : (e.nodeValue = e._stashedText || "")),
        a && a.nodeType === 8)
      )
        if (((e = a.data), e === "/$")) {
          if (l === 0) break;
          l--;
        } else (e !== "$" && e !== "$?" && e !== "$~" && e !== "$!") || l++;
      e = a;
    } while (e);
  }
  function Dr(l, t, e) {
    if (
      ((t = CSS.escape(t) !== t ? "r-" + btoa(t).replace(/=/g, "") : t),
      (l.style.viewTransitionName = t),
      e != null && (l.style.viewTransitionClass = e),
      (e = getComputedStyle(l)),
      e.display === "inline")
    ) {
      if (((t = l.getClientRects()), t.length === 1)) var a = 1;
      else
        for (var u = (a = 0); u < t.length; u++) {
          var n = t[u];
          0 < n.width && 0 < n.height && a++;
        }
      a === 1 &&
        ((l = l.style),
        (l.display = t.length === 1 ? "inline-block" : "block"),
        (l.marginTop = "-" + e.paddingTop),
        (l.marginBottom = "-" + e.paddingBottom));
    }
  }
  function Cr(l, t) {
    (l = l.style), (t = t.style);
    var e =
      t != null
        ? t.hasOwnProperty("viewTransitionName")
          ? t.viewTransitionName
          : t.hasOwnProperty("view-transition-name")
            ? t["view-transition-name"]
            : null
        : null;
    (l.viewTransitionName = e == null || typeof e == "boolean" ? "" : ("" + e).trim()),
      (e =
        t != null
          ? t.hasOwnProperty("viewTransitionClass")
            ? t.viewTransitionClass
            : t.hasOwnProperty("view-transition-class")
              ? t["view-transition-class"]
              : null
          : null),
      (l.viewTransitionClass = e == null || typeof e == "boolean" ? "" : ("" + e).trim()),
      l.display === "inline-block" &&
        (t == null
          ? (l.display = l.margin = "")
          : ((e = t.display),
            (l.display = e == null || typeof e == "boolean" ? "" : e),
            (e = t.margin),
            e != null
              ? (l.margin = e)
              : ((e = t.hasOwnProperty("marginTop") ? t.marginTop : t["margin-top"]),
                (l.marginTop = e == null || typeof e == "boolean" ? "" : e),
                (t = t.hasOwnProperty("marginBottom") ? t.marginBottom : t["margin-bottom"]),
                (l.marginBottom = t == null || typeof t == "boolean" ? "" : t))));
  }
  function Gv(l, t, e) {
    return (
      (e = e.ownerDocument.defaultView),
      {
        rect: l,
        abs: t.position === "absolute" || t.position === "fixed",
        clip:
          t.clipPath !== "none" ||
          t.overflow !== "visible" ||
          t.filter !== "none" ||
          t.mask !== "none" ||
          t.mask !== "none" ||
          t.borderRadius !== "0px",
        view: 0 <= l.bottom && 0 <= l.right && l.top <= e.innerHeight && l.left <= e.innerWidth,
      }
    );
  }
  function v0(l) {
    var t = l.getBoundingClientRect(),
      e = getComputedStyle(l);
    return Gv(t, e, l);
  }
  function Vv(l) {
    return l.documentElement.clientHeight;
  }
  function Xv(l) {
    this.addEventListener("load", l), this.addEventListener("error", l);
  }
  function Qv(l, t, e, a, u, n, i, c, f) {
    var h = t.nodeType === 9 ? t : t.ownerDocument;
    try {
      var S = h.startViewTransition({
        update: function () {
          var v = h.defaultView,
            g = v.navigation && v.navigation.transition,
            x = h.fonts.status;
          a();
          var j = [];
          if (
            (x === "loaded" && (Vv(h), h.fonts.status === "loading" && j.push(h.fonts.ready)),
            (x = j.length),
            l !== null)
          )
            for (var P = l.suspenseyImages, m = 0, r = 0; r < P.length; r++) {
              var y = P[r];
              if (!y.complete) {
                var A = y.getBoundingClientRect();
                if (0 < A.bottom && 0 < A.right && A.top < v.innerHeight && A.left < v.innerWidth) {
                  if (((m += Ir(y)), m > Zi)) {
                    j.length = x;
                    break;
                  }
                  (y = new Promise(Xv.bind(y))), j.push(y);
                }
              }
            }
          if (0 < j.length)
            return (
              (v = Promise.race([
                Promise.all(j),
                new Promise(function (R) {
                  return setTimeout(R, 500);
                }),
              ]).then(u, u)),
              (g ? Promise.allSettled([g.finished, v]) : v).then(n, n)
            );
          if ((u(), g)) return g.finished.then(n, n);
          n();
        },
        types: e,
      });
      h.__reactViewTransition = S;
      var p = [];
      return (
        S.ready.then(
          function () {
            for (
              var v = h.documentElement.getAnimations({ subtree: !0 }), g = 0;
              g < v.length;
              g++
            ) {
              var x = v[g],
                j = x.effect,
                P = j.pseudoElement;
              if (P != null && P.startsWith("::view-transition")) {
                p.push(x), (x = j.getKeyframes());
                for (var m = (P = void 0), r = !0, y = 0; y < x.length; y++) {
                  var A = x[y],
                    R = A.width;
                  if (P === void 0) P = R;
                  else if (P !== R) {
                    r = !1;
                    break;
                  }
                  if (((R = A.height), m === void 0)) m = R;
                  else if (m !== R) {
                    r = !1;
                    break;
                  }
                  delete A.width, delete A.height, A.transform === "none" && delete A.transform;
                }
                r &&
                  P !== void 0 &&
                  m !== void 0 &&
                  (j.setKeyframes(x),
                  (r = getComputedStyle(j.target, j.pseudoElement)),
                  r.width !== P || r.height !== m) &&
                  ((r = x[0]),
                  (r.width = P),
                  (r.height = m),
                  (r = x[x.length - 1]),
                  (r.width = P),
                  (r.height = m),
                  j.setKeyframes(x));
              }
            }
            i();
          },
          function (v) {
            h.__reactViewTransition === S && (h.__reactViewTransition = null);
            try {
              if (typeof v == "object" && v !== null)
                switch (v.name) {
                  case "InvalidStateError":
                    (v.message ===
                      "View transition was skipped because document visibility state is hidden." ||
                      v.message ===
                        "Skipping view transition because document visibility state has become hidden." ||
                      v.message === "Skipping view transition because viewport size changed." ||
                      v.message === "Transition was aborted because of invalid state") &&
                      (v = null);
                }
              v !== null && f(v);
            } finally {
              a(), u(), i();
            }
          },
        ),
        S.finished.finally(function () {
          for (var v = 0; v < p.length; v++) p[v].cancel();
          h.__reactViewTransition === S && (h.__reactViewTransition = null), c();
        }),
        S
      );
    } catch {
      return (a(), u(), i(), null);
    }
  }
  function Ta(l, t) {
    (this._scope = document.documentElement),
      (this._selector = "::view-transition-" + l + "(" + t + ")");
  }
  (Ta.prototype.animate = function (l, t) {
    return (
      (t = typeof t == "number" ? { duration: t } : V({}, t)),
      (t.pseudoElement = this._selector),
      this._scope.animate(l, t)
    );
  }),
    (Ta.prototype.getAnimations = function () {
      for (
        var l = this._scope,
          t = this._selector,
          e = l.getAnimations({ subtree: !0 }),
          a = [],
          u = 0;
        u < e.length;
        u++
      ) {
        var n = e[u].effect;
        n !== null && n.target === l && n.pseudoElement === t && a.push(e[u]);
      }
      return a;
    }),
    (Ta.prototype.getComputedStyle = function () {
      return getComputedStyle(this._scope, this._selector);
    });
  function Ur(l) {
    return {
      name: l,
      group: new Ta("group", l),
      imagePair: new Ta("image-pair", l),
      old: new Ta("old", l),
      new: new Ta("new", l),
    };
  }
  function pt(l) {
    (this._fragmentFiber = l), (this._observers = this._eventListeners = null);
  }
  pt.prototype.addEventListener = function (l, t, e) {
    var a = null,
      u = null;
    if (
      !(e != null && typeof e != "boolean" && ((a = e.signal || null), a !== null && a.aborted))
    ) {
      this._eventListeners === null && (this._eventListeners = []);
      var n = this._eventListeners;
      if (Hr(n, l, t, e) === -1) {
        var i = this,
          c = t;
        e != null &&
          typeof e != "boolean" &&
          e.once === !0 &&
          (c = function (f) {
            i.removeEventListener(l, t, e),
              typeof t == "function" ? t.call(this, f) : t.handleEvent(f);
          }),
          a !== null &&
            ((u = i.removeEventListener.bind(i, l, t, e)),
            a.addEventListener("abort", u, { once: !0 }),
            (u = a.removeEventListener.bind(a, "abort", u))),
          (a = fu(e)),
          n.push({ type: l, listener: t, optionsOrUseCapture: e, attachedListener: c, cleanup: u }),
          T(this._fragmentFiber.child, !1, wv, l, c, a);
      }
      this._eventListeners = n;
    }
  };
  function wv(l, t, e, a) {
    return (k(l).addEventListener(t, e, a), !1);
  }
  pt.prototype.removeEventListener = function (l, t, e) {
    var a = this._eventListeners;
    if (a !== null && ((t = Hr(a, l, t, e)), t !== -1)) {
      var u = a[t];
      e = u.attachedListener;
      var n = u.cleanup;
      (u = fu(u.optionsOrUseCapture)),
        T(this._fragmentFiber.child, !1, Kv, l, e, u),
        a.splice(t, 1),
        n !== null && n();
    }
  };
  function Kv(l, t, e, a) {
    return (k(l).removeEventListener(t, e, a), !1);
  }
  function fu(l) {
    return l != null && typeof l != "boolean" && (l.once === !0 || l.signal instanceof AbortSignal)
      ? { capture: l.capture, passive: l.passive }
      : l;
  }
  function Rr(l) {
    return l == null
      ? "c=0"
      : typeof l == "boolean"
        ? "c=" + (l ? "1" : "0")
        : "c=" + (l.capture ? "1" : "0");
  }
  function Hr(l, t, e, a) {
    if (l.length === 0) return -1;
    a = Rr(a);
    for (var u = 0; u < l.length; u++) {
      var n = l[u];
      if (n.type === t && n.listener === e && Rr(n.optionsOrUseCapture) === a) return u;
    }
    return -1;
  }
  (pt.prototype.dispatchEvent = function (l) {
    var t = C(this._fragmentFiber);
    if (t === null) return !0;
    t = k(t);
    var e = this._eventListeners;
    if ((e !== null && 0 < e.length) || !l.bubbles) {
      var a = t.nodeType === 9 ? t.createComment("") : document.createTextNode("");
      if (e)
        for (var u = 0; u < e.length; u++) {
          var n = e[u];
          a.addEventListener(n.type, n.attachedListener, fu(n.optionsOrUseCapture));
        }
      if ((t.appendChild(a), (l = a.dispatchEvent(l)), e))
        for (u = 0; u < e.length; u++)
          (n = e[u]), a.removeEventListener(n.type, n.attachedListener, fu(n.optionsOrUseCapture));
      return (t.removeChild(a), l);
    }
    return t.dispatchEvent(l);
  }),
    (pt.prototype.focus = function (l) {
      T(this._fragmentFiber.child, !0, jr, l, void 0, void 0);
    });
  function jr(l, t) {
    return l.tag === 6 ? !1 : ((l = k(l)), um(l, t));
  }
  pt.prototype.focusLast = function (l) {
    var t = [];
    T(this._fragmentFiber.child, !0, m0, t, void 0, void 0);
    for (var e = t.length - 1; 0 <= e && !jr(t[e], l); e--);
  };
  function m0(l, t) {
    return (t.push(l), !1);
  }
  pt.prototype.blur = function () {
    var l = C(this._fragmentFiber);
    l !== null &&
      ((l = k(l)),
      (l = un(l).activeElement),
      l !== null && T(this._fragmentFiber.child, !1, Jv, l, void 0, void 0));
  };
  function Jv(l, t) {
    return l.tag === 6 ? !1 : ((l = k(l)), l === t || l.contains(t) ? (t.blur(), !0) : !1);
  }
  pt.prototype.observeUsing = function (l) {
    this._observers === null && (this._observers = new Set()),
      this._observers.add(l),
      T(this._fragmentFiber.child, !1, Fv, l, void 0, void 0);
  };
  function Fv(l, t) {
    return (l.tag === 6 || ((l = k(l)), t.observe(l)), !1);
  }
  pt.prototype.unobserveUsing = function (l) {
    var t = this._observers;
    if (t !== null && t.has(l)) {
      t.delete(l), T(this._fragmentFiber.child, !1, $v, l, void 0, void 0);
      for (var e = (t = 0); e < Vt.length; e++) {
        var a = Vt[e];
        a.fragmentInstance === this && a.observer === l ? l.unobserve(a.instance) : (Vt[t++] = a);
      }
      Vt.length = t;
    }
  };
  function $v(l, t) {
    return (l.tag === 6 || ((l = k(l)), t.unobserve(l)), !1);
  }
  var Vt = [],
    h0 = !1;
  function Wv(l, t, e) {
    Vt.push({ fragmentInstance: l, observer: t, instance: e }),
      h0 ||
        ((h0 = !0),
        nm(function () {
          h0 = !1;
          var a = Vt;
          Vt = [];
          for (var u = 0; u < a.length; u++) {
            var n = a[u];
            n.observer.unobserve(n.instance);
          }
        }));
  }
  pt.prototype.getClientRects = function () {
    var l = [];
    return (T(this._fragmentFiber.child, !1, kv, l, void 0, void 0), l);
  };
  function kv(l, t) {
    if (l.tag === 6) {
      l = l.stateNode;
      var e = l.ownerDocument.createRange();
      e.selectNodeContents(l), t.push.apply(t, e.getClientRects());
    } else (l = k(l)), t.push.apply(t, l.getClientRects());
    return !1;
  }
  (pt.prototype.getRootNode = function (l) {
    var t = C(this._fragmentFiber);
    return t === null ? this : k(t).getRootNode(l);
  }),
    (pt.prototype.compareDocumentPosition = function (l) {
      var t = C(this._fragmentFiber);
      if (t === null) return Node.DOCUMENT_POSITION_DISCONNECTED;
      var e = [];
      T(this._fragmentFiber.child, !1, m0, e, void 0, void 0);
      var a = k(t);
      if (e.length === 0) {
        if (((e = a), fl(this._fragmentFiber))) {
          l: {
            for (t = this._fragmentFiber.return; t !== null; ) {
              if (t.tag === 4) {
                t = t.stateNode.containerInfo;
                break l;
              }
              if (t.tag === 3 || t.tag === 5 || t.tag === 27) break;
              t = t.return;
            }
            t = null;
          }
          t != null && (e = t);
        }
        t = this._fragmentFiber;
        var u = (a = e.compareDocumentPosition(l));
        return (
          e === l
            ? (u = Node.DOCUMENT_POSITION_CONTAINS)
            : a & Node.DOCUMENT_POSITION_CONTAINED_BY &&
              ((e = W(t)[1]),
              e === null
                ? (u = Node.DOCUMENT_POSITION_PRECEDING)
                : ((l = k(e).compareDocumentPosition(l)),
                  (u =
                    l === 0 || l & Node.DOCUMENT_POSITION_FOLLOWING
                      ? Node.DOCUMENT_POSITION_FOLLOWING
                      : Node.DOCUMENT_POSITION_PRECEDING))),
          (u |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC)
        );
      }
      (t = k(e[0])), (u = k(e[e.length - 1]));
      var n = fl(this._fragmentFiber) ? t.parentElement : a;
      if (n == null) return Node.DOCUMENT_POSITION_DISCONNECTED;
      (a = n.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_CONTAINED_BY),
        (n = n.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_CONTAINED_BY);
      var i = t.compareDocumentPosition(l),
        c = u.compareDocumentPosition(l),
        f = i & Node.DOCUMENT_POSITION_CONTAINED_BY || c & Node.DOCUMENT_POSITION_CONTAINED_BY;
      return (
        (c =
          a && n && i & Node.DOCUMENT_POSITION_FOLLOWING && c & Node.DOCUMENT_POSITION_PRECEDING),
        (t =
          (a && t === l) || (n && u === l) || f || c
            ? Node.DOCUMENT_POSITION_CONTAINED_BY
            : (!a && t === l) || (!n && u === l)
              ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC
              : i),
        t & Node.DOCUMENT_POSITION_DISCONNECTED ||
        t & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
        Iv(t, this._fragmentFiber, e[0], e[e.length - 1], l)
          ? t
          : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC
      );
    });
  function Iv(l, t, e, a, u) {
    var n = la(u);
    if (l & Node.DOCUMENT_POSITION_CONTAINED_BY) {
      if ((e = !!n))
        l: {
          for (; n !== null; ) {
            if (n.tag === 7 && (n === t || n.alternate === t)) {
              e = !0;
              break l;
            }
            n = n.return;
          }
          e = !1;
        }
      return e;
    }
    if (l & Node.DOCUMENT_POSITION_CONTAINS) {
      if (n === null)
        return ((n = u.ownerDocument), u === n || u === n.documentElement || u === n.body);
      l: {
        for (n = t, t = C(t); n !== null; ) {
          if (!((n.tag !== 5 && n.tag !== 3 && n.tag !== 27) || (n !== t && n.alternate !== t))) {
            n = !0;
            break l;
          }
          n = n.return;
        }
        n = !1;
      }
      return n;
    }
    return l & Node.DOCUMENT_POSITION_PRECEDING
      ? ((t = !!n) &&
          !(t = n === e) &&
          ((t = il(e, n, ll)),
          t === null ? (t = !1) : (T(t, !0, lt, n, e), (n = Dl), (Dl = null), (t = n !== null))),
        t)
      : l & Node.DOCUMENT_POSITION_FOLLOWING
        ? ((t = !!n) &&
            !(t = n === a) &&
            ((t = il(a, n, ll)),
            t === null
              ? (t = !1)
              : (T(t, !0, Q, n, a), (n = Dl), (Pl = Dl = null), (t = n !== null))),
          t)
        : !1;
  }
  function qr(l, t) {
    var e = l.ownerDocument.createRange();
    e.selectNodeContents(l),
      (l = e.getBoundingClientRect()),
      window.scrollTo(
        window.scrollX + l.left,
        t ? window.scrollY + l.top : window.scrollY + l.bottom - window.innerHeight,
      );
  }
  pt.prototype.scrollIntoView = function (l) {
    if (typeof l == "object") throw Error(o(566));
    var t = [];
    T(this._fragmentFiber.child, !1, m0, t, void 0, void 0);
    var e = l !== !1;
    if (t.length === 0) {
      var a = W(this._fragmentFiber);
      if (((a = e ? a[1] || a[0] || C(this._fragmentFiber) : a[0] || a[1]), a === null)) return;
      if (a.tag === 6) {
        (l = k(a)), qr(l, e);
        return;
      }
      if (((a = k(a)), a.nodeType !== 9)) {
        if (a.nodeType === 11) {
          (e = "host" in a ? a.host : null), e !== null && e.scrollIntoView(l);
          return;
        }
        a.scrollIntoView(l);
      }
    }
    for (a = e ? t.length - 1 : 0; a !== (e ? -1 : t.length); ) {
      var u = t[a];
      u.tag === 6 ? ((u = k(u)), qr(u, e)) : k(u).scrollIntoView(l), (a += e ? -1 : 1);
    }
  };
  function Pv(l, t) {
    return ((l = k(l)), Br(l, t), !1);
  }
  function Br(l, t) {
    l.reactFragments == null && (l.reactFragments = new Set()), l.reactFragments.add(t);
  }
  function Yr(l, t) {
    var e = t._eventListeners;
    if (e !== null)
      for (var a = 0; a < e.length; a++) {
        var u = e[a];
        l.addEventListener(u.type, u.attachedListener, fu(u.optionsOrUseCapture));
      }
    l.nodeType !== 3 &&
      ((e = t._observers),
      e !== null &&
        e.forEach(function (n) {
          for (var i = 0, c = 0; c < Vt.length; c++) {
            var f = Vt[c];
            (f.fragmentInstance !== t || f.observer !== n || f.instance !== l) && (Vt[i++] = f);
          }
          (Vt.length = i), n.observe(l);
        }),
      Br(l, t));
  }
  function lm(l, t) {
    var e = t._eventListeners;
    if (e !== null)
      for (var a = 0; a < e.length; a++) {
        var u = e[a];
        l.removeEventListener(u.type, u.attachedListener, fu(u.optionsOrUseCapture));
      }
    l.nodeType !== 3 &&
      ((e = t._observers),
      e !== null &&
        e.forEach(function (n) {
          typeof n.rootMargin == "string" ? Wv(t, n, l) : n.unobserve(l);
        }),
      l.reactFragments != null && l.reactFragments.delete(t));
  }
  function y0(l) {
    var t = l.firstChild;
    for (t && t.nodeType === 10 && (t = t.nextSibling); t; ) {
      var e = t;
      switch (((t = t.nextSibling), e.nodeName)) {
        case "HTML":
        case "HEAD":
        case "BODY":
          y0(e), Nn(e);
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (e.rel.toLowerCase() === "stylesheet") continue;
      }
      l.removeChild(e);
    }
  }
  function tm(l, t, e, a) {
    for (; l.nodeType === 1; ) {
      var u = e;
      if (l.nodeName.toLowerCase() !== t.toLowerCase()) {
        if (!a && (l.nodeName !== "INPUT" || l.type !== "hidden")) break;
      } else if (a) {
        if (!l[zu])
          switch (t) {
            case "meta":
              if (!l.hasAttribute("itemprop")) break;
              return l;
            case "link":
              if (
                ((n = l.getAttribute("rel")),
                n === "stylesheet" && l.hasAttribute("data-precedence"))
              )
                break;
              if (
                n !== u.rel ||
                l.getAttribute("href") !== (u.href == null || u.href === "" ? null : u.href) ||
                l.getAttribute("crossorigin") !== (u.crossOrigin == null ? null : u.crossOrigin) ||
                l.getAttribute("title") !== (u.title == null ? null : u.title)
              )
                break;
              return l;
            case "style":
              if (l.hasAttribute("data-precedence")) break;
              return l;
            case "script":
              if (
                ((n = l.getAttribute("src")),
                (n !== (u.src == null ? null : u.src) ||
                  l.getAttribute("type") !== (u.type == null ? null : u.type) ||
                  l.getAttribute("crossorigin") !==
                    (u.crossOrigin == null ? null : u.crossOrigin)) &&
                  n &&
                  l.hasAttribute("async") &&
                  !l.hasAttribute("itemprop"))
              )
                break;
              return l;
            default:
              return l;
          }
      } else if (t === "input" && l.type === "hidden") {
        var n = u.name == null ? null : "" + u.name;
        if (u.type === "hidden" && l.getAttribute("name") === n) return l;
      } else return l;
      if (((l = Ht(l.nextSibling)), l === null)) break;
    }
    return null;
  }
  function em(l, t, e) {
    if (t === "") return null;
    for (; l.nodeType !== 3; )
      if (
        ((l.nodeType !== 1 || l.nodeName !== "INPUT" || l.type !== "hidden") && !e) ||
        ((l = Ht(l.nextSibling)), l === null)
      )
        return null;
    return l;
  }
  function Zr(l, t) {
    for (; l.nodeType !== 8; )
      if (
        ((l.nodeType !== 1 || l.nodeName !== "INPUT" || l.type !== "hidden") && !t) ||
        ((l = Ht(l.nextSibling)), l === null)
      )
        return null;
    return l;
  }
  function g0(l) {
    return l.data === "$?" || l.data === "$~";
  }
  function S0(l) {
    return l.data === "$!" || (l.data === "$?" && l.ownerDocument.readyState !== "loading");
  }
  function am(l, t) {
    var e = l.ownerDocument;
    if (l.data === "$~") l._reactRetry = t;
    else if (l.data !== "$?" || e.readyState !== "loading") t();
    else {
      var a = function () {
        t(), e.removeEventListener("DOMContentLoaded", a);
      };
      e.addEventListener("DOMContentLoaded", a), (l._reactRetry = a);
    }
  }
  function Ht(l) {
    for (; l != null; l = l.nextSibling) {
      var t = l.nodeType;
      if (t === 1 || t === 3) break;
      if (t === 8) {
        if (
          ((t = l.data),
          t === "$" ||
            t === "$!" ||
            t === "$?" ||
            t === "$~" ||
            t === "&" ||
            t === "F!" ||
            t === "F")
        )
          break;
        if (t === "/$" || t === "/&") return null;
      }
    }
    return l;
  }
  var b0 = null;
  function Lr(l) {
    l = l.nextSibling;
    for (var t = 0; l; ) {
      if (l.nodeType === 8) {
        var e = l.data;
        if (e === "/$" || e === "/&") {
          if (t === 0) return Ht(l.nextSibling);
          t--;
        } else (e !== "$" && e !== "$!" && e !== "$?" && e !== "$~" && e !== "&") || t++;
      }
      l = l.nextSibling;
    }
    return null;
  }
  function Gr(l) {
    l = l.previousSibling;
    for (var t = 0; l; ) {
      if (l.nodeType === 8) {
        var e = l.data;
        if (e === "$" || e === "$!" || e === "$?" || e === "$~" || e === "&") {
          if (t === 0) return l;
          t--;
        } else (e !== "/$" && e !== "/&") || t++;
      }
      l = l.previousSibling;
    }
    return null;
  }
  function um(l, t) {
    function e() {
      a = !0;
    }
    if (l.ownerDocument.activeElement === l) return !0;
    var a = !1;
    try {
      l.ownerDocument.addEventListener("focus", e, !0),
        (l.focus || HTMLElement.prototype.focus).call(l, t);
    } finally {
      l.ownerDocument.removeEventListener("focus", e, !0);
    }
    return a;
  }
  function nm(l) {
    Nr(function () {
      Nr(function (t) {
        return l(t);
      });
    });
  }
  function Vr(l, t, e) {
    switch (((t = un(e)), l)) {
      case "html":
        if (((l = t.documentElement), !l)) throw Error(o(452));
        return l;
      case "head":
        if (((l = t.head), !l)) throw Error(o(453));
        return l;
      case "body":
        if (((l = t.body), !l)) throw Error(o(454));
        return l;
      default:
        throw Error(o(451));
    }
  }
  function Xr(l, t, e) {
    for (var a in e) {
      var u = e[a];
      e.hasOwnProperty(a) && u != null && bl(l, t, a, null, Hv, u);
    }
    e.dangerouslySetInnerHTML != null && (l.textContent = ""),
      l.onclick === wt && (l.onclick = null),
      Nn(l);
  }
  function E0(l) {
    for (var t = l.attributes; t.length; ) l.removeAttributeNode(t[0]);
    Nn(l);
  }
  var jt = new Map(),
    Qr = new Set();
  function nn(l) {
    if (typeof l.getRootNode == "function") {
      var t = l.getRootNode();
      if (t.nodeType === 9 || t.nodeType === 11) return t;
    }
    return l.nodeType === 9 ? l : l.ownerDocument;
  }
  var be = J.d;
  J.d = { f: im, r: cm, D: fm, C: sm, L: om, m: rm, X: vm, S: dm, M: mm };
  function im() {
    var l = be.f(),
      t = Di();
    return l || t;
  }
  function cm(l) {
    var t = Na(l);
    t !== null && t.tag === 5 && t.type === "form" ? ws(t) : be.r(l);
  }
  var su = typeof document > "u" ? null : document;
  function wr(l, t, e) {
    var a = su;
    if (a && typeof t == "string" && t) {
      var u = Nt(t);
      (u = 'link[rel="' + l + '"][href="' + u + '"]'),
        typeof e == "string" && (u += '[crossorigin="' + e + '"]'),
        Qr.has(u) ||
          (Qr.add(u),
          (l = { rel: l, crossOrigin: e, href: t }),
          a.querySelector(u) === null &&
            ((t = a.createElement("link")), $l(t, "link", l), Zl(t), a.head.appendChild(t)));
    }
  }
  function fm(l) {
    be.D(l), wr("dns-prefetch", l, null);
  }
  function sm(l, t) {
    be.C(l, t), wr("preconnect", l, t);
  }
  function om(l, t, e) {
    be.L(l, t, e);
    var a = su;
    if (a && l && t) {
      var u = 'link[rel="preload"][as="' + Nt(t) + '"]';
      t === "image" && e && e.imageSrcSet
        ? ((u += '[imagesrcset="' + Nt(e.imageSrcSet) + '"]'),
          typeof e.imageSizes == "string" && (u += '[imagesizes="' + Nt(e.imageSizes) + '"]'))
        : (u += '[href="' + Nt(l) + '"]');
      var n = u;
      switch (t) {
        case "style":
          n = ou(l);
          break;
        case "script":
          n = ru(l);
      }
      if (
        !(
          jt.has(n) ||
          ((l = V(
            { rel: "preload", href: t === "image" && e && e.imageSrcSet ? void 0 : l, as: t },
            e,
          )),
          jt.set(n, l),
          a.querySelector(u) !== null ||
            (t === "style" && a.querySelector(cn(n))) ||
            (t === "script" && a.querySelector(fn(n))))
        )
      ) {
        var i = a.createElement("link");
        $l(i, "link", l),
          t === "style" &&
            ((i[_n] = !0),
            (i.onload = i.onerror =
              function () {
                a1(i);
              })),
          Zl(i),
          a.head.appendChild(i);
      }
    }
  }
  function rm(l, t) {
    be.m(l, t);
    var e = su;
    if (e && l) {
      var a = t && typeof t.as == "string" ? t.as : "script",
        u = 'link[rel="modulepreload"][as="' + Nt(a) + '"][href="' + Nt(l) + '"]',
        n = u;
      switch (a) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          n = ru(l);
      }
      if (
        !jt.has(n) &&
        ((l = V({ rel: "modulepreload", href: l }, t)), jt.set(n, l), e.querySelector(u) === null)
      ) {
        switch (a) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (e.querySelector(fn(n))) return;
        }
        (a = e.createElement("link")), $l(a, "link", l), Zl(a), e.head.appendChild(a);
      }
    }
  }
  function dm(l, t, e) {
    be.S(l, t, e);
    var a = su;
    if (a && l) {
      var u = Ma(a).hoistableStyles,
        n = ou(l);
      t = t || "default";
      var i = u.get(n);
      if (!i) {
        var c = { loading: 0, preload: null };
        if ((i = a.querySelector(cn(n)))) c.loading = 5;
        else {
          (l = V({ rel: "stylesheet", href: l, "data-precedence": t }, e)),
            (e = jt.get(n)) && T0(l, e);
          var f = (i = a.createElement("link"));
          Zl(f),
            $l(f, "link", l),
            (f._p = new Promise(function (h, S) {
              (f.onload = h), (f.onerror = S);
            })),
            f.addEventListener("load", function () {
              c.loading |= 1;
            }),
            f.addEventListener("error", function () {
              c.loading |= 2;
            }),
            (c.loading |= 4),
            Bi(i, t, a);
        }
        (i = { type: "stylesheet", instance: i, count: 1, state: c }), u.set(n, i);
      }
    }
  }
  function vm(l, t) {
    be.X(l, t);
    var e = su;
    if (e && l) {
      var a = Ma(e).hoistableScripts,
        u = ru(l),
        n = a.get(u);
      n ||
        ((n = e.querySelector(fn(u))),
        n ||
          ((l = V({ src: l, async: !0 }, t)),
          (t = jt.get(u)) && z0(l, t),
          (n = e.createElement("script")),
          Zl(n),
          $l(n, "link", l),
          e.head.appendChild(n)),
        (n = { type: "script", instance: n, count: 1, state: null }),
        a.set(u, n));
    }
  }
  function mm(l, t) {
    be.M(l, t);
    var e = su;
    if (e && l) {
      var a = Ma(e).hoistableScripts,
        u = ru(l),
        n = a.get(u);
      n ||
        ((n = e.querySelector(fn(u))),
        n ||
          ((l = V({ src: l, async: !0, type: "module" }, t)),
          (t = jt.get(u)) && z0(l, t),
          (n = e.createElement("script")),
          Zl(n),
          $l(n, "link", l),
          e.head.appendChild(n)),
        (n = { type: "script", instance: n, count: 1, state: null }),
        a.set(u, n));
    }
  }
  function Kr(l, t, e, a) {
    var u = (u = Te.current) ? nn(u) : null;
    if (!u) throw Error(o(446));
    switch (l) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof e.precedence == "string" && typeof e.href == "string"
          ? ((e = ou(e.href)),
            (t = Ma(u).hoistableStyles),
            (a = t.get(e)),
            a || ((a = { type: "style", instance: null, count: 0, state: null }), t.set(e, a)),
            a)
          : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (
          e.rel === "stylesheet" &&
          typeof e.href == "string" &&
          typeof e.precedence == "string"
        ) {
          l = ou(e.href);
          var n = Ma(u).hoistableStyles,
            i = n.get(l);
          if (
            (i ||
              ((u = u.ownerDocument || u),
              (i = {
                type: "stylesheet",
                instance: null,
                count: 0,
                state: { loading: 0, preload: null },
              }),
              n.set(l, i),
              (n = u.querySelector(cn(l)))
                ? n._p || ((i.instance = n), (i.state.loading = 5))
                : ((n = jt.get(l)),
                  n ||
                    ((n = {
                      rel: "preload",
                      as: "style",
                      href: e.href,
                      crossOrigin: e.crossOrigin,
                      integrity: e.integrity,
                      media: e.media,
                      hrefLang: e.hrefLang,
                      referrerPolicy: e.referrerPolicy,
                    }),
                    jt.set(l, n)),
                  hm(u, l, n, i.state))),
            t && a === null)
          )
            throw Error(o(528, ""));
          return i;
        }
        if (t && a !== null) throw Error(o(529, ""));
        return null;
      case "script":
        return (
          (t = e.async),
          (e = e.src),
          typeof e == "string" && t && typeof t != "function" && typeof t != "symbol"
            ? ((e = ru(e)),
              (t = Ma(u).hoistableScripts),
              (a = t.get(e)),
              a || ((a = { type: "script", instance: null, count: 0, state: null }), t.set(e, a)),
              a)
            : { type: "void", instance: null, count: 0, state: null }
        );
      default:
        throw Error(o(444, l));
    }
  }
  function ou(l) {
    return 'href="' + Nt(l) + '"';
  }
  function cn(l) {
    return 'link[rel="stylesheet"][' + l + "]";
  }
  function Jr(l) {
    return V({}, l, { "data-precedence": l.precedence, precedence: null });
  }
  function hm(l, t, e, a) {
    if ((t = l.querySelector('link[rel="preload"][as="style"][' + t + "]"))) {
      if (t[_n] !== !0) {
        a.loading = 1;
        return;
      }
    } else
      (t = l.createElement("link")),
        (t[_n] = !0),
        (t.onload = t.onerror = a1.bind(null, t)),
        $l(t, "link", e),
        Zl(t),
        l.head.appendChild(t);
    (a.preload = t),
      t.addEventListener("load", function () {
        return (a.loading |= 1);
      }),
      t.addEventListener("error", function () {
        return (a.loading |= 2);
      });
  }
  function ru(l) {
    return '[src="' + Nt(l) + '"]';
  }
  function fn(l) {
    return "script[async]" + l;
  }
  function Fr(l, t, e) {
    if ((t.count++, t.instance === null))
      switch (t.type) {
        case "style":
          var a = l.querySelector('style[data-href~="' + Nt(e.href) + '"]');
          if (a) return ((t.instance = a), Zl(a), a);
          var u = V({}, e, {
            "data-href": e.href,
            "data-precedence": e.precedence,
            href: null,
            precedence: null,
          });
          return (
            (a = (l.ownerDocument || l).createElement("style")),
            Zl(a),
            $l(a, "style", u),
            Bi(a, e.precedence, l),
            (t.instance = a)
          );
        case "stylesheet":
          u = ou(e.href);
          var n = l.querySelector(cn(u));
          if (n) return ((t.state.loading |= 4), (t.instance = n), Zl(n), n);
          (a = Jr(e)),
            (u = jt.get(u)) && T0(a, u),
            (n = (l.ownerDocument || l).createElement("link")),
            Zl(n);
          var i = n;
          return (
            (i._p = new Promise(function (c, f) {
              (i.onload = c), (i.onerror = f);
            })),
            $l(n, "link", a),
            (t.state.loading |= 4),
            Bi(n, e.precedence, l),
            (t.instance = n)
          );
        case "script":
          return (
            (n = ru(e.src)),
            (u = l.querySelector(fn(n)))
              ? ((t.instance = u), Zl(u), u)
              : ((a = e),
                (u = jt.get(n)) && ((a = V({}, e)), z0(a, u)),
                (l = l.ownerDocument || l),
                (u = l.createElement("script")),
                Zl(u),
                $l(u, "link", a),
                l.head.appendChild(u),
                (t.instance = u))
          );
        case "void":
          return null;
        default:
          throw Error(o(443, t.type));
      }
    else
      t.type === "stylesheet" &&
        (t.state.loading & 4) === 0 &&
        ((a = t.instance), (t.state.loading |= 4), Bi(a, e.precedence, l));
    return t.instance;
  }
  function Bi(l, t, e) {
    for (
      var a = e.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),
        u = a.length ? a[a.length - 1] : null,
        n = u,
        i = 0;
      i < a.length;
      i++
    ) {
      var c = a[i];
      if (c.dataset.precedence === t) n = c;
      else if (n !== u) break;
    }
    n
      ? n.parentNode.insertBefore(l, n.nextSibling)
      : ((t = e.nodeType === 9 ? e.head : e), t.insertBefore(l, t.firstChild));
  }
  function T0(l, t) {
    l.crossOrigin == null && (l.crossOrigin = t.crossOrigin),
      l.referrerPolicy == null && (l.referrerPolicy = t.referrerPolicy),
      l.title == null && (l.title = t.title);
  }
  function z0(l, t) {
    l.crossOrigin == null && (l.crossOrigin = t.crossOrigin),
      l.referrerPolicy == null && (l.referrerPolicy = t.referrerPolicy),
      l.integrity == null && (l.integrity = t.integrity);
  }
  var Yi = null;
  function $r(l, t, e) {
    if (Yi === null) {
      var a = new Map(),
        u = (Yi = new Map());
      u.set(e, a);
    } else (u = Yi), (a = u.get(e)), a || ((a = new Map()), u.set(e, a));
    if (a.has(l)) return a;
    for (a.set(l, null), e = e.getElementsByTagName(l), u = 0; u < e.length; u++) {
      var n = e[u];
      if (
        !(n[zu] || n[Ql] || (l === "link" && n.getAttribute("rel") === "stylesheet")) &&
        n.namespaceURI !== "http://www.w3.org/2000/svg"
      ) {
        var i = n.getAttribute(t) || "";
        i = l + i;
        var c = a.get(i);
        c ? c.push(n) : a.set(i, [n]);
      }
    }
    return a;
  }
  function A0(l, t, e) {
    (l = l.ownerDocument || l),
      l.head.insertBefore(e, t === "title" ? l.querySelector("head > title") : null);
  }
  function ym(l, t, e) {
    if (e === 1 || t.itemProp != null) return !1;
    switch (l) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
        return !0;
      case "link":
        if (
          typeof t.rel != "string" ||
          typeof t.href != "string" ||
          t.href === "" ||
          t.onLoad ||
          t.onError
        )
          break;
        switch (t.rel) {
          case "stylesheet":
            return ((l = t.disabled), typeof t.precedence == "string" && l == null);
          default:
            return !0;
        }
      case "script":
        if (
          t.async &&
          typeof t.async != "function" &&
          typeof t.async != "symbol" &&
          !t.onLoad &&
          !t.onError &&
          t.src &&
          typeof t.src == "string"
        )
          return !0;
    }
    return !1;
  }
  function Wr(l, t) {
    return l === "img" && t.src != null && t.src !== "" && t.onLoad == null && t.loading !== "lazy";
  }
  function kr(l) {
    return !(l.type === "stylesheet" && (l.state.loading & 3) === 0);
  }
  function Ir(l) {
    return (
      (l.width || 100) *
      (l.height || 100) *
      (typeof devicePixelRatio == "number" ? devicePixelRatio : 1) *
      0.25
    );
  }
  function Pr(l, t) {
    typeof t.decode == "function" &&
      (l.imgCount++,
      t.complete || ((l.imgBytes += Ir(t)), l.suspenseyImages.push(t)),
      (l = bm.bind(l)),
      t.decode().then(l, l));
  }
  function gm(l, t, e, a) {
    if (
      e.type === "stylesheet" &&
      (typeof a.media != "string" || matchMedia(a.media).matches !== !1) &&
      (e.state.loading & 4) === 0
    ) {
      if (e.instance === null) {
        var u = ou(a.href),
          n = t.querySelector(cn(u));
        if (n) {
          (t = n._p),
            t !== null &&
              typeof t == "object" &&
              typeof t.then == "function" &&
              (l.count++, (l = sn.bind(l)), t.then(l, l)),
            (e.state.loading |= 4),
            (e.instance = n),
            Zl(n);
          return;
        }
        (n = t.ownerDocument || t),
          (a = Jr(a)),
          (u = jt.get(u)) && T0(a, u),
          (n = n.createElement("link")),
          Zl(n);
        var i = n;
        (i._p = new Promise(function (c, f) {
          (i.onload = c), (i.onerror = f);
        })),
          $l(n, "link", a),
          (e.instance = n);
      }
      l.stylesheets === null && (l.stylesheets = new Map()),
        l.stylesheets.set(e, t),
        (t = e.state.preload) &&
          (e.state.loading & 3) === 0 &&
          (l.count++,
          (e = sn.bind(l)),
          t.addEventListener("load", e),
          t.addEventListener("error", e));
    }
  }
  var Zi = 0;
  function Sm(l, t) {
    return (
      l.stylesheets && l.count === 0 && Gi(l, l.stylesheets),
      0 < l.count || 0 < l.imgCount
        ? function (e) {
            var a = setTimeout(function () {
              if ((l.stylesheets && Gi(l, l.stylesheets), l.unsuspend)) {
                var n = l.unsuspend;
                (l.unsuspend = null), n();
              }
            }, 6e4 + t);
            0 < l.imgBytes && Zi === 0 && (Zi = 62500 * qv());
            var u = setTimeout(
              function () {
                if (
                  ((l.waitingForImages = !1),
                  l.count === 0 && (l.stylesheets && Gi(l, l.stylesheets), l.unsuspend))
                ) {
                  var n = l.unsuspend;
                  (l.unsuspend = null), n();
                }
              },
              (l.imgBytes > Zi ? 50 : 800) + t,
            );
            return (
              (l.unsuspend = e),
              function () {
                (l.unsuspend = null), clearTimeout(a), clearTimeout(u);
              }
            );
          }
        : null
    );
  }
  function l2(l) {
    if (l.count === 0 && (l.imgCount === 0 || !l.waitingForImages)) {
      if (l.stylesheets) Gi(l, l.stylesheets);
      else if (l.unsuspend) {
        var t = l.unsuspend;
        (l.unsuspend = null), t();
      }
    }
  }
  function sn() {
    this.count--, l2(this);
  }
  function bm() {
    this.imgCount--, l2(this);
  }
  var Li = null;
  function Gi(l, t) {
    (l.stylesheets = null),
      l.unsuspend !== null &&
        (l.count++, (Li = new Map()), t.forEach(Em, l), (Li = null), sn.call(l));
  }
  function Em(l, t) {
    if (!(t.state.loading & 4)) {
      var e = Li.get(l);
      if (e) var a = e.get(null);
      else {
        (e = new Map()), Li.set(l, e);
        for (
          var u = l.querySelectorAll("link[data-precedence],style[data-precedence]"), n = 0;
          n < u.length;
          n++
        ) {
          var i = u[n];
          (i.nodeName === "LINK" || i.getAttribute("media") !== "not all") &&
            (e.set(i.dataset.precedence, i), (a = i));
        }
        a && e.set(null, a);
      }
      (u = t.instance),
        (i = u.getAttribute("data-precedence")),
        (n = e.get(i) || a),
        n === a && e.set(null, u),
        e.set(i, u),
        this.count++,
        (a = sn.bind(this)),
        u.addEventListener("load", a),
        u.addEventListener("error", a),
        n
          ? n.parentNode.insertBefore(u, n.nextSibling)
          : ((l = l.nodeType === 9 ? l.head : l), l.insertBefore(u, l.firstChild)),
        (t.state.loading |= 4);
    }
  }
  var du = {
    $$typeof: Yl,
    Provider: null,
    Consumer: null,
    _currentValue: ue,
    _currentValue2: ue,
    _threadCount: 0,
  };
  function Tm(l, t, e, a, u, n, i, c, f) {
    (this.tag = 1),
      (this.containerInfo = l),
      (this.pingCache = this.current = this.pendingChildren = null),
      (this.timeoutHandle = -1),
      (this.callbackNode =
        this.next =
        this.pendingContext =
        this.context =
        this.cancelPendingCommit =
          null),
      (this.callbackPriority = 0),
      (this.expirationTimes = ec(-1)),
      (this.entangledLanes =
        this.shellSuspendCounter =
        this.errorRecoveryDisabledLanes =
        this.expiredLanes =
        this.warmLanes =
        this.pingedLanes =
        this.suspendedLanes =
        this.pendingLanes =
          0),
      (this.entanglements = ec(0)),
      (this.hiddenUpdates = ec(null)),
      (this.identifierPrefix = a),
      (this.onUncaughtError = u),
      (this.onCaughtError = n),
      (this.onRecoverableError = i),
      (this.pooledCache = null),
      (this.pooledCacheLanes = 0),
      (this.formState = f),
      (this.transitionTypes = null),
      (this.incompleteTransitions = new Map());
  }
  function t2(l, t, e, a, u, n, i, c, f, h, S, p) {
    return (
      (l = new Tm(l, t, e, i, f, h, S, p, c)),
      (t = 1),
      n === !0 && (t |= 24),
      (n = ct(3, null, null, t)),
      (l.current = n),
      (n.stateNode = l),
      (t = Bc()),
      t.refCount++,
      (l.pooledCache = t),
      t.refCount++,
      (n.memoizedState = { element: a, isDehydrated: e, cache: t }),
      Gc(n),
      l
    );
  }
  function e2(l) {
    return l ? ((l = Ya), l) : Ya;
  }
  function a2(l, t, e, a, u, n) {
    (u = e2(u)),
      a.context === null ? (a.context = u) : (a.pendingContext = u),
      (a = Ue(t)),
      (a.payload = { element: e }),
      (n = n === void 0 ? null : n),
      n !== null && (a.callback = n),
      (e = Re(l, a, t)),
      e !== null && (rt(e, l, t), Zu(e, l, t));
  }
  function u2(l, t) {
    if (((l = l.memoizedState), l !== null && l.dehydrated !== null)) {
      var e = l.retryLane;
      l.retryLane = e !== 0 && e < t ? e : t;
    }
  }
  function p0(l, t) {
    u2(l, t), (l = l.alternate) && u2(l, t);
  }
  function n2(l) {
    if (l.tag === 13 || l.tag === 31) {
      var t = ua(l, 67108864);
      t !== null && rt(t, l, 67108864), p0(l, 67108864);
    }
  }
  function i2(l) {
    if (l.tag === 13 || l.tag === 31) {
      var t = At();
      t = ac(t);
      var e = ua(l, t);
      e !== null && rt(e, l, t), p0(l, t);
    }
  }
  var vu = !0;
  function zm(l, t, e, a) {
    var u = B.T;
    B.T = null;
    var n = J.p;
    try {
      (J.p = 2), O0(l, t, e, a);
    } finally {
      (J.p = n), (B.T = u);
    }
  }
  function Am(l, t, e, a) {
    var u = B.T;
    B.T = null;
    var n = J.p;
    try {
      (J.p = 8), O0(l, t, e, a);
    } finally {
      (J.p = n), (B.T = u);
    }
  }
  function O0(l, t, e, a) {
    if (vu) {
      var u = _0(a);
      if (u === null) i0(l, t, a, Vi, e), f2(l, a);
      else if (Om(u, l, t, e, a)) a.stopPropagation();
      else if ((f2(l, a), t & 4 && -1 < pm.indexOf(l))) {
        for (; u !== null; ) {
          var n = Na(u);
          if (n !== null)
            switch (n.tag) {
              case 3:
                if (((n = n.stateNode), n.current.memoizedState.isDehydrated)) {
                  var i = Pe(n.pendingLanes);
                  if (i !== 0) {
                    var c = n;
                    for (c.pendingLanes |= 2, c.entangledLanes |= 2; i; ) {
                      var f = 1 << (31 - yt(i));
                      (c.entanglements[1] |= f), (i &= ~f);
                    }
                    te(n), (ml & 6) === 0 && ((Ni = mt() + 500), tn(0));
                  }
                }
                break;
              case 31:
              case 13:
                (c = ua(n, 2)), c !== null && rt(c, n, 2), Di(), p0(n, 2);
            }
          if (((n = _0(a)), n === null && i0(l, t, a, Vi, e), n === u)) break;
          u = n;
        }
        u !== null && a.stopPropagation();
      } else i0(l, t, a, null, e);
    }
  }
  function _0(l) {
    return ((l = oc(l)), N0(l));
  }
  var Vi = null;
  function N0(l) {
    if (((Vi = null), (l = la(l)), l !== null)) {
      var t = M(l);
      if (t === null) l = null;
      else {
        var e = t.tag;
        if (e === 13) {
          if (((l = G(t)), l !== null)) return l;
          l = null;
        } else if (e === 31) {
          if (((l = H(t)), l !== null)) return l;
          l = null;
        } else if (e === 3) {
          if (t.stateNode.current.memoizedState.isDehydrated)
            return t.tag === 3 ? t.stateNode.containerInfo : null;
          l = null;
        } else t !== l && (l = null);
      }
    }
    return ((Vi = l), null);
  }
  function c2(l) {
    switch (l) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "fullscreenerror":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "resize":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (q2()) {
          case w0:
            return 2;
          case K0:
            return 8;
          case Tn:
          case B2:
            return 32;
          case J0:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var M0 = !1,
    we = null,
    Ke = null,
    Je = null,
    on = new Map(),
    rn = new Map(),
    Fe = [],
    pm =
      "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
        " ",
      );
  function f2(l, t) {
    switch (l) {
      case "focusin":
      case "focusout":
        we = null;
        break;
      case "dragenter":
      case "dragleave":
        Ke = null;
        break;
      case "mouseover":
      case "mouseout":
        Je = null;
        break;
      case "pointerover":
      case "pointerout":
        on.delete(t.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        rn.delete(t.pointerId);
    }
  }
  function dn(l, t, e, a, u, n) {
    return l === null || l.nativeEvent !== n
      ? ((l = {
          blockedOn: t,
          domEventName: e,
          eventSystemFlags: a,
          nativeEvent: n,
          targetContainers: [u],
        }),
        t !== null && ((t = Na(t)), t !== null && n2(t)),
        l)
      : ((l.eventSystemFlags |= a),
        (t = l.targetContainers),
        u !== null && t.indexOf(u) === -1 && t.push(u),
        l);
  }
  function Om(l, t, e, a, u) {
    switch (t) {
      case "focusin":
        return ((we = dn(we, l, t, e, a, u)), !0);
      case "dragenter":
        return ((Ke = dn(Ke, l, t, e, a, u)), !0);
      case "mouseover":
        return ((Je = dn(Je, l, t, e, a, u)), !0);
      case "pointerover":
        var n = u.pointerId;
        return (on.set(n, dn(on.get(n) || null, l, t, e, a, u)), !0);
      case "gotpointercapture":
        return ((n = u.pointerId), rn.set(n, dn(rn.get(n) || null, l, t, e, a, u)), !0);
    }
    return !1;
  }
  function s2(l) {
    var t = la(l.target);
    if (t !== null) {
      var e = M(t);
      if (e !== null) {
        if (((t = e.tag), t === 13)) {
          if (((t = G(e)), t !== null)) {
            (l.blockedOn = t),
              l1(l.priority, function () {
                i2(e);
              });
            return;
          }
        } else if (t === 31) {
          if (((t = H(e)), t !== null)) {
            (l.blockedOn = t),
              l1(l.priority, function () {
                i2(e);
              });
            return;
          }
        } else if (t === 3 && e.stateNode.current.memoizedState.isDehydrated) {
          l.blockedOn = e.tag === 3 ? e.stateNode.containerInfo : null;
          return;
        }
      }
    }
    l.blockedOn = null;
  }
  function Xi(l) {
    if (l.blockedOn !== null) return !1;
    for (var t = l.targetContainers; 0 < t.length; ) {
      var e = _0(l.nativeEvent);
      if (e === null) {
        e = l.nativeEvent;
        var a = new e.constructor(e.type, e);
        (sc = a), e.target.dispatchEvent(a), (sc = null);
      } else return ((t = Na(e)), t !== null && n2(t), (l.blockedOn = e), !1);
      t.shift();
    }
    return !0;
  }
  function o2(l, t, e) {
    Xi(l) && e.delete(t);
  }
  function _m() {
    (M0 = !1),
      we !== null && Xi(we) && (we = null),
      Ke !== null && Xi(Ke) && (Ke = null),
      Je !== null && Xi(Je) && (Je = null),
      on.forEach(o2),
      rn.forEach(o2);
  }
  function Qi(l, t) {
    l.blockedOn === t &&
      ((l.blockedOn = null),
      M0 || ((M0 = !0), s.unstable_scheduleCallback(s.unstable_NormalPriority, _m)));
  }
  var wi = null;
  function r2(l) {
    wi !== l &&
      ((wi = l),
      s.unstable_scheduleCallback(s.unstable_NormalPriority, function () {
        wi === l && (wi = null);
        for (var t = 0; t < l.length; t += 3) {
          var e = l[t],
            a = l[t + 1],
            u = l[t + 2];
          if (typeof a != "function") {
            if (N0(a || e) === null) continue;
            break;
          }
          var n = Na(e);
          n !== null &&
            (l.splice(t, 3),
            (t -= 3),
            sf(n, { pending: !0, data: u, method: e.method, action: a }, a, u));
        }
      }));
  }
  function mu(l) {
    function t(f) {
      return Qi(f, l);
    }
    we !== null && Qi(we, l),
      Ke !== null && Qi(Ke, l),
      Je !== null && Qi(Je, l),
      on.forEach(t),
      rn.forEach(t);
    for (var e = 0; e < Fe.length; e++) {
      var a = Fe[e];
      a.blockedOn === l && (a.blockedOn = null);
    }
    for (; 0 < Fe.length && ((e = Fe[0]), e.blockedOn === null); )
      s2(e), e.blockedOn === null && Fe.shift();
    if (((e = (l.ownerDocument || l).$$reactFormReplay), e != null))
      for (a = 0; a < e.length; a += 3) {
        var u = e[a],
          n = e[a + 1],
          i = u[it] || null;
        if (typeof n == "function") i || r2(e);
        else if (i) {
          var c = null;
          if (n && n.hasAttribute("formAction")) {
            if (((u = n), (i = n[it] || null))) c = i.formAction;
            else if (N0(u) !== null) continue;
          } else c = i.action;
          typeof c == "function" ? (e[a + 1] = c) : (e.splice(a, 3), (a -= 3)), r2(e);
        }
      }
  }
  function d2() {
    function l(n) {
      n.canIntercept &&
        n.info === "react-transition" &&
        n.intercept({
          handler: function () {
            return new Promise(function (i) {
              return (u = i);
            });
          },
          focusReset: "manual",
          scroll: "manual",
        });
    }
    function t() {
      u !== null && (u(), (u = null)), a || setTimeout(e, 20);
    }
    function e() {
      if (!a && !navigation.transition) {
        var n = navigation.currentEntry;
        n &&
          n.url != null &&
          navigation.navigate(n.url, {
            state: n.getState(),
            info: "react-transition",
            history: "replace",
          });
      }
    }
    if (typeof navigation == "object") {
      var a = !1,
        u = null;
      return (
        navigation.addEventListener("navigate", l),
        navigation.addEventListener("navigatesuccess", t),
        navigation.addEventListener("navigateerror", t),
        setTimeout(e, 100),
        function () {
          (a = !0),
            navigation.removeEventListener("navigate", l),
            navigation.removeEventListener("navigatesuccess", t),
            navigation.removeEventListener("navigateerror", t),
            u !== null && (u(), (u = null));
        }
      );
    }
  }
  function x0(l) {
    this._internalRoot = l;
  }
  (Ki.prototype.render = x0.prototype.render =
    function (l) {
      var t = this._internalRoot;
      if (t === null) throw Error(o(409));
      var e = t.current,
        a = At();
      a2(e, a, l, t, null, null);
    }),
    (Ki.prototype.unmount = x0.prototype.unmount =
      function () {
        var l = this._internalRoot;
        if (l !== null) {
          this._internalRoot = null;
          var t = l.containerInfo;
          a2(l.current, 2, null, l, null, null), Di(), (t[_a] = null);
        }
      });
  function Ki(l) {
    this._internalRoot = l;
  }
  Ki.prototype.unstable_scheduleHydration = function (l) {
    if (l) {
      var t = P0();
      l = { blockedOn: null, target: l, priority: t };
      for (var e = 0; e < Fe.length && t !== 0 && t < Fe[e].priority; e++);
      Fe.splice(e, 0, l), e === 0 && s2(l);
    }
  };
  var v2 = b.version;
  if (v2 !== "19.3.1") throw Error(o(527, v2, "19.3.1"));
  J.findDOMNode = function (l) {
    var t = l._reactInternals;
    if (t === void 0)
      throw typeof l.render == "function"
        ? Error(o(188))
        : ((l = Object.keys(l).join(",")), Error(o(268, l)));
    return ((l = $(t)), (l = l !== null ? D(l) : null), (l = l === null ? null : l.stateNode), l);
  };
  var Nm = {
    bundleType: 0,
    version: "19.3.1",
    rendererPackageName: "react-dom",
    currentDispatcherRef: B,
    reconcilerVersion: "19.3.1",
  };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var Ji = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!Ji.isDisabled && Ji.supportsFiber)
      try {
        (bu = Ji.inject(Nm)), (ht = Ji);
      } catch {}
  }
  return (
    (vn.createRoot = function (l, t) {
      if (!N(l)) throw Error(o(299));
      var e = !1,
        a = "",
        u = to,
        n = eo,
        i = ao;
      return (
        t != null &&
          (t.unstable_strictMode === !0 && (e = !0),
          t.identifierPrefix !== void 0 && (a = t.identifierPrefix),
          t.onUncaughtError !== void 0 && (u = t.onUncaughtError),
          t.onCaughtError !== void 0 && (n = t.onCaughtError),
          t.onRecoverableError !== void 0 && (i = t.onRecoverableError)),
        (t = t2(l, 1, !1, null, null, e, a, null, u, n, i, d2)),
        (l[_a] = t.current),
        n0(l),
        new x0(t)
      );
    }),
    (vn.hydrateRoot = function (l, t, e) {
      if (!N(l)) throw Error(o(299));
      var a = !1,
        u = "",
        n = to,
        i = eo,
        c = ao,
        f = null;
      return (
        e != null &&
          (e.unstable_strictMode === !0 && (a = !0),
          e.identifierPrefix !== void 0 && (u = e.identifierPrefix),
          e.onUncaughtError !== void 0 && (n = e.onUncaughtError),
          e.onCaughtError !== void 0 && (i = e.onCaughtError),
          e.onRecoverableError !== void 0 && (c = e.onRecoverableError),
          e.formState !== void 0 && (f = e.formState)),
        (t = t2(l, 1, !0, t, e ?? null, a, u, f, n, i, c, d2)),
        (t.context = e2(null)),
        (e = t.current),
        (a = At()),
        (a = ac(a)),
        (u = Ue(a)),
        (u.callback = null),
        Re(e, u, a),
        (e = a),
        (t.current.lanes = e),
        Tu(t, e),
        te(t),
        (l[_a] = t.current),
        n0(l),
        new Ki(t)
      );
    }),
    (vn.version = "19.3.1"),
    vn
  );
}
var z2;
function Lm() {
  if (z2) return H0.exports;
  z2 = 1;
  function s() {
    if (
      !(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      )
    )
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s);
      } catch (b) {
        console.error(b);
      }
  }
  return (s(), (H0.exports = Zm()), H0.exports);
}
var Gm = Lm(),
  Y0 = { exports: {} },
  mn = {}; /**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var A2;
function Vm() {
  if (A2) return mn;
  A2 = 1;
  var s = Symbol.for("react.transitional.element"),
    b = Symbol.for("react.fragment");
  function z(o, N, M) {
    var G = null;
    if ((M !== void 0 && (G = "" + M), N.key !== void 0 && (G = "" + N.key), "key" in N)) {
      M = {};
      for (var H in N) H !== "key" && (M[H] = N[H]);
    } else M = N;
    return ((N = M.ref), { $$typeof: s, type: o, key: G, ref: N !== void 0 ? N : null, props: M });
  }
  return ((mn.Fragment = b), (mn.jsx = z), (mn.jsxs = z), mn);
}
var p2;
function Xm() {
  return (p2 || ((p2 = 1), (Y0.exports = Vm())), Y0.exports);
}
var O = Xm();
const Qm = (s) => {
    const [b, z] = E.useState([]),
      o = E.useCallback(() => {
        s.client
          .listSessions()
          .then(z)
          .catch(() => {});
      }, [s.client]);
    E.useEffect(() => {
      o();
      const M = s.store.subscribe(o);
      return () => {
        M();
      };
    }, [o, s.store]);
    const N = E.useCallback(() => {
      s.client
        .createSession()
        .then(() => o())
        .catch(() => {});
    }, [s.client, o]);
    return O.jsxs("nav", {
      className: "henira-sessions",
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--henira-border)",
        background: "var(--henira-surface)",
        padding: "12px",
        boxSizing: "border-box",
        width: "var(--henira-sidebar-width)",
      },
      children: [
        O.jsxs("div", {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
          },
          children: [
            O.jsx("strong", {
              style: { color: "var(--henira-text-strong)" },
              children: s.t("sessions.title"),
            }),
            O.jsxs("button", {
              className: "henira-primary",
              onClick: N,
              children: ["+ ", s.t("sessions.new")],
            }),
          ],
        }),
        b.length === 0
          ? O.jsx("span", {
              style: { color: "var(--henira-text-muted)" },
              children: s.t("sessions.empty"),
            })
          : O.jsx("ul", {
              style: { listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 },
              children: b.map((M) => {
                const G = s.sessionId === M.id;
                return O.jsx(
                  "li",
                  {
                    style: { marginBottom: "2px" },
                    children: O.jsxs("button", {
                      onClick: () => {
                        s.selectSession(M.id);
                      },
                      style: {
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: G ? "var(--henira-bg)" : "transparent",
                        border: "none",
                        borderRadius: "var(--henira-radius)",
                        padding: "8px",
                      },
                      children: [
                        O.jsx("span", {
                          "aria-label": M.busy ? s.t("sessions.busy") : s.t("sessions.idle"),
                          style: {
                            display: "inline-block",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            marginRight: "8px",
                            background: M.busy
                              ? "var(--henira-warn-text)"
                              : "var(--henira-ok-text)",
                          },
                        }),
                        O.jsx("span", {
                          className: "henira-mono",
                          style: { fontSize: "12px" },
                          children: M.cwd.split(/[\\/]/).pop() || M.cwd,
                        }),
                        O.jsx("span", {
                          style: {
                            color: "var(--henira-text-muted)",
                            marginLeft: "8px",
                            fontSize: "12px",
                          },
                          children: M.busy ? s.t("sessions.busy") : "",
                        }),
                      ],
                    }),
                  },
                  M.id,
                );
              }),
            }),
      ],
    });
  },
  wm = E.createContext({ color: "currentColor", size: "1em", weight: "regular", mirrored: !1 }),
  Aa = E.forwardRef((s, b) => {
    const { alt: z, color: o, size: N, weight: M, mirrored: G, children: H, weights: q, ...$ } = s,
      {
        color: D = "currentColor",
        size: T,
        weight: C = "regular",
        mirrored: fl = !1,
        ...W
      } = E.useContext(wm);
    return E.createElement(
      "svg",
      {
        ref: b,
        xmlns: "http://www.w3.org/2000/svg",
        width: N ?? T,
        height: N ?? T,
        fill: o ?? D,
        viewBox: "0 0 256 256",
        transform: G || fl ? "scale(-1, 1)" : void 0,
        ...W,
        ...$,
      },
      !!z && E.createElement("title", null, z),
      H,
      q.get(M ?? C),
    );
  });
Aa.displayName = "IconBase";
const Km = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
          opacity: "0.2",
        }),
        E.createElement("path", {
          d: "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M172.24,99.76a6,6,0,0,1,0,8.48l-56,56a6,6,0,0,1-8.48,0l-24-24a6,6,0,0,1,8.48-8.48L112,151.51l51.76-51.75A6,6,0,0,1,172.24,99.76ZM230,128A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M170.83,101.17a4,4,0,0,1,0,5.66l-56,56a4,4,0,0,1-5.66,0l-24-24a4,4,0,0,1,5.66-5.66L112,154.34l53.17-53.17A4,4,0,0,1,170.83,101.17ZM228,128A100,100,0,1,1,128,28,100.11,100.11,0,0,1,228,128Zm-8,0a92,92,0,1,0-92,92A92.1,92.1,0,0,0,220,128Z",
        }),
      ),
    ],
  ]),
  _2 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: Km }));
_2.displayName = "CheckCircleIcon";
const Jm = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M236,128a108,108,0,0,1-216,0c0-42.52,24.73-81.34,63-98.9A12,12,0,1,1,93,50.91C63.24,64.57,44,94.83,44,128a84,84,0,0,0,168,0c0-33.17-19.24-63.43-49-77.09A12,12,0,1,1,173,29.1C211.27,46.66,236,85.48,236,128Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
          opacity: "0.2",
        }),
        E.createElement("path", {
          d: "M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,176A72,72,0,0,1,92,65.64a8,8,0,0,1,8,13.85,56,56,0,1,0,56,0,8,8,0,0,1,8-13.85A72,72,0,0,1,128,200Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M230,128a102,102,0,0,1-204,0c0-40.18,23.35-76.86,59.5-93.45a6,6,0,0,1,5,10.9C58.61,60.09,38,92.49,38,128a90,90,0,0,0,180,0c0-35.51-20.61-67.91-52.5-82.55a6,6,0,0,1,5-10.9C206.65,51.14,230,87.82,230,128Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M228,128a100,100,0,0,1-200,0c0-39.4,22.9-75.37,58.33-91.63a4,4,0,1,1,3.34,7.27C57.07,58.6,36,91.71,36,128a92,92,0,0,0,184,0c0-36.29-21.07-69.4-53.67-84.36a4,4,0,1,1,3.34-7.27C205.1,52.63,228,88.6,228,128Z",
        }),
      ),
    ],
  ]),
  N2 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: Jm }));
N2.displayName = "CircleNotchIcon";
const Fm = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
          opacity: "0.2",
        }),
        E.createElement("path", {
          d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M202.83,197.17a4,4,0,0,1-5.66,5.66L128,133.66,58.83,202.83a4,4,0,0,1-5.66-5.66L122.34,128,53.17,58.83a4,4,0,0,1,5.66-5.66L128,122.34l69.17-69.17a4,4,0,1,1,5.66,5.66L133.66,128Z",
        }),
      ),
    ],
  ]),
  M2 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: Fm }));
M2.displayName = "XIcon";
const $m = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", { d: "M200,112H56l72-72Z", opacity: "0.2" }),
        E.createElement("path", {
          d: "M205.66,106.34l-72-72a8,8,0,0,0-11.32,0l-72,72A8,8,0,0,0,56,120h64v96a8,8,0,0,0,16,0V120h64a8,8,0,0,0,5.66-13.66ZM75.31,104,128,51.31,180.69,104Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M207.39,115.06A8,8,0,0,1,200,120H136v96a8,8,0,0,1-16,0V120H56a8,8,0,0,1-5.66-13.66l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,207.39,115.06Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M204.24,116.24a6,6,0,0,1-8.48,0L134,54.49V216a6,6,0,0,1-12,0V54.49L60.24,116.24a6,6,0,0,1-8.48-8.48l72-72a6,6,0,0,1,8.48,0l72,72A6,6,0,0,1,204.24,116.24Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M202.83,114.83a4,4,0,0,1-5.66,0L132,49.66V216a4,4,0,0,1-8,0V49.66L58.83,114.83a4,4,0,0,1-5.66-5.66l72-72a4,4,0,0,1,5.66,0l72,72A4,4,0,0,1,202.83,114.83Z",
        }),
      ),
    ],
  ]),
  x2 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: $m }));
x2.displayName = "ArrowUpIcon";
const Wm = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M200,36H56A20,20,0,0,0,36,56V200a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,160H60V60H196Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M208,56V200a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H200A8,8,0,0,1,208,56Z",
          opacity: "0.2",
        }),
        E.createElement("path", {
          d: "M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,160H56V56H200V200Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M200,42H56A14,14,0,0,0,42,56V200a14,14,0,0,0,14,14H200a14,14,0,0,0,14-14V56A14,14,0,0,0,200,42Zm2,158a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2H200a2,2,0,0,1,2,2Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,160H56V56H200V200Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M200,44H56A12,12,0,0,0,44,56V200a12,12,0,0,0,12,12H200a12,12,0,0,0,12-12V56A12,12,0,0,0,200,44Zm4,156a4,4,0,0,1-4,4H56a4,4,0,0,1-4-4V56a4,4,0,0,1,4-4H200a4,4,0,0,1,4,4Z",
        }),
      ),
    ],
  ]),
  D2 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: Wm }));
D2.displayName = "StopIcon";
function km(s) {
  return O.jsx(_2, { size: s.size ?? 14, color: s.color });
}
function Im(s) {
  return O.jsx(N2, { size: s.size ?? 14, color: s.color });
}
function Pm(s) {
  return O.jsx(M2, { size: s.size ?? 14, color: s.color });
}
function l3(s) {
  return O.jsx(x2, { size: s.size ?? 14, color: s.color, weight: "bold" });
}
function t3(s) {
  return O.jsx(D2, { size: s.size ?? 14, color: s.color, weight: "fill" });
}
function e3({ row: s, ctx: b }) {
  const [z, o] = E.useState(!1),
    N = s.status === "pending" && !z,
    M = (G) => {
      b.sessionId !== null &&
        (o(!0), b.client.settleApproval(b.sessionId, s.requestId, G).catch(() => o(!1)));
    };
  return O.jsxs("div", {
    role: "dialog",
    "aria-label": b.t("approval.title"),
    style: {
      border: `1px solid ${N ? "var(--henira-border-strong)" : "var(--henira-border)"}`,
      borderRadius: "var(--henira-radius)",
      background: N ? "var(--henira-warn-bg)" : "var(--henira-surface)",
      padding: "12px 14px",
      margin: "12px 0",
    },
    children: [
      O.jsxs("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" },
        children: [
          O.jsx("strong", { children: b.t("approval.title") }),
          O.jsx("span", {
            style: {
              fontSize: "11px",
              borderRadius: "9999px",
              padding: "1px 8px",
              background: N ? "var(--henira-warn-text)" : "var(--henira-border)",
              color: N ? "var(--henira-warn-bg)" : "var(--henira-text-muted)",
            },
            children: N ? b.t("approval.pending") : b.t("approval.settled"),
          }),
          O.jsx("span", {
            className: "henira-mono",
            style: { fontSize: "12px", color: "var(--henira-text-muted)" },
            children: s.toolName,
          }),
        ],
      }),
      s.argsSummary !== void 0
        ? O.jsx("div", {
            className: "henira-mono",
            style: { fontSize: "12px", color: "var(--henira-text-muted)", marginBottom: "8px" },
            children: s.argsSummary,
          })
        : null,
      N
        ? O.jsxs("div", {
            style: { display: "flex", gap: "8px" },
            children: [
              O.jsx("button", {
                className: "henira-primary",
                onClick: () => M("allowed-once"),
                children: b.t("approval.allow"),
              }),
              O.jsx("button", { onClick: () => M("rejected"), children: b.t("approval.deny") }),
            ],
          })
        : s.decision !== void 0
          ? O.jsx("span", {
              className: "henira-mono",
              style: { fontSize: "12px", color: "var(--henira-text-muted)" },
              children: s.decision,
            })
          : null,
    ],
  });
}
const a3 = (s) => {
  var M;
  const b = E.useSyncExternalStore(
      s.store.subscribe,
      () => s.store.getSession(s.sessionId),
      () => s.store.getSession(s.sessionId),
    ),
    z = E.useRef(null),
    o = b.rows,
    N = ((M = o[o.length - 1]) == null ? void 0 : M.kind) === "assistant" ? o.length : 0;
  return (
    E.useEffect(() => {
      const G = z.current;
      G !== null && typeof G.scrollIntoView == "function" && G.scrollIntoView({ block: "end" });
    }, [o.length, N]),
    O.jsxs("div", {
      className: "henira-conversation",
      style: { flex: 1, overflowY: "auto", padding: "24px", boxSizing: "border-box" },
      children: [
        o.length === 0
          ? O.jsx("p", {
              style: { color: "var(--henira-text-muted)" },
              children: s.t("conversation.empty"),
            })
          : o.map((G) => O.jsx(u3, { row: G, ctx: s }, G.rowId)),
        b.state.busy
          ? O.jsx("p", {
              style: { color: "var(--henira-text-muted)", fontStyle: "italic" },
              children: s.t("conversation.thinking"),
            })
          : null,
        O.jsx("div", { ref: z }),
      ],
    })
  );
};
function u3({ row: s, ctx: b }) {
  switch (s.kind) {
    case "user":
      return O.jsx(n3, { row: s, ctx: b });
    case "assistant":
      return O.jsx(i3, { row: s, ctx: b });
    case "tool":
      return O.jsx(c3, { row: s, ctx: b });
    case "approval":
      return O.jsx(e3, { row: s, ctx: b });
    case "error":
      return O.jsx(f3, { row: s, ctx: b });
  }
}
function n3({ row: s, ctx: b }) {
  return O.jsxs("div", {
    style: {
      background: "var(--henira-surface)",
      border: "1px solid var(--henira-border)",
      borderRadius: "var(--henira-radius)",
      padding: "10px 14px",
      margin: "12px 0",
      whiteSpace: "pre-wrap",
    },
    children: [
      s.source === "steer" || s.source === "veto"
        ? O.jsx("span", {
            style: {
              background: "var(--henira-info-bg)",
              color: "var(--henira-info-text)",
              borderRadius: "9999px",
              fontSize: "11px",
              padding: "1px 8px",
              marginRight: "8px",
            },
            children: s.source,
          })
        : null,
      s.text,
    ],
  });
}
function i3({ row: s, ctx: b }) {
  const z = s.streaming;
  return O.jsxs("div", {
    style: { margin: "12px 0" },
    children: [
      s.reasoning !== void 0 && s.reasoning !== ""
        ? O.jsx("p", {
            style: {
              color: "var(--henira-text-muted)",
              fontSize: "13px",
              borderLeft: "2px solid var(--henira-border)",
              paddingLeft: "10px",
              whiteSpace: "pre-wrap",
            },
            children: s.reasoning,
          })
        : null,
      O.jsx("div", {
        className: z ? "henira-streaming" : void 0,
        style: { whiteSpace: "pre-wrap" },
        children: b.host.renderMarkdown(s.text),
      }),
    ],
  });
}
function c3({ row: s, ctx: b }) {
  const z =
    s.status === "running"
      ? "var(--henira-info-text)"
      : s.status === "error"
        ? "var(--henira-danger-text)"
        : "var(--henira-ok-text)";
  return (
    s.status === "running" || s.status,
    O.jsxs("div", {
      style: {
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        margin: "8px 0",
        padding: "8px 12px",
        background: "var(--henira-surface)",
      },
      children: [
        O.jsxs("div", {
          style: { display: "flex", alignItems: "center", gap: "8px" },
          children: [
            s.status === "running"
              ? O.jsx(Im, { size: 14, color: z })
              : s.status === "error"
                ? O.jsx(Pm, { size: 14, color: z })
                : O.jsx(km, { size: 14, color: z }),
            O.jsx("span", { className: "henira-mono", style: { color: z }, children: s.name }),
            s.status === "done" && s.output !== void 0
              ? O.jsxs("span", {
                  style: { color: "var(--henira-text-muted)", fontSize: "12px" },
                  children: [s.output.durationMs, "ms"],
                })
              : null,
          ],
        }),
        O.jsx("pre", {
          className: "henira-mono",
          style: {
            margin: "6px 0 0",
            color: "var(--henira-text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          },
          children: s.input,
        }),
        s.output !== void 0
          ? O.jsxs("details", {
              style: { marginTop: "6px" },
              children: [
                O.jsx("summary", {
                  style: { cursor: "pointer", color: "var(--henira-text-muted)", fontSize: "12px" },
                  children: s.output.isError ? b.t("error.title") : b.t("common.copy"),
                }),
                O.jsx("pre", {
                  className: "henira-mono",
                  style: { whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0 0" },
                  children: s.output.content,
                }),
              ],
            })
          : null,
      ],
    })
  );
}
function f3({ row: s, ctx: b }) {
  return O.jsxs("div", {
    role: "alert",
    style: {
      background: "var(--henira-danger-bg)",
      color: "var(--henira-danger-text)",
      borderRadius: "var(--henira-radius)",
      padding: "10px 14px",
      margin: "12px 0",
    },
    children: [
      O.jsx("strong", { children: b.t("error.title") }),
      O.jsx("span", {
        className: "henira-mono",
        style: { marginLeft: "8px", fontSize: "13px" },
        children: s.message,
      }),
    ],
  });
}
const s3 = (s) => {
    const [b, z] = E.useState(""),
      o = E.useSyncExternalStore(
        s.store.subscribe,
        () => s.store.getSession(s.sessionId).state.busy,
        () => !1,
      ),
      N = E.useRef(null),
      M = () => {
        const H = b.trim();
        H === "" ||
          s.sessionId === null ||
          (z(""),
          s.client.prompt(s.sessionId, H).catch(() => {
            z(H);
          }));
      },
      G = () => {
        s.sessionId !== null && s.client.interrupt(s.sessionId);
      };
    return O.jsxs("div", {
      className: "henira-composer",
      style: {
        borderTop: "1px solid var(--henira-border)",
        background: "var(--henira-surface)",
        padding: "12px",
        display: "flex",
        gap: "8px",
        alignItems: "flex-end",
      },
      children: [
        O.jsx("textarea", {
          ref: N,
          value: b,
          rows: 2,
          placeholder: s.t("composer.placeholder"),
          onChange: (H) => {
            z(H.target.value);
          },
          onKeyDown: (H) => {
            H.key === "Enter" && !H.shiftKey && (H.preventDefault(), M());
          },
          style: {
            flex: 1,
            resize: "none",
            border: "1px solid var(--henira-border)",
            borderRadius: "var(--henira-radius)",
            background: "var(--henira-bg)",
            color: "var(--henira-text)",
            padding: "8px 10px",
            font: "inherit",
          },
        }),
        o
          ? O.jsxs("div", {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "4px",
              },
              children: [
                O.jsxs("button", {
                  className: "henira-primary",
                  onClick: G,
                  "aria-label": s.t("composer.stop"),
                  children: [O.jsx(t3, { size: 14 }), " ", s.t("composer.stop")],
                }),
                O.jsx("span", {
                  style: { fontSize: "11px", color: "var(--henira-text-muted)" },
                  children: s.t("composer.steerHint"),
                }),
              ],
            })
          : O.jsxs("button", {
              className: "henira-primary",
              onClick: M,
              disabled: b.trim() === "" || s.sessionId === null,
              "aria-label": s.t("composer.send"),
              children: [O.jsx(l3, { size: 14 }), " ", s.t("composer.send")],
            }),
      ],
    });
  },
  C2 = { sidebar: Qm, conversation: a3, composer: s3 };
function o3(s) {
  const b = [];
  for (const [z, o] of Object.entries(C2)) b.push(s.registerSlot(z, o));
  return () => {
    for (const z of b) z();
  };
}
const r3 = {
  "app.title": "Henira",
  "sessions.title": "会话",
  "sessions.new": "新会话",
  "sessions.empty": "还没有会话",
  "sessions.busy": "进行中",
  "sessions.idle": "空闲",
  "conversation.empty": "发一条消息开始对话",
  "conversation.thinking": "思考中…",
  "composer.placeholder": "输入消息，Enter 发送，Shift+Enter 换行",
  "composer.send": "发送",
  "composer.stop": "停止",
  "composer.steerHint": "回合进行中，消息将作为插话进场",
  "approval.title": "权限请求",
  "approval.allow": "允许",
  "approval.deny": "拒绝",
  "approval.pending": "等待处理",
  "approval.settled": "已处理",
  "error.title": "出错了",
  "settings.title": "设置",
  "settings.model": "默认模型",
  "settings.modelPlaceholder": "provider/model，如 deepseek/deepseek-v4-flash",
  "settings.theme": "主题",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.locale": "界面语言",
  "settings.credential": "密钥",
  "settings.credentialPlaceholder": "粘贴 API key（只写入本地 credentials.json）",
  "settings.credentialProvider": "服务商",
  "settings.save": "保存",
  "settings.saved": "已保存",
  "settings.open": "设置",
  "common.retry": "重试",
  "common.copy": "复制",
  "common.copied": "已复制",
};
var We, yu, yn, gn, gu, ee, Z0, U2, L0;
class d3 {
  constructor() {
    za(this, ee);
    za(this, We, new Map());
    za(this, yu, new Set());
    za(this, yn, new Map());
    za(this, gn, 0);
    za(this, gu);
    D0(
      this,
      "subscribe",
      (b) => (
        nt(this, yu).add(b),
        () => {
          nt(this, yu).delete(b);
        }
      ),
    );
    D0(this, "getSession", (b) => {
      if (b === null) return O2;
      const z = nt(this, yn).get(b);
      return z !== void 0 ? z.view : O2;
    });
  }
  setRefetch(b) {
    U0(this, gu, b);
  }
  has(b) {
    return nt(this, We).has(b);
  }
  applySnapshot(b) {
    const z = b.snapshot,
      o = hu(this, ee, L0).call(this, b.sessionId);
    (o.rows = [...z.rows]),
      (o.byId = new Map(z.rows.map((N) => [N.rowId, N]))),
      (o.state = { ...z.state }),
      (o.lastSeq = z.seq),
      hu(this, ee, Z0).call(this, b.sessionId);
  }
  applyFrame(b) {
    var N;
    const z = hu(this, ee, L0).call(this, b.sessionId),
      o = z.lastSeq + 1;
    if (b.seq !== o) {
      (N = nt(this, gu)) == null || N.call(this, b.sessionId);
      return;
    }
    (z.lastSeq = b.seq),
      hu(this, ee, U2).call(this, b.sessionId, b.delta),
      hu(this, ee, Z0).call(this, b.sessionId);
  }
}
(We = new WeakMap()),
  (yu = new WeakMap()),
  (yn = new WeakMap()),
  (gn = new WeakMap()),
  (gu = new WeakMap()),
  (ee = new WeakSet()),
  (Z0 = function (b) {
    U0(this, gn, nt(this, gn) + 1);
    const z = nt(this, We).get(b);
    if (z !== void 0) {
      nt(this, yn).set(b, {
        view: { rows: [...z.rows], state: { ...z.state } },
        version: nt(this, gn),
      });
      for (const o of nt(this, yu)) o();
    }
  }),
  (U2 = function (b, z) {
    var N;
    const o = nt(this, We).get(b);
    if (o !== void 0)
      switch (z.op) {
        case "row.appended": {
          const M = z.row;
          o.rows.push(M), o.byId.set(M.rowId, M);
          break;
        }
        case "row.delta": {
          const M = o.byId.get(z.rowId);
          if (M === void 0) {
            (N = nt(this, gu)) == null || N.call(this, b);
            return;
          }
          if (z.field === "text") M.text += z.text;
          else {
            const G = M;
            G.reasoning = (G.reasoning ?? "") + z.text;
          }
          break;
        }
        case "row.upserted": {
          const M = o.byId.get(z.row.rowId);
          if (M === void 0) o.rows.push(z.row);
          else {
            const G = o.rows.indexOf(M);
            o.rows[G] = z.row;
          }
          o.byId.set(z.row.rowId, z.row);
          break;
        }
        case "state.updated": {
          o.state = { ...z.state };
          break;
        }
      }
  }),
  (L0 = function (b) {
    let z = nt(this, We).get(b);
    return (
      z === void 0 &&
        ((z = { rows: [], byId: new Map(), state: { busy: !1 }, lastSeq: 0, version: 0 }),
        nt(this, We).set(b, z)),
      z
    );
  });
const O2 = { rows: [], state: { busy: !1 } },
  v3 = new Map([
    [
      "bold",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,76a52,52,0,1,0,52,52A52.06,52.06,0,0,0,128,76Zm0,80a28,28,0,1,1,28-28A28,28,0,0,1,128,156Zm113.86-49.57A12,12,0,0,0,236,98.34L208.21,82.49l-.11-31.31a12,12,0,0,0-4.25-9.12,116,116,0,0,0-38-21.41,12,12,0,0,0-9.68.89L128,37.27,99.83,21.53a12,12,0,0,0-9.7-.9,116.06,116.06,0,0,0-38,21.47,12,12,0,0,0-4.24,9.1l-.14,31.34L20,98.35a12,12,0,0,0-5.85,8.11,110.7,110.7,0,0,0,0,43.11A12,12,0,0,0,20,157.66l27.82,15.85.11,31.31a12,12,0,0,0,4.25,9.12,116,116,0,0,0,38,21.41,12,12,0,0,0,9.68-.89L128,218.73l28.14,15.74a12,12,0,0,0,9.7.9,116.06,116.06,0,0,0,38-21.47,12,12,0,0,0,4.24-9.1l.14-31.34,27.81-15.81a12,12,0,0,0,5.85-8.11A110.7,110.7,0,0,0,241.86,106.43Zm-22.63,33.18-26.88,15.28a11.94,11.94,0,0,0-4.55,4.59c-.54,1-1.11,1.93-1.7,2.88a12,12,0,0,0-1.83,6.31L184.13,199a91.83,91.83,0,0,1-21.07,11.87l-27.15-15.19a12,12,0,0,0-5.86-1.53h-.29c-1.14,0-2.3,0-3.44,0a12.08,12.08,0,0,0-6.14,1.51L93,210.82A92.27,92.27,0,0,1,71.88,199l-.11-30.24a12,12,0,0,0-1.83-6.32c-.58-.94-1.16-1.91-1.7-2.88A11.92,11.92,0,0,0,63.7,155L36.8,139.63a86.53,86.53,0,0,1,0-23.24l26.88-15.28a12,12,0,0,0,4.55-4.58c.54-1,1.11-1.94,1.7-2.89a12,12,0,0,0,1.83-6.31L71.87,57A91.83,91.83,0,0,1,92.94,45.17l27.15,15.19a11.92,11.92,0,0,0,6.15,1.52c1.14,0,2.3,0,3.44,0a12.08,12.08,0,0,0,6.14-1.51L163,45.18A92.27,92.27,0,0,1,184.12,57l.11,30.24a12,12,0,0,0,1.83,6.32c.58.94,1.16,1.91,1.7,2.88A11.92,11.92,0,0,0,192.3,101l26.9,15.33A86.53,86.53,0,0,1,219.23,139.61Z",
        }),
      ),
    ],
    [
      "duotone",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M230.1,108.76,198.25,90.62c-.64-1.16-1.31-2.29-2-3.41l-.12-36A104.61,104.61,0,0,0,162,32L130,49.89c-1.34,0-2.69,0-4,0L94,32A104.58,104.58,0,0,0,59.89,51.25l-.16,36c-.7,1.12-1.37,2.26-2,3.41l-31.84,18.1a99.15,99.15,0,0,0,0,38.46l31.85,18.14c.64,1.16,1.31,2.29,2,3.41l.12,36A104.61,104.61,0,0,0,94,224l32-17.87c1.34,0,2.69,0,4,0L162,224a104.58,104.58,0,0,0,34.08-19.25l.16-36c.7-1.12,1.37-2.26,2-3.41l31.84-18.1A99.15,99.15,0,0,0,230.1,108.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z",
          opacity: "0.2",
        }),
        E.createElement("path", {
          d: "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A111.92,111.92,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.1,8.1,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8,8,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z",
        }),
      ),
    ],
    [
      "fill",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M237.94,107.21a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A111.92,111.92,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z",
        }),
      ),
    ],
    [
      "light",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,82a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162Zm108-54.4a6,6,0,0,0-2.92-4L202.64,86.22l-.42-.71L202.1,51.2A6,6,0,0,0,200,46.64a110.12,110.12,0,0,0-36.07-20.31,6,6,0,0,0-4.84.45L128.46,43.86h-1L96.91,26.76a6,6,0,0,0-4.86-.44A109.92,109.92,0,0,0,56,46.68a6,6,0,0,0-2.12,4.55l-.16,34.34c-.14.23-.28.47-.41.71L22.91,103.57A6,6,0,0,0,20,107.62a104.81,104.81,0,0,0,0,40.78,6,6,0,0,0,2.92,4l30.42,17.33.42.71.12,34.31A6,6,0,0,0,56,209.36a110.12,110.12,0,0,0,36.07,20.31,6,6,0,0,0,4.84-.45l30.61-17.08h1l30.56,17.1A6.09,6.09,0,0,0,162,230a5.83,5.83,0,0,0,1.93-.32,109.92,109.92,0,0,0,36-20.36,6,6,0,0,0,2.12-4.55l.16-34.34c.14-.23.28-.47.41-.71l30.42-17.29a6,6,0,0,0,2.92-4.05A104.81,104.81,0,0,0,236,107.6Zm-11.25,35.79L195.32,160.1a6.07,6.07,0,0,0-2.28,2.3c-.59,1-1.21,2.11-1.86,3.14a6,6,0,0,0-.91,3.16l-.16,33.21a98.15,98.15,0,0,1-27.52,15.53L133,200.88a6,6,0,0,0-2.93-.77h-.14c-1.24,0-2.5,0-3.74,0a6,6,0,0,0-3.07.76L93.45,217.43a98,98,0,0,1-27.56-15.49l-.12-33.17a6,6,0,0,0-.91-3.16c-.64-1-1.27-2.08-1.86-3.14a6,6,0,0,0-2.27-2.3L31.3,143.4a93,93,0,0,1,0-30.79L60.68,95.9A6.07,6.07,0,0,0,63,93.6c.59-1,1.21-2.11,1.86-3.14a6,6,0,0,0,.91-3.16l.16-33.21A98.15,98.15,0,0,1,93.41,38.56L123,55.12a5.81,5.81,0,0,0,3.07.76c1.24,0,2.5,0,3.74,0a6,6,0,0,0,3.07-.76l29.65-16.56a98,98,0,0,1,27.56,15.49l.12,33.17a6,6,0,0,0,.91,3.16c.64,1,1.27,2.08,1.86,3.14a6,6,0,0,0,2.27,2.3L224.7,112.6A93,93,0,0,1,224.73,143.39Z",
        }),
      ),
    ],
    [
      "regular",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z",
        }),
      ),
    ],
    [
      "thin",
      E.createElement(
        E.Fragment,
        null,
        E.createElement("path", {
          d: "M128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,80a36,36,0,1,1,36-36A36,36,0,0,1,128,164Zm106-56a4,4,0,0,0-2-2.7l-30.89-17.6q-.47-.82-1-1.62L200.1,51.2a3.94,3.94,0,0,0-1.42-3,107.8,107.8,0,0,0-35.41-19.94,4,4,0,0,0-3.23.29L129,45.87h-2l-31-17.36a4,4,0,0,0-3.23-.3,108.05,108.05,0,0,0-35.39,20,4,4,0,0,0-1.41,3l-.16,34.9-1,1.62L23.9,105.3A4,4,0,0,0,22,108a102.76,102.76,0,0,0,0,40,4,4,0,0,0,1.95,2.7l30.89,17.6q.47.83,1,1.62l.12,34.87a3.94,3.94,0,0,0,1.42,3,107.8,107.8,0,0,0,35.41,19.94,4,4,0,0,0,3.23-.29L127,210.13h2l31,17.36a4,4,0,0,0,3.23.3,108.05,108.05,0,0,0,35.39-20,4,4,0,0,0,1.41-3l.16-34.9,1-1.62L232.1,150.7a4,4,0,0,0,2-2.71A102.76,102.76,0,0,0,234,108Zm-7.48,36.67L196.3,161.84a4,4,0,0,0-1.51,1.53c-.61,1.09-1.25,2.17-1.91,3.24a3.92,3.92,0,0,0-.61,2.1l-.16,34.15a99.8,99.8,0,0,1-29.7,16.77l-30.4-17a4.06,4.06,0,0,0-2-.51H130c-1.28,0-2.57,0-3.84,0a4.1,4.1,0,0,0-2.05.51l-30.45,17A100.23,100.23,0,0,1,63.89,202.9l-.12-34.12a3.93,3.93,0,0,0-.61-2.11c-.66-1-1.3-2.14-1.91-3.23a4,4,0,0,0-1.51-1.53L29.49,144.68a94.78,94.78,0,0,1,0-33.34L59.7,94.16a4,4,0,0,0,1.51-1.53c.61-1.09,1.25-2.17,1.91-3.23a4,4,0,0,0,.61-2.11l.16-34.15a99.8,99.8,0,0,1,29.7-16.77l30.4,17a4.1,4.1,0,0,0,2.05.51c1.28,0,2.57,0,3.84,0a4,4,0,0,0,2.05-.51l30.45-17A100.23,100.23,0,0,1,192.11,53.1l.12,34.12a3.93,3.93,0,0,0,.61,2.11c.66,1,1.3,2.14,1.91,3.23a4,4,0,0,0,1.51,1.53l30.25,17.23A94.78,94.78,0,0,1,226.54,144.66Z",
        }),
      ),
    ],
  ]),
  G0 = E.forwardRef((s, b) => E.createElement(Aa, { ref: b, ...s, weights: v3 }));
G0.displayName = "GearSixIcon";
const m3 = E.createContext(void 0),
  kl = (s) => {
    const b = r3[s];
    if (b === void 0) throw new Error(`missing locale key: ${s}`);
    return b;
  };
function h3(s) {
  const { store: b, slots: z, client: o, layout: N, safeMode: M } = s,
    [G, H] = E.useState(null),
    [q, $] = E.useState(!1),
    D = E.useMemo(
      () => ({
        client: o,
        sessionId: G,
        selectSession: (k) => {
          H(k);
        },
        t: kl,
        theme: s.theme,
        store: b,
        host: s.host,
      }),
      [o, G, b, s.theme, s.host],
    ),
    T = N === "full",
    C = N === "full" || N === "center",
    fl = N === "full" || N === "composer" || N === "center",
    W = (k) => z.get(k) ?? [],
    Ul = W("sidebar").length > 0;
  return O.jsx(m3.Provider, {
    value: D,
    children: O.jsxs("div", {
      style: { display: "flex", height: "100vh", overflow: "hidden" },
      children: [
        T && Ul
          ? O.jsxs("div", {
              style: {
                display: "flex",
                flexDirection: "column",
                width: "var(--henira-sidebar-width)",
              },
              children: [
                O.jsx("div", {
                  style: { display: "flex", justifyContent: "flex-end", padding: "8px 8px 0" },
                  children: O.jsx("button", {
                    "aria-label": kl("settings.open"),
                    title: kl("settings.title"),
                    onClick: () => {
                      $(!0);
                    },
                    children: O.jsx(G0, { size: 16 }),
                  }),
                }),
                O.jsx("div", {
                  style: { flex: 1, minHeight: 0 },
                  children: W("sidebar").map((k, Dl) => O.jsx(k, { ...D }, Dl)),
                }),
              ],
            })
          : O.jsx("div", {
              style: { padding: "8px" },
              children: O.jsx("button", {
                "aria-label": kl("settings.open"),
                onClick: () => {
                  $(!0);
                },
                children: O.jsx(G0, { size: 16 }),
              }),
            }),
        O.jsxs("div", {
          style: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
          children: [
            C
              ? O.jsx("div", {
                  style: {
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  },
                  children: W("conversation").map((k, Dl) => O.jsx(k, { ...D }, Dl)),
                })
              : null,
            fl
              ? O.jsx("div", { children: W("composer").map((k, Dl) => O.jsx(k, { ...D }, Dl)) })
              : null,
          ],
        }),
        q
          ? O.jsx(y3, {
              client: o,
              theme: s.theme,
              onClose: () => {
                $(!1);
              },
              onTheme: s.onTheme,
            })
          : null,
        M
          ? O.jsx("div", {
              style: {
                position: "fixed",
                right: "12px",
                bottom: "12px",
                background: "var(--henira-warn-bg)",
                color: "var(--henira-warn-text)",
                borderRadius: "9999px",
                fontSize: "12px",
                padding: "2px 10px",
              },
              children: "safe mode",
            })
          : null,
      ],
    }),
  });
}
function y3(s) {
  const [b, z] = E.useState(""),
    [o, N] = E.useState(""),
    [M, G] = E.useState(""),
    [H, q] = E.useState(!1);
  E.useMemo(() => {
    s.client.getSettings().then((D) => {
      D.model !== void 0 && z(D.model);
    });
  }, []);
  const $ = () => {
    const D = {};
    b.trim() !== "" && (D.model = b.trim()),
      (D.ui = { theme: s.theme }),
      s.client
        .putSettings(D)
        .then(() => {
          if (o.trim() !== "" && M.trim() !== "") return s.client.putCredential(o.trim(), M.trim());
        })
        .then(() => {
          q(!0);
        })
        .catch(() => {});
  };
  return O.jsx("div", {
    role: "dialog",
    "aria-label": kl("settings.title"),
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    children: O.jsxs("div", {
      style: {
        background: "var(--henira-surface)",
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        padding: "24px",
        minWidth: "360px",
      },
      children: [
        O.jsxs("div", {
          style: { display: "flex", justifyContent: "space-between", marginBottom: "16px" },
          children: [
            O.jsx("strong", { children: kl("settings.title") }),
            O.jsx("button", { onClick: s.onClose, children: "✕" }),
          ],
        }),
        O.jsxs("label", {
          style: { display: "block", marginBottom: "12px" },
          children: [
            O.jsx("div", {
              style: { color: "var(--henira-text-muted)", marginBottom: "4px" },
              children: kl("settings.model"),
            }),
            O.jsx("input", {
              value: b,
              placeholder: kl("settings.modelPlaceholder"),
              onChange: (D) => {
                z(D.target.value);
              },
              style: hn,
            }),
          ],
        }),
        O.jsxs("label", {
          style: { display: "block", marginBottom: "12px" },
          children: [
            O.jsx("div", {
              style: { color: "var(--henira-text-muted)", marginBottom: "4px" },
              children: kl("settings.theme"),
            }),
            O.jsxs("select", {
              value: s.theme,
              onChange: (D) => {
                s.onTheme(D.target.value);
              },
              style: hn,
              children: [
                O.jsx("option", { value: "light", children: kl("settings.theme.light") }),
                O.jsx("option", { value: "dark", children: kl("settings.theme.dark") }),
              ],
            }),
          ],
        }),
        O.jsxs("label", {
          style: { display: "block", marginBottom: "12px" },
          children: [
            O.jsx("div", {
              style: { color: "var(--henira-text-muted)", marginBottom: "4px" },
              children: kl("settings.locale"),
            }),
            O.jsx("select", {
              style: hn,
              disabled: !0,
              value: "zh",
              children: O.jsx("option", { value: "zh", children: "中文" }),
            }),
          ],
        }),
        O.jsxs("div", {
          style: { marginBottom: "12px" },
          children: [
            O.jsx("div", {
              style: { color: "var(--henira-text-muted)", marginBottom: "4px" },
              children: kl("settings.credential"),
            }),
            O.jsxs("div", {
              style: { display: "flex", gap: "8px" },
              children: [
                O.jsx("input", {
                  value: o,
                  placeholder: kl("settings.credentialProvider"),
                  onChange: (D) => {
                    N(D.target.value);
                  },
                  style: { ...hn, width: "120px" },
                }),
                O.jsx("input", {
                  value: M,
                  type: "password",
                  placeholder: kl("settings.credentialPlaceholder"),
                  onChange: (D) => {
                    G(D.target.value);
                  },
                  style: { ...hn, flex: 1 },
                }),
              ],
            }),
          ],
        }),
        O.jsxs("div", {
          style: { display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "center" },
          children: [
            H
              ? O.jsx("span", {
                  style: { color: "var(--henira-ok-text)" },
                  children: kl("settings.saved"),
                })
              : null,
            O.jsx("button", {
              className: "henira-primary",
              onClick: $,
              children: kl("settings.save"),
            }),
          ],
        }),
      ],
    }),
  });
}
const hn = {
  width: "100%",
  border: "1px solid var(--henira-border)",
  borderRadius: "var(--henira-radius)",
  background: "var(--henira-bg)",
  color: "var(--henira-text)",
  padding: "6px 10px",
  font: "inherit",
  boxSizing: "border-box",
};
function g3(s) {
  const b = new d3();
  let z,
    o,
    N = null,
    M = "",
    G = s.theme ?? "light",
    H = s.safeMode ?? !1;
  const q = new Set(),
    $ = new Set();
  let D = !1,
    T,
    C,
    fl;
  const W = new Map();
  function Ul() {
    C = o3({
      registerSlot: (ll, il) => {
        const V = W.get(ll) ?? [];
        return (
          V.push(il),
          W.set(ll, V),
          () => {
            const cl = W.get(ll);
            if (cl === void 0) return;
            const dt = cl.indexOf(il);
            dt >= 0 && cl.splice(dt, 1);
          }
        );
      },
      replaceSlot: (ll, il) => {
        if (W.has(ll)) throw new Error(`slot conflict: ${ll} already has a default part (D-022)`);
        return (W.set(ll, [il]), () => {});
      },
      host: Dl,
    });
  }
  function k() {
    if ((W.clear(), H)) for (const [Q, ll] of Object.entries(C2)) W.set(Q, [ll]);
    else Ul();
  }
  const Dl = {
    async sendPrompt(Q) {
      if (N === null) throw new Error("no active session");
      return { messageId: (await s.client.prompt(N, Q)).id, sessionId: N };
    },
    subscribe(Q, ll) {
      const il = (V) => {
        V.kind !== "connected" &&
          ((Q.sessionId !== void 0 && V.sessionId !== Q.sessionId) || ll(V));
      };
      return (
        $.add(il),
        () => {
          $.delete(il);
        }
      );
    },
    onTurnFinished(Q) {
      return (
        q.add(Q),
        () => {
          q.delete(Q);
        }
      );
    },
    prefill(Q) {},
    renderMarkdown(Q) {
      return Q;
    },
    getSession() {
      return N === null ? null : { sessionId: N, cwd: M };
    },
    openInExplorer: async () => !1,
    openPlugin() {},
    getInitialView() {},
    async listDir(Q) {
      return N === null ? [] : s.client.listDir(N, Q);
    },
    async listSessionsByCwd(Q) {
      return (await s.client.listSessions())
        .filter((il) => il.cwd === Q)
        .map((il) => ({ id: il.id, cwd: il.cwd, updatedAt: il.updatedAt }));
    },
    useResource: () => ({ status: "failed", error: "useResource lands with plugin-mcp (M4)" }),
    async listPlugins() {
      return [];
    },
  };
  b.setRefetch((Q) => {
    s.client.snapshot(Q).then((ll) => {
      b.applySnapshot({ kind: "snapshot", sessionId: Q, snapshot: ll });
    });
  });
  async function Pl() {
    T = new AbortController();
    for await (const Q of s.client.events()) {
      if (T != null && T.signal.aborted) break;
      if (Q.kind === "snapshot") b.applySnapshot(Q);
      else if (Q.kind === "delta" && (b.applyFrame(Q), Q.delta.op === "state.updated")) {
        const ll = Q.delta.state.busy;
        if (D && !ll) for (const il of q) il({ ok: !0 });
        D = ll;
      }
      for (const ll of $) ll(Q);
    }
  }
  function lt() {
    if (z === void 0 || o === void 0) return;
    o.dataset.theme = G;
    const Q = {
      store: b,
      slots: W,
      client: s.client,
      layout: s.layout ?? "full",
      host: Dl,
      theme: G,
      safeMode: H,
      onToggleSafe: (ll) => {
        (H = ll), C == null || C(), (C = void 0), k(), lt();
      },
      onTheme: (ll) => {
        (G = ll), lt();
      },
    };
    z.render(E.createElement(h3, Q));
  }
  return {
    mount(Q) {
      (o = Q),
        o.classList.add("henira-app"),
        k(),
        (z = Gm.createRoot(Q)),
        lt(),
        Pl().catch(() => {}),
        s.client
          .listSessions()
          .then(async (il) => {
            const V = il.length === 0 ? await s.client.createSession() : il[0];
            (N = V.id), (M = V.cwd), lt();
          })
          .catch(() => {});
      let ll = 0;
      (fl = (il) => {
        if (il.key === "Alt" && !il.repeat) {
          const V = Date.now();
          V - ll < 600 ? ((H = !H), C == null || C(), (C = void 0), k(), lt(), (ll = 0)) : (ll = V);
        }
      }),
        window.addEventListener("keydown", fl);
    },
    async dispose() {
      T == null || T.abort(),
        fl !== void 0 && window.removeEventListener("keydown", fl),
        C == null || C(),
        z == null || z.unmount(),
        await s.client.stop();
    },
    setTheme(Q) {
      (G = Q), lt();
    },
    setSafeMode(Q) {
      (H = Q), C == null || C(), (C = void 0), k(), lt();
    },
  };
}
const S3 = new URLSearchParams(window.location.search),
  b3 = S3.get("token") ?? void 0,
  E3 = g3({ client: Um({ baseUrl: window.location.origin, token: b3 ?? void 0 }), layout: "full" });
E3.mount(document.getElementById("root"));

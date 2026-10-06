/**
 * Browser runtime for the bar, shipped as a string and inlined into HTML responses.
 * Plain ES5-style JS (no build step); renders inside a shadow root so app CSS can't leak in.
 * It must not contain a closing script tag.
 */
export const CLIENT_CSS = String.raw`
:host{all:initial}
*{box-sizing:border-box}
.bd{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d6dbe4;direction:ltr;text-align:left}
.bar{display:flex;align-items:stretch;height:34px;background:#15181e;border-top:1px solid #2a2f3a;overflow-x:auto;overflow-y:hidden;white-space:nowrap}
.brand{display:flex;align-items:center;gap:6px;padding:0 12px;font-weight:700;color:#fff;background:#0b6bcb;border:0;cursor:pointer;font:inherit;font-weight:700}
.item{display:flex;align-items:center;gap:6px;padding:0 12px;border:0;border-right:1px solid #232834;background:none;color:inherit;font:inherit;cursor:pointer}
.item:hover,.item.on{background:#202531;color:#fff}
.item .k{color:#8a93a6}
.badge{padding:1px 6px;border-radius:9px;background:#2a3140;color:#e8ecf3;font-size:11px}
.badge.warn{background:#7a5a00;color:#ffe08a}
.badge.bad{background:#8a1f2b;color:#ffd5da}
.badge.ok{background:#16603a;color:#c9f5da}
.spacer{flex:1}
select{background:#202531;color:inherit;border:1px solid #2f3646;border-radius:4px;font:inherit;margin:5px 8px;max-width:260px}
.panel{background:#10131a;border-top:1px solid #2a2f3a;display:flex;flex-direction:column}
.grip{height:5px;cursor:ns-resize;background:#1b202a}
.tabs{display:flex;background:#15181e;border-bottom:1px solid #232834;overflow-x:auto}
.tab{padding:7px 14px;border:0;background:none;color:#9aa3b5;font:inherit;cursor:pointer;white-space:nowrap}
.tab.on{color:#fff;box-shadow:inset 0 -2px #0b6bcb}
.tab:hover{color:#fff}
.collapse{margin-left:auto;padding:0 14px;border:0;background:none;color:#9aa3b5;font:inherit;font-size:14px;cursor:pointer}
.collapse:hover{color:#fff;background:#202531}
.body{overflow:auto;padding:10px 14px;flex:1}
table,th,td,pre,button,select{font:inherit}
table{border-collapse:collapse;width:100%}
th{text-align:left;color:#8a93a6;font-weight:600;padding:4px 8px;border-bottom:1px solid #232834}
td{padding:4px 8px;border-bottom:1px solid #1a1f29;vertical-align:top}
td.k{color:#8a93a6;width:1%;white-space:nowrap}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit}
.sql{color:#9cdcfe}
.empty{color:#7c8497;padding:8px 0}
.row{cursor:pointer}
.row:hover td{background:#161b24}
.sub{color:#8a93a6;margin:6px 0}
.sec{margin:14px 0 6px;color:#fff;font-weight:700}
.sec:first-child{margin-top:0}
.lvl{display:inline-block;min-width:62px;text-transform:uppercase;font-size:10px;color:#8a93a6}
.lvl.error,.lvl.critical,.lvl.alert,.lvl.emergency{color:#ff7b8a}
.lvl.warning,.lvl.notice{color:#ffd166}
.tl{position:relative;height:18px;margin:3px 0;background:#161b24;border-radius:3px}
.tl i{position:absolute;top:0;bottom:0;background:#0b6bcb;border-radius:3px;min-width:2px}
.tl i.q{background:#2b8a5e}
.tl i.m{background:#a05cd6}
.tl span{position:absolute;left:6px;top:1px;color:#fff;text-shadow:0 0 3px #000;white-space:nowrap}
.btn{background:#202531;color:inherit;border:1px solid #2f3646;border-radius:4px;padding:1px 8px;font:inherit;cursor:pointer}
.min{position:fixed;right:12px;bottom:12px;z-index:2147483000;background:#0b6bcb;color:#fff;border:0;border-radius:18px;padding:7px 12px;font:700 12px ui-monospace,Menlo,monospace;cursor:pointer}
.dup{color:#ffd166}
.chips{display:flex;gap:6px;margin-bottom:8px}
.chip{background:#202531;color:#9aa3b5;border:1px solid #2f3646;border-radius:12px;padding:2px 10px;font:inherit;cursor:pointer}
.chip.on{background:#0b6bcb;border-color:#0b6bcb;color:#fff}
.origin{color:#8a93a6;margin-top:2px}
.tag{display:inline-block;margin:2px 6px 0 0;padding:0 6px;border-radius:3px;font-size:10px;text-transform:uppercase}
.tag.bad{background:#8a1f2b;color:#ffd5da}
.tag.warn{background:#7a5a00;color:#ffe08a}
.np{border:1px solid #6b2630;background:#1d1217;border-radius:4px;padding:8px 10px;margin:6px 0}
.np b{color:#ff9aa6}
.slow{color:#ff7b8a}
`;

export const CLIENT_JS = String.raw`
(function () {
  var host = document.getElementById("bunyad-debugbar");
  var dataEl = document.getElementById("bunyad-debugbar-data");
  if (!host || !dataEl || host.__bd) return;
  host.__bd = true;
  var base = host.getAttribute("data-base") || "/_debugbar";
  var css = host.getAttribute("data-css") || "";
  var root = host.attachShadow({ mode: "open" });
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function pref(key, value) {
    try {
      if (arguments.length > 1) { localStorage.setItem("bunyad-debugbar:" + key, value); return value; }
      return localStorage.getItem("bunyad-debugbar:" + key);
    } catch (e) { return null; }
  }

  var state = {
    snaps: [JSON.parse(dataEl.textContent)],
    index: 0,
    tab: pref("tab"),
    qfilter: "all",
    height: parseInt(pref("height") || "320", 10),
    hidden: pref("hidden") === "1"
  };

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) add(el, c[i]); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function ms(n) { return n < 1 ? n.toFixed(2) + "ms" : n < 1000 ? n.toFixed(1) + "ms" : (n / 1000).toFixed(2) + "s"; }
  function bytes(n) { return n < 1048576 ? (n / 1024).toFixed(0) + "KB" : (n / 1048576).toFixed(1) + "MB"; }
  function pretty(v) { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  function where(o) { return o.file + ":" + o.line + (o.function ? "  \u00b7  " + o.function : ""); }
  function empty(text) { return h("div", { class: "empty" }, text); }

  function kv(obj) {
    var keys = Object.keys(obj || {});
    if (!keys.length) return empty("Nothing to show.");
    return h("table", null, keys.map(function (k) {
      return h("tr", null, h("td", { class: "k" }, k), h("td", null, h("pre", null, pretty(obj[k]))));
    }));
  }
  function section(title, body) { return [h("div", { class: "sec" }, title), body]; }
  function badgeFor(status) { return status >= 500 ? "bad" : status >= 400 ? "warn" : status >= 200 && status < 400 ? "ok" : ""; }

  function wall(s) { return s.queries.wallMs != null ? s.queries.wallMs : s.queries.totalMs; }
  function overlaps(s) { return s.queries.totalMs - wall(s) > 0.05; }
  function overlapNote(s) {
    return overlaps(s) ? ms(s.queries.totalMs) + " summed across queries; " + ms(wall(s)) + " elapsed because some ran in parallel" : "";
  }

  function snap() { return state.snaps[state.index]; }

  function tabs(s) {
    return [
      { id: "messages", label: "Messages", count: s.messages.length, render: function () {
        if (!s.messages.length) return empty("No messages. Use Debugbar.message() to add one.");
        return h("table", null, s.messages.map(function (m) {
          return h("tr", null, h("td", { class: "k" }, ms(m.at)), h("td", null, h("span", { class: "lvl " + m.level }, m.level)), h("td", null, h("pre", null, m.message)));
        }));
      } },
      { id: "timeline", label: "Timeline", count: ms(s.request.durationMs), render: function () {
        var total = Math.max(s.request.durationMs, 0.001);
        var rows = [{ label: "Request", start: 0, duration: total, cls: "" }];
        s.timeline.forEach(function (t) { rows.push({ label: t.label, start: t.start, duration: t.duration, cls: "m" }); });
        s.queries.items.forEach(function (q) { rows.push({ label: q.sql.replace(/\s+/g, " ").slice(0, 90), start: q.at, duration: q.timeMs, cls: "q" }); });
        return rows.map(function (r) {
          var left = Math.min(100, (r.start / total) * 100), width = Math.max(0.3, Math.min(100 - left, (r.duration / total) * 100));
          return h("div", { class: "tl", title: r.label + " — " + ms(r.duration) },
            h("i", { class: r.cls, style: "left:" + left + "%;width:" + width + "%" }),
            h("span", null, ms(r.duration) + "  " + r.label));
        });
      } },
      { id: "queries", label: "Queries", count: s.queries.count, render: function () {
        if (!s.queries.items.length) return empty("No queries.");
        var q = s.queries;
        var filters = [["all", "All", q.count], ["duplicate", "Duplicates", q.duplicates], ["slow", "Slow", q.slow], ["nplus", "N+1", q.nPlusOne]];
        var chips = h("div", { class: "chips" }, filters.map(function (f) {
          return h("button", { class: "chip" + (state.qfilter === f[0] ? " on" : ""), onclick: function () { state.qfilter = f[0]; render(); } }, f[1] + " (" + f[2] + ")");
        }));
        var head = h("div", { class: "sub" }, q.count + " statements, " + ms(wall(s)) + " elapsed" + (overlaps(s) ? " (" + ms(q.totalMs) + " summed: some ran in parallel)" : ""));
        var groups = q.groups.map(function (g) {
          return h("div", { class: "np" },
            h("b", null, "Possible N+1: "), g.count + " similar queries, " + ms(g.totalMs) + " total",
            h("pre", { class: "sql" }, g.sql),
            g.origin ? h("div", { class: "origin" }, where(g.origin)) : null);
        });
        var rows = [];
        q.items.forEach(function (item, i) {
          var keep = state.qfilter === "all" || (state.qfilter === "duplicate" && item.duplicate) ||
            (state.qfilter === "slow" && item.slow) || (state.qfilter === "nplus" && item.nPlusOne);
          if (!keep) return;
          var detail = h("tr", { style: "display:none" }, h("td"), h("td"), h("td", null,
            h("pre", null, "Bindings: " + JSON.stringify(item.bindings)),
            h("button", { class: "btn", onclick: function () {
              try { navigator.clipboard.writeText(item.sql + "\n-- " + JSON.stringify(item.bindings)); } catch (e) {}
            } }, "Copy SQL"),
            item.origin ? h("button", { class: "btn", style: "margin-left:6px", onclick: function () {
              try { navigator.clipboard.writeText(item.origin.file + ":" + item.origin.line); } catch (e) {}
            } }, "Copy location") : null));
          var tags = [];
          if (item.nPlusOne) tags.push(h("span", { class: "tag bad" }, "N+1 \u00d7" + item.repeats));
          if (item.duplicate) tags.push(h("span", { class: "tag warn" }, "duplicate"));
          var row = h("tr", { class: "row", onclick: function () { detail.style.display = detail.style.display === "none" ? "" : "none"; } },
            h("td", { class: "k" }, i + 1),
            h("td", { class: "k" + (item.slow ? " slow" : "") }, ms(item.timeMs)),
            h("td", null, h("pre", { class: "sql" }, item.sql), tags,
              item.origin ? h("div", { class: "origin" }, where(item.origin)) : null));
          rows.push(row, detail);
        });
        var table = rows.length
          ? h("table", null, h("tr", null, h("th", null, "#"), h("th", null, "Time"), h("th", null, "SQL")), rows)
          : empty("No queries match this filter.");
        return [chips, head, state.qfilter === "all" || state.qfilter === "nplus" ? groups : null, table];
      } },
      { id: "request", label: "Request", count: s.request.status, render: function () {
        var r = s.request;
        return [
          section("General", kv({ method: r.method, url: r.url, status: r.status, ip: r.ip, time: ms(r.durationMs), memory: bytes(r.memoryBytes), collected: s.collectedAt })),
          section("Route", kv({ name: r.route.name, parameters: r.route.params })),
          section("Query", kv(r.query)), section("Body", kv(r.body)),
          section("Request headers", kv(r.headers)), section("Cookies", kv(r.cookies)),
          section("Response headers", kv(r.responseHeaders))
        ];
      } },
      { id: "events", label: "Events", count: s.events.count, render: function () {
        if (!s.events.items.length) return empty("No events dispatched.");
        return [h("div", { class: "sub" }, s.events.count + " events" + (s.events.unhandled ? " \u00b7 " + s.events.unhandled + " with no listeners" : "")),
          h("table", null,
            h("tr", null, h("th", null, "Time"), h("th", null, "Event"), h("th", null, "Listeners")),
            s.events.items.map(function (e) {
              var detail = h("tr", { style: "display:none" }, h("td"), h("td", { colspan: 2 }, h("pre", null, e.payload || "{}")));
              var row = h("tr", { class: "row", onclick: function () { detail.style.display = detail.style.display === "none" ? "" : "none"; } },
                h("td", { class: "k" }, ms(e.timeMs)),
                h("td", null, h("pre", null, e.name), e.failed ? h("span", { class: "tag bad" }, "failed") : null),
                h("td", { class: "k" + (e.listeners === 0 ? " dup" : "") }, e.listeners));
              return [row, detail];
            }))];
      } },
      { id: "logs", label: "Logs", count: s.logs.length, render: function () {
        if (!s.logs.length) return empty("No log entries.");
        return h("table", null, s.logs.map(function (l) {
          return h("tr", null, h("td", { class: "k" }, ms(l.at)), h("td", null, h("span", { class: "lvl " + l.level }, l.level)),
            h("td", null, h("pre", null, l.message + (l.context ? "\n" + JSON.stringify(l.context) : ""))));
        }));
      } },
      { id: "cache", label: "Cache", count: s.cache.items.length, render: function () {
        if (!s.cache.items.length) return empty("No cache activity.");
        return [h("div", { class: "sub" }, s.cache.hits + " hits · " + s.cache.misses + " misses · " + s.cache.writes + " writes"),
          h("table", null, s.cache.items.map(function (c) {
            return h("tr", null, h("td", { class: "k" }, ms(c.at)), h("td", null, c.type), h("td", null, c.key), h("td", { class: "k" }, c.store || ""));
          }))];
      } },
      { id: "exceptions", label: "Exceptions", count: s.exceptions.length, bad: s.exceptions.length > 0, render: function () {
        if (!s.exceptions.length) return empty("No exceptions.");
        return s.exceptions.map(function (e) {
          return [h("div", { class: "sec slow" }, e.name + ": " + e.message), h("pre", null, e.stack)];
        });
      } }
    ];
  }

  function item(label, value, opts) {
    opts = opts || {};
    return h("button", { class: "item" + (opts.on ? " on" : ""), onclick: opts.onclick, title: opts.title || "" },
      label ? h("span", { class: "k" }, label) : null,
      value != null ? h("span", { class: "badge " + (opts.cls || "") }, value) : null);
  }

  function render() {
    var s = snap();
    var all = tabs(s);
    root.innerHTML = "";
    root.appendChild(h("style", null, css));
    if (state.hidden) {
      root.appendChild(h("button", { class: "min", onclick: function () { state.hidden = false; pref("hidden", "0"); render(); } }, "Bunyad"));
      return;
    }
    var open = all.filter(function (t) { return t.id === state.tab; })[0];
    function toggle(id) { state.tab = state.tab === id ? null : id; pref("tab", state.tab || ""); render(); }

    var bar = h("div", { class: "bar" },
      h("button", { class: "brand", title: "Request history", onclick: function () { window.open(base, "_blank"); } }, "Bunyad"),
      item(s.request.method, s.request.path + " ", { cls: badgeFor(s.request.status), onclick: function () { toggle("request"); }, on: state.tab === "request", title: s.request.url }),
      item("status", s.request.status, { cls: badgeFor(s.request.status), onclick: function () { toggle("request"); } }),
      item("route", s.request.route.name || "—", { onclick: function () { toggle("request"); } }),
      item("queries", s.queries.count + " · " + ms(wall(s)), { cls: s.queries.nPlusOne ? "bad" : s.queries.duplicates || s.queries.slow ? "warn" : "", title: (s.queries.nPlusOne ? "Possible N+1 queries detected. " : "") + overlapNote(s), onclick: function () { toggle("queries"); }, on: state.tab === "queries" }),
      item("time", ms(s.request.durationMs), { onclick: function () { toggle("timeline"); }, on: state.tab === "timeline" }),
      item("memory", bytes(s.request.memoryBytes)),
      item("exceptions", s.exceptions.length, { cls: s.exceptions.length ? "bad" : "", onclick: function () { toggle("exceptions"); }, on: state.tab === "exceptions" }),
      item("events", s.events.count, { onclick: function () { toggle("events"); }, on: state.tab === "events" }),
      item("logs", s.logs.length, { onclick: function () { toggle("logs"); }, on: state.tab === "logs" }),
      item("cache", s.cache.items.length, { onclick: function () { toggle("cache"); }, on: state.tab === "cache" }),
      h("span", { class: "spacer" }),
      state.snaps.length > 1 ? h("select", { title: "Requests on this page", onchange: function (e) { state.index = parseInt(e.target.value, 10); render(); } },
        state.snaps.map(function (x, i) {
          var opt = h("option", { value: i }, x.request.method + " " + x.request.path + " (" + x.request.status + ")");
          if (i === state.index) opt.setAttribute("selected", "selected");
          return opt;
        })) : null,
      item("", "×", { title: "Minimize", onclick: function () { state.hidden = true; pref("hidden", "1"); render(); } }));

    var wrap = h("div", { class: "bd" });
    if (open) {
      var body = h("div", { class: "body" }, open.render());
      var grip = h("div", { class: "grip", onmousedown: function (e) {
        var startY = e.clientY, startH = state.height;
        function move(ev) { state.height = Math.max(120, Math.min(window.innerHeight - 80, startH + (startY - ev.clientY))); panel.style.height = state.height + "px"; }
        function up() { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); pref("height", String(state.height)); }
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
        e.preventDefault();
      } });
      var panel = h("div", { class: "panel", style: "height:" + state.height + "px" }, grip,
        h("div", { class: "tabs" }, all.map(function (t) {
          return h("button", { class: "tab" + (t.id === state.tab ? " on" : ""), onclick: function () { state.tab = t.id; pref("tab", t.id); render(); } }, t.label + " (" + t.count + ")");
        }), h("button", { class: "collapse", title: "Collapse panel", "aria-label": "Collapse panel", onclick: function () { state.tab = null; pref("tab", ""); render(); } }, "\u2715")), body);
      wrap.appendChild(panel);
    }
    wrap.appendChild(bar);
    root.appendChild(wrap);
  }

  function track(id) {
    if (!id || !nativeFetch) return;
    for (var i = 0; i < state.snaps.length; i++) if (state.snaps[i].id === id) return;
    nativeFetch(base + "/" + id, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        state.snaps.push(s);
        if (state.snaps.length > 30) { state.snaps.splice(1, 1); }
        state.index = state.snaps.length - 1;
        render();
      })["catch"](function () {});
  }

  if (nativeFetch) {
    window.fetch = function () {
      return nativeFetch.apply(window, arguments).then(function (res) {
        try { track(res.headers.get("X-Debugbar-Id")); } catch (e) {}
        return res;
      });
    };
  }
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener("loadend", function () {
      try { track(xhr.getResponseHeader("X-Debugbar-Id")); } catch (e) {}
    });
    return xhrSend.apply(xhr, arguments);
  };

  render();
})();
`;

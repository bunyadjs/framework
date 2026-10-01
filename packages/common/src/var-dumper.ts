/**
 * Interactive HTML dumps for `dd()` / `dump()` in the browser
 * (collapsible tree, dark theme, colored scalars).
 */

export type DumpTheme = "dark" | "light";

const THEMES: Record<
  DumpTheme,
  Record<string, string>
> = {
  dark: {
    default:
      "background-color:#18171B; color:#FF8400; line-height:1.2em; font:12px Menlo, Monaco, Consolas, monospace; word-wrap: break-word; white-space: pre-wrap; position:relative; z-index:99999; word-break: break-all",
    num: "font-weight:bold; color:#1299DA",
    const: "font-weight:bold",
    str: "font-weight:bold; color:#56DB3A",
    note: "color:#1299DA",
    ref: "color:#A0A0A0",
    public: "color:#FFFFFF",
    protected: "color:#FFFFFF",
    private: "color:#FFFFFF",
    meta: "color:#B729D9",
    key: "color:#56DB3A",
    index: "color:#1299DA",
    ellipsis: "color:#FF8400",
  },
  light: {
    default:
      "background:none; color:#CC7832; line-height:1.2em; font:12px Menlo, Monaco, Consolas, monospace; word-wrap: break-word; white-space: pre-wrap; position:relative; z-index:99999; word-break: break-all",
    num: "font-weight:bold; color:#1299DA",
    const: "font-weight:bold",
    str: "font-weight:bold; color:#629755",
    note: "color:#6897BB",
    ref: "color:#6E6E6E",
    public: "color:#262626",
    protected: "color:#262626",
    private: "color:#262626",
    meta: "color:#B729D9",
    key: "color:#789339",
    index: "color:#1299DA",
    ellipsis: "color:#CC7832",
  },
};

const MAX_DEPTH = 20;
const MAX_STRING = 160;
const COLLAPSE_DEPTH = 1;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function span(cls: string, body: string): string {
  return `<span class=sf-dump-${cls}>${body}</span>`;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function classLabel(value: object): string {
  const name = value.constructor?.name;
  if (name && name !== "Object") return name;
  return "Object";
}

/**
 * Live list inside a Collection. `toJSON()` maps each item through its own
 * `toJSON()`, which drops the class (`Category` becomes a plain object).
 */
function collectionItems(obj: object): unknown[] | undefined {
  let current: object | null = obj;
  let isCollection = false;
  while (current && current !== Object.prototype) {
    if (current.constructor?.name === "Collection") {
      isCollection = true;
      break;
    }
    current = Object.getPrototypeOf(current);
  }
  if (!isCollection) return undefined;
  const all = (obj as { all?: () => unknown }).all;
  if (typeof all !== "function") return undefined;
  try {
    const items = all.call(obj);
    return Array.isArray(items) ? items : undefined;
  } catch {
    return undefined;
  }
}

/** Duck-type models that expose `getAttributes()`. */
function modelDumpParts(
  value: object,
): { label: string; attrs: Record<string, unknown> } | null {
  const rec = value as {
    getAttributes?: () => Record<string, unknown>;
    toJSON?: () => unknown;
    constructor?: { name?: string };
  };
  if (typeof rec.getAttributes === "function") {
    try {
      return {
        label: rec.constructor?.name ?? "Model",
        attrs: rec.getAttributes(),
      };
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** JSON-safe snapshot for Flock ingest (`JSON.stringify(Promise)` is `{}`). */
export function serializeDumpValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const t = typeof value;
  if (t === "string" || t === "boolean") {
    return value;
  }
  if (t === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (t === "bigint") {
    return `${value}n`;
  }
  if (t === "symbol" || t === "function") {
    return String(value);
  }
  if (t !== "object") {
    return String(value);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    return "[Circular]";
  }
  seen.add(obj);

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDumpValue(item, seen));
  }
  if (value instanceof Map) {
    return {
      __class: "Map",
      entries: [...value.entries()].map(([key, item]) => [
        serializeDumpValue(key, seen),
        serializeDumpValue(item, seen),
      ]),
    };
  }
  if (value instanceof Set) {
    return {
      __class: "Set",
      values: [...value].map((item) => serializeDumpValue(item, seen)),
    };
  }

  const model = modelDumpParts(obj);
  if (model) {
    const attrs = Object.fromEntries(
      Object.entries(model.attrs).map(([key, item]) => [
        key,
        serializeDumpValue(item, seen),
      ]),
    );
    return { __class: model.label, ...attrs };
  }

  const listed = collectionItems(obj);
  if (listed) {
    return {
      __class: classLabel(obj),
      items: listed.map((item) => serializeDumpValue(item, seen)),
    };
  }

  const rec = obj as { toJSON?: () => unknown; constructor?: { name?: string } };
  if (typeof rec.toJSON === "function" && !isPlainObject(obj)) {
    try {
      const json = rec.toJSON();
      const snapshot = serializeDumpValue(json, seen);
      if (snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)) {
        return { __class: rec.constructor?.name ?? classLabel(obj), ...(snapshot as Record<string, unknown>) };
      }
      return snapshot;
    } catch {
      /* fall through */
    }
  }

  if (isPlainObject(obj)) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, item]) => [key, serializeDumpValue(item, seen)]),
    );
  }

  const out: Record<string, unknown> = { __class: classLabel(obj) };
  for (const key of Object.keys(obj)) {
    try {
      out[key] = serializeDumpValue((obj as Record<string, unknown>)[key], seen);
    } catch {
      out[key] = "<thrown>";
    }
  }
  return out;
}

type Seen = WeakMap<object, number>;

function dumpValue(
  value: unknown,
  depth: number,
  seen: Seen,
  nextId: { n: number },
): string {
  if (value === null) return span("const", "null");
  if (value === undefined) return span("const", "undefined");

  switch (typeof value) {
    case "boolean":
      return span("const", value ? "true" : "false");
    case "number":
      return span("num", Number.isFinite(value) ? String(value) : String(value));
    case "bigint":
      return span("num", `${value}n`);
    case "string": {
      const raw = value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…`
        : value;
      const shown = escapeHtml(JSON.stringify(raw));
      const note =
        value.length > MAX_STRING
          ? ` ${span("note", `${value.length}`)}`
          : "";
      return `${span("str", shown)}${note}`;
    }
    case "symbol":
      return span("const", escapeHtml(String(value)));
    case "function": {
      const name = (value as { name?: string }).name || "anonymous";
      return `${span("note", "Function")} ${span("meta", escapeHtml(name))}()`;
    }
    case "object":
      break;
    default:
      return span("const", escapeHtml(String(value)));
  }

  const obj = value as object;

  if (obj instanceof Date) {
    return `${span("note", "Date")} ${span("str", escapeHtml(obj.toISOString()))}`;
  }
  if (obj instanceof RegExp) {
    return span("str", escapeHtml(String(obj)));
  }
  if (obj instanceof Error) {
    return dumpObjectLike(
      obj.name || "Error",
      {
        message: obj.message,
        stack: obj.stack,
      },
      depth,
      seen,
      nextId,
      obj,
    );
  }
  if (typeof Promise !== "undefined" && obj instanceof Promise) {
    return `${span("note", "Promise")} { ${span("meta", "<pending>") } }`;
  }
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    const len =
      obj instanceof ArrayBuffer
        ? obj.byteLength
        : (obj as ArrayBufferView).byteLength;
    return `${span("note", obj.constructor.name)} { ${span("meta", `${len} bytes`)} }`;
  }

  if (seen.has(obj)) {
    return `${span("note", classLabel(obj))} {${span("ref", `#${seen.get(obj)}`)} ${span("meta", "…circular")}}`;
  }

  if (Array.isArray(obj)) {
    return dumpArray(obj, depth, seen, nextId);
  }
  if (obj instanceof Map) {
    return dumpMap(obj, depth, seen, nextId);
  }
  if (obj instanceof Set) {
    return dumpSet(obj, depth, seen, nextId);
  }

  const model = modelDumpParts(obj);
  if (model) {
    return dumpObjectLike(model.label, model.attrs, depth, seen, nextId, obj);
  }

  const listed = collectionItems(obj);
  if (listed) {
    return `${span("note", classLabel(obj))} ${dumpArray(listed, depth, seen, nextId)}`;
  }

  if (
    typeof (obj as { toJSON?: unknown }).toJSON === "function" &&
    !isPlainObject(obj)
  ) {
    try {
      const json = (obj as { toJSON: () => unknown }).toJSON();
      if (json !== null && typeof json === "object" && !Array.isArray(json)) {
        return dumpObjectLike(
          classLabel(obj),
          json as Record<string, unknown>,
          depth,
          seen,
          nextId,
          obj,
        );
      }
      return `${span("note", classLabel(obj))} ${dumpValue(json, depth, seen, nextId)}`;
    } catch {
      /* fall through */
    }
  }

  const items =
    typeof (obj as { all?: unknown }).all === "function"
      ? (() => {
          try {
            return (obj as { all: () => unknown }).all();
          } catch {
            return undefined;
          }
        })()
      : undefined;
  if (Array.isArray(items)) {
    return `${span("note", classLabel(obj))} ${dumpArray(items, depth, seen, nextId)}`;
  }

  const entries: Record<string, unknown> = {};
  if (isPlainObject(obj)) {
    Object.assign(entries, obj);
  } else {
    for (const key of Reflect.ownKeys(obj)) {
      if (typeof key === "symbol") continue;
      try {
        entries[key] = (obj as Record<string, unknown>)[key];
      } catch {
        entries[key] = "<thrown>";
      }
    }
  }
  return dumpObjectLike(classLabel(obj), entries, depth, seen, nextId, obj);
}

function dumpArray(
  items: unknown[],
  depth: number,
  seen: Seen,
  nextId: { n: number },
): string {
  const id = ++nextId.n;
  seen.set(items, id);
  const count = items.length;
  const note = span("note", `array:${count}`);
  if (count === 0) return `${note} []`;
  if (depth >= MAX_DEPTH) {
    return `${note} [ ${span("ellipsis", "…")} ]`;
  }
  const compact = depth >= COLLAPSE_DEPTH;
  const openClass = compact ? "sf-dump-compact" : "sf-dump-expanded";
  const rows = items
    .map((item, i) => {
      const key = span("index", String(i));
      const val = dumpValue(item, depth + 1, seen, nextId);
      return `<samp data-depth=${depth + 1} class=${openClass}><span class=sf-dump-index>${key}</span> => ${val}\n</samp>`;
    })
    .join("");
  const toggle = `<a class=sf-dump-ref>${compact ? "<span>▶</span>" : "<span>▼</span>"}</a>`;
  return `${note} ${toggle}[<samp>\n${rows}</samp>]`;
}

function dumpMap(
  map: Map<unknown, unknown>,
  depth: number,
  seen: Seen,
  nextId: { n: number },
): string {
  const id = ++nextId.n;
  seen.set(map, id);
  const note = span("note", `Map:${map.size}`);
  if (map.size === 0) return `${note} {}`;
  const compact = depth >= COLLAPSE_DEPTH;
  const openClass = compact ? "sf-dump-compact" : "sf-dump-expanded";
  const rows: string[] = [];
  let i = 0;
  for (const [k, v] of map) {
    rows.push(
      `<samp data-depth=${depth + 1} class=${openClass}><span class=sf-dump-index>${span("index", String(i++))}</span> => ${dumpValue(k, depth + 1, seen, nextId)} => ${dumpValue(v, depth + 1, seen, nextId)}\n</samp>`,
    );
  }
  const toggle = `<a class=sf-dump-ref>${compact ? "<span>▶</span>" : "<span>▼</span>"}</a>`;
  return `${note} ${toggle}{<samp>\n${rows.join("")}</samp>}`;
}

function dumpSet(
  set: Set<unknown>,
  depth: number,
  seen: Seen,
  nextId: { n: number },
): string {
  const id = ++nextId.n;
  seen.set(set, id);
  const note = span("note", `Set:${set.size}`);
  if (set.size === 0) return `${note} {}`;
  const compact = depth >= COLLAPSE_DEPTH;
  const openClass = compact ? "sf-dump-compact" : "sf-dump-expanded";
  const rows: string[] = [];
  let i = 0;
  for (const v of set) {
    rows.push(
      `<samp data-depth=${depth + 1} class=${openClass}><span class=sf-dump-index>${span("index", String(i++))}</span> => ${dumpValue(v, depth + 1, seen, nextId)}\n</samp>`,
    );
  }
  const toggle = `<a class=sf-dump-ref>${compact ? "<span>▶</span>" : "<span>▼</span>"}</a>`;
  return `${note} ${toggle}{<samp>\n${rows.join("")}</samp>}`;
}

function dumpObjectLike(
  label: string,
  entries: Record<string, unknown>,
  depth: number,
  seen: Seen,
  nextId: { n: number },
  identity: object,
): string {
  const id = ++nextId.n;
  seen.set(identity, id);
  const keys = Object.keys(entries);
  const note = `${span("note", escapeHtml(label))} {${span("ref", `#${id}`)}`;
  if (keys.length === 0) return `${note}}`;
  if (depth >= MAX_DEPTH) {
    return `${note} ${span("ellipsis", "…")}}`;
  }
  const compact = depth >= COLLAPSE_DEPTH;
  const openClass = compact ? "sf-dump-compact" : "sf-dump-expanded";
  const rows = keys
    .map((key) => {
      const keyHtml = span("public", escapeHtml(key));
      const val = dumpValue(entries[key], depth + 1, seen, nextId);
      return `<samp data-depth=${depth + 1} class=${openClass}>  +${keyHtml}: ${val}\n</samp>`;
    })
    .join("");
  const toggle = `<a class=sf-dump-ref>${compact ? "<span>▶</span>" : "<span>▼</span>"}</a>`;
  return `${note} ${toggle}<samp>\n${rows}</samp>}`;
}

function dumpStyles(theme: DumpTheme): string {
  const styles = THEMES[theme];
  let css = "";
  for (const [cls, style] of Object.entries(styles)) {
    if (cls === "default") {
      css += `pre.sf-dump, pre.sf-dump .sf-dump-default{${style}}`;
    } else {
      css += `pre.sf-dump .sf-dump-${cls}{${style}}`;
    }
  }
  css += `
.sf-js-enabled pre.sf-dump .sf-dump-compact { display: none; }
pre.sf-dump { display:block; white-space:pre; padding:5px; overflow:auto !important; margin:0 0 1rem; border-radius:3px; }
pre.sf-dump a { text-decoration:none; cursor:pointer; border:0; outline:none; color:inherit; }
pre.sf-dump .sf-dump-ref { color: inherit; }
.sf-dump-hover:hover { background-color:#B729D9; color:#FFF !important; border-radius:2px; }
body.sf-dump-body { margin:0; padding:1.25rem; background:#F9F9F9; color:#222; font-family:Helvetica,Arial,sans-serif; font-size:14px; }
body.sf-dump-body.sf-dump-dark { background:#0f0f12; color:#e8e8e8; }
.sf-dump-title { font:12px Menlo,Monaco,Consolas,monospace; color:#cc2255; margin:0 0 .75rem; }
`;
  return css;
}

const DUMP_SCRIPT = `<script>(function(){
document.documentElement.className='sf-js-enabled';
document.addEventListener('click',function(e){
  var a=e.target;
  while(a&&a.tagName!=='A')a=a.parentNode;
  if(!a||!/\\bsf-dump-ref\\b/.test(a.className))return;
  e.preventDefault();
  var root=a.parentNode;
  if(!root)return;
  var samples=root.querySelectorAll(':scope > samp > samp, :scope > samp.sf-dump-compact, :scope > samp.sf-dump-expanded');
  if(!samples.length){
    var wrap=a.nextElementSibling;
    if(wrap)samples=wrap.querySelectorAll(':scope > samp');
  }
  var expand=a.textContent.indexOf('▶')!==-1;
  a.innerHTML=expand?'<span>▼</span>':'<span>▶</span>';
  for(var i=0;i<samples.length;i++){
    var s=samples[i];
    s.className=s.className.replace(/\\bsf-dump-(compact|expanded)\\b/, expand?'sf-dump-expanded':'sf-dump-compact');
  }
},false);
})();</script>`;

/** Render one value as an `sf-dump` `<pre>` block. */
export function dumpHtml(value: unknown, theme: DumpTheme = "dark"): string {
  const id = `sf-dump-${Math.floor(Math.random() * 1e9)}`;
  const html = dumpValue(value, 0, new WeakMap(), { n: 0 });
  return `<pre class=sf-dump id=${id} data-indent-pad="  ">${html}</pre>`;
}

/** Full HTML document for HTTP `dd()` responses. */
export function renderDdHtmlPage(
  values: unknown[],
  theme: DumpTheme = "dark",
): string {
  const blocks = values.map((v) => dumpHtml(v, theme)).join("\n");
  const bodyClass =
    theme === "dark" ? "sf-dump-body sf-dump-dark" : "sf-dump-body";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>dd()</title>
<style>${dumpStyles(theme)}</style>
</head>
<body class="${bodyClass}">
<div class="sf-dump-title">dd()</div>
${blocks}
${DUMP_SCRIPT}
</body>
</html>`;
}

/** Await thenables so `dd(Model.find(1))` dumps the model, not a Promise. */
export async function resolveDumpValues(
  values: unknown[],
): Promise<unknown[]> {
  return Promise.all(
    values.map(async (value) => {
      if (
        value != null &&
        typeof (value as { then?: unknown }).then === "function"
      ) {
        return await value;
      }
      return value;
    }),
  );
}

/**
 * Escape HTML for {{ }} echoes.
 */
import { BunyadError } from "@bunyad/common";
import { AttributeBag as AttributeBagCtor } from "./attributes.ts";
import {
  viewAuthCheck,
  viewCanCheck,
  viewCannotCheck,
  viewGuestCheck,
} from "./auth-helpers.ts";
import { toCssClasses, toCssStyles } from "./css.ts";
import { renderHead as getRenderHead } from "./helpers.ts";

/** True when a value is "empty" (nullish, false, 0, "", "0", [], {}). */
export function viewIsEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return value.length === 0 || value === "0";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Current app environment from view data (`__env` or `app.env`). */
export function viewEnvOf(data: Record<string, unknown>): string {
  if (typeof data.__env === "string") return data.__env;
  const app = data.app;
  if (app && typeof app === "object" && typeof (app as { env?: unknown }).env === "string") {
    return (app as { env: string }).env;
  }
  return "production";
}

/** Whether the current env matches a string or list of names. */
export function viewEnvIs(
  data: Record<string, unknown>,
  target: string | readonly string[],
): boolean {
  const env = viewEnvOf(data);
  if (Array.isArray(target)) return target.includes(env);
  return env === target;
}

export function escapeHtml(value: unknown): string {
  if (
    value != null &&
    typeof (value as { toHTML?: unknown }).toHTML === "function"
  ) {
    return (value as { toHTML: () => string }).toHTML();
  }
  const s = value == null ? "" : String(value);
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** JSON safe to embed in HTML / <script> (no raw </script> / U+2028). */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

const RESERVED = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "new",
  "typeof",
  "instanceof",
  "return",
  "in",
  "of",
  "void",
]);

/** Reject prototype / eval escapes in compiled expressions. */
const UNSAFE_EXPR =
  /(\.constructor\b|\[['"]constructor['"]\]|\.__proto__\b|\[['"]__proto__['"]\]|\b(?:eval|Function)\s*\()/;

export function assertSafeExpr(expr: string): void {
  if (UNSAFE_EXPR.test(expr)) {
    throw new BunyadError(
      `Unsafe expression in view template: ${expr.trim().slice(0, 80)}`,
      "BUNYAD_VIEW_005",
    );
  }
}

export type ComponentRenderer = (
  name: string,
  props: Record<string, unknown>,
) => string;

export type IncludeRenderer = (
  name: string,
  data: Record<string, unknown>,
) => string;

/**
 * Compile a view expression.
 * Prefer `title` / `user.name` (no `$`). Optional `$title` still works.
 * Free identifiers resolve from the data bag (`__d`), not the process global scope.
 */
function compileExpr(expr: string, locals: Set<string>): string {
  assertSafeExpr(expr);
  const normalized = expr.trim().replace(/\$([a-zA-Z_][\w]*)/g, "$1");
  let out = "";
  let i = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (i < normalized.length) {
    const ch = normalized[i]!;

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += quote;
      i += 1;
      while (i < normalized.length && normalized[i] !== quote) {
        if (normalized[i] === "\\") {
          out += normalized.slice(i, i + 2);
          i += 2;
          continue;
        }
        const inner = normalized[i]!;
        if (inner === "\r" || inner === "\n") {
          out += "\\n";
          if (inner === "\r" && normalized[i + 1] === "\n") {
            i += 1;
          }
          i += 1;
          continue;
        }
        out += inner;
        i += 1;
      }
      if (i < normalized.length) {
        out += normalized[i]!;
        i += 1;
      }
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      out += ch;
      i += 1;
      continue;
    }

    if (
      /[a-zA-Z_]/.test(ch) &&
      (i === 0 || /[^\.\w]/.test(normalized[i - 1]!))
    ) {
      const start = i;
      i += 1;
      while (i < normalized.length && /[\w]/.test(normalized[i]!)) i += 1;
      const name = normalized.slice(start, i);
      let j = i;
      while (j < normalized.length && /\s/.test(normalized[j]!)) j += 1;
      const isObjectKey =
        braceDepth > 0 &&
        normalized[j] === ":" &&
        (j + 1 >= normalized.length || normalized[j + 1] !== ":");
      out +=
        isObjectKey || RESERVED.has(name) || locals.has(name)
          ? name
          : `__d.${name}`;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Compile a `.view` template into a render function.
 * Supports: {{ }}, {!! !!}, @if/@elseif/@else/@endif, @unless/@endunless,
 * @isset/@endisset, @empty(...)/@endempty, @switch/@case/@break/@default/@endswitch,
 * @foreach/@endforeach, @forelse/@empty/@endforelse, loop object,
 * @auth/@guest/@can/@cannot, @production/@env, @class/@style, @error/@enderror,
 * @props, @include, @push/@endpush, @prepend/@endprepend, @stack, @once/@endonce,
 * @head, @use/@import, @let, @json, <x-*> components (including named <x-slot>).
 *
 * Not supported (by design): `@php` / arbitrary module imports from the template.
 */
export function compile(
  source: string,
): (
  data: Record<string, unknown>,
  c?: ComponentRenderer,
  i?: IncludeRenderer,
) => string {
  const body = renderFunctionBody(source);
  let fn: (
    data: Record<string, unknown>,
    e: typeof escapeHtml,
    c: ComponentRenderer,
    i: IncludeRenderer,
    AttributeBag: typeof import("./attributes.ts").AttributeBag,
    head: () => string,
    json: typeof jsonForHtml,
    toClasses: typeof toCssClasses,
    toStyles: typeof toCssStyles,
    authCheck: typeof viewAuthCheck,
    guestCheck: typeof viewGuestCheck,
    canCheck: typeof viewCanCheck,
    cannotCheck: typeof viewCannotCheck,
    viewEmpty: typeof viewIsEmpty,
    viewEnv: typeof viewEnvOf,
    viewEnvIsFn: typeof viewEnvIs,
  ) => string;
  try {
    fn = new Function(
      "__d",
      "e",
      "c",
      "i",
      "__AttributeBag",
      "__head",
      "__json",
      "__toCssClasses",
      "__toCssStyles",
      "__viewAuth",
      "__viewGuest",
      "__viewCan",
      "__viewCannot",
      "__viewEmpty",
      "__viewEnv",
      "__viewEnvIs",
      body,
    ) as typeof fn;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BunyadError(
      `Failed to compile view (${message}).`,
      "BUNYAD_VIEW_008",
    );
  }
  return (data, c = () => "", i = () => "") =>
    fn(
      data,
      escapeHtml,
      c,
      i,
      AttributeBagCtor,
      getRenderHead,
      jsonForHtml,
      toCssClasses,
      toCssStyles,
      viewAuthCheck,
      viewGuestCheck,
      viewCanCheck,
      viewCannotCheck,
      viewIsEmpty,
      viewEnvOf,
      viewEnvIs,
    );
}

/** Shared function body used by `compile` and `compileToModuleSource`. */
function renderFunctionBody(source: string): string {
  return (
    `const __stacks=(__d.__stacks||(__d.__stacks={}));\n` +
    `const __once=(__d.__once||(__d.__once=new Set()));\n` +
    `const __helpers=(__d.__helpers&&typeof __d.__helpers==="object")?__d.__helpers:{};\n` +
    compileBody(stripComments(source), new Set())
  );
}

/** `{{-- … --}}` comments never reach the output. */
function stripComments(source: string): string {
  return source.replace(/\{\{--[\s\S]*?--\}\}/g, "");
}

/**
 * Emit an ES module that exports `render` for a precompiled view.
 */
export function compileToModuleSource(source: string): string {
  const body = renderFunctionBody(source);
  return `import { escapeHtml as e, AttributeBag as __AttributeBag, renderHead as __head, jsonForHtml as __json, toCssClasses as __toCssClasses, toCssStyles as __toCssStyles, viewAuthCheck as __viewAuth, viewGuestCheck as __viewGuest, viewCanCheck as __viewCan, viewCannotCheck as __viewCannot, viewIsEmpty as __viewEmpty, viewEnvOf as __viewEnv, viewEnvIs as __viewEnvIs } from "@bunyad/view";

export function render(__d = {}, c = () => "", i = () => "") {
${body}
}
`;
}

let onceSeq = 0;

function compileBody(source: string, locals: Set<string>): string {
  const localStack: string[] = [];
  let out = 'let __o="";\n';
  let i = 0;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    out += `__o+=${JSON.stringify(text)};\n`;
  };

  while (i < source.length) {
    if (source.startsWith("<x-", i)) {
      const tag = parseComponent(source, i);
      if (tag) {
        const props: string[] = [];
        for (const attr of tag.attrs) {
          if (attr.bind) {
            props.push(
              `${JSON.stringify(attr.key)}:${compileExpr(attr.value, locals)}`,
            );
          } else {
            props.push(
              `${JSON.stringify(attr.key)}:${JSON.stringify(attr.value)}`,
            );
          }
        }
        if (tag.slot.length > 0) {
          const slots = extractNamedSlots(tag.slot);
          for (const [slotName, body] of Object.entries(slots.named)) {
            const slotFn = compileBody(body, new Set(locals));
            props.push(`${JSON.stringify(slotName)}:(()=>{${slotFn}})()`);
          }
          if (slots.defaultSlot.trim().length > 0) {
            const slotFn = compileBody(slots.defaultSlot, new Set(locals));
            props.push(`slot:(()=>{${slotFn}})()`);
          } else {
            props.push(`slot:""`);
          }
        } else {
          props.push(`slot:""`);
        }
        out += `__o+=c(${JSON.stringify(tag.name)},{${props.join(",")}});\n`;
        i = tag.end;
        continue;
      }
    }

    if (source.startsWith("{!!", i)) {
      const end = source.indexOf("!!}", i + 3);
      const expr = compileExpr(source.slice(i + 3, end), locals);
      out += `__o+=(${expr})??"";\n`;
      i = end + 3;
      continue;
    }

    if (source.startsWith("{{", i)) {
      const end = source.indexOf("}}", i + 2);
      const expr = compileExpr(source.slice(i + 2, end), locals);
      out += `__o+=e(${expr});\n`;
      i = end + 2;
      continue;
    }

    if (source[i] === "@") {
      const rest = source.slice(i);

      if (rest.startsWith("@php")) {
        throw new BunyadError(
          "Register helpers with ViewFactory.use() and @use('name'), use @let(name = expr), Controllers, or class Components.",
          "BUNYAD_VIEW_004",
        );
      }

      if (rest.startsWith("@foreach")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@foreach");
        const inside = rest.slice(open + 1, close);
        const [iterable, alias] = inside.split(/\s+as\s+/);
        const item = alias!.trim().replace(/^\$/, "");
        locals.add(item);
        locals.add("loop");
        localStack.push(item);
        localStack.push("loop");
        const iterExpr = compileExpr(iterable!, locals);
        out += `{\nconst __iter=Array.from((${iterExpr})??[]);\nconst __count=__iter.length;\nlet __i=0;\nfor (const ${item} of __iter) {\nconst loop={index:__i,iteration:__i+1,first:__i===0,last:__i===__count-1,count:__count};\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endforeach")) {
        out += "__i+=1;}\n}\n";
        const loopVar = localStack.pop();
        const item = localStack.pop();
        if (loopVar && !localStack.includes(loopVar)) locals.delete(loopVar);
        if (item && !localStack.includes(item)) locals.delete(item);
        i += "@endforeach".length;
        continue;
      }

      if (rest.startsWith("@forelse")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@forelse");
        const inside = rest.slice(open + 1, close);
        const [iterable, alias] = inside.split(/\s+as\s+/);
        const item = alias!.trim().replace(/^\$/, "");
        const contentStart = i + close + 1;
        const split = splitForelse(source, contentStart);
        const loopLocals = new Set(locals);
        loopLocals.add(item);
        loopLocals.add("loop");
        const loopBody = compileBody(split.loopBody, loopLocals);
        const emptyBody = compileBody(split.emptyBody, new Set(locals));
        const iterExpr = compileExpr(iterable!, locals);
        out += `{\nconst __iter=Array.from((${iterExpr})??[]);\nconst __count=__iter.length;\nif(__count>0){\nlet __i=0;\nfor (const ${item} of __iter) {\nconst loop={index:__i,iteration:__i+1,first:__i===0,last:__i===__count-1,count:__count};\n__o+=(()=>{${loopBody}})();\n__i+=1;}\n} else {\n__o+=(()=>{${emptyBody}})();\n}\n}\n`;
        i = split.end;
        continue;
      }

      if (rest.startsWith("@auth")) {
        const after = rest.slice("@auth".length);
        let guardArg = "";
        let consumed = "@auth".length;
        if (after.trimStart().startsWith("(")) {
          const open = rest.indexOf("(");
          const close = requireMatchingParen(rest, open, "@auth");
          const raw = rest.slice(open + 1, close).trim();
          guardArg = raw ? `,${compileExpr(raw, locals)}` : "";
          consumed = close + 1;
        }
        out += `if (__viewAuth(__d${guardArg})) {\n`;
        i += consumed;
        continue;
      }

      if (rest.startsWith("@endauth")) {
        out += "}\n";
        i += "@endauth".length;
        continue;
      }

      if (rest.startsWith("@guest")) {
        const after = rest.slice("@guest".length);
        let guardArg = "";
        let consumed = "@guest".length;
        if (after.trimStart().startsWith("(")) {
          const open = rest.indexOf("(");
          const close = requireMatchingParen(rest, open, "@guest");
          const raw = rest.slice(open + 1, close).trim();
          guardArg = raw ? `,${compileExpr(raw, locals)}` : "";
          consumed = close + 1;
        }
        out += `if (__viewGuest(__d${guardArg})) {\n`;
        i += consumed;
        continue;
      }

      if (rest.startsWith("@endguest")) {
        out += "}\n";
        i += "@endguest".length;
        continue;
      }

      if (rest.startsWith("@cannot")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError(
            "@cannot requires ('ability', ...args).",
            "BUNYAD_VIEW_008",
          );
        }
        const close = requireMatchingParen(rest, open, "@cannot");
        const args = compileDirectiveArgs(
          rest.slice(open + 1, close),
          locals,
        );
        out += `if (__viewCannot(__d,${args})) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endcannot")) {
        out += "}\n";
        i += "@endcannot".length;
        continue;
      }

      if (rest.startsWith("@can")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError(
            "@can requires ('ability', ...args).",
            "BUNYAD_VIEW_008",
          );
        }
        const close = requireMatchingParen(rest, open, "@can");
        const args = compileDirectiveArgs(
          rest.slice(open + 1, close),
          locals,
        );
        out += `if (__viewCan(__d,${args})) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endcan")) {
        out += "}\n";
        i += "@endcan".length;
        continue;
      }

      if (rest.startsWith("@class")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError("@class requires ([...]).", "BUNYAD_VIEW_008");
        }
        const close = requireMatchingParen(rest, open, "@class");
        const expr = compileExpr(rest.slice(open + 1, close), locals);
        out += `__o+=' class="'+e(__toCssClasses(${expr}))+'"';\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@style")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError("@style requires ([...]).", "BUNYAD_VIEW_008");
        }
        const close = requireMatchingParen(rest, open, "@style");
        const expr = compileExpr(rest.slice(open + 1, close), locals);
        out += `__o+=' style="'+e(__toCssStyles(${expr}))+'"';\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@if")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@if");
        out += `if (${compileExpr(rest.slice(open + 1, close), locals)}) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@elseif")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@elseif");
        out += `} else if (${compileExpr(rest.slice(open + 1, close), locals)}) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@else")) {
        out += "} else {\n";
        i += "@else".length;
        continue;
      }

      if (rest.startsWith("@endif")) {
        out += "}\n";
        i += "@endif".length;
        continue;
      }

      if (rest.startsWith("@unless")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@unless");
        out += `if (!(${compileExpr(rest.slice(open + 1, close), locals)})) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endunless")) {
        out += "}\n";
        i += "@endunless".length;
        continue;
      }

      if (rest.startsWith("@isset")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@isset");
        out += `if ((${compileExpr(rest.slice(open + 1, close), locals)}) != null) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endisset")) {
        out += "}\n";
        i += "@endisset".length;
        continue;
      }

      if (rest.startsWith("@empty(") || rest.startsWith("@empty (")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@empty");
        out += `if (__viewEmpty(${compileExpr(rest.slice(open + 1, close), locals)})) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endempty")) {
        out += "}\n";
        i += "@endempty".length;
        continue;
      }

      if (rest.startsWith("@production")) {
        out += `if (__viewEnv(__d)==="production") {\n`;
        i += "@production".length;
        continue;
      }

      if (rest.startsWith("@endproduction")) {
        out += "}\n";
        i += "@endproduction".length;
        continue;
      }

      if (rest.startsWith("@env")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError(
            "@env requires ('local') or (['local','staging']).",
            "BUNYAD_VIEW_008",
          );
        }
        const close = requireMatchingParen(rest, open, "@env");
        const targets = compileExpr(rest.slice(open + 1, close), locals);
        out += `if (__viewEnvIs(__d,${targets})) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endenv")) {
        out += "}\n";
        i += "@endenv".length;
        continue;
      }

      if (rest.startsWith("@switch")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@switch");
        out += `switch (${compileExpr(rest.slice(open + 1, close), locals)}) {\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@endswitch")) {
        out += "}\n";
        i += "@endswitch".length;
        continue;
      }

      if (rest.startsWith("@case")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@case");
        out += `case ${compileExpr(rest.slice(open + 1, close), locals)}:\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@break")) {
        out += "break;\n";
        i += "@break".length;
        continue;
      }

      if (rest.startsWith("@default")) {
        out += "default:\n";
        i += "@default".length;
        continue;
      }

      if (rest.startsWith("@csrf")) {
        out += `__o+='<input type="hidden" name="_token" value="'+e(csrf_token())+'">';\n`;
        i += "@csrf".length;
        continue;
      }

      if (rest.startsWith("@method")) {
        const open = rest.indexOf("(");
        if (open === -1) throw new Error("@method requires ('VERB')");
        const close = findMatchingParen(rest, open);
        const arg = rest.slice(open + 1, close).trim();
        out += `__o+='<input type="hidden" name="_method" value="'+e(String(${arg}))+'">';\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@error")) {
        const open = rest.indexOf("(");
        if (open === -1) throw new Error("@error requires ('field')");
        const close = findMatchingParen(rest, open);
        const argsRaw = rest.slice(open + 1, close).trim();
        const argParts: string[] = [];
        let depth = 0;
        let current = "";
        let inQuote: string | null = null;
        for (let ai = 0; ai < argsRaw.length; ai++) {
          const ch = argsRaw[ai]!;
          if (inQuote) {
            current += ch;
            if (ch === inQuote && argsRaw[ai - 1] !== "\\") inQuote = null;
            continue;
          }
          if (ch === "'" || ch === '"') {
            inQuote = ch;
            current += ch;
            continue;
          }
          if (ch === "(" || ch === "[") depth++;
          if (ch === ")" || ch === "]") depth--;
          if (ch === "," && depth === 0) {
            argParts.push(current.trim());
            current = "";
            continue;
          }
          current += ch;
        }
        if (current.trim()) argParts.push(current.trim());
        const field = (argParts[0] ?? "").replace(/^['"]|['"]$/g, "");
        const bag = argParts[1]
          ? argParts[1].replace(/^['"]|['"]$/g, "")
          : undefined;
        locals.add("message");
        if (bag) {
          out += `{\nconst __err=__d.errors?.[${JSON.stringify(bag)}]?.[${JSON.stringify(field)}];\nif(__err){\nconst message=Array.isArray(__err)?__err[0]:__err;\n`;
        } else {
          out += `{\nconst __err=__d.errors?.[${JSON.stringify(field)}]??__d.errors?.default?.[${JSON.stringify(field)}];\nif(__err){\nconst message=Array.isArray(__err)?__err[0]:__err;\n`;
        }
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@enderror")) {
        out += "}}\n";
        locals.delete("message");
        i += "@enderror".length;
        continue;
      }

      if (rest.startsWith("@props")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@props");
        const inside = rest.slice(open + 1, close).trim();
        const defaults = new Function(`return (${inside});`)() as Record<
          string,
          unknown
        >;
        const keys = Object.keys(defaults);
        for (const [key, value] of Object.entries(defaults)) {
          out += `if(__d[${JSON.stringify(key)}]===undefined)__d[${JSON.stringify(key)}]=${JSON.stringify(value)};\n`;
        }
        out += `__d.attributes=new __AttributeBag(__d,${JSON.stringify(keys)});\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@aware")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@aware");
        const inside = rest.slice(open + 1, close).trim();
        const keys = new Function(`return (${inside});`)() as string[];
        out += `for(const __k of ${JSON.stringify(keys)}){if(__d[__k]===undefined&&__d.__aware&&__d.__aware[__k]!==undefined)__d[__k]=__d.__aware[__k];}\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@include")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@include");
        const inside = rest.slice(open + 1, close).trim();
        const parsed = parseIncludeArgs(inside);
        if (parsed.data) {
          out += `__o+=i(${JSON.stringify(parsed.name)},{...__d,...(${compileDataObject(parsed.data, locals)})});\n`;
        } else {
          out += `__o+=i(${JSON.stringify(parsed.name)},__d);\n`;
        }
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@use") || rest.startsWith("@import")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError(
            "@use/@import requires ('name') or ('name', 'alias').",
            "BUNYAD_VIEW_006",
          );
        }
        const close = requireMatchingParen(rest, open, "@use/@import");
        const inside = rest.slice(open + 1, close).trim();
        const parsed = parseUseArgs(inside);
        locals.add(parsed.alias);
        const missingMsg = `View helper [${parsed.name}] is not registered. Call ViewFactory.use(${JSON.stringify(parsed.name)}, …) in a service provider.`;
        out += `const ${parsed.alias}=(()=>{const __h=__helpers[${JSON.stringify(parsed.name)}];if(__h===undefined){throw new Error(${JSON.stringify(missingMsg)}); }return __h;})();\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@let")) {
        const open = rest.indexOf("(");
        if (open === -1) {
          throw new BunyadError(
            "@let requires (name = expression).",
            "BUNYAD_VIEW_007",
          );
        }
        const close = requireMatchingParen(rest, open, "@let");
        const inside = rest.slice(open + 1, close).trim();
        const eq = inside.indexOf("=");
        if (eq === -1) {
          throw new BunyadError(
            "@let requires (name = expression).",
            "BUNYAD_VIEW_007",
          );
        }
        const name = inside.slice(0, eq).trim().replace(/^\$/, "");
        if (!/^[a-zA-Z_][\w]*$/.test(name)) {
          throw new BunyadError(
            `@let binding name must be a simple identifier, got [${name}].`,
            "BUNYAD_VIEW_007",
          );
        }
        const valueExpr = inside.slice(eq + 1).trim();
        if (!valueExpr || valueExpr.includes(";")) {
          throw new BunyadError(
            "@let only allows a single expression (no statements).",
            "BUNYAD_VIEW_007",
          );
        }
        const compiled = compileExpr(valueExpr, locals);
        locals.add(name);
        out += `const ${name}=(${compiled});\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@json")) {
        const open = rest.indexOf("(");
        const close = requireMatchingParen(rest, open, "@json");
        const expr = compileExpr(rest.slice(open + 1, close), locals);
        out += `__o+=__json(${expr});\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@push")) {
        const open = rest.indexOf("(");
        const close = rest.indexOf(")", open);
        const stackName = rest
          .slice(open + 1, close)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        const contentStart = i + close + 1;
        const endIdx = source.indexOf("@endpush", contentStart);
        const slotFn = compileBody(
          source.slice(contentStart, endIdx),
          new Set(locals),
        );
        out += `(__stacks[${JSON.stringify(stackName)}]||(__stacks[${JSON.stringify(stackName)}]=[])).push((()=>{${slotFn}})());\n`;
        i = endIdx + "@endpush".length;
        continue;
      }

      if (rest.startsWith("@prepend")) {
        const open = rest.indexOf("(");
        const close = rest.indexOf(")", open);
        const stackName = rest
          .slice(open + 1, close)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        const contentStart = i + close + 1;
        const endIdx = source.indexOf("@endprepend", contentStart);
        const slotFn = compileBody(
          source.slice(contentStart, endIdx),
          new Set(locals),
        );
        out += `(__stacks[${JSON.stringify(stackName)}]||(__stacks[${JSON.stringify(stackName)}]=[])).unshift((()=>{${slotFn}})());\n`;
        i = endIdx + "@endprepend".length;
        continue;
      }

      if (rest.startsWith("@stack")) {
        const open = rest.indexOf("(");
        const close = rest.indexOf(")", open);
        const stackName = rest
          .slice(open + 1, close)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        out += `__o+=(__stacks[${JSON.stringify(stackName)}]||[]).join("");\n`;
        i += close + 1;
        continue;
      }

      if (rest.startsWith("@once")) {
        const contentStart = i + "@once".length;
        const endIdx = source.indexOf("@endonce", contentStart);
        const slotFn = compileBody(
          source.slice(contentStart, endIdx),
          new Set(locals),
        );
        const id = `o${onceSeq++}`;
        out += `if(!__once.has(${JSON.stringify(id)})){__once.add(${JSON.stringify(id)});__o+=(()=>{${slotFn}})();}\n`;
        i = endIdx + "@endonce".length;
        continue;
      }

      if (rest.startsWith("@head")) {
        out += `__o+=__head();\n`;
        i += "@head".length;
        continue;
      }
    }

    const nextEcho = indexOfEcho(source, i);
    const nextAt = source.indexOf("@", i + (source[i] === "@" ? 1 : 0));
    const nextComponent = source.indexOf(
      "<x-",
      i + (source.startsWith("<x-", i) ? 3 : 0),
    );
    let next = source.length;
    if (nextEcho !== -1) next = Math.min(next, nextEcho);
    if (nextAt !== -1) next = Math.min(next, nextAt);
    if (nextComponent !== -1) next = Math.min(next, nextComponent);
    if (next === i) {
      pushText(source[i]!);
      i += 1;
      continue;
    }
    pushText(source.slice(i, next));
    i = next;
  }

  out += "return __o;";
  return out;
}

function parseUseArgs(inside: string): { name: string; alias: string } {
  const match = inside.match(/^['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?$/);
  if (!match) {
    throw new BunyadError(
      "@use/@import requires a string helper name registered via ViewFactory.use() — not a filesystem or module path.",
      "BUNYAD_VIEW_006",
    );
  }
  const name = match[1]!;
  if (
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(":")
  ) {
    throw new BunyadError(
      `@use/@import name [${name}] is invalid. Register a short alias with ViewFactory.use('alias', helper) — arbitrary imports are not allowed.`,
      "BUNYAD_VIEW_006",
    );
  }
  return { name, alias: match[2] ?? name.replace(/[^\w]/g, "_") };
}

type ComponentAttr = { key: string; value: string; bind: boolean };

type ParsedComponent = {
  name: string;
  attrs: ComponentAttr[];
  slot: string;
  end: number;
};

function parseComponent(source: string, start: number): ParsedComponent | null {
  if (!source.startsWith("<x-", start)) return null;
  let i = start + 3;
  const nameStart = i;
  while (i < source.length && /[a-zA-Z0-9_.-]/.test(source[i]!)) i += 1;
  const name = source.slice(nameStart, i);
  if (!name) return null;

  const attrs: ComponentAttr[] = [];
  while (i < source.length && /\s/.test(source[i]!)) i += 1;

  while (
    i < source.length &&
    source[i] !== ">" &&
    !(source[i] === "/" && source[i + 1] === ">")
  ) {
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    if (
      i >= source.length ||
      source[i] === ">" ||
      (source[i] === "/" && source[i + 1] === ">")
    ) {
      break;
    }

    let bind = false;
    if (source[i] === ":") {
      bind = true;
      i += 1;
    }
    const keyStart = i;
    while (i < source.length && /[a-zA-Z0-9_-]/.test(source[i]!)) i += 1;
    const key = source.slice(keyStart, i);
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    if (source[i] !== "=") {
      attrs.push({ key, value: "true", bind: false });
      continue;
    }
    i += 1;
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    const quote = source[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      const valueStart = i;
      while (i < source.length && source[i] !== quote) i += 1;
      attrs.push({ key, value: source.slice(valueStart, i), bind });
      i += 1;
    } else {
      const valueStart = i;
      while (i < source.length && !/[\s/>]/.test(source[i]!)) i += 1;
      attrs.push({ key, value: source.slice(valueStart, i), bind });
    }
  }

  while (i < source.length && /\s/.test(source[i]!)) i += 1;

  if (source[i] === "/" && source[i + 1] === ">") {
    return { name, attrs, slot: "", end: i + 2 };
  }

  if (source[i] !== ">") return null;
  i += 1;

  const close = `</x-${name}>`;
  const closeAt = source.indexOf(close, i);
  if (closeAt === -1) return null;
  return {
    name,
    attrs,
    slot: source.slice(i, closeAt),
    end: closeAt + close.length,
  };
}

/** Pull `<x-slot name="…">` / `<x-slot:name>` out of a component body. */
function extractNamedSlots(slotHtml: string): {
  defaultSlot: string;
  named: Record<string, string>;
} {
  const named: Record<string, string> = {};
  let defaultSlot = "";
  let i = 0;
  while (i < slotHtml.length) {
    const next = slotHtml.indexOf("<x-slot", i);
    if (next === -1) {
      defaultSlot += slotHtml.slice(i);
      break;
    }
    defaultSlot += slotHtml.slice(i, next);
    let j = next + "<x-slot".length;
    let slotName = "";
    if (slotHtml[j] === ":") {
      j += 1;
      const nameStart = j;
      while (j < slotHtml.length && /[a-zA-Z0-9_-]/.test(slotHtml[j]!)) j += 1;
      slotName = slotHtml.slice(nameStart, j);
    } else {
      const nameMatch = slotHtml
        .slice(j)
        .match(/^\s+name\s*=\s*(['"])([^'"]+)\1/);
      if (!nameMatch) {
        defaultSlot += slotHtml.slice(next, next + 7);
        i = next + 7;
        continue;
      }
      slotName = nameMatch[2]!;
      j += nameMatch[0].length;
    }
    while (j < slotHtml.length && /\s/.test(slotHtml[j]!)) j += 1;
    if (slotHtml[j] === "/" && slotHtml[j + 1] === ">") {
      named[slotName] = "";
      i = j + 2;
      continue;
    }
    if (slotHtml[j] !== ">") {
      defaultSlot += slotHtml.slice(next, next + 7);
      i = next + 7;
      continue;
    }
    j += 1;
    const close = "</x-slot>";
    const closeAt = slotHtml.indexOf(close, j);
    if (closeAt === -1) {
      named[slotName] = slotHtml.slice(j);
      i = slotHtml.length;
      break;
    }
    named[slotName] = slotHtml.slice(j, closeAt);
    i = closeAt + close.length;
  }
  return { defaultSlot, named };
}

function indexOfEcho(source: string, from: number): number {
  const a = source.indexOf("{{", from);
  const b = source.indexOf("{!!", from);
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

/** Skip a quoted `'`, `"`, or backtick string starting at `i` (the opening quote). */
function skipQuoted(source: string, i: number): number {
  const quote = source[i]!;
  i += 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i;
    i += 1;
  }
  return source.length - 1;
}

function findMatchingParen(source: string, open: number): number {
  if (open < 0 || source[open] !== "(") return -1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(source, i);
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function requireMatchingParen(
  source: string,
  open: number,
  directive: string,
): number {
  const close = findMatchingParen(source, open);
  if (close < 0) {
    throw new BunyadError(
      `${directive} has an unclosed '(' — check quotes around arguments that contain parentheses (for example CSS var(--…)).`,
      "BUNYAD_VIEW_008",
    );
  }
  return close;
}

function parseIncludeArgs(inside: string): { name: string; data?: string } {
  const match = inside.match(/^['"]([^'"]+)['"]\s*(?:,\s*([\s\S]+))?$/);
  return {
    name: match?.[1] ?? inside.replace(/^['"]|['"]$/g, ""),
    data: match?.[2]?.trim(),
  };
}

/** Split `@forelse` body into loop / empty sections (nesting-aware). */
function splitForelse(
  source: string,
  start: number,
): { loopBody: string; emptyBody: string; end: number } {
  let depth = 1;
  let i = start;
  let emptyAt = -1;
  while (i < source.length) {
    if (source.startsWith("@forelse", i)) {
      depth += 1;
      i += "@forelse".length;
      continue;
    }
    if (source.startsWith("@endforelse", i)) {
      depth -= 1;
      if (depth === 0) {
        if (emptyAt === -1) {
          return {
            loopBody: source.slice(start, i),
            emptyBody: "",
            end: i + "@endforelse".length,
          };
        }
        return {
          loopBody: source.slice(start, emptyAt),
          emptyBody: source.slice(emptyAt + "@empty".length, i),
          end: i + "@endforelse".length,
        };
      }
      i += "@endforelse".length;
      continue;
    }
    if (depth === 1 && source.startsWith("@empty", i)) {
      const next = source[i + "@empty".length];
      // Standalone `@empty` marker (not `@empty(`).
      if (next === undefined || /[\s@<{]/.test(next) || next === "\n") {
        emptyAt = i;
        i += "@empty".length;
        continue;
      }
    }
    i += 1;
  }
  throw new BunyadError(
    "@forelse is missing @endforelse.",
    "BUNYAD_VIEW_008",
  );
}

/** Compile comma-separated directive args (`'update', post`). */
function compileDirectiveArgs(inside: string, locals: Set<string>): string {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inside.length; i++) {
    const ch = inside[i];
    if (i < inside.length) {
      if (ch === '"' || ch === "'" || ch === "`") {
        i = skipQuoted(inside, i);
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      if (ch !== "," || depth !== 0) continue;
    }
    const part = inside.slice(start, i).trim();
    if (part) parts.push(compileExpr(part, locals));
    start = i + 1;
  }
  return parts.join(",");
}

/** Compile `{ key: expr }` so keys stay literal and values use __d. */
function compileDataObject(src: string, locals: Set<string>): string {
  const trimmed = src.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return compileExpr(trimmed, locals);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return "{}";

  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i];
    if (i < inner.length) {
      if (ch === '"' || ch === "'" || ch === "`") {
        i = skipQuoted(inner, i);
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
      if (ch !== "," || depth !== 0) continue;
    }
    const pair = inner.slice(start, i).trim();
    if (pair) {
      const colon = pair.indexOf(":");
      const key = pair
        .slice(0, colon)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      const value = pair.slice(colon + 1).trim();
      parts.push(`${JSON.stringify(key)}:${compileExpr(value, locals)}`);
    }
    start = i + 1;
  }
  return `{${parts.join(",")}}`;
}

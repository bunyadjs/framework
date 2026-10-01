import { expect, test } from "bun:test";
import { compile, compileToModuleSource, escapeHtml } from "../src/index.ts";

test("@head renders via setHeadRenderer", async () => {
  const { setHeadRenderer } = await import("../src/helpers.ts");
  setHeadRenderer(() => '<title>From Head</title>');
  const render = compile("@head");
  expect(render({})).toBe("<title>From Head</title>");
  setHeadRenderer(null);
});


test("raw echoes", () => {
  const render = compile("{!! html !!}");
  expect(render({ html: "<b>x</b>" })).toBe("<b>x</b>");
});

test("if else", () => {
  const render = compile("@if(ok)yes@else no@endif");
  expect(render({ ok: true }).trim()).toBe("yes");
  expect(render({ ok: false }).trim()).toBe("no");
});

test("foreach", () => {
  const render = compile("@foreach(items as item)-{{ item }}@endforeach");
  expect(render({ items: ["a", "b"] })).toBe("-a-b");
});

test("foreach with property access", () => {
  const render = compile(
    "@foreach(users as user){{ user.name }}@endforeach",
  );
  expect(render({ users: [{ name: "Ada" }] })).toBe("Ada");
});

test("escapeHtml", () => {
  expect(escapeHtml(`a&b<"'>`)).toBe("a&amp;b&lt;&quot;&#39;&gt;");
});

test("compileToModuleSource exports render", async () => {
  const source = compileToModuleSource("Hello, {{ name }}!");
  expect(source).toContain("export function render");
  expect(source).toContain('@bunyad/view');
  const path = `${import.meta.dir}/.tmp-compiled-view.js`;
  await Bun.write(path, source);
  const mod = await import(path);
  expect(mod.render({ name: "Ada" })).toBe("Hello, Ada!");
  await Bun.file(path).delete();
});

test("@error shows first message", () => {
  const render = compile(`@error('email')<span>{{ message }}</span>@enderror`);
  expect(
    render({ errors: { email: ["The email field is required."] } }),
  ).toBe("<span>The email field is required.</span>");
  expect(render({ errors: {} })).toBe("");
});

test("@error reads named bag", () => {
  const render = compile(
    `@error('title', 'post')<span>{{ message }}</span>@enderror`,
  );
  expect(
    render({
      errors: { post: { title: ["The title field is required."] } },
    }),
  ).toBe("<span>The title field is required.</span>");
  expect(render({ errors: { title: ["ignored"] } })).toBe("");
});

test("@error default bag fallback", () => {
  const render = compile(`@error('email')<span>{{ message }}</span>@enderror`);
  expect(
    render({
      errors: { default: { email: ["From default bag."] } },
    }),
  ).toBe("<span>From default bag.</span>");
});

test("x-component with slot and attrs", () => {
  const render = compile(`<x-alert type="error">Hi {{ name }}</x-alert>`);
  const html = render({ name: "Ada" }, (component, props) => {
    expect(component).toBe("alert");
    expect(props.type).toBe("error");
    return `<div class="${props.type}">${props.slot}</div>`;
  });
  expect(html).toBe('<div class="error">Hi Ada</div>');
});

test("x-component self-closing and bound attrs", () => {
  const render = compile(`<x-badge :label="title" />`);
  const html = render({ title: "New" }, (_n, props) => String(props.label));
  expect(html).toBe("New");
});

test("old('field') keeps string literal keys", () => {
  const render = compile(`{{ old('email') }}`);
  expect(
    render({
      old: (key: string, def = "") => (key === "email" ? "a@b.c" : def),
    }),
  ).toBe("a@b.c");
});

test("@props applies defaults", () => {
  const render = compile(`@props({ type: "info" }){{ type }}`);
  expect(render({})).toBe("info");
  expect(render({ type: "error" })).toBe("error");
});

test("@include merges data", () => {
  const render = compile(`@include('nav', { active: page })`);
  const html = render({ page: "home" }, undefined, (name, data) => {
    expect(name).toBe("nav");
    expect(data.active).toBe("home");
    return `<nav>${data.active}</nav>`;
  });
  expect(html).toBe("<nav>home</nav>");
});

test("@include keeps parentheses inside quoted Tailwind classes", () => {
  const source = `@include('partials.cta', { ctaClass: 'inline-flex bg-[var(--color-brand)] hover:bg-[var(--color-brand-dark)]' })
after`;
  const render = compile(source);
  const html = render({}, undefined, (name, data) => {
    expect(name).toBe("partials.cta");
    expect(data.ctaClass).toBe(
      "inline-flex bg-[var(--color-brand)] hover:bg-[var(--color-brand-dark)]",
    );
    return `<a class="${data.ctaClass}">Go</a>`;
  });
  expect(html).toContain("bg-[var(--color-brand)]");
  expect(html).toContain("after");
});

test("@include keeps commas inside quoted class strings", () => {
  const render = compile(
    `@include('chip', { className: 'shadow-[0_1px_2px_rgba(0,0,0,0.2)]' })`,
  );
  render({}, undefined, (_name, data) => {
    expect(data.className).toBe("shadow-[0_1px_2px_rgba(0,0,0,0.2)]");
    return "";
  });
});

test("@include allows wrapped quoted class strings", () => {
  const source = `@include('cta', { ctaClass: 'inline-flex bg-[var(--color-brand)]
                px-6 hover:bg-[var(--color-brand-dark)]' })`;
  const render = compile(source);
  render({}, undefined, (_name, data) => {
    expect(String(data.ctaClass)).toContain("bg-[var(--color-brand)]");
    expect(String(data.ctaClass)).toContain("px-6");
    return "";
  });
});

test("@push and @stack", () => {
  const render = compile(
    `@push('scripts')A@endpush@push('scripts')B@endpush@stack('scripts')`,
  );
  expect(render({})).toBe("AB");
});

test("@prepend inserts before push", () => {
  const render = compile(
    `@push('scripts')B@endpush@prepend('scripts')A@endprepend@stack('scripts')`,
  );
  expect(render({})).toBe("AB");
});

test("@once renders only once per data bag", () => {
  const render = compile(`@onceONCE@endonce`);
  const data: Record<string, unknown> = {};
  expect(render(data) + render(data)).toBe("ONCE");
});

test("@props builds attributes bag", () => {
  const render = compile(
    `@props({ type: "info" })<div class="{{ type }}" {{ attributes }}></div>`,
  );
  expect(render({ type: "error", id: "a1", role: "status" })).toBe(
    `<div class="error" id="a1" role="status"></div>`,
  );
});

test("@aware pulls from parent bag", () => {
  const render = compile(`@aware(['color']){{ color }}`);
  expect(render({ __aware: { color: "red" } })).toBe("red");
  expect(render({ color: "blue", __aware: { color: "red" } })).toBe("blue");
});

test("@php is rejected at compile time", () => {
  expect(() => compile(`@php($x = 1){{ x }}`)).toThrow(
    /BUNYAD_VIEW_004|@php is not supported|ViewFactory\.use/,
  );
});

test("@use loads registered helpers only", () => {
  const render = compile(`@use('money'){{ money.format(n) }}`);
  expect(
    render({
      n: 12,
      __helpers: { money: { format: (v: number) => `$${v}` } },
    }),
  ).toBe("$12");
  expect(() => render({ n: 1, __helpers: {} })).toThrow(/not registered/);
});

test("@import is an alias for @use with optional rename", () => {
  const render = compile(`@import('money', 'fmt'){{ fmt.format(n) }}`);
  expect(
    render({
      n: 3,
      __helpers: { money: { format: (v: number) => `$${v}` } },
    }),
  ).toBe("$3");
});

test("@use rejects path-like names", () => {
  expect(() => compile(`@use('../secrets')`)).toThrow(/BUNYAD_VIEW_006|invalid/);
  expect(() => compile(`@use('node:fs')`)).toThrow(/BUNYAD_VIEW_006|invalid/);
});

test("@let binds a data-scoped expression", () => {
  const render = compile(`@let(total = price * qty){{ total }}`);
  expect(render({ price: 4, qty: 3 })).toBe("12");
});

test("@let rejects statements", () => {
  expect(() => compile(`@let(x = 1; y = 2)`)).toThrow(/BUNYAD_VIEW_007|single expression/);
});

test("@json embeds HTML-safe JSON", () => {
  const render = compile(`<script>window.data=@json(payload)</script>`);
  expect(render({ payload: { a: 1, s: "</script>" } })).toBe(
    `<script>window.data={"a":1,"s":"\\u003c/script\\u003e"}</script>`,
  );
});

test("prototype escape expressions are rejected", () => {
  expect(() => compile(`{{ ({}).constructor }}`)).toThrow(/BUNYAD_VIEW_005|Unsafe/);
});

test("ViewFactory.use wires helpers into templates", async () => {
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(import.meta.dir, ".tmp-view-use");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(
    resolve(root, "hello.view"),
    `@use('greet'){{ greet(name) }}`,
  );
  const { ViewFactory } = await import("../src/factory.ts");
  const factory = new ViewFactory(root);
  factory.use("greet", (name: string) => `Hi ${name}`);
  expect(factory.render("hello", { name: "Ada" })).toBe("Hi Ada");
  await rm(root, { recursive: true, force: true });
});

test("foreach exposes loop object", () => {
  const render = compile(
    `@foreach(items as item){{ loop.iteration }}:{{ item }}{{ loop.last ? "" : "," }}@endforeach`,
  );
  expect(render({ items: ["a", "b", "c"] })).toBe("1:a,2:b,3:c");
});

test("forelse renders empty branch", () => {
  const render = compile(
    `@forelse(items as item){{ item }}@empty
none@endforelse`,
  );
  expect(render({ items: ["x"] })).toBe("x");
  expect(render({ items: [] }).trim()).toBe("none");
  expect(render({}).trim()).toBe("none");
});

test("@class and @style build conditional attributes", () => {
  const render = compile(
    `<span@class(['p-4', { 'font-bold': active, 'hidden': !active }])@style([{ 'color': 'red' }, { 'font-weight': 'bold' }])></span>`,
  );
  expect(render({ active: true })).toBe(
    `<span class="p-4 font-bold" style="color: red; font-weight: bold"></span>`,
  );
  expect(render({ active: false })).toBe(
    `<span class="p-4 hidden" style="color: red; font-weight: bold"></span>`,
  );
});

test("@auth @guest @can @cannot use helpers and data flags", async () => {
  const { setViewAuthHelpers } = await import("../src/auth-helpers.ts");
  setViewAuthHelpers({
    check: () => false,
    guest: () => true,
    can: (ability) => ability === "edit",
    cannot: (ability) => ability !== "edit",
  });
  const auth = compile(`@authhi@endauth`);
  expect(auth({ user: { id: 1 } })).toBe("hi");
  expect(auth({})).toBe("");
  const guest = compile(`@guestbye@endguest`);
  expect(guest({})).toBe("bye");
  expect(guest({ user: { id: 1 } })).toBe("");
  const can = compile(`@can('edit', post)ok@endcan`);
  expect(can({ post: { id: 1 } })).toBe("ok");
  const cannot = compile(`@cannot('delete')no@endcannot`);
  expect(cannot({})).toBe("no");
  setViewAuthHelpers(null);
});

test("@unless @isset @empty conditionals", () => {
  const unless = compile(`@unless(hidden)shown@endunless`);
  expect(unless({ hidden: false })).toBe("shown");
  expect(unless({ hidden: true })).toBe("");

  const isset = compile(`@isset(name){{ name }}@endisset`);
  expect(isset({ name: "Ada" })).toBe("Ada");
  expect(isset({})).toBe("");

  const empty = compile(`@empty(items)none@endempty`);
  expect(empty({ items: [] })).toBe("none");
  expect(empty({ items: [1] })).toBe("");
});

test("@switch @case @break @default", () => {
  const render = compile(
    `@switch(status)@case('draft')D@break@case('live')L@break@defaultX@endswitch`,
  );
  expect(render({ status: "draft" })).toBe("D");
  expect(render({ status: "live" })).toBe("L");
  expect(render({ status: "other" })).toBe("X");
});

test("@production and @env", () => {
  const prod = compile(`@productionprod@endproduction`);
  expect(prod({ __env: "production" })).toBe("prod");
  expect(prod({ __env: "local" })).toBe("");

  const env = compile(`@env('local')dev@endenv`);
  expect(env({ __env: "local" })).toBe("dev");
  expect(env({ __env: "production" })).toBe("");

  const multi = compile(`@env(['local','testing'])ok@endenv`);
  expect(multi({ __env: "testing" })).toBe("ok");
  expect(multi({ __env: "production" })).toBe("");
});

test("named x-slot props", () => {
  const render = compile(
    `<x-alert><x-slot:title>Warn</x-slot>Body {{ name }}</x-alert>`,
  );
  const html = render({ name: "Ada" }, (name, props) => {
    expect(name).toBe("alert");
    expect(props.title).toBe("Warn");
    expect(props.slot).toBe("Body Ada");
    return `<div>${props.title}:${props.slot}</div>`;
  });
  expect(html).toBe("<div>Warn:Body Ada</div>");
});

test("named x-slot name attribute", () => {
  const render = compile(
    `<x-card><x-slot name="header">Hi</x-slot>Main</x-card>`,
  );
  const html = render({}, (_name, props) => {
    expect(props.header).toBe("Hi");
    expect(props.slot).toBe("Main");
    return "ok";
  });
  expect(html).toBe("ok");
});

test("{{-- comments --}} are stripped", () => {
  const out = compile("a{{-- one --}}b{{--\n  two {{ nope }}\n--}}c")({});
  expect(out).toBe("abc");
});

test("@if and @elseif conditions may contain calls with string arguments", () => {
  const render = compile(
    "@if(f('a') === 'x')A@elseif(f(g('b')))B@else C@endif",
  );
  expect(render({ f: (v: string) => v, g: () => "" })).toBe(" C");
  expect(render({ f: (v: string) => (v === "a" ? "x" : v), g: () => "" })).toBe("A");
  expect(render({ f: (v: string) => (v === "a" ? "" : "y"), g: () => "b" })).toBe("B");
});

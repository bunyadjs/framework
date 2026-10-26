import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ViewFactory, resolveLayouts, compile } from "../src/index.ts";

const renderWith = (child: string, layouts: Record<string, string>, data: Record<string, unknown> = {}) =>
  compile(resolveLayouts(child, (name) => layouts[name]!))(data);

test("resolveLayouts merges sections into yield", () => {
  const layouts: Record<string, string> = {
    "layouts.app": "<main>@yield('content')</main>",
  };
  const child = `@extends('layouts.app')
@section('content')
Hi {{ name }}
@endsection`;
  expect(renderWith(child, layouts, { name: "Ada" })).toBe("<main>Hi Ada</main>");
});

test("resolveLayouts yield default when section missing", () => {
  const layouts: Record<string, string> = {
    "layouts.app": "<title>@yield('title', 'App')</title>@yield('content')",
  };
  const child = `@extends('layouts.app')
@section('content')
Hi
@endsection`;
  expect(renderWith(child, layouts)).toBe("<title>App</title>Hi");
});

test("@yield in a template rendered without @extends outputs its default or nothing", () => {
  const out = compile(resolveLayouts("<main>{!! slot !!}@yield('content')@yield('title', 'Home')</main>", () => ""))({
    slot: "X",
  });
  expect(out).toBe("<main>XHome</main>");
});

test("a section can be set inline", () => {
  const layouts = { "layouts.app": "<title>@yield('title')</title>" };
  const child = `@extends('layouts.app')
@section('title', 'Tools - ' + name)`;
  expect(renderWith(child, layouts, { name: "Acme" })).toBe("<title>Tools - Acme</title>");
});

test("a @push outside any section reaches the layout's stack", () => {
  const layouts = { "layouts.app": "<head>@stack('meta')</head><body>@yield('content')@stack('scripts')</body>" };
  const child = `@extends('layouts.app')
@push('meta')<meta name="x">@endpush
@push('scripts')<script src="{{ src }}"></script>@endpush
@section('content')<p>Hi</p>@endsection`;
  expect(renderWith(child, layouts, { src: "/a.js" })).toBe(
    `<head><meta name="x"></head><body><p>Hi</p><script src="/a.js"></script></body>`,
  );
});

test("a @push inside a section reaches a stack the layout prints before the content", () => {
  const layouts = { "layouts.app": "<head>@stack('styles')</head><body>@yield('content')</body>" };
  const child = `@extends('layouts.app')
@section('content')<p>Hi</p>@push('styles')<style></style>@endpush@endsection`;
  expect(renderWith(child, layouts)).toBe("<head><style></style></head><body><p>Hi</p></body>");
});

test("text a child prints outside its sections goes nowhere", () => {
  const layouts = { "layouts.app": "[@yield('content')]" };
  const child = `@extends('layouts.app')
stray {{ name }}
@section('content')in@endsection
more stray`;
  expect(renderWith(child, layouts, { name: "Ada" })).toBe("[in]");
});

test("a child's @use and @let are available to its sections", () => {
  const layouts = { "layouts.app": "@yield('content')" };
  const child = `@extends('layouts.app')
@let(greeting = 'Hello ' + name)
@section('content'){{ greeting }}@endsection`;
  expect(renderWith(child, layouts, { name: "Ada" })).toBe("Hello Ada");
});

test("@yield inside an @include'd partial reads the child's sections", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "layouts"));
  await mkdir(join(dir, "partials"));
  await writeFile(
    join(dir, "layouts", "app.view"),
    "<head>@include('partials.styles')</head><body>@yield('content')@include('partials.scripts')</body>",
  );
  await writeFile(join(dir, "partials", "styles.view"), "[styles:@yield('styles')]");
  await writeFile(join(dir, "partials", "scripts.view"), "[scripts:@yield('scripts', 'none')]");
  await writeFile(
    join(dir, "page.view"),
    `@extends('layouts.app')
@section('styles')<s/>@endsection
@section('content')<c/>@endsection`,
  );

  expect(new ViewFactory(dir).render("page")).toBe("<head>[styles:<s/>]</head><body><c/>[scripts:none]</body>");
});

test("a partial rendered on its own yields its default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "partial.view"), "[@yield('x', 'fallback')]");

  expect(new ViewFactory(dir).render("partial")).toBe("[fallback]");
});

test("@yield inside a component reads the child's sections", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "layouts"));
  await mkdir(join(dir, "components"));
  await writeFile(join(dir, "layouts", "app.view"), "<x-banner />");
  await writeFile(join(dir, "components", "banner.view"), "<h1>@yield('title', 'Untitled')</h1>");
  await writeFile(join(dir, "page.view"), "@extends('layouts.app')\n@section('title', 'Tools')");

  expect(new ViewFactory(dir).render("page")).toBe("<h1>Tools</h1>");
});

test("a partial that pushes after the layout printed the stack still shows up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "layouts"));
  await mkdir(join(dir, "partials"));
  await writeFile(
    join(dir, "layouts", "app.view"),
    "<head>@stack('scripts')</head>@yield('content')@include('partials.toast')",
  );
  await writeFile(join(dir, "partials", "toast.view"), "@push('scripts')<toast/>@endpush");
  await writeFile(join(dir, "page.view"), "@extends('layouts.app')\n@push('scripts')<page/>@endpush\n@section('content')hi@endsection");

  expect(new ViewFactory(dir).render("page")).toBe("<head><page/><toast/></head>hi");
});

test("@prepend still goes first when the stack prints before the pushes", () => {
  const layouts = { "layouts.app": "[@stack('s')]" };
  const child = `@extends('layouts.app')
@push('s')b@endpush
@prepend('s')a@endprepend`;
  expect(renderWith(child, layouts)).toBe("[ab]");
});

test("@stop ends a section like @endsection", () => {
  const layouts = { "layouts.app": "<h1>@yield('title')</h1>@yield('content')" };
  const child = `@extends('layouts.app')
@section('title')Hi@stop
@section('content')Body@endsection`;
  expect(renderWith(child, layouts)).toBe("<h1>Hi</h1>Body");
});

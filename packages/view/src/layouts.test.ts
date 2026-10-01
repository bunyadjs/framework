import { expect, test } from "bun:test";
import { resolveLayouts, compile } from "../src/index.ts";

test("resolveLayouts merges sections into yield", () => {
  const layouts: Record<string, string> = {
    "layouts.app": "<main>@yield('content')</main>",
  };
  const child = `@extends('layouts.app')
@section('content')
Hi {{ name }}
@endsection`;
  const merged = resolveLayouts(child, (name) => layouts[name]!);
  expect(merged).toContain("Hi {{ name }}");
  expect(merged).not.toContain("@yield");
  expect(compile(merged)({ name: "Ada" })).toBe("<main>Hi Ada</main>");
});

test("resolveLayouts yield default when section missing", () => {
  const layouts: Record<string, string> = {
    "layouts.app": "<title>@yield('title', 'App')</title>@yield('content')",
  };
  const child = `@extends('layouts.app')
@section('content')
Hi
@endsection`;
  const merged = resolveLayouts(child, (name) => layouts[name]!);
  expect(merged).toBe("<title>App</title>Hi");
});

test("@yield in a template rendered without @extends outputs its default or nothing", () => {
  const out = resolveLayouts("<main>{!! slot !!}@yield('content')@yield('title', 'Home')</main>", () => "");
  expect(out).toBe("<main>{!! slot !!}Home</main>");
});

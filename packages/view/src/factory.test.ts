import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ViewFactory, setViewFactory, view, render, View } from "../src/index.ts";

test("factory caches and renders file views", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "home.view"), "Hi {{ name }}");
  const factory = new ViewFactory(dir);
  setViewFactory(factory);

  expect(render("home", { name: "Ada" })).toBe("Hi Ada");
  const res = view("home", { name: "Ada" });
  expect(await res.text()).toBe("Hi Ada");
  expect(res.headers.get("Content-Type")).toContain("text/html");
});

test("shared global helpers are available in templates without @use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(
    join(dir, "link.view"),
    `<a href="{{ asset('css/app.css') }}">{{ config('app.name') }}</a>`,
  );
  const g = globalThis as { asset?: unknown; config?: unknown };
  const { asset, config } = g;
  g.asset = (p: string) => `https://cdn.test/${p}`;
  g.config = () => "Karobar";
  try {
    const factory = new ViewFactory(dir);
    expect(factory.render("link")).toBe(
      `<a href="https://cdn.test/css/app.css">Karobar</a>`,
    );
  } finally {
    // Other suites in the same process rely on the real helpers.
    g.asset = asset;
    g.config = config;
  }
});

test("old() helper and x-components from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "components"), { recursive: true });
  await writeFile(
    join(dir, "form.view"),
    `<input value="{{ old('email') }}" /><x-alert type="info">{{ old('email') }}</x-alert>`,
  );
  await writeFile(
    join(dir, "components/alert.view"),
    `<aside class="{{ type }}">{!! slot !!}</aside>`,
  );
  const factory = new ViewFactory(dir);

  expect(
    factory.render("form", { _old: { email: "a@b.c" } }),
  ).toBe(`<input value="a@b.c" /><aside class="info">a@b.c</aside>`);
});

test("class-based components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "components"), { recursive: true });
  await writeFile(join(dir, "page.view"), `<x-badge :count="n" />`);
  await writeFile(
    join(dir, "components/badge.view"),
    `<span>{{ count }}</span>`,
  );

  const { Component } = await import("../src/component.ts");
  class Badge extends Component {
    count = 0;
    render() {
      return "components.badge";
    }
  }

  const factory = new ViewFactory(dir).component("badge", Badge);
  expect(factory.render("page", { n: 3 })).toBe("<span>3</span>");
});

test("clearCache drops precompiled views so disk edits apply", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "home.view"), "from-disk");
  const factory = new ViewFactory(dir, {
    compiled: {
      home: () => "from-compiled",
    },
  });
  expect(factory.render("home")).toBe("from-compiled");
  factory.clearCache();
  expect(factory.render("home")).toBe("from-disk");
});

test("BUNYAD_DEV skips cache so disk edits apply without clearCache", async () => {
  const prev = process.env.BUNYAD_DEV;
  process.env.BUNYAD_DEV = "1";
  try {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
    const file = join(dir, "home.view");
    await writeFile(file, "v1");
    const factory = new ViewFactory(dir);
    expect(factory.render("home")).toBe("v1");
    await writeFile(file, "v2");
    expect(factory.render("home")).toBe("v2");
  } finally {
    if (prev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prev;
  }
});

test("compiledOnly fails fast without disk compile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "home.view"), "from-disk");
  const factory = new ViewFactory(dir, {
    compiled: {
      home: () => "from-compiled",
    },
    compiledOnly: true,
  });
  expect(factory.render("home")).toBe("from-compiled");
  expect(() => factory.render("missing")).toThrow(/not found in compiled views/);
  try {
    factory.render("other");
  } catch (err) {
    expect((err as { code?: string }).code).toBe("BUNYAD_VIEW_001");
  }
  // Disk file exists but compiledOnly must not read it for unlisted names.
  await writeFile(join(dir, "extra.view"), "disk-extra");
  expect(() => factory.render("extra")).toThrow(/compiled views/);
});

test("factory resolves @extends sections and @include end-to-end", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "layouts"), { recursive: true });
  await mkdir(join(dir, "partials"), { recursive: true });
  await writeFile(
    join(dir, "layouts/app.view"),
    `<html><body>@yield('content')</body></html>`,
  );
  await writeFile(join(dir, "partials/nav.view"), `<nav>{{ active }}</nav>`);
  await writeFile(
    join(dir, "home.view"),
    `@extends('layouts.app')
@section('content')
@include('partials.nav', { active: page })
Hi {{ name }}
@endsection`,
  );
  const factory = new ViewFactory(dir);
  expect(factory.render("home", { name: "Ada", page: "home" })).toBe(
    `<html><body><nav>home</nav>
Hi Ada</body></html>`,
  );
});

test("share merges into every render", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "home.view"), "{{ appName }} {{ title }}");
  const factory = new ViewFactory(dir);
  setViewFactory(factory);
  factory.share("appName", "Karobar");
  factory.share({ title: "Home" });
  expect(factory.render("home")).toBe("Karobar Home");
  expect(factory.render("home", { title: "Override" })).toBe("Karobar Override");
  View.share("brand", "KP");
  await writeFile(join(dir, "branded.view"), "{{ brand }}");
  expect(factory.render("branded")).toBe("KP");
});

test("composer mutates data for matching views", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await mkdir(join(dir, "admin"), { recursive: true });
  await writeFile(join(dir, "admin/dash.view"), "{{ label }}");
  await writeFile(join(dir, "public.view"), "{{ label }}");
  const factory = new ViewFactory(dir);
  factory.composer("admin.*", (data) => {
    data.label = "Admin";
  });
  factory.composer(["public"], () => ({ label: "Public" }));
  expect(factory.render("admin.dash")).toBe("Admin");
  expect(factory.render("public")).toBe("Public");
});

test("exists and first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-views-"));
  await writeFile(join(dir, "a.view"), "A");
  const factory = new ViewFactory(dir);
  expect(factory.exists("a")).toBe(true);
  expect(factory.exists("missing")).toBe(false);
  expect(factory.first(["missing", "a"])).toBe("A");
  expect(() => factory.first(["x", "y"])).toThrow(/None of the views/);
});

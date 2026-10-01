import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { flockServedHint, listTemplates, newProject } from "./new.ts";
import { Prompt, restore, setPromptOutput } from "./prompts.ts";

test("listTemplates includes every starter kit and saas", async () => {
  const templates = await listTemplates();
  for (const kit of ["views", "live", "react", "vue", "svelte", "api", "saas"]) {
    expect(templates).toContain(kit);
  }
});

test("newProject scaffolds api template", async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new");
  const target = resolve(parent, "scaffold-api");
  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });

  const cwd = process.cwd();
  process.chdir(parent);
  try {
    await newProject(["api", "scaffold-api"]);
    expect(existsSync(resolve(target, "server.ts"))).toBe(true);
    expect(existsSync(resolve(target, "routes/api.ts"))).toBe(true);
    const pkg = (await Bun.file(resolve(target, "package.json")).json()) as {
      name: string;
    };
    expect(pkg.name).toBe("@bunyad-apps/scaffold-api");
  } finally {
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

test("flockServedHint is null without Flock", () => {
  const prevUrl = process.env.FLOCK_CONTROL_URL;
  const prevHome = process.env.FLOCK_HOME;
  delete process.env.FLOCK_CONTROL_URL;
  process.env.FLOCK_HOME = "/tmp/no-flock-home-xyz";
  try {
    expect(flockServedHint("demo", "/tmp/demo")).toBeNull();
  } finally {
    if (prevUrl === undefined) {
      delete process.env.FLOCK_CONTROL_URL;
    } else {
      process.env.FLOCK_CONTROL_URL = prevUrl;
    }
    if (prevHome === undefined) {
      delete process.env.FLOCK_HOME;
    } else {
      process.env.FLOCK_HOME = prevHome;
    }
  }
});

test("flockServedHint points at name.test when Flock is present", () => {
  const prevUrl = process.env.FLOCK_CONTROL_URL;
  const prevPark = process.env.FLOCK_PARK;
  process.env.FLOCK_CONTROL_URL = "http://127.0.0.1:7979";
  process.env.FLOCK_PARK = "/tmp/Flock";
  try {
    expect(flockServedHint("shop", "/tmp/Flock/shop")).toContain("http://shop.test");
  } finally {
    if (prevUrl === undefined) {
      delete process.env.FLOCK_CONTROL_URL;
    } else {
      process.env.FLOCK_CONTROL_URL = prevUrl;
    }
    if (prevPark === undefined) {
      delete process.env.FLOCK_PARK;
    } else {
      process.env.FLOCK_PARK = prevPark;
    }
  }
});

test("the prompt offers the starter kits by name and copies no runtime leftovers", { timeout: 30_000 }, async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new-prompt");
  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });
  const lines: string[] = [];
  setPromptOutput((line) => lines.push(line));
  const log = console.log;
  console.log = (line: string) => lines.push(String(line));
  // Without Flock, so the next steps are the plain ones.
  const prevHome = process.env.FLOCK_HOME;
  const prevUrl = process.env.FLOCK_CONTROL_URL;
  process.env.FLOCK_HOME = "/tmp/no-flock-home-xyz";
  delete process.env.FLOCK_CONTROL_URL;
  const cwd = process.cwd();
  process.chdir(parent);
  try {
    Prompt.fake(["1", "shop", true]);
    await newProject([]);

    const menu = lines.join("\n");
    expect(menu).toContain("1. Views — server-rendered .view pages");
    expect(menu).toContain("Svelte — Inertia with Svelte 5");
    expect(menu).not.toContain("saas");

    const target = resolve(parent, "shop");
    expect(existsSync(resolve(target, "routes/auth.ts"))).toBe(true);
    // The template has node_modules and a test database from being run.
    expect(existsSync(resolve(target, "node_modules"))).toBe(false);
    expect(existsSync(resolve(target, "database/testing.sqlite"))).toBe(false);
    expect(existsSync(resolve(target, "database/migrations"))).toBe(true);
    expect(existsSync(resolve(target, ".env"))).toBe(true);
    expect(menu).toContain("bunyad migrate");
    expect(menu).toContain("bun run dev");
  } finally {
    if (prevHome === undefined) delete process.env.FLOCK_HOME;
    else process.env.FLOCK_HOME = prevHome;
    if (prevUrl !== undefined) process.env.FLOCK_CONTROL_URL = prevUrl;
    console.log = log;
    restore();
    setPromptOutput((line) => console.log(line));
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

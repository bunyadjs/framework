import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { applyDatabase, flockServedHint, listTemplates, newProject } from "./new.ts";
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

test("the prompt offers the starter kits by name and copies no runtime leftovers", async () => {
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
    Prompt.fake(["1", "shop", "1", false, false, true]);
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
    expect(menu).toContain("bun ./bunyad migrate");
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
}, 30_000);

test("--database points the new app's .env at PostgreSQL", async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new-db");
  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });
  const cwd = process.cwd();
  process.chdir(parent);
  try {
    await newProject(["api", "shop-api", "--database=pgsql"]);
    const env = await Bun.file(resolve(parent, "shop-api/.env")).text();
    expect(env).toContain("DB_CONNECTION=pgsql");
    expect(env).toContain("DB_PORT=5432");
    expect(env).toContain("DB_DATABASE=shop_api");
    expect(env).toContain("DB_USERNAME=postgres");
    expect(env).not.toContain("# DB_HOST");
    expect(env).toMatch(/^APP_KEY=.{20,}$/m);
  } finally {
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

test("applyDatabase appends settings the template does not list", async () => {
  const dir = resolve(import.meta.dir, "../.tmp-new-env");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await Bun.write(resolve(dir, ".env.example"), "APP_NAME=x\nDB_CONNECTION=sqlite\n");
    await applyDatabase(dir, "mysql", "my-app");
    const env = await Bun.file(resolve(dir, ".env.example")).text();
    expect(env).toContain("DB_CONNECTION=mysql");
    expect(env).toContain("DB_PORT=3306");
    expect(env).toContain("DB_DATABASE=my_app");
    expect(env).toContain("APP_NAME=x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown options and databases are rejected before anything is created", async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new-bad");
  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });
  const cwd = process.cwd();
  const err = console.error;
  const messages: string[] = [];
  console.error = (line: string) => messages.push(String(line));
  process.chdir(parent);
  try {
    await newProject(["api", "a", "--database=oracle"]);
    await newProject(["api", "b", "--nope"]);
    expect(messages.join("\n")).toContain('Unknown database "oracle"');
    expect(messages.join("\n")).toContain("Unknown option --nope");
    expect(existsSync(resolve(parent, "a"))).toBe(false);
    expect(existsSync(resolve(parent, "b"))).toBe(false);
  } finally {
    process.exitCode = 0;
    console.error = err;
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

test("--kit and --dir name the starter kit and directory without prompts", async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new-flags");
  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });
  const cwd = process.cwd();
  process.chdir(parent);
  try {
    await newProject(["--kit=api", "--dir=from-flags"]);
    await newProject(["--kit=api", "positional-dir"]);
    expect(existsSync(resolve(parent, "from-flags/routes/api.ts"))).toBe(true);
    expect(existsSync(resolve(parent, "positional-dir/routes/api.ts"))).toBe(true);
  } finally {
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

test("names with spaces are rejected, and non-empty directories are not overwritten", async () => {
  const parent = resolve(import.meta.dir, "../.tmp-new-dirs");
  await rm(parent, { recursive: true, force: true });
  await mkdir(resolve(parent, "taken"), { recursive: true });
  await Bun.write(resolve(parent, "taken/keep.txt"), "mine");
  await mkdir(resolve(parent, "empty"), { recursive: true });
  const cwd = process.cwd();
  const err = console.error;
  const messages: string[] = [];
  console.error = (line: string) => messages.push(String(line));
  process.chdir(parent);
  try {
    await newProject(["api", "my app"]);
    expect(existsSync(resolve(parent, "my app"))).toBe(false);
    expect(messages.join("\n")).toContain("contains spaces");

    messages.length = 0;
    await newProject(["api", "taken"]);
    expect(messages.join("\n")).toContain("not empty");
    expect(await Bun.file(resolve(parent, "taken/keep.txt")).text()).toBe("mine");

    messages.length = 0;
    process.exitCode = 0;
    await newProject(["api", "empty"]);
    expect(messages).toEqual([]);
    expect(existsSync(resolve(parent, "empty/server.ts"))).toBe(true);
  } finally {
    console.error = err;
    process.exitCode = 0;
    process.chdir(cwd);
    await rm(parent, { recursive: true, force: true });
  }
});

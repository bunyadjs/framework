import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCommands } from "./make.ts";

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test("make:model -mfs writes migration factory and seeder", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-model-"));
  await mkdir(join(root, "app/Models"), { recursive: true });
  await mkdir(join(root, "database/migrations"), { recursive: true });
  await mkdir(join(root, "database/factories"), { recursive: true });
  await mkdir(join(root, "database/seeders"), { recursive: true });

  await withCwd(root, async () => {
    await makeCommands["make:model"]!(["Widget", "-mfs"]);
  });

  expect(await Bun.file(join(root, "app/Models/Widget.ts")).exists()).toBe(true);
  expect(await Bun.file(join(root, "database/factories/WidgetFactory.ts")).exists()).toBe(
    true,
  );
  expect(await Bun.file(join(root, "database/seeders/WidgetSeeder.ts")).exists()).toBe(
    true,
  );

  const { readdir } = await import("node:fs/promises");
  const migrations = await readdir(join(root, "database/migrations"));
  expect(migrations.some((f) => f.includes("create_widgets_table"))).toBe(true);
});

test("make:model -c --policy writes controller and policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-model-cp-"));
  await mkdir(join(root, "app/Models"), { recursive: true });
    await mkdir(join(root, "app/Policies"), { recursive: true });

  await withCwd(root, async () => {
    await makeCommands["make:model"]!(["Article", "-c", "--policy"]);
  });

  expect(await Bun.file(join(root, "app/Models/Article.ts")).exists()).toBe(true);
  expect(
    await Bun.file(join(root, "routes/article/ArticleController.ts")).exists(),
  ).toBe(true);
  expect(await Bun.file(join(root, "app/Policies/ArticlePolicy.ts")).exists()).toBe(
    true,
  );
});

test("make:test and make:provider stubs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-test-"));
  await mkdir(join(root, "tests/Feature"), { recursive: true });
  await mkdir(join(root, "tests/Unit"), { recursive: true });
  await mkdir(join(root, "app/Providers"), { recursive: true });
  await writeFile(
    join(root, "server.ts"),
    `import { bunyad } from "@bunyad/framework";
import AppServiceProvider from "@/Providers/AppServiceProvider.ts";

export const createApplication = bunyad(import.meta, {
  providers: [AppServiceProvider],
});
`,
  );

  await withCwd(root, async () => {
    await makeCommands["make:test"]!(["Order"]);
    await makeCommands["make:test"]!(["Math", "--unit"]);
    await makeCommands["make:provider"]!(["Billing"]);
  });

  expect(await Bun.file(join(root, "tests/Feature/OrderTest.ts")).exists()).toBe(
    true,
  );
  expect(await Bun.file(join(root, "tests/Unit/MathTest.ts")).exists()).toBe(true);
  expect(
    await Bun.file(join(root, "app/Providers/BillingProvider.ts")).exists(),
  ).toBe(true);

  const server = await readFile(join(root, "server.ts"), "utf8");
  expect(server).toContain('import BillingProvider from "@/Providers/BillingProvider.ts";');
  expect(server).toContain("providers: [BillingProvider, AppServiceProvider]");
});

test("make:provider adds the providers option to a bare bunyad() call", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-test-"));
  await writeFile(
    join(root, "server.ts"),
    `import { bunyad } from "@bunyad/framework";

export const createApplication = bunyad(import.meta);
`,
  );
  await withCwd(root, async () => {
    await makeCommands["make:provider"]!(["Billing"]);
  });
  const server = await readFile(join(root, "server.ts"), "utf8");
  expect(server).toContain("bunyad(import.meta, { providers: [BillingProvider] })");
});

test("make:controller supports folders, --invokable, --api and --requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-controller-"));
  await withCwd(root, async () => {
    await makeCommands["make:controller"]!(["Auth/Register", "--invokable"]);
    const invokable = await readFile(
      join(root, "routes/auth/register/RegisterController.ts"),
      "utf8",
    );
    expect(invokable).toContain("export default class RegisterController");
    expect(invokable).toContain("async handle(_request: Request)");

    await makeCommands["make:controller"]!(["Post", "--api", "--requests"]);
    const api = await readFile(join(root, "routes/post/PostController.ts"), "utf8");
    expect(api).toContain("store(_request: StorePostRequest)");
    expect(api).toContain("update(_request: UpdatePostRequest)");
    expect(api).not.toContain("create(");
    expect(api).toContain('import StorePostRequest from "@/Http/Requests/StorePostRequest.ts"');
    const update = await readFile(join(root, "app/Http/Requests/UpdatePostRequest.ts"), "utf8");
    expect(update).toContain("class UpdatePostRequest extends FormRequest");
  });
});

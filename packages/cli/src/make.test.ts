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
  await mkdir(join(root, "app/Http/Controllers"), { recursive: true });
  await mkdir(join(root, "app/Policies"), { recursive: true });

  await withCwd(root, async () => {
    await makeCommands["make:model"]!(["Article", "-c", "--policy"]);
  });

  expect(await Bun.file(join(root, "app/Models/Article.ts")).exists()).toBe(true);
  expect(
    await Bun.file(join(root, "app/Http/Controllers/ArticleController.ts")).exists(),
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
  await mkdir(join(root, "bootstrap"), { recursive: true });
  await writeFile(
    join(root, "bootstrap/providers.ts"),
    `import type { Application } from "@bunyad/core";
import AppServiceProvider from "../app/Providers/AppServiceProvider.ts";

export function registerProviders(app: Application): void {
  app.register(AppServiceProvider);
}
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

  const providers = await readFile(join(root, "bootstrap/providers.ts"), "utf8");
  expect(providers).toContain("BillingProvider");
  expect(providers).toContain("app.register(BillingProvider)");
});

test("make:controller supports folders, --invokable, --api and --requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-controller-"));
  await withCwd(root, async () => {
    await makeCommands["make:controller"]!(["Auth/Register", "--invokable"]);
    const invokable = await readFile(
      join(root, "app/Http/Controllers/Auth/RegisterController.ts"),
      "utf8",
    );
    expect(invokable).toContain("export default class RegisterController");
    expect(invokable).toContain("async __invoke(_request: Request)");

    await makeCommands["make:controller"]!(["Post", "--api", "--requests"]);
    const api = await readFile(join(root, "app/Http/Controllers/PostController.ts"), "utf8");
    expect(api).toContain("store(_request: StorePostRequest)");
    expect(api).toContain("update(_request: UpdatePostRequest)");
    expect(api).not.toContain("create(");
    expect(api).toContain('import StorePostRequest from "@/Http/Requests/StorePostRequest.ts"');
    const update = await readFile(join(root, "app/Http/Requests/UpdatePostRequest.ts"), "utf8");
    expect(update).toContain("class UpdatePostRequest extends FormRequest");
  });
});

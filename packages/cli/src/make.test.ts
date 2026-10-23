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
    expect(api).toContain('import StorePostRequest from "./StorePostRequest.ts"');
    const update = await readFile(join(root, "routes/post/UpdatePostRequest.ts"), "utf8");
    expect(update).toContain("class UpdatePostRequest extends FormRequest");
  });
});

test("make:controller and make:request follow the folder they run in", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-folder-"));
  await writeFile(join(root, "server.ts"), "export default {};\n");
  await mkdir(join(root, "routes/(auth)"), { recursive: true });
  await withCwd(join(root, "routes/(auth)"), async () => {
    await makeCommands["make:controller"]!(["Login"]);
    await makeCommands["make:request"]!(["LoginRequest"]);
  });
  expect(await readFile(join(root, "routes/(auth)/login/LoginController.ts"), "utf8")).toContain("class LoginController");
  expect(await readFile(join(root, "routes/(auth)/LoginRequest.ts"), "utf8")).toContain("class LoginRequest");

  await mkdir(join(root, "app/Models"), { recursive: true });
  await withCwd(join(root, "app/Models"), async () => {
    await makeCommands["make:job"]!(["SendInvoice"]);
  });
  expect(await readFile(join(root, "app/Jobs/SendInvoiceJob.ts"), "utf8")).toContain("SendInvoiceJob");
});

test("classic apps get controllers and requests in app/Http", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-classic-"));
  await writeFile(join(root, "server.ts"), "export default {};\n");
  await mkdir(join(root, "routes"), { recursive: true });
  await writeFile(join(root, "routes/web.ts"), "export default function () {}\n");
  await withCwd(root, async () => {
    await makeCommands["make:controller"]!(["Auth/Register", "--resource", "--requests"]);
  });
  expect(await readFile(join(root, "app/Http/Controllers/Auth/RegisterController.ts"), "utf8")).toContain(
    'import StoreRegisterRequest from "@/Http/Requests/Auth/StoreRegisterRequest.ts"',
  );
  expect(await readFile(join(root, "app/Http/Requests/Auth/UpdateRegisterRequest.ts"), "utf8")).toContain("FormRequest");
});

test("bunyad.json decides the structure over the files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-marker-"));
  await writeFile(join(root, "server.ts"), "export default {};\n");
  await writeFile(join(root, "bunyad.json"), JSON.stringify({ structure: "classic" }));
  await withCwd(root, async () => {
    await makeCommands["make:controller"]!(["Post"]);
  });
  expect(await readFile(join(root, "app/Http/Controllers/PostController.ts"), "utf8")).toContain("class PostController");
});

test("make:test goes in _tests beside the code in a folders app, and in tests/ in a classic one", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-make-test-"));
  await writeFile(join(root, "server.ts"), "export default {};\n");
  await mkdir(join(root, "routes/(auth)/login"), { recursive: true });
  await writeFile(join(root, "routes/(auth)/login/LoginController.ts"), "export default class LoginController {}\n");
  await withCwd(join(root, "routes/(auth)/login"), async () => {
    await makeCommands["make:test"]!(["Login"]);
  });
  const test = await readFile(join(root, "routes/(auth)/login/_tests/LoginTest.ts"), "utf8");
  expect(test).toContain('await import("../../../../server.ts")');

  const classic = await mkdtemp(join(tmpdir(), "bunyad-make-test-classic-"));
  await writeFile(join(classic, "server.ts"), "export default {};\n");
  await writeFile(join(classic, "bunyad.json"), JSON.stringify({ structure: "classic" }));
  await withCwd(classic, async () => {
    await makeCommands["make:test"]!(["Login"]);
  });
  expect(await readFile(join(classic, "tests/Feature/LoginTest.ts"), "utf8")).toContain('await import("../../server.ts")');
});

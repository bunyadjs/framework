import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function studly(name: string): string {
  return name
    .replace(/[_\-\s]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
}

function className(name: string, suffix?: string): string {
  let base = studly(name.replace(/\.ts$/i, ""));
  if (suffix && !base.endsWith(suffix)) base += suffix;
  return base;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeStub(
  relativePath: string,
  contents: string,
  force: boolean,
): Promise<string> {
  const path = resolve(process.cwd(), relativePath);
  if (!force && (await exists(path))) {
    throw new Error(`${relativePath} already exists (use --force to overwrite).`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return relativePath;
}

function parseFlags(args: string[]): { name?: string; force: boolean; rest: string[] } {
  const force = args.includes("--force");
  const rest = args.filter((a) => a !== "--force");
  return { name: rest[0], force, rest };
}

/** `Auth/Register` → `{ dir: "Auth", base: "Register" }`. */
function splitFolder(name: string): { dir: string; base: string } {
  const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
  const base = parts.pop() ?? name;
  return { dir: parts.map(studly).join("/"), base };
}

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

/** Expand combined short flags like `-mfs` into individual letters. */
function expandShortFlags(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (/^-[mfsct]+$/.test(arg) && !arg.startsWith("--")) {
      for (const ch of arg.slice(1)) {
        out.push(`-${ch}`);
      }
    } else {
      out.push(arg);
    }
  }
  return out;
}

function tableNameFromModel(cls: string): string {
  return cls
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/y$/, "ie")
    .replace(/([^s])$/, "$1s");
}

async function appendProviderRegistration(
  className: string,
  relativeImport: string,
): Promise<boolean> {
  const providersPath = resolve(process.cwd(), "bootstrap/providers.ts");
  if (!(await exists(providersPath))) {
    return false;
  }
  let source = await Bun.file(providersPath).text();
  const importLine = `import ${className} from "${relativeImport}";`;
  if (!source.includes(importLine) && !source.includes(`import ${className} from`)) {
    const lastImport = [...source.matchAll(/^import .+$/gm)].at(-1);
    if (lastImport && lastImport.index != null) {
      const insertAt = lastImport.index + lastImport[0].length;
      source =
        source.slice(0, insertAt) + `\n${importLine}` + source.slice(insertAt);
    } else {
      source = `${importLine}\n${source}`;
    }
  }
  const registerCall = `app.register(${className});`;
  if (!source.includes(registerCall)) {
    if (/registerProviders\([^)]*\)\s*:\s*void\s*\{/.test(source)) {
      source = source.replace(
        /(registerProviders\([^)]*\)\s*:\s*void\s*\{)/,
        `$1\n  ${registerCall}`,
      );
    } else if (/export function registerProviders/.test(source)) {
      source = source.replace(
        /(export function registerProviders[\s\S]*?\{\n)/,
        `$1  ${registerCall}\n`,
      );
    } else {
      source += `\n${registerCall}\n`;
    }
  }
  await writeFile(providersPath, source);
  return true;
}

export const makeCommands: Record<
  string,
  (args: string[]) => Promise<void>
> = {
  async "make:command"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:command Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Command");
    const command = name
      .replace(/Command$/i, "")
      .replace(/[A-Z]/g, (ch, i) => (i === 0 ? ch.toLowerCase() : `:${ch.toLowerCase()}`))
      .replace(/[:\s]+/g, ":")
      .replace(/_+/g, "-");
    const path = join("app/Console/Commands", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Command } from "@bunyad/cli/command";

export default class ${cls} extends Command {
  static signature = "${command}";
  static description = "";

  async handle(): Promise<number> {
    this.info("${cls}");
    return 0;
  }
}
`,
      force,
    );
    console.log(`Command created: ${file}`);
  },

  async "make:controller"(args) {
    const { name, force, rest } = parseFlags(args);
    if (!name) {
      console.error(
        "Usage: make:controller [Folder/]Name [--invokable|-i] [--api] [--resource|-r] [--model=Name] [--requests|-R] [--force]",
      );
      process.exitCode = 1;
      return;
    }
    const invokable = hasFlag(rest, "--invokable", "-i");
    const api = hasFlag(rest, "--api");
    const resource = hasFlag(rest, "--resource", "-r") || api;
    const withRequests = hasFlag(rest, "--requests", "-R");
    const modelFlag = rest.find((a) => a.startsWith("--model="))?.slice("--model=".length);

    const { dir, base } = splitFolder(name);
    const cls = className(base, "Controller");
    const path = join("app/Http/Controllers", dir, `${cls}.ts`);
    const model = modelFlag ? className(modelFlag) : undefined;
    const subject = model ?? cls.replace(/Controller$/, "");

    const imports: string[] = [];
    let formStore = "Request";
    let formUpdate = "Request";
    if (resource && withRequests) {
      formStore = `Store${subject}Request`;
      formUpdate = `Update${subject}Request`;
      for (const form of [formStore, formUpdate]) {
        await makeCommands["make:request"]!([join(dir, form), ...(force ? ["--force"] : [])]);
        imports.push(`import ${form} from "@/Http/Requests/${join(dir, form)}.ts";`);
      }
    }
    const requestImport = `import type { Request } from "@bunyad/http";
import { json${resource ? ", noContent" : ""} } from "@bunyad/http";`;

    let body: string;
    if (invokable) {
      body = `  async __invoke(_request: Request) {
    return json({ message: "${cls}" });
  }`;
    } else if (resource) {
      const action = (signature: string, result: string) =>
        `  async ${signature} {\n    ${result}\n  }`;
      const methods = [
        action("index(_request: Request)", `return json({ data: [] });`),
        ...(api ? [] : [action("create(_request: Request)", `return json({ message: "create" });`)]),
        action(`store(_request: ${formStore})`, `return json({ message: "store" }, 201);`),
        action("show(_request: Request)", `return json({ message: "show" });`),
        ...(api ? [] : [action("edit(_request: Request)", `return json({ message: "edit" });`)]),
        action(`update(_request: ${formUpdate})`, `return json({ message: "update" });`),
        action("destroy(_request: Request)", `return noContent();`),
      ];
      body = methods.join("\n\n");
    } else {
      body = `  async index(_request: Request) {
    return json({ message: "${cls}" });
  }`;
    }

    const file = await writeStub(
      path,
      `${[requestImport, ...imports].join("\n")}

export default class ${cls} {
${body}
}
`,
      force,
    );
    console.log(`Controller created: ${file}`);
  },

  async "make:model"(args) {
    const expanded = expandShortFlags(args);
    const { name, force } = parseFlags(expanded);
    if (!name) {
      console.error(
        "Usage: make:model Name [-m|--migration] [-f|--factory] [-s|--seed] [-c|--controller] [--policy] [--force]",
      );
      process.exitCode = 1;
      return;
    }
    const withMigration = hasFlag(
      expanded,
      "-m",
      "--migration",
      "--migrations",
    );
    const withFactory = hasFlag(expanded, "-f", "--factory");
    const withSeeder = hasFlag(expanded, "-s", "--seed", "--seeder");
    const withController = hasFlag(expanded, "-c", "--controller");
    const withPolicy = hasFlag(expanded, "--policy");

    const cls = className(name);
    const path = join("app/Models", `${cls}.ts`);
    const table = tableNameFromModel(cls);
    const file = await writeStub(
      path,
      `import { Model } from "@bunyad/orm";

export default class ${cls} extends Model {
  static table = "${table}";
  static fillable = ["name"] as const;
}
`,
      force,
    );
    console.log(`Model created: ${file}`);

    if (withMigration) {
      await makeCommands["make:migration"]!([`create_${table}_table`, ...(force ? ["--force"] : [])]);
    }
    if (withFactory) {
      await makeCommands["make:factory"]!([cls, ...(force ? ["--force"] : [])]);
    }
    if (withSeeder) {
      await makeCommands["make:seeder"]!([`${cls}Seeder`, ...(force ? ["--force"] : [])]);
    }
    if (withController) {
      await makeCommands["make:controller"]!([
        `${cls}Controller`,
        ...(force ? ["--force"] : []),
      ]);
    }
    if (withPolicy) {
      await makeCommands["make:policy"]!([
        `${cls}Policy`,
        `--model=${cls}`,
        ...(force ? ["--force"] : []),
      ]);
    }
  },

  async "make:mailable"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:mailable Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Mail");
    const path = join("app/Mail", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Mailable } from "@bunyad/mail";

export default class ${cls} extends Mailable {
  constructor(readonly email: string) {
    super();
  }

  envelope() {
    return { to: this.email, subject: "${cls}" };
  }

  content() {
    return { text: "Hello from ${cls}" };
  }
}
`,
      force,
    );
    console.log(`Mailable created: ${file}`);
  },

  async "make:job"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:job Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Job");
    const path = join("app/Jobs", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Job } from "@bunyad/queue";

export default class ${cls} extends Job {
  async handle(): Promise<void> {
    console.log("[job] ${cls}");
  }
}
`,
      force,
    );
    console.log(`Job created: ${file}`);
  },

  async "make:middleware"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:middleware Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name);
    const path = join("app/Http/Middleware", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import type { Next } from "@bunyad/contracts";
import type { Request } from "@bunyad/http";

export default class ${cls} {
  async handle(request: Request, next: Next, ...params: string[]) {
    // Optional: next(modifiedRequest) replaces the request for later layers.
    return next();
  }

  // Optional: runs after the response is ready.
  // async terminate(request: Request, response: Response) {}
}
`,
      force,
    );
    console.log(`Middleware created: ${file}`);
  },

  async "make:notification"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:notification Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Notification");
    const path = join("app/Notifications", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Notification, type Notifiable } from "@bunyad/notifications";
import { Mailable } from "@bunyad/mail";

class ${cls}Mail extends Mailable {
  constructor(readonly email: string) {
    super();
  }
  envelope() {
    return { to: this.email, subject: "${cls}" };
  }
  content() {
    return { text: "${cls}" };
  }
}

export default class ${cls} extends Notification {
  via(_notifiable: Notifiable) {
    return ["mail"] as const;
  }

  toMail(notifiable: Notifiable) {
    return new ${cls}Mail(String(notifiable.email ?? ""));
  }
}
`,
      force,
    );
    console.log(`Notification created: ${file}`);
  },

  async "make:event"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:event Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name);
    const path = join("app/Events", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Event } from "@bunyad/events";

export default class ${cls} extends Event {
  constructor(readonly payload: Record<string, unknown> = {}) {
    super();
  }
}
`,
      force,
    );
    console.log(`Event created: ${file}`);
  },

  async "make:listener"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:listener Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name);
    const path = join("app/Listeners", `${cls}.ts`);
    const file = await writeStub(
      path,
      `export default async function ${cls}(event: unknown): Promise<void> {
  console.log("[listener] ${cls}", event);
}
`,
      force,
    );
    console.log(`Listener created: ${file}`);
  },

  async "make:request"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:request Name [--force]");
      process.exitCode = 1;
      return;
    }
    const { dir, base } = splitFolder(name);
    const cls = className(base, "Request");
    const path = join("app/Http/Requests", dir, `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { FormRequest } from "@bunyad/http";

export default class ${cls} extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return {
      // field: "required|string",
    };
  }
}
`,
      force,
    );
    console.log(`Request created: ${file}`);
  },

  async "make:resource"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:resource Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Resource");
    const path = join("app/Http/Resources", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { JsonResource } from "@bunyad/http";

export default class ${cls} extends JsonResource<Record<string, unknown>> {
  toArray() {
    return {
      ...(this.resource as Record<string, unknown>),
    };
  }
}
`,
      force,
    );
    console.log(`Resource created: ${file}`);
  },

  async "make:migration"(args) {
    const { name, force, rest } = parseFlags(args);
    if (!name) {
      console.error(
        "Usage: make:migration create_widgets_table | make:migration add_foo_to_widgets_table [--force]",
      );
      process.exitCode = 1;
      return;
    }

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");

    const snake = name
      .replace(/\.ts$/i, "")
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[-\s]+/g, "_")
      .toLowerCase();

    const createMatch = /^create_(.+)_table$/.exec(snake);
    const table = createMatch?.[1] ?? "table";
    const filename = `${stamp}_${snake}.ts`;
    const path = join("database/migrations", filename);

    const body = createMatch
      ? `import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("${table}", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("${table}");
}
`
      : `import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.table("table_name", (table) => {
    table.string("column").nullable();
    // table.renameColumn("old", "new");
    // table.dropColumn("column");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("table_name", (table) => {
    table.dropColumn("column");
  });
}
`;

    // unused rest silenced
    void rest;

    const file = await writeStub(path, body, force);
    console.log(`Migration created: ${file}`);
  },

  async "make:seeder"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:seeder Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Seeder");
    const path = join("database/seeders", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Seeder } from "@bunyad/database";

export default class ${cls} extends Seeder {
  async run(): Promise<void> {
    // Seed data here
  }
}
`,
      force,
    );
    console.log(`Seeder created: ${file}`);
  },

  async "make:policy"(args) {
    const { name, force, rest } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:policy Name [--model=Model] [--force]");
      process.exitCode = 1;
      return;
    }
    const modelFlag = rest.find((a) => a.startsWith("--model="));
    const model =
      modelFlag?.slice("--model=".length) ||
      className(name.replace(/Policy$/i, ""));
    const cls = className(name, "Policy");
    const path = join("app/Policies", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import type { GateUser } from "@bunyad/auth";
import type ${model} from "@/Models/${model}.ts";

export default class ${cls} {
  view(_user: GateUser, _model: ${model}) {
    return true;
  }

  create(user: GateUser) {
    return user != null;
  }

  update(user: GateUser, model: ${model}) {
    return user != null && Number(user.id) === Number((model as { user_id?: unknown }).user_id);
  }

  delete(user: GateUser, model: ${model}) {
    return user != null && Number(user.id) === Number((model as { user_id?: unknown }).user_id);
  }
}
`,
      force,
    );
    console.log(`Policy created: ${file}`);
  },

  async "make:factory"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:factory Name [--force]");
      process.exitCode = 1;
      return;
    }
    const model = className(name.replace(/Factory$/i, ""));
    const cls = `${model}Factory`;
    const path = join("database/factories", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { Factory } from "@bunyad/orm";
import ${model} from "@/Models/${model}.ts";

export default class ${cls} extends Factory<${model}> {
  model() {
    return ${model};
  }

  definition() {
    return {
      // name: "Example",
    };
  }
}
`,
      force,
    );
    console.log(`Factory created: ${file}`);
  },

  async "make:test"(args) {
    const { name, force, rest } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:test Name [--unit] [--force]");
      process.exitCode = 1;
      return;
    }
    const unit = hasFlag(rest, "--unit");
    const cls = className(name.replace(/Test$/i, ""), "Test");
    const folder = unit ? "tests/Unit" : "tests/Feature";
    const path = join(folder, `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { expect, test } from "bun:test";
import { TestCase, testCase } from "@bunyad/testing";

@testCase({
  async createApplication() {
    const { createApplication } = await import("../../bootstrap/app.ts");
    return createApplication();
  },
})
class ${cls} extends TestCase {
  // @test()
  // async example() {
  //   const response = await this.get("/");
  //   response.assertOk();
  // }
}

test("${cls}", async () => {
  expect(true).toBe(true);
});
`,
      force,
    );
    console.log(`Test created: ${file}`);
  },

  async "make:provider"(args) {
    const { name, force } = parseFlags(args);
    if (!name) {
      console.error("Usage: make:provider Name [--force]");
      process.exitCode = 1;
      return;
    }
    const cls = className(name, "Provider");
    const path = join("app/Providers", `${cls}.ts`);
    const file = await writeStub(
      path,
      `import { ServiceProvider } from "@bunyad/core";

export default class ${cls} extends ServiceProvider {
  register(): void {
    // Bind services into the container.
  }

  boot(): void {
    // Register routes, events, or other boot-time work.
  }
}
`,
      force,
    );
    console.log(`Provider created: ${file}`);
    const appended = await appendProviderRegistration(
      cls,
      `../app/Providers/${cls}.ts`,
    );
    if (appended) {
      console.log(`Provider registered in bootstrap/providers.ts`);
    } else {
      console.log(
        `Note: bootstrap/providers.ts not found — register ${cls} manually.`,
      );
    }
  },
};

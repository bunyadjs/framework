import { cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { writeAppKey } from "./key.ts";
import { confirm, intro, outro, select, text } from "./prompts.ts";
import { appNameProblem, unsupportedRuntimeMessage } from "./runtime.ts";

/**
 * A published CLI runs from `dist/` and carries its own copy of the starter kits
 * (`templates/`, see scripts/bundle-templates.ts). In the monorepo they are read
 * from the repo's `templates/` folder and keep their `workspace:*` dependencies.
 */
const BUNDLED = basename(import.meta.dir) === "dist";
const TEMPLATES_ROOT = BUNDLED
  ? resolve(import.meta.dir, "../templates")
  : resolve(import.meta.dir, "../../../templates");

const DATABASES: Record<string, string> = {
  sqlite: "SQLite — a file, nothing to install",
  pgsql: "PostgreSQL",
  mysql: "MySQL",
};

type NewOptions = {
  kit?: string;
  dir?: string;
  database?: string;
  install?: boolean;
  git?: boolean;
};

/** `--kit=react`, `--dir=my-app`, `--database=pgsql`, `--install` / `--no-install`, `--git` / `--no-git`. */
function parseFlags(args: string[]): { positional: string[]; options: NewOptions } {
  const positional: string[] = [];
  const options: NewOptions = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
    } else if (arg.startsWith("--kit=")) {
      options.kit = arg.slice("--kit=".length);
    } else if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
    } else if (arg.startsWith("--database=")) {
      options.database = arg.slice("--database=".length);
    } else if (arg === "--install" || arg === "--no-install") {
      options.install = arg === "--install";
    } else if (arg === "--git" || arg === "--no-git") {
      options.git = arg === "--git";
    } else {
      throw new Error(`Unknown option ${arg}.`);
    }
  }
  if (options.database !== undefined && !(options.database in DATABASES)) {
    throw new Error(
      `Unknown database "${options.database}". Choose one of: ${Object.keys(DATABASES).join(", ")}.`,
    );
  }
  return { positional, options };
}

/**
 * The prompt's menu, in order. Any other template folder (`saas`, an add-on
 * on top of a web app) is still created with `bunyad new <folder> <dir>`.
 */
const STARTER_KITS: Record<string, string> = {
  views: "Views — server-rendered .view pages",
  live: "Live — .view pages that update without reloads",
  react: "React — Inertia with React",
  vue: "Vue — Inertia with Vue",
  svelte: "Svelte — Inertia with Svelte 5",
  api: "API — JSON with bearer tokens, no pages",
};

/** Left in a template by running it; never copied into a new app. */
export function isRuntimeArtifact(path: string): boolean {
  const parts = path.split(sep);
  const name = parts.at(-1)!;
  return (
    parts.includes("node_modules") ||
    parts.includes(".build") ||
    name === ".env" ||
    /\.sqlite(-journal|-wal|-shm)?$/.test(name) ||
    parts.join("/").startsWith("public/build") ||
    parts.join("/").startsWith("storage/framework/sessions/")
  );
}

export async function listTemplates(): Promise<string[]> {
  const entries = await readdir(TEMPLATES_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(resolve(TEMPLATES_ROOT, name, "package.json")))
    .sort();
}

/** Scaffold a new app from `templates/<name>`. */
export async function newProject(rawArgs: string[]): Promise<void> {
  const runtimeProblem = unsupportedRuntimeMessage();
  if (runtimeProblem) {
    console.error(runtimeProblem);
    process.exitCode = 1;
    return;
  }
  let args: string[];
  let options: NewOptions;
  try {
    ({ positional: args, options } = parseFlags(rawArgs));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const templates = await listTemplates();
  // With --kit the lone positional is the directory (`bun create bunyad my-app --kit=react`).
  let template = options.kit ?? args[0];
  let targetArg = options.dir ?? (options.kit ? args[0] : args[1]);

  if (!template || !targetArg) {
    intro("Create a new Bunyad app");
    template =
      template ??
      (await select({
        label: "Which starter kit?",
        options: Object.fromEntries(
          Object.entries(STARTER_KITS).filter(([name]) => templates.includes(name)),
        ),
        default: "views",
      }));
    targetArg =
      targetArg ??
      (await text({
        label: "Directory name?",
        required: "Please provide a directory.",
        placeholder: "my-app",
        validate: (value) => appNameProblem(value) ?? undefined,
      }));
    options.database ??= await select({
      label: "Which database?",
      options: DATABASES,
      default: "sqlite",
    });
    options.install ??= await confirm({
      label: "Install dependencies now?",
      default: true,
    });
    options.git ??= await confirm({
      label: "Initialize a git repository?",
      default: true,
    });
    const ok = await confirm({
      label: `Create ${template} app in ./${targetArg}?`,
      default: true,
    });
    if (!ok) {
      outro("Cancelled.");
      return;
    }
  }

  const templateDir = resolve(TEMPLATES_ROOT, template);
  if (!existsSync(templateDir)) {
    console.error(`Template "${template}" not found.`);
    console.error(`Available: ${templates.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const nameProblem = appNameProblem(targetArg);
  if (nameProblem) {
    console.error(nameProblem);
    process.exitCode = 1;
    return;
  }

  const target = resolve(process.cwd(), targetArg);
  // An empty existing directory is fine (e.g. one you just created); anything else is not.
  if (existsSync(target) && (await readdir(target).catch(() => ["?"])).length > 0) {
    console.error(`Directory already exists and is not empty: ${target}`);
    console.error("Choose another name, or remove it first.");
    process.exitCode = 1;
    return;
  }

  await cp(templateDir, target, {
    recursive: true,
    filter: (source) => !isRuntimeArtifact(relative(templateDir, source)),
  });
  const appName = targetArg
    .split(/[/\\]/)
    .pop()!
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
  if (options.database && options.database !== "sqlite") {
    await applyDatabase(target, options.database, appName);
  }
  if (existsSync(resolve(target, ".env.example"))) {
    await writeAppKey(target);
  }
  const pkgPath = resolve(target, "package.json");
  const pkgJson = JSON.parse(await Bun.file(pkgPath).text()) as {
    name: string;
    scripts?: Record<string, string>;
  };
  pkgJson.name = `@bunyad-apps/${appName}`;
  await Bun.write(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
  if (BUNDLED) await makeStandalone(target);

  outro(`Created ${template} app → ${target}`);
  const installed = options.install ? await run(["bun", "install"], target) : false;
  if (options.git) await run(["git", "init", "-q"], target);
  console.log("Next steps:");
  console.log(`  cd ${targetArg}`);
  if (!installed) console.log("  bun install");
  if (existsSync(resolve(target, "database/migrations"))) {
    console.log("  bun ./bunyad migrate");
  }
  const hint = flockServedHint(appName, target);
  if (hint) {
    // Flock serves the app but does not run the asset watchers.
    if (pkgJson.scripts?.build) console.log("  bun run build");
    console.log(`  ${hint}`);
  } else {
    console.log(pkgJson.scripts?.dev ? "  bun run dev" : "  bun ./bunyad serve");
  }
}

/** Run a command in `cwd`, showing its output. False when it fails or is missing. */
async function run(command: string[], cwd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    return (await proc.exited) === 0;
  } catch {
    console.error(`Could not run \`${command.join(" ")}\`.`);
    return false;
  }
}

/** Point `.env.example` at PostgreSQL or MySQL instead of the template's SQLite. */
export async function applyDatabase(
  target: string,
  database: string,
  appName: string,
): Promise<void> {
  const file = resolve(target, ".env.example");
  if (!existsSync(file)) return;
  const values: Record<string, string> =
    database === "pgsql"
      ? { DB_PORT: "5432", DB_USERNAME: "postgres" }
      : { DB_PORT: "3306", DB_USERNAME: "root" };
  const settings: Record<string, string> = {
    DB_CONNECTION: database,
    DB_HOST: "127.0.0.1",
    DB_PORT: values.DB_PORT!,
    DB_DATABASE: appName.replace(/-/g, "_"),
    DB_USERNAME: values.DB_USERNAME!,
    DB_PASSWORD: "",
  };
  let text = await Bun.file(file).text();
  for (const [key, value] of Object.entries(settings)) {
    const line = new RegExp(`^#?\\s*${key}=.*$`, "m");
    text = line.test(text)
      ? text.replace(line, `${key}=${value}`)
      : `${text}${text.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  }
  await Bun.write(file, text);
}

/**
 * A kit copied out of the published CLI has to stand on its own: depend on the
 * published `@bunyad/*` versions, and carry its own TypeScript settings.
 */
async function makeStandalone(target: string): Promise<void> {
  const cli = (await Bun.file(resolve(import.meta.dir, "../package.json")).json()) as {
    version: string;
  };
  const pkgPath = resolve(target, "package.json");
  const pkg = JSON.parse(await Bun.file(pkgPath).text()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const field of ["dependencies", "devDependencies"] as const) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (range.startsWith("workspace:")) pkg[field]![name] = `^${cli.version}`;
    }
  }
  pkg.devDependencies = {
    "@types/bun": "latest",
    typescript: "^5.9.2",
    ...pkg.devDependencies,
  };
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const tsconfigPath = resolve(target, "tsconfig.json");
  const baseFile = resolve(TEMPLATES_ROOT, "tsconfig.base.json");
  if (existsSync(tsconfigPath) && existsSync(baseFile)) {
    const tsconfig = JSON.parse(await Bun.file(tsconfigPath).text()) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
    };
    if (tsconfig.extends?.endsWith("tsconfig.base.json")) {
      const base = JSON.parse(await Bun.file(baseFile).text()) as {
        compilerOptions: Record<string, unknown>;
      };
      delete tsconfig.extends;
      tsconfig.compilerOptions = { ...base.compilerOptions, ...tsconfig.compilerOptions };
      await Bun.write(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
    }
  }
}

/** When Flock is installed, new apps in a parked folder are served at name.test. */
export function flockServedHint(appName: string, target = process.cwd()): string | null {
  const home =
    process.env.FLOCK_HOME ??
    (process.platform === "darwin"
      ? `${process.env.HOME}/Library/Application Support/Flock`
      : process.platform === "win32"
        ? `${process.env.APPDATA}\\Flock`
        : `${process.env.HOME}/.local/share/flock`);
  const parked = process.env.FLOCK_PARK ?? `${process.env.HOME}/Flock`;
  const hasFlock =
    Boolean(process.env.FLOCK_CONTROL_URL) || existsSync(`${home}/config/flock.json`);
  if (!hasFlock) {
    return null;
  }
  if (target.startsWith(parked) || existsSync(`${home}/config/flock.json`)) {
    return `open http://${appName}.test   # Flock`;
  }
  return `flock link ${appName} && open http://${appName}.test`;
}

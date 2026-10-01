import { cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { writeAppKey } from "./key.ts";
import { confirm, intro, outro, select, text } from "./prompts.ts";

const TEMPLATES_ROOT = resolve(import.meta.dir, "../../../templates");

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
function isRuntimeArtifact(path: string): boolean {
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
export async function newProject(args: string[]): Promise<void> {
  const templates = await listTemplates();
  let template = args[0];
  let targetArg = args[1];

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
      }));
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

  const target = resolve(process.cwd(), targetArg);
  if (existsSync(target)) {
    console.error(`Directory already exists: ${target}`);
    process.exitCode = 1;
    return;
  }

  await cp(templateDir, target, {
    recursive: true,
    filter: (source) => !isRuntimeArtifact(relative(templateDir, source)),
  });
  if (existsSync(resolve(target, ".env.example"))) {
    await writeAppKey(target);
  }

  const appName = targetArg
    .split(/[/\\]/)
    .pop()!
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
  const pkgPath = resolve(target, "package.json");
  const pkgJson = JSON.parse(await Bun.file(pkgPath).text()) as {
    name: string;
    scripts?: Record<string, string>;
  };
  pkgJson.name = `@bunyad-apps/${appName}`;
  await Bun.write(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);

  outro(`Created ${template} app → ${target}`);
  console.log("Next steps:");
  console.log(`  cd ${targetArg}`);
  console.log("  bun install");
  if (existsSync(resolve(target, "database/migrations"))) {
    console.log("  bunyad migrate");
  }
  const hint = flockServedHint(appName, target);
  if (hint) {
    // Flock serves the app but does not run the asset watchers.
    if (pkgJson.scripts?.build) console.log("  bun run build");
    console.log(`  ${hint}`);
  } else {
    console.log(pkgJson.scripts?.dev ? "  bun run dev" : "  bunyad serve");
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

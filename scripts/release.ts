/**
 * Build, pack or publish every publishable package in dependency order.
 *
 *   bun scripts/release.ts build
 *   bun scripts/release.ts pack [outDir]          (default .packs)
 *   bun scripts/release.ts publish [--dry-run] [--otp=123456] [--only=orm,cli]
 *
 * The order lives in scripts/publish-order.json (dependencies first).
 * Publishing goes through pnpm, which applies `publishConfig.exports` and turns
 * `workspace:^` into real version ranges. Packages are published under the
 * `alpha` tag. A version that is already on npm is skipped, so a failed run can
 * simply be repeated.
 */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const [mode, ...rest] = process.argv.slice(2);
const flags = rest.filter((arg) => arg.startsWith("--"));
const outDir = resolve(root, rest.find((arg) => !arg.startsWith("--")) ?? ".packs");
const only = flags.find((f) => f.startsWith("--only="))?.slice("--only=".length).split(",");
const otp = flags.find((f) => f.startsWith("--otp="));
const dryRun = flags.includes("--dry-run");

const order: string[] = await Bun.file(join(root, "scripts/publish-order.json")).json();
const names = only ?? order;
if (!["build", "pack", "publish"].includes(mode ?? "")) {
  console.error("Usage: bun scripts/release.ts build | pack [outDir] | publish [--dry-run] [--otp=…] [--only=a,b]");
  process.exit(1);
}

function sh(cmd: string[], cwd: string): { ok: boolean; out: string } {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
}

async function alreadyPublished(name: string, version: string): Promise<boolean> {
  const r = sh(["npm", "view", `${name}@${version}`, "version"], root);
  return r.ok && r.out.trim() === version;
}

let failed = 0;
for (const name of names) {
  const dir = join(root, "packages", name);
  const pkg = await Bun.file(join(dir, "package.json")).json();

  const build = sh(["bun", "run", "build"], dir);
  if (!build.ok) {
    console.error(`FAIL build ${pkg.name}\n${build.out}`);
    process.exit(1);
  }
  if (mode === "build") {
    console.log(`built   ${pkg.name}`);
    continue;
  }
  if (mode === "pack") {
    const r = sh(["pnpm", "pack", "--pack-destination", outDir], dir);
    console.log(`${r.ok ? "packed " : "FAIL   "} ${pkg.name}`);
    if (!r.ok) {
      console.error(r.out);
      failed++;
    }
    continue;
  }
  if (!dryRun && (await alreadyPublished(pkg.name, pkg.version))) {
    console.log(`skip    ${pkg.name}@${pkg.version} (already on npm)`);
    continue;
  }
  const cmd = ["pnpm", "publish", "--tag", "alpha", "--no-git-checks", ...(dryRun ? ["--dry-run"] : []), ...(otp ? [otp] : [])];
  // Inherit the terminal so npm can ask for a one-time password or open the browser approval.
  console.log(`publishing ${pkg.name}@${pkg.version} ...`);
  const r = Bun.spawnSync(cmd, { cwd: dir, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`FAIL    ${pkg.name}@${pkg.version}`);
    process.exit(1); // dependents would fail too; stop here
  }
  console.log(`${dryRun ? "dry-run" : "published"} ${pkg.name}@${pkg.version}`);
}
process.exit(failed ? 1 : 0);

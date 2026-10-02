/**
 * Build, pack or publish every publishable package in dependency order.
 *
 *   bun scripts/release.ts build
 *   bun scripts/release.ts pack [outDir]          (default .packs)
 *   bun scripts/release.ts version <x.y.z[-tag.n]> (sets one lock-step version on the beta packages)
 *   bun scripts/release.ts publish [--dry-run] [--otp=123456] [--only=orm,cli] [--tag=beta]
 *
 * The order lives in scripts/publish-order.json (dependencies first); the packages
 * that ship in the beta live in scripts/beta-packages.json.
 * Publishing goes through pnpm, which applies `publishConfig.exports` and turns
 * `workspace:^` into real version ranges. The dist-tag comes from the version
 * (`0.2.0-beta.0` -> `beta`, `0.1.0-alpha.1` -> `alpha`) or `--tag=`; a stable
 * version without `--tag=` is refused, so `latest` only moves on purpose. A
 * `-beta` version publishes only the beta packages unless `--only=` says otherwise.
 * A version that is already on npm is skipped, so a failed run can simply be repeated.
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
const betaSet: string[] = await Bun.file(join(root, "scripts/beta-packages.json")).json();
const tagFlag = flags.find((f) => f.startsWith("--tag="))?.slice("--tag=".length);
if (!["build", "pack", "publish", "version"].includes(mode ?? "")) {
  console.error("Usage: bun scripts/release.ts build | pack [outDir] | version <v> | publish [--dry-run] [--otp=…] [--only=a,b] [--tag=beta]");
  process.exit(1);
}

if (mode === "version") {
  const next = rest.find((arg) => !arg.startsWith("--"));
  if (!next || !/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/.test(next)) {
    console.error("Usage: bun scripts/release.ts version <x.y.z[-tag.n]>");
    process.exit(1);
  }
  for (const name of betaSet) {
    const file = join(root, "packages", name, "package.json");
    const text = await Bun.file(file).text();
    await Bun.write(file, text.replace(/"version": "[^"]+"/, `"version": "${next}"`));
    console.log(`${name} -> ${next}`);
  }
  process.exit(0);
}

const firstPkg = await Bun.file(join(root, "packages", betaSet[0]!, "package.json")).json();
const prerelease = /-([a-z]+)\./.exec(firstPkg.version)?.[1];
const names = only ?? (mode === "publish" && prerelease === "beta" ? order.filter((n) => betaSet.includes(n)) : order);

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
  const distTag = tagFlag ?? /-([a-z]+)\./.exec(pkg.version)?.[1];
  if (!distTag) {
    console.error(`Refusing to publish stable ${pkg.name}@${pkg.version} without --tag=`);
    process.exit(1);
  }
  const cmd = ["pnpm", "publish", "--tag", distTag, "--no-git-checks", ...(dryRun ? ["--dry-run"] : []), ...(otp ? [otp] : [])];
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

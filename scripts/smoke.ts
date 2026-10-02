/**
 * Smoke test: scaffold an app with create-bunyad from freshly packed tarballs,
 * install it, migrate, serve it and request a page.
 *
 *   bun scripts/release.ts pack && bun scripts/smoke.ts [--kit=api]
 *
 * Every `@bunyad/*` dependency is overridden with the local tarball, so nothing
 * from the npm registry's @bunyad scope is used.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packs = join(root, ".packs");
const kit = process.argv.find((a) => a.startsWith("--kit="))?.slice(6) ?? "api";

const overrides: Record<string, string> = {};
for (const file of readdirSync(packs)) {
  const match = /^(?:bunyad-(.+)|(create-bunyad))-\d.*\.tgz$/.exec(file);
  if (!match) continue;
  const name = match[2] ?? `@bunyad/${match[1]}`;
  overrides[name] = `file:${join(packs, file)}`;
}

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) {
    console.error(`FAIL: ${cmd.join(" ")}\n${out}`);
    process.exit(1);
  }
  return out;
}

const work = mkdtempSync(join(tmpdir(), "bunyad-smoke-"));
console.log(`workdir ${work}`);

// 1. A throwaway project that only holds create-bunyad (plus the local overrides).
writeFileSync(
  join(work, "package.json"),
  JSON.stringify({ name: "smoke-host", private: true, dependencies: { "create-bunyad": overrides["create-bunyad"] }, overrides }, null, 2),
);
run(["bun", "install"], work);

// 2. Scaffold.
run(["bun", "./node_modules/create-bunyad/index.js", "app", `--kit=${kit}`, "--no-install", "--no-git"], work);
const app = join(work, "app");

// 3. Point the app at the local tarballs and install.
const pkgPath = join(app, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
for (const field of ["dependencies", "devDependencies"] as const) {
  for (const name of Object.keys(pkg[field] ?? {})) if (overrides[name]) pkg[field][name] = overrides[name];
}
pkg.overrides = overrides;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
run(["bun", "install"], app);

// 4. Migrate, serve, request.
console.log(run(["bun", "./bunyad", "migrate"], app).trim());
const port = 40000 + Math.floor(Math.random() * 1000);
const server = Bun.spawn(["bun", "./bunyad", "serve"], { cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, PORT: String(port) } });
let status = 0;
for (let i = 0; i < 50 && !status; i++) {
  try {
    status = (await fetch(`http://127.0.0.1:${port}/`)).status;
  } catch {
    await Bun.sleep(200);
  }
}
server.kill();
if (!status) {
  console.error("FAIL: server never answered\n" + (await new Response(server.stderr).text()));
  process.exit(1);
}
console.log(`GET / -> ${status}`);
if (status >= 500) process.exit(1);
console.log("smoke ok");

/**
 * Apply npm publish metadata to every publishable `@bunyad/*` package:
 * `bun scripts/prepare-packages.ts`. Idempotent. Dev exports keep pointing at
 * `src/` (Bun runs TypeScript directly); `publishConfig.exports` (applied by
 * `pnpm publish`) points at the built `dist/`.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
/** One lock-step version: set it with `bun scripts/release.ts version <x.y.z>`; this script follows it. */
const VERSION: string = JSON.parse(readFileSync(join(root, "packages/contracts/package.json"), "utf8")).version;
const SKIP = new Set(["nestjs", "create-bunyad"]);
/** Packages that also run on plain Node (everything else needs Bun). */
const NODE_OK = new Set(["contracts", "common", "database", "orm"]);

const DESCRIPTIONS: Record<string, string> = {
  auth: "Authentication for Bunyad: sessions, password, remember-me, email verification and bearer tokens.",
  billing: "Subscription billing helpers for Bunyad.",
  broadcasting: "Realtime broadcasting for Bunyad: SSE, Pusher and Ably drivers.",
  cache: "Cache for Bunyad: memory, file, Redis and database stores with tags.",
  cli: "The bunyad command line: scaffold apps, run migrations, serve, and generate code.",
  common: "Collections, string/array helpers and errors shared across Bunyad packages.",
  compiler: "Build-time compiler for Bunyad: turns routes, views and the container into optimized JavaScript.",
  config: "Configuration loading for Bunyad.",
  console: "Console output and command helpers for Bunyad.",
  container: "Dependency-injection container for Bunyad.",
  contracts: "Shared TypeScript interfaces for Bunyad packages.",
  core: "Application kernel for Bunyad: bootstrapping, providers and the HTTP lifecycle.",
  database: "Query builder, schema builder, migrations and multi-driver connections (SQLite, PostgreSQL, MySQL, MariaDB, SQL Server) for Bunyad.",
  events: "Event dispatcher for Bunyad.",
  features: "Feature flags for Bunyad.",
  filesystem: "Storage abstraction for Bunyad: local disk and S3.",
  framework: "The Bunyad framework: the full stack in one package.",
  head: "HTML head management for Bunyad.",
  http: "HTTP requests, responses and middleware for Bunyad.",
  image: "Image processing for Bunyad.",
  inertia: "Inertia.js server adapter for Bunyad.",
  live: "Server-driven reactive components for Bunyad views.",
  log: "Logging for Bunyad.",
  mail: "Mail for Bunyad: SMTP and other drivers.",
  metrics: "Application metrics for Bunyad.",
  migrate: "Database migration runner for Bunyad.",
  notifications: "Notifications for Bunyad: mail, database, Slack, SMS and broadcast channels.",
  oauth: "OAuth social login for Bunyad.",
  orm: "Active-record ORM for Bunyad: models, relations, casts, scopes, events, factories.",
  queue: "Queues for Bunyad: delayed jobs, chains and batches.",
  router: "Routing for Bunyad.",
  schedule: "Task scheduler for Bunyad.",
  search: "Full-text search for Bunyad.",
  session: "Sessions for Bunyad.",
  testing: "Testing helpers for Bunyad apps.",
  validation: "Validation for Bunyad: rules, form requests and messages.",
  view: "Server-rendered .view templates for Bunyad.",
};

type Json = Record<string, any>;

const toDist = (path: string, types: boolean) =>
  path.replace("./src/", "./dist/").replace(/\.ts$/, types ? ".d.ts" : ".js");

function publishExports(exports: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string") {
      out[key] = { types: toDist(value, true), default: toDist(value, false) };
      continue;
    }
    const entry: Json = { types: toDist(value.types, true) };
    for (const [cond, target] of Object.entries<string>(value)) {
      if (cond !== "types") entry[cond] = toDist(target, false);
    }
    out[key] = entry;
  }
  return out;
}

for (const name of readdirSync(join(root, "packages")).sort()) {
  if (SKIP.has(name)) continue;
  const file = join(root, "packages", name, "package.json");
  const pkg: Json = JSON.parse(readFileSync(file, "utf8"));
  const description = DESCRIPTIONS[name];
  if (!description) throw new Error(`no description for ${name}`);

  const extraFiles = name === "cli" ? ["templates"] : [];
  const out: Json = {
    name: pkg.name,
    version: VERSION,
    description,
    license: "MIT",
    author: "Shah Khalid",
    type: "module",
    repository: {
      type: "git",
      url: "git+https://github.com/bunyadjs/framework.git",
      directory: `packages/${name}`,
    },
    homepage: "https://github.com/bunyadjs/framework#readme",
    bugs: { url: "https://github.com/bunyadjs/framework/issues" },
    keywords: ["bunyad", "bun", "typescript", ...(name === "orm" ? ["orm", "active-record"] : [])],
    files: ["dist", ...extraFiles, "README.md", "LICENSE"],
    engines: NODE_OK.has(name) ? { node: ">=20" } : { bun: ">=1.4.0" },
  };
  for (const [key, value] of Object.entries(pkg)) {
    if (key in out || ["private", "version", "type", "publishConfig", "bin"].includes(key)) continue;
    out[key] = value;
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!out[field]) continue;
    out[field] = Object.fromEntries(
      Object.entries<string>(out[field]).map(([dep, range]) => [
        dep,
        field === "devDependencies" ? range : range.replace(/^workspace:\*$/, "workspace:^"),
      ]),
    );
  }
  const build = "bun ../../scripts/build-package.ts .";
  out.scripts = {
    ...pkg.scripts,
    build: name === "cli" ? `${build} && bun scripts/bundle-templates.ts` : build,
  };
  out.publishConfig = { access: "public", exports: publishExports(pkg.exports) };
  if (pkg.bin) {
    out.bin = pkg.bin;
    out.publishConfig.bin = Object.fromEntries(
      Object.entries<string>(pkg.bin).map(([cmd, path]) => [cmd, toDist(path, false)]),
    );
  }
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  copyFileSync(join(root, "LICENSE"), join(root, "packages", name, "LICENSE"));

  // Never overwrite a README: they are hand-written. Only create a minimal one when it is missing.
  const readme = join(root, "packages", name, "README.md");
  if (!existsSync(readme)) {
    const install = NODE_OK.has(name)
      ? `npm install ${pkg.name}@beta`
      : `bun add ${pkg.name}@beta`;
    const runtime = NODE_OK.has(name) ? "Works on Node 20+ and Bun." : "Requires Bun 1.4 or newer.";
    writeFileSync(
      readme,
      `# ${pkg.name}

${description}

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

\`\`\`bash
${install}
\`\`\`

${runtime} Part of [Bunyad](https://github.com/bunyadjs/framework).

## License

MIT
`,
    );
  }
}
console.log("prepared packages");

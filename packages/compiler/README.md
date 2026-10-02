# @bunyad/compiler

Build-time compiler for Bunyad apps: runs analysis and generation plugins (routes, middleware, providers, config, migrations, workers, server entry) and writes generated modules plus a manifest.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/compiler@beta   # or: npm install @bunyad/compiler@beta
```

## Usage

```ts
import { compile, type CompilerPlugin } from "@bunyad/compiler";

const hello: CompilerPlugin = {
  name: "hello",
  generate(ctx) {
    ctx.writeModule("hello", "hello.ts", `export const hello = "hi";\n`);
    ctx.setManifestModule("hello", "./hello.ts");
    ctx.setManifestMeta("hello", { present: true });
  },
};

const manifest = await compile({
  root: process.cwd(),
  outDir: "./.build",
  appName: "demo",
  routesEntries: ["./routes/web.ts"],
  plugins: [hello],
  bootstrap: { applicationModule: "./bootstrap/app.ts" },
});

manifest.version;       // 1
manifest.modules.hello; // "./hello.ts"
manifest.meta.hello;    // { present: true }
// .build/ now holds manifest.json, routes.ts, server.ts, queue-worker.ts, schedule-worker.ts, standalone.ts and hello.ts
```

## Notes

- Bun-only runtime. Normally driven by the `bunyad compile` CLI.
- The router, middleware, providers, migrations, discovery, config, server and workers plugins always run first; `plugins` are appended after them (for example `createViewPlugin()` from `@bunyad/view`).
- Route entries need at least one route file. Closure routes are skipped with a warning; controller routes must live under `app/Http/Controllers`.
- Set `optimize: true` to emit the radix route matcher.

## License

MIT

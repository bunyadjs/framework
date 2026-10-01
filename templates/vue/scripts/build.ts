/**
 * `bun run build` — bundle `resources/js/app.ts` and the stylesheet into
 * `public/build`. `--watch` rebuilds the bundle when `resources/js` changes
 * (`bun run dev` runs Tailwind's own watcher alongside).
 *
 * Pages are found, not listed: `virtual:pages` maps every file under
 * `resources/js/pages` to a lazy import, so `Inertia.render("auth/login")`
 * loads `pages/auth/login.vue` in its own chunk. `.vue` files are compiled
 * with `@vue/compiler-sfc`.
 */
import { watch } from "node:fs";
import { relative, resolve } from "node:path";
import { Glob, type BunPlugin } from "bun";
import { vue } from "./vue-plugin.ts";

const root = resolve(import.meta.dir, "..");
const pagesDir = resolve(root, "resources/js/pages");
const production = process.env.NODE_ENV === "production";

const pages: BunPlugin = {
  name: "inertia-pages",
  setup(build) {
    build.onResolve({ filter: /^virtual:pages$/ }, () => ({ path: "pages", namespace: "inertia-pages" }));
    build.onLoad({ filter: /.*/, namespace: "inertia-pages" }, async () => {
      const entries: string[] = [];
      for await (const file of new Glob("**/*.vue").scan(pagesDir)) {
        const name = file.replace(/\.vue$/, "").replaceAll("\\", "/");
        entries.push(`  ${JSON.stringify(name)}: () => import(${JSON.stringify(resolve(pagesDir, file))}),`);
      }
      return { contents: `export const pages = {\n${entries.sort().join("\n")}\n};\n`, loader: "ts" };
    });
  },
};

async function bundle(): Promise<boolean> {
  const started = performance.now();
  const result = await Bun.build({
    entrypoints: [resolve(root, "resources/js/app.ts")],
    outdir: resolve(root, "public/build"),
    target: "browser",
    format: "esm",
    splitting: true,
    minify: production,
    sourcemap: production ? "none" : "linked",
    naming: { entry: "app.js", chunk: "chunks/[name]-[hash].js", asset: "assets/[name]-[hash].[ext]" },
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    plugins: [pages, vue],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }
  console.log(`bundled ${result.outputs.length} files in ${Math.round(performance.now() - started)}ms`);
  return true;
}

if (process.argv.includes("--watch")) {
  await bundle();
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(resolve(root, "resources/js"), { recursive: true }, (_event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`changed ${relative(root, resolve(root, "resources/js", String(file)))}`);
      void bundle();
    }, 50);
  });
} else {
  const css = Bun.spawnSync(
    ["bunx", "tailwindcss", "-i", "resources/css/app.css", "-o", "public/build/app.css", "--minify"],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (!(await bundle()) || css.exitCode !== 0) process.exit(1);
}
